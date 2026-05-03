import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const MAX_FILE_BYTES = 8 * 1024 * 1024  // 8 MB

export async function POST(request) {
  // Bulk OCR of a Gold Movement Report — high LLM cost (Opus call, 4096 tokens).
  // Admin-only.
  const auth = await requireAuth(request, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  try {
    const formData = await request.formData()
    const file     = formData.get('image')
    if (!file) return Response.json({ success: false, error: 'No image provided' }, { status: 400 })
    if (file.size && file.size > MAX_FILE_BYTES) {
      return Response.json({ success: false, error: `Image too large (${Math.round(file.size / 1024 / 1024)} MB). The limit is 8 MB.` }, { status: 413 })
    }

    const bytes  = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const mime   = file.type || 'image/jpeg'

    const response = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mime, data: base64 }
          },
          {
            type: 'text',
            text: `This is a Gold Movement Report. Extract ALL rows from the table.
Return ONLY a JSON array, no other text, no markdown, no backticks.
Each object must have exactly these fields:
{
  "s_no": number,
  "date": "YYYY-MM-DD",
  "customer_name": "string",
  "branch": "string",
  "gross_wt": number,
  "stone": number,
  "wastage": number,
  "net_wt": number,
  "gross_amount": number,
  "application_no": "string"
}
Parse dates like "16-Mar-2026,Mon" as "2026-03-16".
Return ONLY the JSON array starting with [ and ending with ].`
          }
        ]
      }]
    })

    const text = response.content[0].text.trim()

    let rows
    try {
      rows = JSON.parse(text)
    } catch {
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) return Response.json({ success: false, error: 'Could not parse OCR response', raw: text }, { status: 500 })
      rows = JSON.parse(match[0])
    }

    if (!Array.isArray(rows) || rows.length === 0)
      return Response.json({ success: false, error: 'No rows extracted from image' }, { status: 500 })

    const appIds = rows.map(r => String(r.application_no).trim()).filter(Boolean)

    const { data: found } = await supabaseAdmin
      .from('purchases')
      .select('id, application_id, branch_name, net_weight, total_amount, purchase_date, stock_status')
      .in('application_id', appIds)

    const foundMap  = new Map((found || []).map(r => [r.application_id, r]))
    const matched   = []
    const notFound  = []
    const wrongStatus = []

    rows.forEach(row => {
      const appId  = String(row.application_no).trim()
      const record = foundMap.get(appId)
      if (!record) {
        notFound.push(appId)
      } else if (record.stock_status !== 'at_branch') {
        wrongStatus.push({ appId, status: record.stock_status })
      } else {
        matched.push({ ...record, ocr_row: row })
      }
    })

    return Response.json({
      success:        true,
      total:          rows.length,
      matched:        matched.length,
      notFound:       notFound.length,
      wrongStatus:    wrongStatus.length,
      rows:           matched,
      notFoundIds:    notFound,
      wrongStatusIds: wrongStatus,
    })

  } catch (err) {
    console.error('OCR error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
}