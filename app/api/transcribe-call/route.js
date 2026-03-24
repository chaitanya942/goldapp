// app/api/transcribe-call/route.js
// Groq Whisper (free) + Claude Haiku diarization
// Key insight: Bot ALWAYS speaks first, voice persona is consistent throughout

export async function POST(req) {
  try {
    const { callId, recordingUrl } = await req.json()
    if (!recordingUrl) return Response.json({ error: 'Missing recordingUrl' }, { status: 400 })

    // 1. Fetch audio
    const audioRes = await fetch(recordingUrl)
    if (!audioRes.ok) throw new Error('Failed to fetch audio from S3')
    const audioBuffer = await audioRes.arrayBuffer()

    // 2. Groq Whisper with verbose_json — gets segments with timestamps
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

    // 3. Detect speaker turns using gap analysis
    // Logic: significant pause (>0.8s) between segments = speaker switch
    // Bot ALWAYS starts (segment 0 = Bot)
    // After a gap, speaker switches. Bot's turns tend to be longer (formal speech)
    const GAP_THRESHOLD = 0.8 // seconds

    const segmentsWithGaps = segments.map((seg, i) => {
      const prevSeg = segments[i - 1]
      const gap     = prevSeg ? seg.start - prevSeg.end : 0
      return { ...seg, gap, index: i }
    })

    // Build initial speaker assignment based on gaps
    let currentSpeaker = 'Bot' // Bot ALWAYS first
    const speakerMap   = {}

    for (const seg of segmentsWithGaps) {
      if (seg.index === 0) {
        speakerMap[seg.index] = 'Bot'
        continue
      }
      // Switch speaker on significant gap
      if (seg.gap >= GAP_THRESHOLD) {
        currentSpeaker = currentSpeaker === 'Bot' ? 'Customer' : 'Bot'
      }
      speakerMap[seg.index] = currentSpeaker
    }

    // 4. Claude Haiku — refine the assignment using content analysis
    // Give Claude the gap-based assignments + text to correct any mistakes
    const segmentList = segmentsWithGaps.map((s, i) =>
      `[${i}] gap:${s.gap.toFixed(1)}s speaker:${speakerMap[i]} | ${s.text.trim()}`
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
        max_tokens: 2000,
        messages: [{
          role:    'user',
          content: `You are analyzing a call transcript from a gold purchasing company's AI bot system.

CRITICAL RULES:
1. Segment [0] is ALWAYS "Bot" — never change this
2. The Bot's voice persona is CONSISTENT throughout — it speaks formally, uses polite Kannada, asks structured questions about gold selling/pledging
3. The Customer responds informally, gives short answers about their gold quantity, intent, etc.
4. I've already done gap-based speaker detection. Review and correct only obvious mistakes.
5. Do NOT flip speakers just because of content — trust the gap analysis mostly

Segments (gap = silence before this segment, initial speaker assignment shown):
${segmentList}

Return ONLY a JSON array: [{"id":0,"speaker":"Bot"},{"id":1,"speaker":"Customer"},...]
No explanation. Just JSON.`,
        }],
      }),
    })

    let refined = []
    if (claudeRes.ok) {
      const claudeData = await claudeRes.json()
      const raw = claudeData.content?.[0]?.text || '[]'
      try {
        refined = JSON.parse(raw.replace(/```json|```/g, '').trim())
      } catch { refined = [] }
    }

    // 5. Build final turns — use Claude refinement if available, else gap-based
    const turns = segments.map((seg, i) => {
      const claudeAssign = refined.find(r => r.id === i)
      const speaker      = claudeAssign?.speaker || speakerMap[i] || (i === 0 ? 'Bot' : 'Customer')
      return { speaker, text: seg.text.trim(), start: seg.start, end: seg.end }
    })

    // 6. Merge consecutive same-speaker segments
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