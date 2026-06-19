// app/api/mdm/fields/route.js
// Admin-only field management for a form. field_key is derived from the label
// (slug) and kept unique within the form — it's the key used in record.data.

import { requireMdmAuth, mdmAdmin } from '../../../../lib/mdmAuth'

const TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'file']

function slug(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field'
}

export async function POST(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  try {
    const { form_id, label, type, options, required } = await req.json()
    if (!form_id) return Response.json({ error: 'form_id required' }, { status: 400 })
    if (!String(label || '').trim()) return Response.json({ error: 'Field label is required' }, { status: 400 })
    if (!TYPES.includes(type)) return Response.json({ error: `type must be one of ${TYPES.join(', ')}` }, { status: 400 })

    // Unique key within the form.
    const { data: existing } = await mdmAdmin.from('mdm_fields').select('field_key, sort_order').eq('form_id', form_id)
    const keys = new Set((existing || []).map(f => f.field_key))
    let key = slug(label), n = 1
    while (keys.has(key)) key = `${slug(label)}_${++n}`
    const nextOrder = (existing || []).reduce((m, f) => Math.max(m, f.sort_order || 0), 0) + 1

    const cleanOptions = Array.isArray(options) ? options.map(o => String(o).trim()).filter(Boolean) : []
    const { data, error } = await mdmAdmin.from('mdm_fields').insert({
      form_id, label: String(label).trim(), field_key: key, type,
      options: type === 'select' ? cleanOptions : [],
      required: required === true, sort_order: nextOrder,
    }).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ field: data })
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
}

export async function PATCH(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  try {
    const { id, label, type, options, required, sort_order } = await req.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const patch = {}
    if (label !== undefined) patch.label = String(label).trim()
    if (type !== undefined) { if (!TYPES.includes(type)) return Response.json({ error: 'invalid type' }, { status: 400 }); patch.type = type }
    if (options !== undefined) patch.options = Array.isArray(options) ? options.map(o => String(o).trim()).filter(Boolean) : []
    if (typeof required === 'boolean') patch.required = required
    if (typeof sort_order === 'number') patch.sort_order = sort_order
    const { error } = await mdmAdmin.from('mdm_fields').update(patch).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
}

export async function DELETE(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await mdmAdmin.from('mdm_fields').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
