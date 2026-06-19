'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'

// Gated MDM home. Membership + the IT-admin active switch decide what renders:
//   no session   → /mdm/login
//   not a member → "no access" card
//   inactive     → lock screen (session kept; admin can enable any time)
//   active        → the portal shell (admin sees the Users link)
export default function MdmHome() {
  const router = useRouter()
  const [state, setState] = useState('loading')   // loading | nosession | nomember | inactive | ok
  const [member, setMember] = useState(null)

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b', amber = '#d97706'

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setState('nosession'); return }
    const r = await authedFetch('/api/mdm/me')
    if (!r.ok) { setState('nomember'); return }
    const j = await r.json()
    if (!j.member) { setState('nomember'); return }
    setMember(j.member)
    setState(j.member.active ? 'ok' : 'inactive')
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (state === 'nosession') router.replace('/mdm/login') }, [state, router])

  const signOut = async () => { await supabase.auth.signOut(); router.replace('/mdm/login') }

  const Shell = ({ children }) => (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: slate, letterSpacing: '-.02em' }}>MDM Portal</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {member && <span style={{ fontSize: '.74rem', color: sub }}>{member.full_name || member.email}{member.role === 'admin' ? ' · admin' : ''}</span>}
          <button onClick={signOut} style={{ fontSize: '.74rem', fontWeight: 600, color: sub, background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 12px', cursor: 'pointer' }}>Sign out</button>
        </div>
      </div>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '28px 22px' }}>{children}</div>
    </div>
  )

  if (state === 'loading' || state === 'nosession')
    return <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: sub, fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>Loading…</div>

  if (state === 'nomember')
    return (
      <Shell>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: slate, marginBottom: 8 }}>No access</div>
          <div style={{ fontSize: '.82rem', color: sub, lineHeight: 1.6 }}>This account isn't part of the MDM portal. Ask your IT admin to invite you.</div>
        </div>
      </Shell>
    )

  if (state === 'inactive')
    return (
      <Shell>
        <div style={{ background: '#fff', border: `1px solid ${amber}33`, borderRadius: 14, padding: 32, textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: `${amber}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 22 }}>🔒</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: slate, marginBottom: 8 }}>Access not enabled yet</div>
          <div style={{ fontSize: '.82rem', color: sub, lineHeight: 1.6 }}>Your account is set up, but the IT admin hasn't enabled your access. You'll be able to sign in here once they switch you on.</div>
          <button onClick={load} style={{ marginTop: 18, fontSize: '.78rem', fontWeight: 600, color: blue, background: 'transparent', border: `1px solid ${blue}55`, borderRadius: 8, padding: '7px 16px', cursor: 'pointer' }}>Check again</button>
        </div>
      </Shell>
    )

  // active
  return (
    <Shell>
      {member?.role === 'admin' && (
        <a href="/mdm/admin" style={{ display: 'block', textDecoration: 'none', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: '.95rem', fontWeight: 700, color: slate }}>Manage users →</div>
          <div style={{ fontSize: '.78rem', color: sub, marginTop: 4 }}>Invite users and switch access on/off.</div>
        </a>
      )}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 24 }}>
        <div style={{ fontSize: '.95rem', fontWeight: 700, color: slate, marginBottom: 6 }}>Forms & data</div>
        <div style={{ fontSize: '.8rem', color: sub, lineHeight: 1.6 }}>
          Coming next: the IT admin builds forms (any fields + document uploads) and you fill them in here. Phase 1 (login, invites, access control) is live.
        </div>
      </div>
    </Shell>
  )
}
