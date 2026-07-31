// lib/emailDomain.js  (SERVER ONLY — imports node:dns)
// Verify a recipient's domain can actually receive mail BEFORE sending, so a
// typo'd domain (e.g. whitegold1.money, which doesn't exist) is rejected up
// front instead of silently bouncing after SMTP "accepts" the message.
//
// Only import this from server routes — it pulls in node:dns.

import dns from 'node:dns/promises'
import { EMAIL_RE } from './companyMail'

// Returns { ok: true } if the domain has mail servers (MX) or at least resolves
// to an IP (implicit MX). Returns { ok: false, reason } for a clearly bad domain.
// FAILS OPEN on transient DNS errors (timeout / SERVFAIL) — our DNS hiccup must
// never block a legitimate send.
export async function checkRecipientDomain(email) {
  const e = String(email || '').trim()
  if (!EMAIL_RE.test(e)) return { ok: false, reason: `"${e}" is not a valid email address` }
  const domain = e.split('@')[1].toLowerCase()

  try {
    const mx = await dns.resolveMx(domain)
    if (mx && mx.some(r => r && r.exchange)) return { ok: true }
    // resolved but empty MX → fall through to A/AAAA check
  } catch (err) {
    const code = err && err.code
    if (code === 'ENOTFOUND') return { ok: false, reason: `the domain "${domain}" doesn't exist` }
    if (code !== 'ENODATA') return { ok: true }   // transient/unknown → fail open
    // ENODATA = domain exists but has no MX record → try A/AAAA (implicit MX)
  }

  try { const a  = await dns.resolve4(domain); if (a && a.length)  return { ok: true } } catch {}
  try { const a6 = await dns.resolve6(domain); if (a6 && a6.length) return { ok: true } } catch {}
  return { ok: false, reason: `the domain "${domain}" has no mail server` }
}
