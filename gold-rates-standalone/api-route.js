/**
 * api-route.js
 * Drop this into your Next.js app as: app/api/gold-rates/route.js
 *
 * Call GET /api/gold-rates to fetch live gold rates and store to Supabase.
 * Schedule this endpoint every 60 seconds using a cron job (Railway, Vercel, etc).
 *
 * Supabase table required:
 *   CREATE TABLE gold_rates (
 *     id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     fetched_at      timestamptz NOT NULL DEFAULT now(),
 *     kalinga_sell_rate float,
 *     ambica_sell_rate  float,
 *     aamlin_sell_rate  float
 *   );
 *
 * Env vars needed:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET   (optional — if set, requests must include Authorization: Bearer <secret>)
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchKalingaRate() {
  try {
    const url = `https://bcast.kalingakawad.com:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/kalingabanglore?_=${Date.now()}`
    const res = await fetch(url, {
      headers: { Referer: 'https://kalingakawad.com/', Accept: 'text/plain' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    for (const line of text.trim().split('\n')) {
      if (line.toUpperCase().includes('GOLD 999') && line.toUpperCase().includes('WITH GST FOR REF')) {
        const numbers = line.match(/\d+/g)
        if (numbers && numbers.length >= 3) {
          const sell = parseFloat(numbers[2])
          if (sell > 100000) return sell
        }
      }
    }
    return null
  } catch (err) {
    console.error('Kalinga error:', err.message)
    return null
  }
}

async function fetchAmbicaaRate() {
  try {
    const url = 'https://rsbl-spot-gold-silver-prices.firebaseio.com/liverates/GOLDBLR999IND.json'
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const sell = parseFloat(json?.Sell || json?.Ask || 0)
    if (sell > 100000) return sell
    return null
  } catch (err) {
    console.error('Ambicaa error:', err.message)
    return null
  }
}

export async function GET(req) {
  // Optional auth — protect the endpoint so only your cron can call it
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [kalinga_sell_rate, ambica_sell_rate] = await Promise.all([
    fetchKalingaRate(),
    fetchAmbicaaRate(),
  ])

  if (!kalinga_sell_rate && !ambica_sell_rate) {
    return Response.json({ success: false, message: 'All rate sources failed' }, { status: 500 })
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

export async function POST(req) { return GET(req) }
