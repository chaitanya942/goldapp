// app/api/download-recording/route.js
// Proxies S3 audio through our server so the browser can save with a
// branded filename. Audio is customer PII — ADMIN only.

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const s3 = new S3Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

// Telesales team needs to download recordings for offline review.
export async function POST(req) {
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.TELESALES })
  if (!auth.ok) return auth.response
  try {
    const { s3_key, filename } = await req.json()
    if (!s3_key) return new Response('Missing s3_key', { status: 400 })

    const cmd = new GetObjectCommand({
      Bucket: 'whitegold-call-recordings',
      Key:    s3_key,
    })
    const { Body, ContentLength } = await s3.send(cmd)

    const headers = {
      'Content-Type':        'audio/mpeg',
      'Content-Disposition': `attachment; filename="${filename || 'recording.mp3'}"`,
    }
    if (ContentLength) headers['Content-Length'] = String(ContentLength)

    return new Response(Body, { status: 200, headers })
  } catch (err) {
    console.error('Download error:', err)
    return new Response(err.message, { status: 500 })
  }
}