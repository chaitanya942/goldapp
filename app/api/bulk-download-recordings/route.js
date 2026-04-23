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

// ── CRC32 (required by ZIP spec — Windows extractor rejects zips without it) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32(data) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ── DOS time encoding for ZIP headers ─────────────────────────────────────────
function dosTime() {
  const now = new Date()
  return ((now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate()) << 16
       | (now.getHours() << 11 | now.getMinutes() << 5 | (now.getSeconds() >> 1))
}

// ── ZIP builder with valid CRC32 ──────────────────────────────────────────────
function buildZip(files) {
  const parts      = []
  const centralDir = []
  let offset = 0
  const dt   = dosTime()

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name)
    const data      = file.data
    const crc       = crc32(data)
    const size      = data.length

    // Local file header (30 + name)
    const lh = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32(0,  0x04034b50, true) // signature PK\x03\x04
    lv.setUint16(4,  20, true)          // version needed: 2.0
    lv.setUint16(6,  0, true)           // flags
    lv.setUint16(8,  0, true)           // compression: STORE
    lv.setUint32(10, dt, true)          // mod time + date
    lv.setUint32(14, crc, true)         // CRC-32
    lv.setUint32(18, size, true)        // compressed size
    lv.setUint32(22, size, true)        // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)           // extra field length
    lh.set(nameBytes, 30)

    // Central directory entry (46 + name)
    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0,  0x02014b50, true) // signature PK\x01\x02
    cv.setUint16(4,  20, true)          // version made by
    cv.setUint16(6,  20, true)          // version needed
    cv.setUint16(8,  0, true)           // flags
    cv.setUint16(10, 0, true)           // compression: STORE
    cv.setUint32(12, dt, true)          // mod time + date
    cv.setUint32(16, crc, true)         // CRC-32
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)           // extra field length
    cv.setUint16(32, 0, true)           // comment length
    cv.setUint16(34, 0, true)           // disk number start
    cv.setUint16(36, 0, true)           // internal attributes
    cv.setUint32(38, 0x20, true)        // external attributes (archive)
    cv.setUint32(42, offset, true)      // local header offset
    cd.set(nameBytes, 46)

    parts.push(lh, data)
    centralDir.push(cd)
    offset += lh.length + data.length
  }

  // End of central directory record
  const cdSize = centralDir.reduce((s, e) => s + e.length, 0)
  const eocd   = new Uint8Array(22)
  const ev     = new DataView(eocd.buffer)
  ev.setUint32(0,  0x06054b50, true)   // signature PK\x05\x06
  ev.setUint16(4,  0, true)
  ev.setUint16(6,  0, true)
  ev.setUint16(8,  files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  const all   = [...parts, ...centralDir, eocd]
  const total = all.reduce((s, a) => s + a.length, 0)
  const out   = new Uint8Array(total)
  let pos = 0
  for (const a of all) { out.set(a, pos); pos += a.length }
  return out
}

// ── Download one file from S3 ─────────────────────────────────────────────────
async function downloadS3(key) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const chunks = []
  for await (const chunk of Body) chunks.push(chunk)
  return new Uint8Array(Buffer.concat(chunks))
}

// ── Sanitize string for use in filenames ──────────────────────────────────────
function safe(str) {
  if (!str) return ''
  return str.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 30)
}

export async function POST(req) {
  try {
    const { ids } = await req.json()
    if (!ids?.length) return new Response('No IDs provided', { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
    )

    const { data: callsData, error } = await supabase
      .from('telesales_calls')
      .select('id, s3_key, customer_number, customer_name, call_date, call_time, call_disposition, language')
      .in('id', ids)
      .order('call_date', { ascending: false })

    if (error) throw new Error(error.message)
    if (!callsData?.length) return new Response('No calls found', { status: 404 })

    const withKeys = callsData.filter(c => c.s3_key)
    if (!withKeys.length) return new Response('No audio files found', { status: 404 })

    // ── Parallel S3 downloads (20 at a time) ─────────────────────────────────
    const CONCURRENCY = 20
    const files = []

    for (let i = 0; i < withKeys.length; i += CONCURRENCY) {
      const batch = withKeys.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map(async call => {
          try {
            const data = await downloadS3(call.s3_key)

            // Filename: YYYY-MM-DD_HH-MM_phone_CustomerName_DISPOSITION.mp3
            const date        = call.call_date || 'unknown'
            const time        = (call.call_time || '').slice(0, 5).replace(':', '-')
            const phone       = call.customer_number || 'unknown'
            const customer    = safe(call.customer_name)
            const disposition = safe(call.call_disposition)
            const nameParts   = [date, time, phone, customer, disposition].filter(Boolean)
            const name        = `${nameParts.join('_')}.mp3`

            return { name, data }
          } catch (err) {
            console.error(`Failed to download ${call.s3_key}:`, err.message)
            return null
          }
        })
      )
      results.forEach(r => r && files.push(r))
    }

    if (!files.length) return new Response('All audio downloads failed', { status: 500 })

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
