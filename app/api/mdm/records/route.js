// app/api/mdm/records/route.js
// Records = submitted form entries (JSONB). Any active MDM user can view a
// form's records and add new ones; you can edit/delete your own, admins any.

import { requireMdmAuth, mdmAdmin } from '../../../../lib/mdmAuth'

export async function GET(req) {
  const auth = await requireMdmAuth(req)
  if (!auth.ok) return auth.response
  const formId = new URL(req.url).searchParams.get('form_id')
  if (!formId) return Response.json({ error: 'form_id required' }, { status: 400 })
  const { data: records, error } = await mdmAdmin
    .from('mdm_records').select('*').eq('form_id', formId).order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // Attach creator names.
  const ids = [...new Set((records || []).map(r => r.created_by).filter(Boolean))]
  const names = {}
  if (ids.length) {
    const { data: us } = await mdmAdmin.from('mdm_users').select('id, full_name, email').in('id', ids)
    for (const u of us || []) names[u.id] = u.full_name || u.email
  }
  return Response.json({
    records: (records || []).map(r => ({ ...r, _by: names[r.created_by] || '—', _mine: r.created_by === auth.member.id })),
    is_admin: auth.member.role === 'admin',
  })
}

export async function POST(req) {
  const auth = await requireMdmAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { form_id, data } = await req.json()
    if (!form_id) return Response.json({ error: 'form_id required' }, { status: 400 })

    // Validate required fields are present.
    const { data: fields } = await mdmAdmin.from('mdm_fields').select('field_key, label, required, type').eq('form_id', form_id)
    const d = data && typeof data === 'object' ? data : {}
    const missing = (fields || []).filter(f => f.required && (d[f.field_key] === undefined || d[f.field_key] === null || d[f.field_key] === '' ||
      (f.type === 'file' && !d[f.field_key]?.path))).map(f => f.label)
    if (missing.length) return Response.json({ error: `Required: ${missing.join(', ')}` }, { status: 400 })

    const { data: rec, error } = await mdmAdmin.from('mdm_records').insert({ form_id, data: d, created_by: auth.member.id }).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Index any uploaded files (file fields store { path, name, size, type }).
    const fileRows = (fields || []).filter(f => f.type === 'file' && d[f.field_key]?.path).map(f => ({
      record_id: rec.id, form_id, field_key: f.field_key,
      file_name: d[f.field_key].name || null, storage_path: d[f.field_key].path,
      mime_type: d[f.field_key].type || null, size_bytes: d[f.field_key].size || null,
      uploaded_by: auth.member.id,
    }))
    if (fileRows.length) { try { await mdmAdmin.from('mdm_files').insert(fileRows) } catch {} }

    return Response.json({ record: rec })
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
}

export async function PATCH(req) {
  const auth = await requireMdmAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id, data } = await req.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { data: rec } = await mdmAdmin.from('mdm_records').select('created_by').eq('id', id).maybeSingle()
    if (!rec) return Response.json({ error: 'Record not found' }, { status: 404 })
    if (rec.created_by !== auth.member.id && auth.member.role !== 'admin') {
      return Response.json({ error: 'You can only edit your own records' }, { status: 403 })
    }
    const { error } = await mdmAdmin.from('mdm_records').update({ data: data || {}, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
}

export async function DELETE(req) {
  const auth = await requireMdmAuth(req)
  if (!auth.ok) return auth.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { data: rec } = await mdmAdmin.from('mdm_records').select('created_by').eq('id', id).maybeSingle()
  if (!rec) return Response.json({ error: 'Record not found' }, { status: 404 })
  if (rec.created_by !== auth.member.id && auth.member.role !== 'admin') {
    return Response.json({ error: 'You can only delete your own records' }, { status: 403 })
  }
  const { error } = await mdmAdmin.from('mdm_records').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
