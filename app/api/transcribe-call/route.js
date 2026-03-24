// app/api/transcribe-call/route.js
// Groq Whisper (free) + Claude Haiku diarization (~₹0.0001 per call)

export async function POST(req) {
  try {
    const { callId, recordingUrl } = await req.json()
    if (!recordingUrl) return Response.json({ error: 'Missing recordingUrl' }, { status: 400 })

    // 1. Fetch audio
    const audioRes = await fetch(recordingUrl)
    if (!audioRes.ok) throw new Error('Failed to fetch audio from S3')
    const audioBuffer = await audioRes.arrayBuffer()

    // 2. Groq Whisper verbose_json — segments with timestamps
    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'recording.mp3')
    formData.append('model', 'whisper-large-v3')
    formData.append('response_format', 'verbose_json')
    formData.append('language', 'kn')

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body:    formData,
    })

    if (!groqRes.ok) throw new Error(`Groq error: ${await groqRes.text()}`)

    const groqData = await groqRes.json()
    const segments = groqData.segments || []

    if (segments.length === 0) {
      return Response.json({ error: 'No speech detected in recording' }, { status: 400 })
    }

    // 3. Annotate segments with duration + gap
    const annotated = segments.map((seg, i) => ({
      id:       i,
      text:     seg.text.trim(),
      start:    seg.start,
      end:      seg.end,
      duration: parseFloat((seg.end - seg.start).toFixed(2)),
      gap:      i > 0 ? parseFloat((seg.start - segments[i - 1].end).toFixed(2)) : 0,
    }))

    // 4. Claude Haiku diarization with full context
    const segmentList = annotated.map(s =>
      `[${s.id}] dur:${s.duration}s gap:${s.gap}s | ${s.text}`
    ).join('\n')

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role:    'user',
          content: `You are diarizing a call transcript from White Gold's AI inbound bot (Gnani AI) in Kannada.

FACTS ABOUT THIS CALL:
- This is an AUTOMATED BOT calling customers who called after 7 PM
- The BOT has a fixed voice persona — it ALWAYS speaks first (segment [0] is ALWAYS Bot)
- The BOT speaks in long, formal Kannada sentences — welcomes, asks structured questions about gold (sell/pledge/release)
- The CUSTOMER gives short informal replies — yes/no, quantities, names
- They strictly alternate: Bot asks → Customer replies → Bot follows up → Customer replies
- Large gaps (>1s) almost always indicate a speaker switch
- Short gaps (<0.3s) are breathing pauses — same speaker continuing

Each segment shows: duration in seconds, gap before it, and text.

Segments:
${segmentList}

Assign Bot or Customer to each segment ID.
Return ONLY JSON array: [{"id":0,"speaker":"Bot"},{"id":1,"speaker":"Customer"},...]`,
        }],
      }),
    })

    let diarized = []
    if (claudeRes.ok) {
      const claudeData = await claudeRes.json()
      const raw = claudeData.content?.[0]?.text || '[]'
      try {
        diarized = JSON.parse(raw.replace(/```json|```/g, '').trim())
      } catch { diarized = [] }
    }

    // 5. Build turns — Claude assignment, fallback to alternating with gap detection
    let currentSpeaker = 'Bot'
    const turns = annotated.map((seg, i) => {
      const claudeAssign = diarized.find(d => d.id === i)
      let speaker

      if (claudeAssign) {
        speaker = claudeAssign.speaker
      } else {
        // Fallback gap-based
        if (i === 0) speaker = 'Bot'
        else {
          if (seg.gap >= 0.6) currentSpeaker = currentSpeaker === 'Bot' ? 'Customer' : 'Bot'
          speaker = currentSpeaker
        }
      }

      // Hard rule: segment 0 is ALWAYS Bot
      if (i === 0) speaker = 'Bot'
      currentSpeaker = speaker

      return { speaker, text: seg.text, start: seg.start, end: seg.end }
    })

    // 6. Merge consecutive same-speaker turns
    const merged = []
    for (const turn of turns) {
      const last = merged[merged.length - 1]
      if (last && last.speaker === turn.speaker) {
        last.text += ' ' + turn.text
        last.end   = turn.end
      } else {
        merged.push({ ...turn })
      }
    }

    const transcriptJson = JSON.stringify(merged)

    // 7. Save to Supabase
    if (callId) {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
      await supabase.from('telesales_calls').update({ transcript: transcriptJson }).eq('id', callId)
    }

    return Response.json({ transcript: transcriptJson, turns: merged })

  } catch (err) {
    console.error('Transcribe error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}