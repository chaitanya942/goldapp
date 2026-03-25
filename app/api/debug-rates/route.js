// app/api/debug-rates/route.js

async function testSocket(baseUrl, roomName) {
  try {
    const hs     = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, { signal: AbortSignal.timeout(8000) })
    const hsText = await hs.text()
    const sid    = hsText.match(/"sid":"([^"]+)"/)?.[1]
    if (!sid) return { error: 'No SID', raw: hsText.slice(0, 200) }

    await (await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: '40', signal: AbortSignal.timeout(5000) })).text()
    await (await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { signal: AbortSignal.timeout(5000) })).text()
    await (await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: `42["room","${roomName}"]`, signal: AbortSignal.timeout(5000) })).text()

    const polls = []
    for (let i = 0; i < 4; i++) {
      const p = await (await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { signal: AbortSignal.timeout(8000) })).text()
      polls.push(p.slice(0, 500))
      if (p.includes('Session ID unknown')) break
      if (p.includes('Rate') || p.includes('Gold')) break
    }
    return { sid, polls }
  } catch (e) { return { error: e.message } }
}

export async function GET() {
  const [ambicaa, aamlin_http, aamlin_https] = await Promise.all([
    testSocket('http://dashboard.ambicaaspot.com:10001', 'ambicaaspot'),
    testSocket('http://starlinebulltech.in:10001', 'aamlinspot'),
    testSocket('https://starlinebulltech.in:10001', 'aamlinspot'),
  ])
  return Response.json({ ambicaa, aamlin_http, aamlin_https })
}