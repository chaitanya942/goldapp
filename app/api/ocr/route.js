import Anthropic from '@anthropic-ai/sdk'

export async function POST(req) {
  try {
    const { image, mediaType, type } = await req.json()

    const client = new Anthropic()

    const prompt = type === 'weight'
      ? `This is a photo of a weighing scale display (Mettler Toledo or similar). 
Extract ONLY the numeric weight reading shown on the digital display.
Return ONLY a JSON object: {"weight": 531.64}
The number is in grams. Ignore all text, just the number on the display.
If you cannot read it clearly, return {"weight": null}`
      : `This is a photo of a gold assay certificate (from an assayer like Rathnam Silver Assayers).
Find the "Fineness in %" value — a number like 89.10 or 99.50.
Return ONLY a JSON object: {"purity": 89.10}
Do NOT return the Carat value. Only the Fineness percentage.
If you cannot find it, return {"purity": null}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: prompt }
        ]
      }]
    })

    const text = (response.content?.[0]?.text || '').replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(text)
    return Response.json({ success: true, data: parsed })

  } catch (err) {
    console.error('OCR error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
}