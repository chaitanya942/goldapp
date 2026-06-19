// app/api/mdm/upload/route.js
// Document upload for file fields. Stores into the private "mdm-docs" bucket
// and returns { path, name, size, type } which the client puts into the
// record's data under the field key. Any active MDM user can upload.

import crypto from 'crypto'
import { requireMdmAuth, mdmAdmin } from '../../../../lib/mdmAuth'

const BUCKET = 'mdm-docs'
const MAX_BYTES = 25 * 1024 * 1024   // 25 MB

export async function POST(req) {
  const auth = await requireMdmAuth(req)
  if (!auth.ok) return auth.response
  try {
    const form = await req.formData()
    const file = form.get('file')
    const formId = String(form.get('form_id') || 'misc')
    if (!file || typeof file === 'string') return Response.json({ error: 'No file' }, { status: 400 })
    if (file.size > MAX_BYTES) return Response.json({ error: 'File exceeds 25 MB' }, { status: 400 })

    const safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 80)
    const path = `forms/${formId}/${crypto.randomUUID()}_${safe}`
    const buf = Buffer.from(await file.arrayBuffer())

    const { error } = await mdmAdmin.storage.from(BUCKET).upload(path, buf, {
      contentType: file.type || 'application/octet-stream', upsert: false,
    })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ path, name: file.name || safe, size: file.size, type: file.type || null })
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
}
