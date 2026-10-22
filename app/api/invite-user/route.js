// app/api/invite-user/route.js
// Sends a Supabase invite email and pre-creates the profile row so the
// role is ready on first login.
//
// Two access tiers:
//   - ADMIN role group → can invite any role (User Management surface).
//   - page.audit-roster permission → can ONLY invite role='audit' (Audit
//     Roster "+ Add auditor" surface). Privilege-escalation guard: a
//     non-admin caller cannot mint a super_admin or any other role no
//     matter what they pass in `role`.

import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAuthForPage, ROLE_GROUPS } from '../../../lib/apiAuth'
import { sendMail, mailConfigured } from '../../../lib/sendMail'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function findAuthUserByEmail(email) {
  const target = email.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data?.users?.length) return null
    const hit = data.users.find(u => (u.email || '').toLowerCase() === target)
    if (hit) return hit
    if (data.users.length < 1000) return null
  }
  return null
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function inviteHtml(name, link) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#222">
  <h2 style="color:#9a7228;margin:0 0 16px">WhiteGold</h2>
  <p>Hi${name ? ' ' + esc(name) : ''},</p>
  <p>You've been invited to the WhiteGold app. Click below to set your password and sign in.</p>
  <p style="margin:24px 0"><a href="${esc(link)}" style="background:#c9a84c;color:#111;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Accept invite</a></p>
  <p style="font-size:12px;color:#777">If the button doesn't work, copy this link into your browser:<br>${esc(link)}</p>
  <p style="font-size:12px;color:#777">This link can be used once.</p>
</div>`
}

export async function POST(request) {
  // Try ADMIN first (preserves existing User Management behaviour); fall
  // back to page.audit-roster, but clamp those callers to inviting
  // role='audit' only.
  let auth = await requireAuth(request, { requiredRoles: ROLE_GROUPS.ADMIN })
  let restrictedToAudit = false
  if (!auth.ok) {
    auth = await requireAuthForPage(request, 'audit-roster')
    if (!auth.ok) return auth.response
    restrictedToAudit = !ROLE_GROUPS.ADMIN.includes(auth.role)
  }

  try {
    const { email, full_name, role } = await request.json()

    const cleanEmail = String(email || '').trim()
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      return Response.json({ error: 'Valid email is required.' }, { status: 400 })
    }
    let cleanRole = String(role || 'viewer').trim()
    if (restrictedToAudit) {
      // Non-admin callers (e.g. master_auditor) can only mint auditors.
      // Don't silently accept whatever they sent — that would let the UI
      // accidentally pass through and grant the wrong role.
      if (cleanRole !== 'audit') {
        return Response.json({ error: "Your role can only invite users as 'audit'." }, { status: 403 })
      }
    }

    // Validate role exists in the roles table — otherwise the user gets an
    // invite for a role that grants nothing, and silently lands in a broken
    // state on first login.
    const { data: roleRow } = await supabaseAdmin
      .from('roles').select('name').eq('name', cleanRole).maybeSingle()
    if (!roleRow && cleanRole !== 'viewer') {
      // Allow 'viewer' even if the row is missing, since it's the safe default.
      return Response.json({ error: `Role '${cleanRole}' does not exist.` }, { status: 400 })
    }

    // 1. Create the invite link with Supabase, then email it ourselves via
    //    Gmail SMTP (lib/sendMail — the same sender as scheduled reports).
    //    Supabase's own invite mail (inviteUserByEmail) fails with "Error
    //    sending invite email" — its SMTP setup is broken — so it's not used.
    //    The link is identical to the one Supabase would have emailed.
    if (!mailConfigured()) {
      return Response.json({ error: 'Email is not configured on the server (GMAIL_USER / GMAIL_APP_PASSWORD).' }, { status: 500 })
    }
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`
    let { data: authData, error: authErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite', email: cleanEmail,
      options: { redirectTo, data: { full_name: full_name?.trim() || '', role: cleanRole } },
    })

    // Already registered: if they never signed in (e.g. an earlier invite email
    // never arrived), re-send a set-password link instead of failing.
    if (authErr && /already/i.test(authErr.message || '')) {
      const existing = await findAuthUserByEmail(cleanEmail)
      if (existing && !existing.last_sign_in_at) {
        ;({ data: authData, error: authErr } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery', email: cleanEmail, options: { redirectTo },
        }))
      } else if (existing) {
        return Response.json({ error: `${cleanEmail} already has an account and has signed in before.` }, { status: 400 })
      }
    }
    if (authErr) {
      return Response.json({ error: authErr.message }, { status: 400 })
    }

    const link = authData?.properties?.action_link
    if (!link) return Response.json({ error: 'Could not create the invite link.' }, { status: 500 })
    try {
      await sendMail({
        to: cleanEmail,
        fromName: 'WhiteGold',
        subject: 'You have been invited to WhiteGold',
        html: inviteHtml(full_name?.trim(), link),
        text: `You've been invited to the WhiteGold app. Set your password and sign in here:\n${link}\n\nThis link can be used once.`,
      })
    } catch (mailErr) {
      return Response.json({ error: `The account was created but the invite email failed: ${mailErr.message}. Click Invite again to resend.` }, { status: 502 })
    }

    // 2. Insert profile row immediately so role is ready on first login.
    const userId = authData?.user?.id
    if (userId) {
      const { error: profileErr } = await supabaseAdmin.from('user_profiles').upsert({
        id:        userId,
        email:     cleanEmail,
        full_name: full_name?.trim() || cleanEmail,
        role:      cleanRole,
        is_active: true,
      }, { onConflict: 'id' })

      // If the profile upsert fails after the invite was sent, surface the
      // problem so the inviting admin can clean up — otherwise the user gets
      // an email and a confused first-login experience.
      if (profileErr) {
        return Response.json({
          error: `Invite was sent to ${cleanEmail} but profile creation failed: ${profileErr.message}. Add the profile manually via Admin > Users.`,
        }, { status: 500 })
      }
    }

    return Response.json({ success: true, userId })

  } catch (err) {
    return Response.json({ error: err.message || 'Server error.' }, { status: 500 })
  }
}