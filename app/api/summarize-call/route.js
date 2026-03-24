// app/api/summarize-call/route.js
// Claude Haiku — generates 2-line call summary (~₹0.0001/call)

export async function POST(req) {
  try {
    const { callId, transcript } = await req.json()
    if (!transcript) return Response.json({ error: 'No transcript' }, { status: 400 })

    const turns = (() => {
      try {
        const p = JSON.parse(transcript)
        if (Array.isArray(p) && p[0]?.speaker) return p.map(t => `${t.speaker}: ${t.text}`).join('\n')
      } catch {}
      return transcript
    })()

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{
          role:    'user',
          content: `Summarize this gold purchasing company bot call in 1-2 short sentences in English.
Include: what the customer wanted (sell/pledge/release gold), quantity if mentioned, and outcome.
Be concise — max 25 words.

Transcript:
${turns}

Return only the summary, nothing else.`,
        }],
      }),
    })

    if (!res.ok) throw new Error(`Claude error: ${await res.text()}`)
    const data    = await res.json()
    const summary = data.content?.[0]?.text?.trim() || ''

    if (callId && summary) {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      await supabase.from('telesales_calls').update({ summary }).eq('id', callId)
    }

    return Response.json({ summary })
  } catch (err) {
    console.error('Summarize error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}