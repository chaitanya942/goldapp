import { createClient } from '@supabase/supabase-js'
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { pipeline } from 'stream/promises'
import { createWriteStream, createReadStream, mkdirSync, rmSync, existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { extract } from 'tar'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const s3 = new S3Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

const BUCKET = 'whitegold-call-recordings'

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function findMp3Files(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) results.push(...findMp3Files(fullPath))
    else if (entry.toLowerCase().endsWith('.mp3')) results.push(fullPath)
  }
  return results
}

function findMetadataJson(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      const found = findMetadataJson(fullPath)
      if (found) return found
    } else if (entry === 'metadata.json') {
      return fullPath
    }
  }
  return null
}

function parseFilename(filename) {
  const base = filename.replace(/\.mp3$/i, '')
  const parts = base.split('-')
  if (parts.length < 6) return null

  return {
    gnani_call_id: parts[2],
    customer_number: parts[3],
    call_date: parts[4].replace(/_/g, '-'),
    call_time: parts[5].replace(/_/g, ':'),
  }
}

function fmtLanguage(lang) {
  if (!lang) return 'Unknown'
  return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase()
}

async function downloadFromS3(key, localPath) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  await pipeline(Body, createWriteStream(localPath))
}

async function uploadToS3(localPath, s3Key) {
  const stream = createReadStream(localPath)
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: stream,
    ContentType: 'audio/mpeg'
  }))
  return `https://${BUCKET}.s3.ap-south-1.amazonaws.com/${s3Key}`
}

async function listTarFiles(language = null) {
  const prefix = language ? `${language}/` : ''
  const { Contents = [] } = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
  )
  return Contents.filter(obj => obj.Key.endsWith('.tar.gz')).map(obj => obj.Key)
}

// ─────────────────────────────────────────────
// MAIN API
// ─────────────────────────────────────────────

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))

    let tarKeys = []

    if (body?.Records) {
      tarKeys = body.Records
        .filter(r => r.s3?.object?.key?.endsWith('.tar.gz'))
        .map(r => decodeURIComponent(r.s3.object.key.replace(/\+/g, ' ')))
    } else if (body?.key) {
      tarKeys = [body.key]
    } else {
      tarKeys = await listTarFiles(body?.language || null)
    }

    if (!tarKeys.length) {
      return Response.json({ success: true, inserted: 0, message: 'No tar files found' })
    }

    let totalInserted = 0
    let totalSkipped = 0
    const errors = []

    for (const tarKey of tarKeys) {
      const pathParts = tarKey.split('/')
      const language = fmtLanguage(pathParts[0])
      const datePath = `${pathParts[1]}/${pathParts[2]}/${pathParts[3]}`

      const tmpDir = join(tmpdir(), `gnani_${Date.now()}`)
      mkdirSync(tmpDir, { recursive: true })

      try {
        const localTar = join(tmpDir, 'data.tar.gz')

        await downloadFromS3(tarKey, localTar)
        await extract({ file: localTar, cwd: tmpDir, strict: false })

        // ─── Load metadata.json ───
        let metadataMap = {}

        const metadataPath = findMetadataJson(tmpDir)

        if (metadataPath) {
          try {
            const raw = JSON.parse(readFileSync(metadataPath, 'utf-8'))

            if (Array.isArray(raw)) {
              metadataMap = Object.fromEntries(
                raw.map(m => [m.gnani_call_id, m])
              )
            } else if (typeof raw === 'object') {
              metadataMap = raw
            }
          } catch (err) {
            console.error('Metadata parse error:', err)
          }
        }

        // ─── Parse MP3s ───
        const mp3Files = findMp3Files(tmpDir)

        const parsed = mp3Files
          .map(mp3Path => {
            const filename = mp3Path.split(/[\\/]/).pop()
            const meta = parseFilename(filename)
            return meta ? { ...meta, filename, mp3Path } : null
          })
          .filter(Boolean)

        if (!parsed.length) continue

        // ─── Process rows ───
        const results = await Promise.all(parsed.map(async (item) => {
          try {
            const gnaniMeta = metadataMap[item.gnani_call_id] || {}

            const s3Key = `recordings/${pathParts[0]}/${datePath}/${item.filename}`
            const recordingUrl = await uploadToS3(item.mp3Path, s3Key)

            return {
              gnani_call_id: item.gnani_call_id,
              customer_number: item.customer_number,
              call_date: item.call_date,
              call_time: item.call_time,
              language: fmtLanguage(gnaniMeta.language) || language,
              duration_seconds: gnaniMeta.call_duration ? Math.round(gnaniMeta.call_duration) : null,
              customer_name: gnaniMeta.customer_name || null,
              call_disposition: gnaniMeta.call_disposition || null,
              system_disposition: gnaniMeta.system_disposition || null,
              summary: gnaniMeta.summary || null,
              recording_url: recordingUrl,
              s3_key: s3Key,
              outcome: 'pending',
            }

          } catch (err) {
            console.error('Row failed:', item, err)
            errors.push(err.message)
            return null
          }
        }))

        const validRows = results.filter(Boolean)

        console.log('DEBUG:', {
          parsed: parsed.length,
          validRows: validRows.length
        })

        if (!validRows.length) continue

        // ─── UPSERT (important) ───
        const { error } = await supabase
          .from('telesales_calls')
          .upsert(validRows, { onConflict: 'gnani_call_id' })

        if (error) {
          console.error('Insert error:', error)
          errors.push(error.message)
        } else {
          totalInserted += validRows.length
        }

      } finally {
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
      }
    }

    return Response.json({
      success: true,
      inserted: totalInserted,
      errors: errors.length ? errors : undefined,
      message: `Synced ${totalInserted} calls`
    })

  } catch (err) {
    console.error('SYNC ERROR:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
}