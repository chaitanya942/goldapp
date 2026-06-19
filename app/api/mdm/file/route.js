// app/api/mdm/file/route.js
// Returns a short-lived signed URL to download a stored document. Any active
// MDM user can fetch (the portal is the access boundary; the bucket is private).

import { requireMdmAuth, mdmAdmin } from '../../../../lib/mdmAuth'

const BUCKET = 'mdm-docs'

export async function POST(req) {
  const auth = await requireMdmAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { path } = await req.json()
    if (!path || typeof path !== 'string') return Response.json({ error: 'path required' }, { status: 400 })
    const { data, error } = await mdmAdmin.storage.from(BUCKET).createSignedUrl(path, 300)   // 5 min
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ url: data.signedUrl })
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
}
