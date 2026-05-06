import { createClient } from '@supabase/supabase-js'
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { pipeline } from 'stream/promises'
import { createWriteStream, createReadStream, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { extract } from 'tar'
import { requireAuth, ROLE_GROUPS } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const s3 = new S3Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

const BUCKET = 'whitegold-call-recordings'

// --- HELPER FUNCTIONS ---

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
  const base = filename.replace(/\.mp3$/i, '')
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
  if (!lang) return 'Unknown'
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
  const keys = []
  let continuationToken

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    })
    const res = await s3.send(cmd)
    ;(res.Contents || []).forEach(obj => {
      if (obj.Key.endsWith('.tar.gz')) keys.push(obj.Key)
    })
    continuationToken = res.IsTruncated ? res.NextContinuationToken : null
  } while (continuationToken)

  return keys
}

async function listAllS3Objects(prefix = '') {
  const keys = []
  let continuationToken

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    })
    const res = await s3.send(cmd)
    ;(res.Contents || []).forEach(obj => keys.push({ key: obj.Key, size: obj.Size }))
    continuationToken = res.IsTruncated ? res.NextContinuationToken : null
  } while (continuationToken)

  return keys
}

async function getExistingIds(gnaniIds) {
  if (!gnaniIds.length) return new Set()
  const { data } = await supabase
    .from('telesales_calls')
    .select('gnani_call_id')
    .in('gnani_call_id', gnaniIds)
  return new Set((data || []).map(r => r.gnani_call_id))
}

// ── Fetch metadata.json from S3 as a separate object (not inside tar) ──────────
// Gnani places it at: {language}/{year}/{month}/{day}/metadata.json
// Each entry has a `unique_id` field that matches gnani_call_id in MP3 filenames
async function fetchMetadataFromS3(language, year, month, day) {
  const key = `${language}/${year}/${month}/${day}/metadata.json`
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
    const { Body } = await s3.send(cmd)
    const chunks = []
    for await (const chunk of Body) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    const rawData = JSON.parse(text)
    const metaArray = Array.isArray(rawData) ? rawData : [rawData]
    // Key by unique_id (matches gnani_call_id in MP3 filename)
    const map = {}
    metaArray.forEach(m => {
      if (m.unique_id) map[m.unique_id] = m
    })
    return map
  } catch (err) {
    if (err.name !== 'NoSuchKey') console.warn(`metadata.json not found at ${key}:`, err.message)
    return {}
  }
}

// --- MAIN HANDLER ---

export async function POST(req) {
  // Pulls voicebot recordings + metadata from S3 / writes to Supabase. Costly
  // operation that should never be triggered anonymously. Cron variant uses
  // the GET handler with CRON_SECRET (handled below).
  // Open to telesales operators too — they're the ones who watch the call list
  // most actively and need to pull new recordings without waiting for an admin.
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.TELESALES })
  if (!auth.ok) return auth.response
  try {
    const body = await req.json().catch(() => ({}))

    // ── Backfill mode: update existing records that have null metadata ─────────
    if (body?.backfill) {
      return handleBackfill()
    }

    // ── Fast re-import: rebuild Supabase records from already-uploaded recordings/
    // Use this after wiping DB — reads MP3 keys from S3, pairs with metadata, inserts.
    // Much faster than re-downloading all tars.
    if (body?.reimport) {
      return handleReimport()
    }

    let tarKeys = []

    // 1. Determine which keys to process
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
      const language  = pathParts[0]  // lowercase e.g. 'kannada'
      const year      = pathParts[1]
      const month     = pathParts[2]
      const day       = pathParts[3]
      const datePath  = `${year}/${month}/${day}`

      const tmpDir = join(tmpdir(), `gnani_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`)
      mkdirSync(tmpDir, { recursive: true })
      const localTar = join(tmpDir, 'recordings.tar.gz')

      try {
        // Fetch metadata.json from S3 (separate object, not inside tar)
        const metadataMap = await fetchMetadataFromS3(language, year, month, day)

        await downloadFromS3(tarKey, localTar)
        await extract({ file: localTar, cwd: tmpDir, strict: false })

        const mp3Files = findMp3Files(tmpDir)
        if (!mp3Files.length) {
          console.log(`No MP3s found in ${tarKey}`)
          continue
        }

        const parsed = mp3Files.map(mp3Path => {
          const filename = mp3Path.split(/[\\/]/).pop()
          const meta     = parseFilename(filename)
          return meta ? { mp3Path, filename, ...meta } : null
        }).filter(Boolean)

        // 2. Filter out what's already in Supabase
        const allIds      = parsed.map(p => p.gnani_call_id)
        const existingIds = await getExistingIds(allIds)
        const toInsert    = parsed.filter(p => !existingIds.has(p.gnani_call_id))

        totalSkipped += (parsed.length - toInsert.length)

        if (!toInsert.length) continue

        // 3. Process new files
        const results = await Promise.all(toInsert.map(async (item) => {
          try {
            const s3RecKey  = `recordings/${language}/${datePath}/${item.filename}`
            // Match by unique_id (= gnani_call_id from filename)
            const gnaniMeta = metadataMap[item.gnani_call_id] || {}

            const recordingUrl     = await uploadToS3(item.mp3Path, s3RecKey)
            const duration_seconds = gnaniMeta.call_duration ? Math.round(gnaniMeta.call_duration) : null

            return {
              gnani_call_id:      item.gnani_call_id,
              customer_number:    item.customer_number,
              call_date:          item.call_date,
              call_time:          item.call_time,
              language:           gnaniMeta.language ? fmtLanguage(gnaniMeta.language) : fmtLanguage(language),
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

        // 4. Final Insert
        if (validRows.length > 0) {
          const { error: insertErr } = await supabase
            .from('telesales_calls')
            .insert(validRows)

          if (insertErr) {
            console.error('Bulk insert error, trying individual:', insertErr)
            for (const row of validRows) {
              const { error: e } = await supabase.from('telesales_calls').insert(row)
              if (e) errors.push(`Insert failed: ${e.message}`)
              else totalInserted++
            }
          } else {
            totalInserted += validRows.length
          }
        }

      } catch (err) {
        console.error(`Error processing tarKey ${tarKey}:`, err)
        errors.push(`Tar error ${tarKey}: ${err.message}`)
      } finally {
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
      }
    }

    // Get actual DB count so message matches the table
    const { count: totalInDb } = await supabase
      .from('telesales_calls')
      .select('*', { count: 'exact', head: true })

    return Response.json({
      success:  true,
      inserted: totalInserted,
      skipped:  totalSkipped,
      total:    totalInDb,
      errors:   errors.length > 0 ? errors : undefined,
      message:  totalInserted > 0
        ? `✓ ${totalInserted} new calls synced · ${totalInDb} total`
        : `Up to date · ${totalInDb} calls`,
    })

  } catch (err) {
    console.error('Gnani sync root error:', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
}

// ── Fast re-import: rebuild DB from already-uploaded recordings/ MP3s ──────────
// Reads recordings/{language}/{year}/{month}/{day}/{filename}.mp3 keys from S3,
// pairs each with metadata.json (fetched once per date), inserts into Supabase.
async function handleReimport() {
  // List all MP3s in recordings/ prefix
  const allObjects  = await listAllS3Objects('recordings/')
  const mp3Objects  = allObjects.filter(o => o.key.endsWith('.mp3'))

  if (!mp3Objects.length) {
    return Response.json({ success: true, inserted: 0, message: 'No uploaded recordings found in recordings/ prefix' })
  }

  // Group by language/date to fetch metadata once per group
  const groups = new Map()
  for (const { key } of mp3Objects) {
    // key format: recordings/{language}/{year}/{month}/{day}/{filename}.mp3
    const parts = key.split('/')
    if (parts.length < 6) continue
    const [, language, year, month, day] = parts
    const filename = parts[parts.length - 1]
    const groupKey = `${language}/${year}/${month}/${day}`
    if (!groups.has(groupKey)) groups.set(groupKey, { language, year, month, day, files: [] })
    groups.get(groupKey).files.push({ key, filename })
  }

  let totalInserted = 0
  const errors = []

  for (const [, group] of groups) {
    const { language, year, month, day, files } = group
    const metadataMap = await fetchMetadataFromS3(language, year, month, day)

    const rows = files.map(({ key, filename }) => {
      const meta = parseFilename(filename)
      if (!meta) return null
      const gnaniMeta = metadataMap[meta.gnani_call_id] || {}
      return {
        gnani_call_id:      meta.gnani_call_id,
        customer_number:    meta.customer_number,
        call_date:          meta.call_date,
        call_time:          meta.call_time,
        language:           gnaniMeta.language ? fmtLanguage(gnaniMeta.language) : fmtLanguage(language),
        duration_seconds:   gnaniMeta.call_duration ? Math.round(gnaniMeta.call_duration) : null,
        customer_name:      gnaniMeta.customer_name      || null,
        call_disposition:   gnaniMeta.call_disposition   || null,
        system_disposition: gnaniMeta.system_disposition || null,
        summary:            gnaniMeta.summary            || null,
        recording_url:      `https://${BUCKET}.s3.ap-south-1.amazonaws.com/${key}`,
        s3_key:             key,
        outcome:            'pending',
      }
    }).filter(Boolean)

    if (!rows.length) continue

    // Check which ones already exist (skip on re-run)
    const ids = rows.map(r => r.gnani_call_id)
    const existingSet = await getExistingIds(ids)
    const toInsert = rows.filter(r => !existingSet.has(r.gnani_call_id))

    if (!toInsert.length) continue

    // Insert in batches of 100
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100)
      const { error } = await supabase.from('telesales_calls').insert(batch)
      if (error) {
        errors.push(`Insert error (${language} ${year}-${month}-${day}): ${error.message}`)
      } else {
        totalInserted += batch.length
      }
    }
  }

  return Response.json({
    success:  errors.length === 0,
    inserted: totalInserted,
    errors:   errors.length ? errors : undefined,
    message:  `Re-imported ${totalInserted} calls from ${groups.size} date groups`,
  })
}

// ── Backfill: fetch metadata for existing records that have null fields ─────────
async function handleBackfill() {
  // Find all records missing metadata (customer_name or call_disposition is null)
  const { data: nullRecords, error } = await supabase
    .from('telesales_calls')
    .select('gnani_call_id, call_date, language')
    .or('customer_name.is.null,call_disposition.is.null')
    .order('call_date', { ascending: false })

  if (error) return Response.json({ success: false, error: error.message }, { status: 500 })
  if (!nullRecords?.length) return Response.json({ success: true, updated: 0, message: 'All records already have metadata' })

  // Group by date + language to minimize S3 fetches
  const groups = new Map()
  nullRecords.forEach(r => {
    const lang = (r.language || 'Kannada').toLowerCase()
    const [year, month, day] = (r.call_date || '').split('-')
    if (!year || !month || !day) return
    const key = `${lang}/${year}/${month}/${day}`
    if (!groups.has(key)) groups.set(key, { lang, year, month, day, ids: [] })
    groups.get(key).ids.push(r.gnani_call_id)
  })

  let totalUpdated = 0
  const errors = []

  for (const [, group] of groups) {
    const metadataMap = await fetchMetadataFromS3(group.lang, group.year, group.month, group.day)
    if (!Object.keys(metadataMap).length) continue

    // Update each record that has metadata available
    const results = await Promise.all(
      group.ids.map(gnani_call_id => {
        const m = metadataMap[gnani_call_id]
        if (!m) return Promise.resolve(null)
        return supabase.from('telesales_calls').update({
          customer_name:      m.customer_name      || null,
          call_disposition:   m.call_disposition   || null,
          system_disposition: m.system_disposition || null,
          duration_seconds:   m.call_duration ? Math.round(m.call_duration) : null,
          summary:            m.summary            || null,
          language:           m.language ? fmtLanguage(m.language) : undefined,
        }).eq('gnani_call_id', gnani_call_id)
      })
    )

    results.forEach((res, i) => {
      if (!res) return
      if (res.error) errors.push(`Update failed ${group.ids[i]}: ${res.error.message}`)
      else totalUpdated++
    })
  }

  return Response.json({
    success: true,
    updated: totalUpdated,
    errors:  errors.length ? errors : undefined,
    message: `Backfilled metadata for ${totalUpdated} calls`,
  })
}

export async function GET(req) {
  // Inventory / count read — exposes S3 layout if `inventory=1`. Restrict to
  // ADMIN to prevent infra fingerprinting by any logged-in user.
  const auth = await requireAuth(req, { requiredRoles: ROLE_GROUPS.ADMIN })
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const { count } = await supabase.from('telesales_calls').select('*', { count: 'exact', head: true })

  if (searchParams.get('inventory') === '1') {
    const allObjects = await listAllS3Objects('')
    const tarFiles   = allObjects.filter(o => o.key.endsWith('.tar.gz'))
    const metaFiles  = allObjects.filter(o => o.key.endsWith('metadata.json'))
    const recFiles   = allObjects.filter(o => o.key.startsWith('recordings/') && o.key.endsWith('.mp3'))

    // Summarize by language/date
    const summary = {}
    tarFiles.forEach(({ key }) => {
      const p = key.split('/')
      const lang = p[0], date = `${p[1]}-${p[2]}-${p[3]}`
      const k = `${lang}/${date}`
      if (!summary[k]) summary[k] = { tar: false, metadata: false }
      summary[k].tar = true
    })
    metaFiles.forEach(({ key }) => {
      const p = key.split('/')
      const lang = p[0], date = `${p[1]}-${p[2]}-${p[3]}`
      const k = `${lang}/${date}`
      if (!summary[k]) summary[k] = { tar: false, metadata: false }
      summary[k].metadata = true
    })

    return Response.json({
      status:         'ok',
      total_calls_db: count,
      bucket:         BUCKET,
      tar_files:      tarFiles.length,
      metadata_files: metaFiles.length,
      uploaded_mp3s:  recFiles.length,
      by_date:        summary,
    })
  }

  return Response.json({ status: 'ok', total_calls: count, bucket: BUCKET })
}
