// lib/sendMail.js
// Thin email-sending wrapper over Gmail SMTP (nodemailer). The app had no
// mailer before scheduled Finance reports needed one; Gmail SMTP was chosen so
// mail goes out from a real @whitegold.money address finance already trusts,
// with zero DNS setup.
//
// Required env (set on BOTH the web service and the goldapp-cron worker, since
// the dispatch path runs server-side from either):
//   GMAIL_USER          — the sending address, e.g. chaitanya@whitegold.money
//   GMAIL_APP_PASSWORD   — a Google *app password* (NOT the account password).
//                          Account → Security → 2-Step Verification → App
//                          passwords. 16 chars, spaces optional.
// Optional:
//   MAIL_FROM_NAME       — display name on the From header (default 'WhiteGold Reports')
//
// Everything is lazy — the transport is only created on first send, so importing
// this module in a route that never mails costs nothing and a missing app
// password only errors when you actually try to send.
import nodemailer from 'nodemailer'

let _transport = null

function transport() {
  if (_transport) return _transport
  const user = process.env.GMAIL_USER
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') // app passwords are shown space-separated
  if (!user || !pass) {
    throw new Error('Email not configured: set GMAIL_USER and GMAIL_APP_PASSWORD env vars')
  }
  _transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    // Persistent service (Railway) — keep the SMTP connection warm so repeated
    // sends skip the TLS/auth handshake each time.
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  })
  return _transport
}

export function mailConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
}

/**
 * Send an email. Recipients may be arrays or comma-separated strings.
 * @param {object} o
 * @param {string|string[]} o.to
 * @param {string|string[]} [o.cc]
 * @param {string} o.subject
 * @param {string} [o.html]
 * @param {string} [o.text]
 * @param {Array<{filename:string, content:Buffer|string, contentType?:string, encoding?:string}>} [o.attachments]
 * @returns {Promise<{messageId:string, accepted:string[], rejected:string[]}>}
 */
export async function sendMail({ to, cc, subject, html, text, attachments, replyTo, fromName }) {
  // The From ADDRESS is always GMAIL_USER — Gmail SMTP only sends from the
  // authenticated mailbox. `fromName` overrides just the display name (e.g. the
  // ops person who triggered the send), and `replyTo` routes replies to them,
  // which together make branch-facing mail read as if it came from that person.
  const name = (fromName || process.env.MAIL_FROM_NAME || 'WhiteGold Reports').replace(/[<>\r\n]/g, ' ').trim()
  const from = `${name} <${process.env.GMAIL_USER}>`
  const norm = (v) => Array.isArray(v) ? v.filter(Boolean) : (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [])
  const toList = norm(to)
  if (!toList.length) throw new Error('sendMail: at least one recipient (to) is required')
  const info = await transport().sendMail({
    from, to: toList, cc: norm(cc), replyTo: replyTo || undefined, subject, html, text, attachments,
  })
  return { messageId: info.messageId, accepted: info.accepted || [], rejected: info.rejected || [] }
}
