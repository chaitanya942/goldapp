import { createClient } from '@supabase/supabase-js'
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { pipeline } from 'stream/promises'
import { createWriteStream, createReadStream, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import tar from 'tar'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const s3 = new S3Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

const BUCKET = 'whitegold-call-recordings'

// Cross-platform recursive MP3 finder — pure Node.js, no shell
function findMp3Files(dir) {
  const results = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...findMp3Files(fullPath))
    } else if (entry.toLowerCase().endsWith('.mp3')) {
      results.push(fullPath)
    }
  }
  return results
}

// Parse filename: prod-{batch_uuid}-{gnani_call_id}-{phone}-{YYYY_MM_DD}-{HH_MM_SS}.mp3
function parseFilename(filename) {
  const base  = filename.replace(/\.mp3$/i, '')
  const parts = base.split('-')
  if (parts.length < 6) return null
  try {
    const gnani_call_id   = parts[2]
    const customer_number = parts[3]
    const call_date       = parts[4].replace(/_/g, '-') // 2026-03-23
    const call_time       = parts[5].replace(/_/g, ':') // 19:07:41
    return { gnani_call_id, customer_number, call_date, call_time }
  } catch {
    return null
  }
}

// Download S3 object to local tmp file
async function downloadFromS3(key, localPath) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  const { Body } = await s3.send(cmd)
  await pipeline(Body, createWriteStream(localPath))
}

// Upload local file to S3
async function uploadToS3(localPath, s3Key, contentType = 'audio/mpeg') {
  const stream = createReadStream(localPath)
  const cmd = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         s3Key,
    Body:        stream,
    ContentType: contentType,
  })
  await s3.send(cmd)
  return `https://${BUCKET}.s3.ap-south-1.amazonaws.com/${s3Key}`
}

// List all tar.gz files in the bucket
async function listTarFiles(language = null) {
  const prefix = language ? `${language}/` : ''
  const cmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
  const { Contents = [] } = await s3.send(cmd)
  return Contents.filter(obj => obj.Key.endsWith('.tar.gz')).map(obj => obj.Key)
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))

    let tarKeys = []

    if (body?.Records) {
      // S3 Event Notification webhook
      tarKeys = body.Records
        .filter(r => r.s3?.object?.key?.endsWith('.tar.gz'))
        .map(r => decodeURIComponent(r.s3.object.key.replace(/\+/g, ' ')))
    } else if (body?.key) {
      tarKeys = [body.key]
    } else {
      // Manual sync button — scan entire bucket
      const lang = body?.language || null
      tarKeys = await listTarFiles(lang)
    }

    if (tarKeys.length === 0) {
      return Response.json({ success: true, message: 'No tar.gz files found', inserted: 0 })
    }

    let totalInserted = 0
    let totalSkipped  = 0
    const errors      = []

    for (const tarKey of tarKeys) {
      const pathParts = tarKey.split('/')
      const language  = pathParts[0] || 'unknown'
      const datePath  = `${pathParts[1]}/${pathParts[2]}/${pathParts[3]}`

      const tmpDir   = join(tmpdir(), `gnani_${Date.now()}`)
      mkdirSync(tmpDir, { recursive: true })
      const localTar = join(tmpDir, 'recordings.tar.gz')

      try {
        // 1. Download tar.gz from S3
        await downloadFromS3(tarKey, localTar)

        // 2. Extract using npm 'tar' package — no shell, works on Vercel
        await tar.extract({ file: localTar, cwd: tmpDir, strict: false })

        // 3. Find all MP3 files recursively
        const mp3Files = findMp3Files(tmpDir)

        for (const mp3Path of mp3Files) {
          const filename = mp3Path.split(/[\\/]/).pop()
          const meta     = parseFilename(filename)

          if (!meta) {
            errors.push(`Could not parse filename: ${filename}`)
            continue
          }

          // Skip duplicates
          const { data: existing } = await supabase
            .from('telesales_calls')
            .select('id')
            .eq('gnani_call_id', meta.gnani_call_id)
            .single()

          if (existing) {
            totalSkipped++
            continue
          }

          // 4. Re-upload MP3 to recordings/ prefix in S3
          const s3RecKey     = `recordings/${language}/${datePath}/${filename}`
          const recordingUrl = await uploadToS3(mp3Path, s3RecKey)

          // 5. Insert into Supabase
          const { error: insertErr } = await supabase
            .from('telesales_calls')
            .insert({
              gnani_call_id:   meta.gnani_call_id,
              customer_number: meta.customer_number,
              call_date:       meta.call_date,
              call_time:       meta.call_time,
              language:        language,
              recording_url:   recordingUrl,
              s3_key:          s3RecKey,
              outcome:         'pending',
            })

          if (insertErr) {
            errors.push(`Insert failed for ${filename}: ${insertErr.message}`)
          } else {
            totalInserted++
          }
        }
      } finally {
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
      }
    }

    return Response.json({
      success:  true,
      inserted: totalInserted,
      skipped:  totalSkipped,
      errors:   errors.length > 0 ? errors : undefined,
      message:  `Synced ${totalInserted} new calls, skipped ${totalSkipped} duplicates`,
    })

  } catch (err) {
    console.error('Gnani sync error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
}

export async function GET() {
  const { count } = await supabase
    .from('telesales_calls')
    .select('*', { count: 'exact', head: true })

  return Response.json({
    status:      'ok',
    total_calls: count,
    bucket:      BUCKET,
  })
}