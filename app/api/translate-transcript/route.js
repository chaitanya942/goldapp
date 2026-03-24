// app/api/translate-transcript/route.js
// Translates diarized transcript turns to English using Claude Haiku (fast + cheap)

export async function POST(req) {
  try {
    const { turns, callId } = await req.json()
    if (!turns?.length) return Response.json({ error: 'No turns to translate' }, { status: 400 })

    const plainText = turns.map((t, i) => `[${i + 1}] ${t.speaker}: ${t.text}`).join('\n')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{
          role:    'user',
          content: `Translate the following call transcript to English. 
Keep the same speaker labels (Bot/Customer) and segment numbers.
Translate naturally — this is a gold purchasing company's AI bot talking to customers in Kannada.
Preserve the meaning and tone accurately.

Return ONLY a JSON array in this format:
[{"speaker":"Bot","text":"translated text"},{"speaker":"Customer","text":"translated text"},...]

No explanation, no markdown, just the JSON array.

Transcript:
${plainText}`,
        }],
      }),
    })

    if (!res.ok) throw new Error(`Claude error: ${await res.text()}`)

    const data = await res.json()
    const raw  = data.content?.[0]?.text || '[]'

    let translated
    try {
      translated = JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch {
      throw new Error('Failed to parse translation response')
    }

    return Response.json({ turns: translated })

  } catch (err) {
    console.error('Translate error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}