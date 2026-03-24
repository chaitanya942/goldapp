// app/api/bulk-download-recordings/route.js
// Downloads multiple MP3s from S3 and returns a ZIP

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'

const s3 = new S3Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

const BUCKET = 'whitegold-call-recordings'

// Simple ZIP builder — pure JS, no native dependencies
// Uses store compression (no compression, just packaging)
function buildZip(files) {
  // files: [{name, data: Uint8Array}]
  const parts = []
  const centralDir = []
  let offset = 0

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name)
    const data      = file.data

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0,  0x04034b50, true) // signature
    lv.setUint16(4,  20, true)          // version needed
    lv.setUint16(6,  0, true)           // flags
    lv.setUint16(8,  0, true)           // compression (store)
    lv.setUint16(10, 0, true)           // mod time
    lv.setUint16(12, 0, true)           // mod date
    lv.setUint32(14, 0, true)           // crc32 (skip)
    lv.setUint32(18, data.length, true) // compressed size
    lv.setUint32(22, data.length, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)           // extra field length
    localHeader.set(nameBytes, 30)

    // Central directory entry
    const cdEntry = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cdEntry.buffer)
    cv.setUint32(0,  0x02014b50, true) // signature
    cv.setUint16(4,  20, true)
    cv.setUint16(6,  20, true)
    cv.setUint16(8,  0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
    cv.setUint32(16, 0, true)           // crc32
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0x20, true)        // external attr
    cv.setUint32(42, offset, true)      // local header offset
    cdEntry.set(nameBytes, 46)

    parts.push(localHeader, data)
    centralDir.push(cdEntry)
    offset += localHeader.length + data.length
  }

  // End of central directory
  const cdSize   = centralDir.reduce((s, e) => s + e.length, 0)
  const eocd     = new Uint8Array(22)
  const ev       = new DataView(eocd.buffer)
  ev.setUint32(0,  0x06054b50, true)
  ev.setUint16(4,  0, true)
  ev.setUint16(6,  0, true)
  ev.setUint16(8,  files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  const all = [...parts, ...centralDir, eocd]
  const total = all.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let pos = 0
  for (const a of all) { result.set(a, pos); pos += a.length }
  return result
}

export async function POST(req) {
  try {
    const { ids } = await req.json() // array of call IDs to download
    if (!ids?.length) return new Response('No IDs provided', { status: 400 })

    // Fetch s3_key + metadata from Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const { data: callsData, error } = await supabase
      .from('telesales_calls')
      .select('id, s3_key, customer_number, call_date, call_time')
      .in('id', ids)

    if (error) throw new Error(error.message)
    if (!callsData?.length) return new Response('No calls found', { status: 404 })

    // Download each MP3 from S3
    const files = []
    for (const call of callsData) {
      if (!call.s3_key) continue
      const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: call.s3_key })
      const { Body } = await s3.send(cmd)
      const chunks = []
      for await (const chunk of Body) chunks.push(chunk)
      const data = new Uint8Array(Buffer.concat(chunks))
      const name = `call-${call.customer_number}-${call.call_date}-${(call.call_time || '').slice(0,5).replace(':', '')}.mp3`
      files.push({ name, data })
    }

    if (!files.length) return new Response('No audio files found', { status: 404 })

    const zipData = buildZip(files)
    const date    = new Date().toISOString().slice(0, 10)

    return new Response(zipData, {
      status:  200,
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': `attachment; filename="calls-${date}.zip"`,
        'Content-Length':      String(zipData.length),
      },
    })
  } catch (err) {
    console.error('Bulk download error:', err)
    return new Response(err.message, { status: 500 })
  }
}