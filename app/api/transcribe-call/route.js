// app/api/transcribe-call/route.js
// Free transcription using Groq Whisper large-v3 (completely free)

export async function POST(req) {
  try {
    const { callId, recordingUrl } = await req.json()
    if (!recordingUrl) return Response.json({ error: 'Missing recordingUrl' }, { status: 400 })

    // 1. Fetch the audio from presigned S3 URL
    const audioRes = await fetch(recordingUrl)
    if (!audioRes.ok) throw new Error('Failed to fetch audio from S3')
    const audioBuffer = await audioRes.arrayBuffer()

    // 2. Send to Groq Whisper API (free)
    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'recording.mp3')
    formData.append('model', 'whisper-large-v3')
    formData.append('response_format', 'text')
    // Kannada language hint — improves accuracy significantly
    formData.append('language', 'kn')

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: formData,
    })

    if (!groqRes.ok) {
      const err = await groqRes.text()
      throw new Error(`Groq error: ${err}`)
    }

    const transcript = await groqRes.text()

    // 3. Save transcript to Supabase
    if (callId) {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
      await supabase.from('telesales_calls').update({ transcript }).eq('id', callId)
    }

    return Response.json({ transcript })
  } catch (err) {
    console.error('Transcribe error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}