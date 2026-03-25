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
// Scrape HTML page — IND-GOLD[999]-1KG sell rate is in the DOM table
async function fetchAmbicaaRate() {
  try {
    const res = await fetch('http://ambicaaspot.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()

    // Find IND-GOLD[999]-1KG row and extract sell rate
    // HTML structure: <td>IND-GOLD[999]-1KG --today</td><td>BUY</td><td>SELL</td>
    const regex = /IND-GOLD\[999\]-1KG[^<]*<\/[^>]+>[\s\S]*?<td[^>]*>[\s\S]*?(\d{6})/i
    const match = html.match(regex)
    if (match) {
      const sell = parseFloat(match[1])
      if (sell > 100000) return sell
    }

    // Fallback: look for the number pattern near the product name
    const idx = html.indexOf('IND-GOLD[999]-1KG')
    if (idx !== -1) {
      const chunk   = html.slice(idx, idx + 500)
      const numbers = chunk.match(/\d{6}/g)
      if (numbers && numbers.length >= 2) {
        return parseFloat(numbers[1]) // second 6-digit number = sell
      }
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