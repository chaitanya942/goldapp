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
    const BASE = 'http://dashboard.ambicaaspot.com:10001'

    // Step 1: Handshake — get session ID
    const hsRes  = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, { signal: AbortSignal.timeout(8000) })
    const hsText = await hsRes.text()
    const sidMatch = hsText.match(/"sid":"([^"]+)"/)
    if (!sidMatch) throw new Error('No SID')
    const sid = sidMatch[1]

    // Step 2: Send connect packet (40 = socket.io connect to default namespace)
    await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '40',
      signal: AbortSignal.timeout(5000),
    })

    // Step 3: Poll to confirm connection
    await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, {
      signal: AbortSignal.timeout(5000),
    })

    // Step 4: Emit room join — 42["room","ambicaaspot"]
    await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '42["room","ambicaaspot"]',
      signal: AbortSignal.timeout(5000),
    })

    // Step 5: Poll multiple times — server sends data after room join
    for (let i = 0; i < 5; i++) {
      const pollRes  = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { signal: AbortSignal.timeout(8000) })
      const pollText = await pollRes.text()

      // Look for message event with Rate data
      // Format: 42["message",{"Rate":[...]}]
      if (pollText.includes('"message"') && pollText.includes('IND-GOLD')) {
        // Extract the JSON part after 42["message",
        const start = pollText.indexOf('42["message",')
        if (start !== -1) {
          const jsonStr = pollText.slice(start + 13, pollText.lastIndexOf(']') + 1)
          try {
            const data  = JSON.parse(jsonStr)
            const rates = data?.Rate || []
            for (const rate of rates) {
              if (rate.Symbol && rate.Symbol.toUpperCase().includes('IND-GOLD') && rate.Symbol.includes('1KG')) {
                const sell = parseFloat(rate.Ask)
                if (sell > 100000) return sell
              }
            }
          } catch {}
        }
        // Fallback number extraction
        const idx = pollText.indexOf('IND-GOLD')
        if (idx !== -1) {
          const numbers = pollText.slice(idx, idx + 300).match(/\d{6}/g)
          if (numbers && numbers.length >= 2) return parseFloat(numbers[1])
        }
      }

      // Small wait before next poll
      await new Promise(r => setTimeout(r, 500))
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

// Debug endpoint — call /api/fetch-gold-rates?debug=1 to see raw responses
export async function GET_DEBUG(req) {
  const url = new URL(req.url)
  if (url.searchParams.get('debug') !== '1') return GET(req)

  const results = {}

  // Test Kalinga
  try {
    const kRes = await fetch(`https://bcast.kalingakawad.com:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/kalingabanglore?_=${Date.now()}`, {
      headers: { 'Referer': 'https://kalingakawad.com/' },
      signal: AbortSignal.timeout(8000),
    })
    results.kalinga_status = kRes.status
    results.kalinga_raw    = (await kRes.text()).slice(0, 300)
  } catch (e) { results.kalinga_error = e.message }

  // Test Ambicaa handshake
  try {
    const aRes = await fetch(`http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000),
    })
    results.ambicaa_status = aRes.status
    results.ambicaa_raw    = (await aRes.text()).slice(0, 300)
  } catch (e) { results.ambicaa_error = e.message }

  return Response.json(results)
}