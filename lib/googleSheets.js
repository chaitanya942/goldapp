// lib/googleSheets.js
//
// Minimal Google Sheets writer using a service account — no heavy dependency.
// We sign an RS256 JWT with Node's built-in crypto, exchange it for an access
// token, and call the Sheets REST API. The service account can only touch
// sheets you've explicitly shared with its email; it has no other access.
//
// Env vars (set on Railway):
//   GOOGLE_SA_EMAIL        — the service account's client_email
//   GOOGLE_SA_PRIVATE_KEY  — its private_key (newlines may be stored as \n)

import crypto from 'crypto'

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')

async function getAccessToken() {
  const email = process.env.GOOGLE_SA_EMAIL
  const key   = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Google service account not configured (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY)')

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim  = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }))
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`); signer.end()
  const jwt = `${header}.${claim}.${b64url(signer.sign(key))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google token error: ${j.error_description || j.error || res.status}`)
  return j.access_token
}

const api = (id, path) => `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${path}`

// Overwrite a tab with header + rows, starting at startCell (default A1).
// startCell lets you preserve formula/header rows above the data (e.g. 'C4').
export async function pushToSheet(spreadsheetId, tab, header, rows, startCell = 'A1') {
  const token = await getAccessToken()
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const range = `${encodeURIComponent(tab)}!${startCell}`

  // Clear the data region from startCell down/right, then write fresh.
  const clearRange = `${encodeURIComponent(tab)}!${startCell.replace(/[0-9]+$/, '')}${startCell.match(/[0-9]+$/)?.[0] || 1}:ZZ`
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${clearRange}:clear`, { method: 'POST', headers: H })

  const values = header ? [header, ...rows] : rows
  const res = await fetch(`${api(spreadsheetId, range)}?valueInputOption=RAW`, {
    method: 'PUT', headers: H, body: JSON.stringify({ values }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Sheets write error: ${j.error?.message || res.status}`)
  return { updatedRows: j.updatedRows ?? values.length, updatedCells: j.updatedCells }
}
