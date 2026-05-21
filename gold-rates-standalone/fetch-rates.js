/**
 * fetch-rates.js
 * Standalone Node.js script — fetches live Gold with GST rates
 * from 3 Indian bullion price feeds used by WhiteGold app.
 *
 * Run: node fetch-rates.js
 * Or schedule every 60s with setInterval / cron / Railway cron job.
 *
 * All 3 sources provide Gold 999 IND price ₹/10g INCLUDING GST.
 * No API keys required.
 */

// ── Source 1: Kalinga Kawad ───────────────────────────────────────────────────
// Plain-text broadcast stream. Line containing "GOLD 999" + "WITH GST FOR REF"
// has the sell rate as the 3rd number on that line.
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
          if (sell > 100000) return sell // sanity check — gold is always > ₹1 lakh/10g
        }
      }
    }
    return null
  } catch (err) {
    console.error('[Kalinga] Error:', err.message)
    return null
  }
}

// ── Source 2: Ambicaa / RSBL via Firebase ────────────────────────────────────
// Firebase public REST endpoint — no auth required.
// GOLDBLR999IND = Gold, Bangalore, 999 purity, India.
// Sell/Ask field is Gold with GST equivalent.
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
    console.error('[Ambicaa] Error:', err.message)
    return null
  }
}

// ── Source 3: Aamlin Spot (socket.io — browser-side only) ────────────────────
// This source requires socket.io-client and runs in a browser/Node environment.
// Install: npm install socket.io-client
// NOTE: This connects directly to Aamlin's broadcast server.
async function connectAamlinSocket(onRate) {
  const { io } = await import('socket.io-client')

  const socket = io('http://starlinebulltech.in:10001', {
    transports:        ['websocket', 'polling'],
    reconnection:      true,
    reconnectionDelay: 5000,
    timeout:           15000,
  })

  socket.on('connect', () => {
    console.log('[Aamlin] Connected')
    socket.emit('room', 'aamlinspot')
  })

  socket.on('message', (data) => {
    try {
      const rateArr = data?.Rate || data?.rate || []
      for (const rate of rateArr) {
        const sym = rate.Symbol || rate.symbol || ''
        if (/gold\s*999\s*ind/i.test(sym)) {
          const sell = parseFloat(rate.Ask || rate.ask || 0)
          if (sell > 100000) onRate(sell)
          break
        }
      }
    } catch (e) {
      console.error('[Aamlin] Parse error:', e.message)
    }
  })

  socket.on('disconnect', () => console.log('[Aamlin] Disconnected — reconnecting...'))
  socket.on('connect_error', (e) => console.error('[Aamlin] Connection error:', e.message))

  return socket
}

// ── Main: fetch all rates once ────────────────────────────────────────────────
async function fetchAllRates() {
  console.log(`\n[${new Date().toLocaleTimeString('en-IN')}] Fetching gold rates...`)

  const [kalinga, ambicaa] = await Promise.all([
    fetchKalingaRate(),
    fetchAmbicaaRate(),
  ])

  console.log('Kalinga Kawad  (Gold 999 with GST):', kalinga ? `₹${kalinga.toLocaleString('en-IN')}` : 'unavailable')
  console.log('Ambicaa / RSBL (Gold 999 with GST):', ambicaa ? `₹${ambicaa.toLocaleString('en-IN')}` : 'unavailable')

  return { kalinga_sell_rate: kalinga, ambica_sell_rate: ambicaa, fetched_at: new Date().toISOString() }
}

// ── Run once immediately, then every 60 seconds ───────────────────────────────
fetchAllRates()
setInterval(fetchAllRates, 60_000)

// ── Aamlin live socket (uncomment to enable) ──────────────────────────────────
// connectAamlinSocket((rate) => {
//   console.log('Aamlin Spot    (Gold 999 with GST):', `₹${rate.toLocaleString('en-IN')}`)
// })
