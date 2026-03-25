// app/api/debug-rates/route.js — temporary debug route, delete after testing

export async function GET() {
  const results = {}

  // Test Ambicaa handshake
  try {
    const res = await fetch(
      `http://dashboard.ambicaaspot.com:10001/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
      { signal: AbortSignal.timeout(8000) }
    )
    results.ambicaa_status = res.status
    results.ambicaa_raw    = (await res.text()).slice(0, 500)
  } catch (e) {
    results.ambicaa_error = e.message
  }

  // Test Ambicaa main site
  try {
    const res = await fetch('http://ambicaaspot.com', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    results.ambicaa_site_status = res.status
    const html = await res.text()
    // Find IND-GOLD in page
    const idx = html.indexOf('IND-GOLD')
    results.ambicaa_site_found_gold = idx !== -1
    if (idx !== -1) results.ambicaa_site_snippet = html.slice(idx, idx + 300)
  } catch (e) {
    results.ambicaa_site_error = e.message
  }

  return Response.json(results)
}