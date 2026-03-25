// app/api/debug-rates/route.js — temporary debug route

async function testSocketIO(baseUrl, roomName) {
  try {
    const hsRes  = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, { signal: AbortSignal.timeout(8000) })
    const hsText = await hsRes.text()
    const sidMatch = hsText.match(/"sid":"([^"]+)"/)
    if (!sidMatch) return { error: 'No SID', handshake: hsText.slice(0, 100) }
    const sid = sidMatch[1]

    await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '40', signal: AbortSignal.timeout(5000),
    })
    await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { signal: AbortSignal.timeout(5000) })
    await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: `42["room","${roomName}"]`, signal: AbortSignal.timeout(5000),
    })

    const polls = []
    for (let i = 0; i < 4; i++) {
      const pollRes  = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${sid}`, { signal: AbortSignal.timeout(8000) })
      const pollText = await pollRes.text()
      polls.push(pollText.slice(0, 400))
      if (pollText.includes('Rate') || pollText.includes('Gold')) break
      await new Promise(r => setTimeout(r, 500))
    }
    return { sid, polls }
  } catch (err) {
    return { error: err.message }
  }
}

export async function GET() {
  const [ambicaa, aamlin] = await Promise.all([
    testSocketIO('http://dashboard.ambicaaspot.com:10001', 'ambicaaspot'),
    testSocketIO('https://starlinebulltech.in:10001', 'aamlinspot'),
  ])
  return Response.json({ ambicaa, aamlin })
}