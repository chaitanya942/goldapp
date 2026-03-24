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

// Get MP3 duration by reading MPEG frame headers directly — no npm package needed
function getMp3DurationFromBuffer(buffer) {
  try {
    // Look for ID3 tag to skip it
    let offset = 0
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      // ID3v2 tag — skip it
      const id3Size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) |
                      ((buffer[8] & 0x7f) << 7)  |  (buffer[9] & 0x7f)
      offset = id3Size + 10
    }

    // Find first valid MPEG frame sync
    while (offset < buffer.length - 4) {
      if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
        const b1 = buffer[offset + 1]
        const b2 = buffer[offset + 2]

        const version   = (b1 >> 3) & 0x3  // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
        const layer     = (b1 >> 1) & 0x3  // 3=LayerI, 2=LayerII, 1=LayerIII
        const bitrateIdx = (b2 >> 4) & 0xf
        const sampleIdx  = (b2 >> 2) & 0x3

        if (bitrateIdx === 0 || bitrateIdx === 15) { offset++; continue }
        if (sampleIdx === 3) { offset++; continue }

        const bitratesV1L3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0]
        const sampleRates  = [[11025,12000,8000,0],[0,0,0,0],[22050,24000,16000,0],[44100,48000,32000,0]]

        const bitrate    = bitratesV1L3[bitrateIdx] * 1000
        const sampleRate = sampleRates[version][sampleIdx]

        if (!bitrate || !sampleRate) { offset++; continue }

        // Estimate duration from file size and bitrate
        const fileSize  = buffer.length
        const duration  = (fileSize * 8) / bitrate
        return Math.round(duration)
      }
      offset++
    }
    return null
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
            const [recordingUrl, duration_seconds] = await Promise.all([
              uploadToS3(item.mp3Path, s3RecKey),
              Promise.resolve(getMp3DurationFromBuffer(readFileSync(item.mp3Path))),
            ])

            return {
              gnani_call_id:   item.gnani_call_id,
              customer_number: item.customer_number,
              call_date:       item.call_date,
              call_time:       item.call_time,
              language,
              duration_seconds,
              recording_url:   recordingUrl,
              s3_key:          s3RecKey,
              outcome:         'pending',
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