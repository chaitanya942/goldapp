// app/api/fetch-gold-rates/route.js
// Fetches live gold sell rates from Kalinga Kawad and Ambicaa every minute
// Called by Vercel Cron Job

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Kalinga Kawad ─────────────────────────────────────────────────────────────
// Plain text response, space-separated rows
// Line format: ID  NAME  BUY  SELL  HIGH  LOW
// Target: "GOLD 999  IMP WITH GST FOR REF"
async function fetchKalingaRate() {
  try {
    const url = `https://bcast.kalingakawad.com:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/kalingabanglore?_=${Date.now()}`
    const res  = await fetch(url, {
      headers: { 'Referer': 'https://kalingakawad.com/', 'Accept': 'text/plain' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()

    // Parse each line — find the GOLD 999 IMP WITH GST FOR REF row
    const lines = text.trim().split('\n')
    for (const line of lines) {
      if (line.toUpperCase().includes('GOLD 999') && line.toUpperCase().includes('WITH GST FOR REF')) {
        // Format: ID  NAME(multiple words)  BUY(-)  SELL  HIGH  LOW
        // Values are the numbers at the end — extract all numbers
        const numbers = line.match(/\d+/g)
        if (numbers && numbers.length >= 3) {
          // SELL is the first number after BUY (which is '-')
          // From response: "4992  GOLD 999  IMP WITH GST FOR REF  -  149802  150253  144277"
          // numbers[0]=4992(ID), numbers[1]=999(part of name), numbers[2]=149802(sell), numbers[3]=150253(high), numbers[4]=144277(low)
          // Actually: sell = numbers[2], high = numbers[3]
          const sell = parseFloat(numbers[2])
          if (sell > 100000) return sell // sanity check — gold rate should be >1 lakh
        }
      }
    }
    return null
  } catch (err) {
    console.error('Kalinga fetch error:', err.message)
    return null
  }
}

// ── Ambicaa ───────────────────────────────────────────────────────────────────
// Connect to Ambicaa's Socket.IO server via long-polling (no websocket needed)
// Server: http://dashboard.ambicaaspot.com:10001
// Event: 'message' → data.Rate[] → find IND-GOLD[999]-1KG → Ask = sell rate
async function fetchAmbicaaRate() {
  try {
    // Step 1: Handshake to get session ID
    const handshakeUrl = `http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&t=${Date.now()}`
    const handshakeRes = await fetch(handshakeUrl, {
      signal: AbortSignal.timeout(8000),
    })
    if (!handshakeRes.ok) throw new Error(`Handshake failed: ${handshakeRes.status}`)
    const handshakeText = await handshakeRes.text()

    // Response format: 0{"sid":"...","upgrades":["websocket"],...}
    const sidMatch = handshakeText.match(/"sid":"([^"]+)"/)
    if (!sidMatch) throw new Error('No session ID in handshake')
    const sid = sidMatch[1]

    // Step 2: Poll for data with session ID
    // Need to send room join first
    const joinUrl = `http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`
    
    // Send room join message (42 = socket.io message, emit room with username)
    await fetch(joinUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '42["room","ambicaaspot"]',
      signal: AbortSignal.timeout(5000),
    })

    // Step 3: Poll for rate data
    const pollUrl = `http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`
    const pollRes = await fetch(pollUrl, { signal: AbortSignal.timeout(8000) })
    if (!pollRes.ok) throw new Error(`Poll failed: ${pollRes.status}`)
    const pollText = await pollRes.text()

    // Parse socket.io message — look for 'message' event with Rate array
    // Format: 42["message",{"Rate":[{"Symbol":"IND-GOLD[999]-1KG --today","Ask":149779,...}]}]
    const msgMatch = pollText.match(/42\["message",([\s\S]+?)\]\s*$/)
    if (msgMatch) {
      const data = JSON.parse(msgMatch[1])
      const rates = data?.Rate || []
      for (const rate of rates) {
        if (rate.Symbol && rate.Symbol.includes('IND-GOLD[999]-1KG')) {
          const sell = parseFloat(rate.Ask)
          if (sell > 100000) return sell
        }
      }
    }

    // Fallback: look for any 6-digit number near IND-GOLD
    const idx = pollText.indexOf('IND-GOLD')
    if (idx !== -1) {
      const chunk   = pollText.slice(idx, idx + 200)
      const numbers = chunk.match(/\d{6}/g)
      if (numbers && numbers.length >= 2) return parseFloat(numbers[1])
    }

    return null
  } catch (err) {
    console.error('Ambicaa fetch error:', err.message)
    return null
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(req) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [kalinga_sell_rate, ambica_sell_rate] = await Promise.all([
    fetchKalingaRate(),
    fetchAmbicaaRate(),
  ])

  // Only insert if at least one rate was fetched
  if (!kalinga_sell_rate && !ambica_sell_rate) {
    return Response.json({ success: false, message: 'Failed to fetch both rates' }, { status: 500 })
  }

  const { error } = await supabase.from('gold_rates').insert({
    kalinga_sell_rate,
    ambica_sell_rate,
    fetched_at: new Date().toISOString(),
  })

  if (error) {
    console.error('Supabase insert error:', error)
    return Response.json({ success: false, error: error.message }, { status: 500 })
  }

  return Response.json({
    success: true,
    kalinga_sell_rate,
    ambica_sell_rate,
    fetched_at: new Date().toISOString(),
  })
}

// Also allow POST for manual testing
export async function POST(req) {
  return GET(req)
}