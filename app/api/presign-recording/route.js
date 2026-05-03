import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const s3 = new S3Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

const BUCKET = 'whitegold-call-recordings'

// Returns a 1-hour presigned S3 URL for a customer call recording. Audio
// contains PII — restrict to ADMIN.
export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response
  try {
    const { s3_key } = await req.json()
    if (!s3_key) return Response.json({ error: 'Missing s3_key' }, { status: 400 })

    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: s3_key })
    const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 }) // 1 hour

    return Response.json({ url })
  } catch (err) {
    console.error('Presign error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}