// app/api/transcribe-call/route.js
// Step 1: Groq Whisper large-v3 — FREE, auto language detect
// Step 2: Claude Haiku — diarization (~₹0.0001/call)

export async function POST(req) {
  try {
    const { callId, recordingUrl } = await req.json()
    if (!recordingUrl) return Response.json({ error: 'Missing recordingUrl' }, { status: 400 })

    // 1. Fetch audio
    const audioRes = await fetch(recordingUrl)
    if (!audioRes.ok) throw new Error('Failed to fetch audio from S3')
    const audioBuffer = await audioRes.arrayBuffer()

    // 2. Groq Whisper — verbose_json, NO language hint (auto-detect)
    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'recording.mp3')
    formData.append('model', 'whisper-large-v3')
    formData.append('response_format', 'verbose_json')
    // NO language hint — auto-detects Kannada, Telugu, Hindi, Malayalam accurately

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body:    formData,
    })

    if (!groqRes.ok) throw new Error(`Groq error: ${await groqRes.text()}`)

    const groqData  = await groqRes.json()
    const segments  = groqData.segments || []
    const detectedLang = groqData.language || 'unknown'

    if (segments.length === 0) {
      return Response.json({ error: 'No speech detected in recording' }, { status: 400 })
    }

    // 3. Annotate segments with duration + gap for Claude
    const annotated = segments.map((seg, i) => ({
      id:       i,
      text:     seg.text.trim(),
      start:    seg.start,
      end:      seg.end,
      duration: parseFloat((seg.end - seg.start).toFixed(2)),
      gap:      i > 0 ? parseFloat((seg.start - segments[i - 1].end).toFixed(2)) : 0,
    }))

    // 4. Claude Haiku diarization
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
          content: `You are diarizing a call transcript from White Gold's AI inbound bot (Gnani AI).

FACTS:
- This is an automated BOT calling customers who called after 7 PM
- Segment [0] is ALWAYS Bot — never change this
- The BOT speaks first, formally, in long sentences — welcomes, asks about gold (sell/pledge/release)
- The CUSTOMER gives short informal replies
- Large gaps (>1s) = speaker switch. Tiny gaps (<0.3s) = same speaker continuing
- Language detected: ${detectedLang}

Segments (dur = duration, gap = silence before this segment):
${segmentList}

Return ONLY a JSON array: [{"id":0,"speaker":"Bot"},{"id":1,"speaker":"Customer"},...]
No explanation. Just JSON.`,
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

    // 5. Build turns with fallback gap-based diarization
    let currentSpeaker = 'Bot'
    const turns = annotated.map((seg, i) => {
      const assigned = diarized.find(d => d.id === i)
      let speaker

      if (assigned) {
        speaker = assigned.speaker
      } else {
        if (i === 0) speaker = 'Bot'
        else {
          if (seg.gap >= 0.6) currentSpeaker = currentSpeaker === 'Bot' ? 'Customer' : 'Bot'
          speaker = currentSpeaker
        }
      }

      if (i === 0) speaker = 'Bot' // hard rule
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

    // 7. Save transcript + detected language to Supabase
    if (callId) {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
      await supabase.from('telesales_calls')
        .update({ transcript: transcriptJson, language: detectedLang })
        .eq('id', callId)
    }

    return Response.json({ transcript: transcriptJson, turns: merged, language: detectedLang })

  } catch (err) {
    console.error('Transcribe error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}