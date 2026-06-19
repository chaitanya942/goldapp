'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { authedFetch } from '../../../lib/authedFetch'

// IT-admin user management: invite users + the per-user ON/OFF access switch.
// Admin-gated both client-side (this guard) and server-side (requireMdmAuth).
export default function MdmAdmin() {
  const router = useRouter()
  const [state, setState] = useState('loading')   // loading | denied | ok
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('user')
  const [activateNow, setActivateNow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)   // { ok, text }
  const [tempCred, setTempCred] = useState(null)   // { login, password } shown once

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b', green = '#16a34a', red = '#dc2626'

  const refresh = useCallback(async () => {
    const r = await authedFetch('/api/mdm/users')
    if (r.ok) { const j = await r.json(); setUsers(j.users || []) }
  }, [])

  const init = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.replace('/mdm/login'); return }
    const r = await authedFetch('/api/mdm/me')
    const j = r.ok ? await r.json() : { member: null }
    if (!j.member || !j.member.active || j.member.role !== 'admin') { setState('denied'); return }
    setMe(j.member); setState('ok'); refresh()
  }, [router, refresh])

  useEffect(() => { init() }, [init])

  const invite = async () => {
    setMsg(null); setTempCred(null); setBusy(true)
    const login = username.trim()
    const r = await authedFetch('/api/mdm/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, full_name: name, role, active: activateNow }),
    })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: j.error || 'Create failed' }); return }
    // Show the temp password ONCE — it's never stored or shown again.
    setTempCred({ login, password: j.temp_password })
    setUsername(''); setEmail(''); setName(''); setRole('user'); setActivateNow(false)
    refresh()
  }

  const patch = async (id, body) => {
    const r = await authedFetch('/api/mdm/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg({ ok: false, text: j.error || 'Update failed' }); return }
    if (j.temp_password) setTempCred({ login: body._login || 'user', password: j.temp_password })   // reset-password result
    refresh()
  }
  const resetPwd = (u) => patch(u.id, { reset_password: true, _login: u.username || u.email })

  if (state === 'loading') return <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: sub, fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>Loading…</div>
  if (state === 'denied') return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 32, textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: slate, marginBottom: 8 }}>IT admin only</div>
        <div style={{ fontSize: '.8rem', color: sub }}>This page is restricted to MDM admins.</div>
        <a href="/mdm" style={{ display: 'inline-block', marginTop: 16, fontSize: '.78rem', color: blue, textDecoration: 'none' }}>← Back to portal</a>
      </div>
    </div>
  )

  const input = { width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: '.82rem', color: slate, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/mdm" style={{ textDecoration: 'none', color: sub, fontSize: '.8rem' }}>←</a>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: slate, letterSpacing: '-.02em' }}>Users</div>
        </div>
        <span style={{ fontSize: '.74rem', color: sub }}>{me?.email} · admin</span>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 22px' }}>
        {/* Invite */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, marginBottom: 18 }}>
          <div style={{ fontSize: '.92rem', fontWeight: 700, color: slate, marginBottom: 4 }}>Add a user</div>
          <div style={{ fontSize: '.72rem', color: sub, marginBottom: 14 }}>Login can be anything — email, employee ID, phone, or name. Email is optional (only used for self-service password reset).</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username — email / emp ID / phone / name" style={input} />
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" style={input} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (optional)" style={input} />
            <div />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <select value={role} onChange={e => setRole(e.target.value)} style={{ ...input, width: 'auto', padding: '9px 12px' }}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '.78rem', color: sub, cursor: 'pointer' }}>
              <input type="checkbox" checked={activateNow} onChange={e => setActivateNow(e.target.checked)} />
              Enable access immediately
            </label>
            <button onClick={invite} disabled={busy || !username.trim()} style={{ marginLeft: 'auto', padding: '9px 18px', background: blue, border: 'none', borderRadius: 9, color: '#fff', fontSize: '.8rem', fontWeight: 700, cursor: busy || !username.trim() ? 'not-allowed' : 'pointer', opacity: busy || !username.trim() ? .6 : 1 }}>
              {busy ? 'Creating…' : 'Create user'}
            </button>
          </div>
          {msg && <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 8, background: msg.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecaca'}`, color: msg.ok ? green : red, fontSize: '.76rem' }}>{msg.text}</div>}
          {tempCred && (
            <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#92400e', marginBottom: 8 }}>Login + temporary password — copy & share now (shown once)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <code style={{ fontSize: '.8rem', color: slate, background: '#fff', border: '1px solid #fde68a', borderRadius: 7, padding: '6px 10px' }}>{tempCred.login}</code>
                <code style={{ fontSize: '.85rem', fontWeight: 700, color: slate, background: '#fff', border: '1px solid #fde68a', borderRadius: 7, padding: '6px 10px', letterSpacing: '.04em' }}>{tempCred.password}</code>
                <button onClick={() => { navigator.clipboard?.writeText(tempCred.password); }} style={{ fontSize: '.74rem', fontWeight: 600, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>Copy password</button>
                <button onClick={() => setTempCred(null)} style={{ fontSize: '.74rem', color: sub, background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}>Done</button>
              </div>
              <div style={{ fontSize: '.68rem', color: '#a16207', marginTop: 8 }}>They'll be forced to set their own password on first login.</div>
            </div>
          )}
        </div>

        {/* Users list */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #f1f5f9', fontSize: '.82rem', fontWeight: 700, color: slate }}>Users · {users.length}</div>
          {users.length === 0 && <div style={{ padding: 22, color: sub, fontSize: '.8rem' }}>No users yet.</div>}
          {users.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderBottom: '1px solid #f8fafc' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.84rem', fontWeight: 600, color: slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name || u.username || u.email}</div>
                <div style={{ fontSize: '.7rem', color: sub }}>
                  {u.username || u.email}
                  {u.email && !/@mdm\.local$/.test(u.email) && u.email !== u.username ? ` · ${u.email}` : ''}
                  {u.last_login_at ? '' : ' · never signed in'}
                </div>
              </div>
              <button onClick={() => resetPwd(u)} title="Issue a new temporary password" style={{ fontSize: '.72rem', color: sub, background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }}>Reset password</button>
              <select value={u.role} onChange={e => patch(u.id, { role: e.target.value })} style={{ fontSize: '.74rem', padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 7, color: slate, background: '#fff' }}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              {/* The IT-admin master switch */}
              <button onClick={() => patch(u.id, { active: !u.active })}
                title={u.active ? 'Click to disable access' : 'Click to enable access'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 99, fontSize: '.72rem', fontWeight: 700, cursor: 'pointer', border: `1px solid ${u.active ? green + '55' : '#e2e8f0'}`, background: u.active ? '#f0fdf4' : '#f8fafc', color: u.active ? green : sub }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: u.active ? green : '#cbd5e1' }} />
                {u.active ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
