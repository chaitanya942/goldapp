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
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

const BUCKET = 'whitegold-call-recordings'

function findMp3Files(dir) {
  const results = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) results.push(...findMp3Files(fullPath))
    else if (entry.toLowerCase().endsWith('.mp3')) results.push(fullPath)
  }
  return results
}

function findMetadataJson(dir) {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      const found = findMetadataJson(fullPath)
      if (found) return found
    } else if (entry === 'metadata.json') return fullPath
  }
  return null
}

function parseFilename(filename) {
  const base  = filename.replace(/\.mp3$/i, '')
  const parts = base.split('-')
  if (parts.length < 6) return null
  try {
    return {
      gnani_call_id:   parts[2],
      customer_number: parts[3],
      call_date:       parts[4].replace(/_/g, '-'),
      call_time:       parts[5].replace(/_/g, ':'),
    }
  } catch { return null }
}



function fmtLanguage(lang) {
  if (!lang) return 'unknown'
  return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase()
}

async function downloadFromS3(key, localPath) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  const { Body } = await s3.send(cmd)
  await pipeline(Body, createWriteStream(localPath))
}

async function uploadToS3(localPath, s3Key, contentType = 'audio/mpeg') {
  const stream = createReadStream(localPath)
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: s3Key, Body: stream, ContentType: contentType })
  await s3.send(cmd)
  return `https://${BUCKET}.s3.ap-south-1.amazonaws.com/${s3Key}`
}

async function listTarFiles(language = null) {
  const prefix = language ? `${language}/` : ''
  const cmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
  const { Contents = [] } = await s3.send(cmd)
  return Contents.filter(obj => obj.Key.endsWith('.tar.gz')).map(obj => obj.Key)
}

// Check which gnani_call_ids already exist in bulk — avoids N+1 queries
async function getExistingIds(gnaniIds) {
  const { data } = await supabase
    .from('telesales_calls')
    .select('gnani_call_id')
    .in('gnani_call_id', gnaniIds)
  return new Set((data || []).map(r => r.gnani_call_id))
}

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

    if (tarKeys.length === 0) {
      return Response.json({ success: true, message: 'No tar.gz files found', inserted: 0 })
    }

    let totalInserted = 0
    let totalSkipped  = 0
    const errors      = []

    for (const tarKey of tarKeys) {
      const pathParts = tarKey.split('/')
      const language  = fmtLanguage(pathParts[0])
      const datePath  = `${pathParts[1]}/${pathParts[2]}/${pathParts[3]}`

      const tmpDir   = join(tmpdir(), `gnani_${Date.now()}`)
      mkdirSync(tmpDir, { recursive: true })
      const localTar = join(tmpDir, 'recordings.tar.gz')

      try {
        await downloadFromS3(tarKey, localTar)
        await extract({ file: localTar, cwd: tmpDir, strict: false })

        const mp3Files = findMp3Files(tmpDir)
        if (!mp3Files.length) continue

        // Parse all filenames first
        const parsed = mp3Files.map(mp3Path => {
          const filename = mp3Path.split(/[\\/]/).pop()
          const meta     = parseFilename(filename)
          return meta ? { mp3Path, filename, ...meta } : null
        }).filter(Boolean)

        // Bulk check which IDs already exist — single query instead of N queries
        const allIds     = parsed.map(p => p.gnani_call_id)
        const existingIds = await getExistingIds(allIds)

        const toInsert = parsed.filter(p => !existingIds.has(p.gnani_call_id))
        totalSkipped  += parsed.length - toInsert.length

        if (!toInsert.length) continue

        // Process all new files in parallel — upload + read duration simultaneously
        const results = await Promise.all(toInsert.map(async (item) => {
          try {
            const s3RecKey = `recordings/${pathParts[0]}/${datePath}/${item.filename}`

            // Upload + read duration in parallel
            const recordingUrl     = await uploadToS3(item.mp3Path, s3RecKey)
            const duration_seconds = gnaniMeta.call_duration ? Math.round(gnaniMeta.call_duration) : null

            return {
              gnani_call_id:      item.gnani_call_id,
              customer_number:    item.customer_number,
              call_date:          item.call_date,
              call_time:          item.call_time,
              language:           gnaniMeta.language ? gnaniMeta.language.charAt(0).toUpperCase() + gnaniMeta.language.slice(1).toLowerCase() : language,
              duration_seconds,
              customer_name:      gnaniMeta.customer_name || null,
              call_disposition:   gnaniMeta.call_disposition || null,
              system_disposition: gnaniMeta.system_disposition || null,
              summary:            gnaniMeta.summary || null,
              recording_url:      recordingUrl,
              s3_key:             s3RecKey,
              outcome:            'pending',
            }
          } catch (err) {
            errors.push(`Failed ${item.filename}: ${err.message}`)
            return null
          }
        }))

        const validRows = results.filter(Boolean)

        // Bulk insert all rows at once — single query instead of N queries
        if (validRows.length > 0) {
          const { error: insertErr } = await supabase
            .from('telesales_calls')
            .insert(validRows)

          if (insertErr) {
            // Fallback to individual inserts if bulk fails
            for (const row of validRows) {
              const { error: e } = await supabase.from('telesales_calls').insert(row)
              if (e) errors.push(`Insert failed: ${e.message}`)
              else totalInserted++
            }
          } else {
            totalInserted += validRows.length
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
  const { count } = await supabase.from('telesales_calls').select('*', { count: 'exact', head: true })
  return Response.json({ status: 'ok', total_calls: count, bucket: BUCKET })
}