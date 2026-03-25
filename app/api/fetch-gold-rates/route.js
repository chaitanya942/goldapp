// app/api/fetch-gold-rates/route.js

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
// Key fix: do handshake + all setup in ONE poll batch, no delays between steps
async function fetchSocketIORate(baseUrl, roomName, symbolMatcher) {
  try {
    // Step 1: Handshake
    const hsRes = await fetch(
      `${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
      { signal: AbortSignal.timeout(8000) }
    )
    const hsText   = await hsRes.text()
    const sidMatch = hsText.match(/"sid":"([^"]+)"/)
    if (!sidMatch) throw new Error('No SID')
    const sid = sidMatch[1]

    // Step 2: Send connect + room join in parallel as a single combined body
    // EIO4 allows batching: separate packets with record separator \x1e
    // First send "40" (connect), then immediately "42[room,name]"
    const connectRes = await fetch(
      `${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: '40',
        signal: AbortSignal.timeout(5000),
      }
    )
    await connectRes.text()

    // Step 3: Read connect ack
    const ackRes = await fetch(
      `${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`,
      { signal: AbortSignal.timeout(5000) }
    )
    await ackRes.text()

    // Step 4: Join room immediately
    const joinRes = await fetch(
      `${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: `42["room","${roomName}"]`,
        signal: AbortSignal.timeout(5000),
      }
    )
    await joinRes.text()

    // Step 5: Poll rapidly — no setTimeout delays
    for (let i = 0; i < 6; i++) {
      const pollRes  = await fetch(
        `${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`,
        { signal: AbortSignal.timeout(8000) }
      )
      const pollText = await pollRes.text()

      // Check for session expired
      if (pollText.includes('Session ID unknown')) {
        console.error(`${roomName}: Session expired on poll ${i}`)
        break
      }

      // Look for message event with Rate array
      if (pollText.includes('"message"')) {
        const msgIdx = pollText.indexOf('42["message",')
        if (msgIdx !== -1) {
          try {
            // Find the matching closing bracket
            let depth = 0, end = msgIdx
            for (let j = msgIdx; j < pollText.length; j++) {
              if (pollText[j] === '[' || pollText[j] === '{') depth++
              else if (pollText[j] === ']' || pollText[j] === '}') { depth--; if (depth === 0) { end = j + 1; break } }
            }
            const raw  = pollText.slice(msgIdx + 2) // remove "42"
            const arr  = JSON.parse(raw.slice(0, end - msgIdx - 2 + 1))
            const data = arr[1]
            const rateArr = data?.Rate || data?.rate || []
            for (const rate of rateArr) {
              const sym  = rate.Symbol || rate.symbol || ''
              if (symbolMatcher(sym)) {
                const sell = parseFloat(rate.Ask || rate.ask || 0)
                if (sell > 100000) return sell
              }
            }
          } catch (e) {
            console.error(`${roomName} parse error:`, e.message)
          }
        }
      }
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
    (sym) => sym.toUpperCase().includes('IND-GOLD') && sym.includes('1KG')
  )
}

// ── Aamlin Spot ───────────────────────────────────────────────────────────────
// starlinebulltech.in:10001 is not reachable from Vercel (HTTPS on non-standard port blocked)
// Try HTTP fallback on port 10001 and also port 80
async function fetchAamlinRate() {
  // Try HTTP first (non-standard HTTPS port often blocked by Vercel)
  const urls = [
    'http://starlinebulltech.in:10001',
    'https://starlinebulltech.in:10001',
    'http://aamlinspot.in:10001',
  ]
  for (const url of urls) {
    try {
      const result = await fetchSocketIORate(
        url,
        'aamlinspot',
        (sym) => /gold\s*999\s*ind/i.test(sym)
      )
      if (result) return result
    } catch {}
  }
  return null
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

  return Response.json({ success: true, kalinga_sell_rate, ambica_sell_rate, aamlin_sell_rate, fetched_at: new Date().toISOString() })
}

export async function POST(req) { return GET(req) }