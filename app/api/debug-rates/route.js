// app/api/debug-rates/route.js

export async function GET() {
  const results = {}

  // Test 1: Ambicaa liverate page
  try {
    const res  = await fetch('http://ambicaaspot.com/liverate', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    })
    results.ambicaa_liverate_status = res.status
    const html = await res.text()
    results.ambicaa_liverate_length = html.length
    // Look for rate numbers
    const idx = html.search(/IND-GOLD|149|150|148/i)
    if (idx !== -1) results.ambicaa_liverate_snippet = html.slice(Math.max(0, idx-50), idx+200)
  } catch (e) { results.ambicaa_liverate_error = e.message }

  // Test 2: Ambicaa main page — check if rates are in initial HTML
  try {
    const res  = await fetch('http://ambicaaspot.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    })
    const html = await res.text()
    results.ambicaa_main_has_rates = html.includes('IND-GOLD') || html.includes('149') 
    results.ambicaa_main_snippet   = html.slice(0, 300)
  } catch (e) { results.ambicaa_main_error = e.message }

  // Test 3: Ambicaa socket — try sending everything in one shot without reading ack
  try {
    const hsRes  = await fetch('http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&t=test123', { signal: AbortSignal.timeout(5000) })
    const hsText = await hsRes.text()
    const sid    = hsText.match(/"sid":"([^"]+)"/)?.[1]
    results.ambicaa_socket_sid = sid
    if (sid) {
      // Skip reading ack — go straight to room join
      await fetch(`http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: '4040',  // combined: engine connect + socket connect
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})

      await fetch(`http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: '42["room","ambicaaspot"]',
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})

      // Poll immediately
      const p1 = await fetch(`http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&sid=${sid}`, { signal: AbortSignal.timeout(8000) })
      results.ambicaa_socket_poll1 = (await p1.text()).slice(0, 400)
    }
  } catch (e) { results.ambicaa_socket_error = e.message }

  // Test 4: Aamlin — try different ports and protocols
  for (const url of [
    'http://starlinebulltech.in:10001/socket.io/?EIO=4&transport=polling',
    'http://starlinebulltech.in:3000/socket.io/?EIO=4&transport=polling',
    'http://aamlinspot.in:10001/socket.io/?EIO=4&transport=polling',
    'http://www.aamlinspot.in:10001/socket.io/?EIO=4&transport=polling',
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      results[`aamlin_${url.split('//')[1].split('/')[0]}`] = `${res.status}: ${(await res.text()).slice(0,100)}`
    } catch (e) {
      results[`aamlin_${url.split('//')[1].split('/')[0]}`] = `error: ${e.message}`
    }
  }

  return Response.json(results)
}