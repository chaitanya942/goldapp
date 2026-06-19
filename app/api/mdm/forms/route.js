// app/api/mdm/forms/route.js
// Forms = admin-defined collections. GET is open to any active MDM user (to
// fill them); create/update/delete are admin-only.

import { requireMdmAuth, mdmAdmin } from '../../../../lib/mdmAuth'

export async function GET(req) {
  const auth = await requireMdmAuth(req)
  if (!auth.ok) return auth.response
  const isAdmin = auth.member.role === 'admin'
  const url = new URL(req.url)
  const id  = url.searchParams.get('id')

  if (id) {
    // One form + its fields (ordered).
    const { data: form, error } = await mdmAdmin.from('mdm_forms').select('*').eq('id', id).maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!form) return Response.json({ error: 'Form not found' }, { status: 404 })
    if (!form.is_active && !isAdmin) return Response.json({ error: 'Form not available' }, { status: 403 })
    const { data: fields } = await mdmAdmin.from('mdm_fields').select('*').eq('form_id', id).order('sort_order', { ascending: true })
    return Response.json({ form, fields: fields || [] })
  }

  // List. Non-admins only see active forms.
  let q = mdmAdmin.from('mdm_forms').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  if (!isAdmin) q = q.eq('is_active', true)
  const { data: forms, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // Attach a quick field + record count per form.
  const ids = (forms || []).map(f => f.id)
  const counts = {}
  if (ids.length) {
    const { data: fc } = await mdmAdmin.from('mdm_fields').select('form_id').in('form_id', ids)
    const { data: rc } = await mdmAdmin.from('mdm_records').select('form_id').in('form_id', ids)
    for (const r of fc || []) counts[r.form_id] = counts[r.form_id] || { fields: 0, records: 0 }, counts[r.form_id].fields++
    for (const r of rc || []) counts[r.form_id] = counts[r.form_id] || { fields: 0, records: 0 }, counts[r.form_id].records++
  }
  return Response.json({ forms: (forms || []).map(f => ({ ...f, _counts: counts[f.id] || { fields: 0, records: 0 } })) })
}

export async function POST(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  try {
    const { name, description } = await req.json()
    if (!String(name || '').trim()) return Response.json({ error: 'Form name is required' }, { status: 400 })
    const { data: maxRow } = await mdmAdmin.from('mdm_forms').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
    const { data, error } = await mdmAdmin.from('mdm_forms').insert({
      name: String(name).trim(), description: String(description || '').trim() || null,
      sort_order: (maxRow?.sort_order || 0) + 1, created_by: auth.member.id,
    }).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ form: data })
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
}

export async function PATCH(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  try {
    const { id, name, description, is_active, sort_order } = await req.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const patch = {}
    if (name !== undefined) patch.name = String(name).trim()
    if (description !== undefined) patch.description = String(description || '').trim() || null
    if (typeof is_active === 'boolean') patch.is_active = is_active
    if (typeof sort_order === 'number') patch.sort_order = sort_order
    const { error } = await mdmAdmin.from('mdm_forms').update(patch).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
}

export async function DELETE(req) {
  const auth = await requireMdmAuth(req, { requireAdmin: true })
  if (!auth.ok) return auth.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await mdmAdmin.from('mdm_forms').delete().eq('id', id)   // cascades fields + records
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
