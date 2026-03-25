// app/api/fetch-gold-rates/route.js
// Fetches live gold sell rates from Kalinga Kawad, Ambicaa and Aamlin every minute

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Kalinga Kawad ─────────────────────────────────────────────────────────────
async function fetchKalingaRate() {
  try {
    const url = `https://bcast.kalingakawad.com:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/kalingabanglore?_=${Date.now()}`
    const res  = await fetch(url, {
      headers: { 'Referer': 'https://kalingakawad.com/', 'Accept': 'text/plain' },
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
    console.error('Kalinga fetch error:', err.message)
    return null
  }
}

// ── Socket.IO helper ──────────────────────────────────────────────────────────
// Reusable for both Ambicaa and Aamlin (same platform, different servers/rooms)
async function fetchSocketIORate(baseUrl, roomName, symbolMatcher) {
  try {
    // Step 1: Handshake
    const hsRes  = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, { signal: AbortSignal.timeout(8000) })
    const hsText = await hsRes.text()
    const sidMatch = hsText.match(/"sid":"([^"]+)"/)
    if (!sidMatch) throw new Error('No SID')
    const sid = sidMatch[1]

    // Step 2: Connect to namespace
    await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '40', signal: AbortSignal.timeout(5000),
    })

    // Step 3: Confirm connection
    await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { signal: AbortSignal.timeout(5000) })

    // Step 4: Join room
    await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: `42["room","${roomName}"]`, signal: AbortSignal.timeout(5000),
    })

    // Step 5: Poll for rate data
    for (let i = 0; i < 5; i++) {
      const pollRes  = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { signal: AbortSignal.timeout(8000) })
      const pollText = await pollRes.text()

      if (pollText.includes('"message"') && pollText.includes('Gold')) {
        const start = pollText.indexOf('42["message",')
        if (start !== -1) {
          const jsonStr = pollText.slice(start + 13, pollText.lastIndexOf(']') + 1)
          try {
            const data  = JSON.parse(jsonStr)
            const rates = data?.Rate || []
            for (const rate of rates) {
              if (rate.Symbol && symbolMatcher(rate.Symbol)) {
                const sell = parseFloat(rate.Ask)
                if (sell > 100000) return sell
              }
            }
          } catch {}
        }
        // Fallback: extract 6-digit number near symbol
        const idx = pollText.search(/Gold 999 IND/i)
        if (idx !== -1) {
          const numbers = pollText.slice(idx, idx + 300).match(/\d{6}/g)
          if (numbers && numbers.length >= 1) return parseFloat(numbers[0])
        }
      }
      await new Promise(r => setTimeout(r, 500))
    }
    return null
  } catch (err) {
    console.error(`Socket.IO fetch error (${roomName}):`, err.message)
    return null
  }
}

// ── Ambicaa ───────────────────────────────────────────────────────────────────
async function fetchAmbicaaRate() {
  return fetchSocketIORate(
    'http://dashboard.ambicaaspot.com:10001',
    'ambicaaspot',
    (symbol) => symbol.toUpperCase().includes('IND-GOLD') && symbol.includes('1KG')
  )
}

// ── Aamlin Spot ───────────────────────────────────────────────────────────────
async function fetchAamlinRate() {
  return fetchSocketIORate(
    'https://starlinebulltech.in:10001',
    'aamlinspot',
    (symbol) => /gold\s*999\s*ind/i.test(symbol)
  )
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [kalinga_sell_rate, ambica_sell_rate, aamlin_sell_rate] = await Promise.all([
    fetchKalingaRate(),
    fetchAmbicaaRate(),
    fetchAamlinRate(),
  ])

  if (!kalinga_sell_rate && !ambica_sell_rate && !aamlin_sell_rate) {
    return Response.json({ success: false, message: 'Failed to fetch all rates' }, { status: 500 })
  }

  const { error } = await supabase.from('gold_rates').insert({
    kalinga_sell_rate,
    ambica_sell_rate,
    aamlin_sell_rate,
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
    aamlin_sell_rate,
    fetched_at: new Date().toISOString(),
  })
}

export async function POST(req) {
  return GET(req)
}