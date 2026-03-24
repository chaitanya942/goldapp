// app/api/transcribe-call/route.js
// Step 1: Groq Whisper (free) for transcription with timestamps
// Step 2: Claude to diarize — assign Bot vs Customer to each segment

export async function POST(req) {
  try {
    const { callId, recordingUrl } = await req.json()
    if (!recordingUrl) return Response.json({ error: 'Missing recordingUrl' }, { status: 400 })

    // 1. Fetch audio from presigned S3 URL
    const audioRes = await fetch(recordingUrl)
    if (!audioRes.ok) throw new Error('Failed to fetch audio from S3')
    const audioBuffer = await audioRes.arrayBuffer()

    // 2. Groq Whisper — verbose_json gives segments with timestamps
    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'recording.mp3')
    formData.append('model', 'whisper-large-v3')
    formData.append('response_format', 'verbose_json')
    formData.append('language', 'kn') // Kannada hint

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body:    formData,
    })

    if (!groqRes.ok) {
      const err = await groqRes.text()
      throw new Error(`Groq error: ${err}`)
    }

    const groqData = await groqRes.json()
    const segments  = groqData.segments || []
    const fullText  = groqData.text || ''

    // 3. Build segment list with timestamps for Claude to diarize
    // Each segment: { start, end, text }
    const segmentList = segments
      .map((s, i) => `[${i + 1}] ${s.text.trim()}`)
      .join('\n')

    // 4. Claude diarization — identify Bot vs Customer per segment
    // Context: inbound bot call, Bot always speaks first (greeting), 
    // Bot speaks formally in Kannada, Customer responds
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
          content: `This is a transcript of an inbound call from a gold purchasing company's AI bot system.

CONTEXT:
- This is an automated inbound bot (Gnani AI) that answers customer calls after 7 PM
- The BOT always speaks FIRST with a greeting/welcome message
- The BOT speaks formally, introduces itself, asks structured questions
- The CUSTOMER responds to the bot's questions
- Calls are in Kannada language
- The bot and customer alternate turns

Here are the transcript segments in order:
${segmentList}

For each segment number, assign either "Bot" or "Customer" as the speaker.
Rules:
1. Segment [1] is ALWAYS Bot (first greeting)
2. Identify speaker switches based on conversation flow
3. Bot asks questions, Customer answers
4. Return ONLY a JSON array like: [{"id":1,"speaker":"Bot"},{"id":2,"speaker":"Customer"},...]
Return only the JSON, no explanation.`,
        }],
      }),
    })

    let diarized = []
    if (claudeRes.ok) {
      const claudeData = await claudeRes.json()
      const raw = claudeData.content?.[0]?.text || '[]'
      try {
        diarized = JSON.parse(raw.replace(/```json|```/g, '').trim())
      } catch {
        diarized = []
      }
    }

    // 5. Build final transcript as JSON array of turns
    const turns = segments.map((seg, i) => {
      const assignment = diarized.find(d => d.id === i + 1)
      return {
        speaker: assignment?.speaker || (i % 2 === 0 ? 'Bot' : 'Customer'),
        text:    seg.text.trim(),
        start:   seg.start,
        end:     seg.end,
      }
    })

    // Merge consecutive same-speaker turns
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

    // Store as JSON string in Supabase
    const transcriptJson = JSON.stringify(merged)

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