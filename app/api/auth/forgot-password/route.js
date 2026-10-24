// POST /api/auth/forgot-password { email } — emails a set-new-password link.
//
// Supabase's own mailer is broken ("Error sending … email"), so like invites
// (app/api/invite-user) the link is created with auth.admin.generateLink and
// sent through lib/sendMail (Gmail SMTP). Public route (no session — the user
// is locked out), so it:
//   - always answers { ok: true } whether or not the address has an account,
//     so it can't be used to discover who has one;
//   - only actually sends for an existing, active profile;
//   - limits each address to one email per minute and each IP to 10 per hour.

import { createClient } from '@supabase/supabase-js'
import { sendMail, mailConfigured } from '../../../../lib/sendMail'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const lastByEmail = new Map()          // email → last send ms
const hitsByIp = new Map()             // ip → [ms, …] within the last hour

const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function resetHtml(name, link) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#222">
  <h2 style="color:#9a7228;margin:0 0 16px">WhiteGold</h2>
  <p>Hi${name ? ' ' + esc(name) : ''},</p>
  <p>Use the button below to set a new password for the WhiteGold app.</p>
  <p style="margin:24px 0"><a href="${esc(link)}" style="background:#c9a84c;color:#111;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Set new password</a></p>
  <p style="font-size:12px;color:#777">If the button doesn't work, copy this link into your browser:<br>${esc(link)}</p>
  <p style="font-size:12px;color:#777">This link can be used once. If you didn't ask for it, you can ignore this email.</p>
</div>`
}

export async function POST(req) {
  const ok = Response.json({ ok: true })
  let email
  try { email = String((await req.json())?.email || '').trim().toLowerCase() } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }) }
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  if (!mailConfigured()) return Response.json({ error: 'Password reset email is not available right now. Please contact your admin.' }, { status: 503 })

  const now = Date.now()
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const hits = (hitsByIp.get(ip) || []).filter(t => now - t < 3600e3)
  if (hits.length >= 10) return Response.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  hitsByIp.set(ip, [...hits, now])
  if (now - (lastByEmail.get(email) || 0) < 60e3) return ok
  lastByEmail.set(email, now)

  const { data: profile } = await supabaseAdmin
    .from('user_profiles').select('full_name, is_active').ilike('email', email).maybeSingle()
  if (!profile || profile.is_active === false) return ok

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery', email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/reset` },
  })
  const link = data?.properties?.action_link
  if (error || !link) {
    console.error('[forgot-password] generateLink failed:', error?.message)
    return Response.json({ error: 'Could not create a reset link. Please contact your admin.' }, { status: 500 })
  }
  try {
    await sendMail({
      to: email, fromName: 'WhiteGold',
      subject: 'Set a new password for WhiteGold',
      html: resetHtml(profile.full_name, link),
      text: `Set a new password for the WhiteGold app here:\n${link}\n\nThis link can be used once.`,
    })
  } catch (e) {
    console.error('[forgot-password] send failed:', e?.message)
    return Response.json({ error: 'The reset email could not be sent. Please contact your admin.' }, { status: 502 })
  }
  return ok
}
