'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0e0e0e', card: '#141414', card2: '#1a1a1a', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#2a2a2a', border2: '#333333', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf' },
  light: { bg: '#f5f0e8', card: '#ede8dc', card2: '#e4dfd3', text1: '#2a1f0a', text2: '#5a4a2a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d5cfc0', border2: '#c8c0b0', green: '#2a8a5a', red: '#cc3333', blue: '#2a6fa0' },
}

const ROLES = [
  { value: 'super_admin',     label: 'Super Admin',      color: '#c9a84c' },
  { value: 'founders_office', label: "Founder's Office", color: '#8c5ac8' },
  { value: 'admin',           label: 'Admin',            color: '#3a8fbf' },
  { value: 'manager',         label: 'Manager',          color: '#3aaa6a' },
  { value: 'branch_staff',    label: 'Branch Staff',     color: '#c9981f' },
  { value: 'viewer',          label: 'View Only',        color: '#7a6a4a' },
]

function getRoleStyle(role) {
  return ROLES.find(r => r.value === role) ?? { label: role, color: '#7a6a4a' }
}

export default function UserManagement() {
  const { theme, canDo } = useApp()
  const t = THEMES[theme]

  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(false)
  const [savingId,   setSavingId]   = useState(null)

  // Invite form
  const [showInvite, setShowInvite] = useState(false)
  const [invEmail,   setInvEmail]   = useState('')
  const [invName,    setInvName]    = useState('')
  const [invRole,    setInvRole]    = useState('viewer')
  const [inviting,   setInviting]   = useState(false)
  const [invMsg,     setInvMsg]     = useState(null)  // { type: 'success'|'error', text }

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('user_profiles').select('*').order('full_name')
    if (data) setUsers(data)
    setLoading(false)
  }

  // ── INVITE ──────────────────────────────────────────────
  const inviteUser = async () => {
    if (!invEmail.trim()) return
    setInviting(true)
    setInvMsg(null)

    try {
      // Call server-side API route (uses service role key securely)
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:     invEmail.trim(),
          full_name: invName.trim(),
          role:      invRole,
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send invite.')

      setInvMsg({ type: 'success', text: `Invite sent to ${invEmail.trim()}. They will receive an email to set their password.` })
      setInvEmail('')
      setInvName('')
      setInvRole('viewer')
      await load()

    } catch (err) {
      setInvMsg({ type: 'error', text: err.message || 'Failed to send invite.' })
    }

    setInviting(false)
  }

  // ── UPDATE ROLE ──────────────────────────────────────────
  const updateRole = async (id, role) => {
    setSavingId(id)
    await supabase.from('user_profiles').update({ role }).eq('id', id)
    await load()
    setSavingId(null)
  }

  // ── TOGGLE ACTIVE ────────────────────────────────────────
  const toggleActive = async (id, current) => {
    setSavingId(id)
    await supabase.from('user_profiles').update({ is_active: !current }).eq('id', id)
    await load()
    setSavingId(null)
  }

  // ── SHARED INPUT STYLE ───────────────────────────────────
  const inp = {
    background: t.card2,
    border: `1px solid ${t.border2}`,
    borderRadius: '7px',
    padding: '9px 12px',
    color: t.text1,
    fontSize: '.75rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1060px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>User Management</div>
          <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>Invite team members and manage their access roles</div>
        </div>
        {canDo('edit') && (
          <button
            onClick={() => { setShowInvite(!showInvite); setInvMsg(null) }}
            style={{
              background: showInvite ? 'transparent' : t.gold,
              border: `1px solid ${t.gold}`,
              borderRadius: '8px',
              padding: '9px 20px',
              color: showInvite ? t.gold : '#0a0a0a',
              fontSize: '.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all .2s',
            }}>
            {showInvite ? '✕  Cancel' : '+ Invite User'}
          </button>
        )}
      </div>

      {/* ── Invite Form ── */}
      {showInvite && (
        <div style={{
          background: t.card,
          border: `1px solid ${t.gold}33`,
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Gold top accent */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg,${t.gold},${t.gold}00)` }}/>

          <div style={{ fontSize: '.6rem', color: t.gold, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '18px', fontWeight: 600 }}>
            Invite New User
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '18px' }}>
            {/* Full Name */}
            <div>
              <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Full Name</div>
              <input
                style={inp}
                placeholder="e.g. Rahul Sharma"
                value={invName}
                onChange={e => setInvName(e.target.value)}
              />
            </div>

            {/* Email */}
            <div>
              <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Email Address</div>
              <input
                style={inp}
                placeholder="rahul@whitegold.money"
                type="email"
                value={invEmail}
                onChange={e => setInvEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && inviteUser()}
              />
            </div>

            {/* Role */}
            <div>
              <div style={{ fontSize: '.58rem', color: t.text3, marginBottom: '5px', letterSpacing: '.08em', textTransform: 'uppercase' }}>Role</div>
              <select
                style={{ ...inp, cursor: 'pointer' }}
                value={invRole}
                onChange={e => setInvRole(e.target.value)}>
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Send button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={inviteUser}
              disabled={inviting || !invEmail.trim()}
              style={{
                background: inviting || !invEmail.trim() ? t.border2 : t.gold,
                border: 'none',
                borderRadius: '7px',
                padding: '9px 28px',
                color: '#0a0a0a',
                fontSize: '.75rem',
                fontWeight: 700,
                cursor: inviting || !invEmail.trim() ? 'not-allowed' : 'pointer',
                opacity: inviting || !invEmail.trim() ? .6 : 1,
                transition: 'all .2s',
              }}>
              {inviting ? 'Sending…' : 'Send Invite →'}
            </button>
            <div style={{ fontSize: '.65rem', color: t.text4, lineHeight: 1.5 }}>
              User will receive an email with a link to set their password
            </div>
          </div>

          {/* Status message */}
          {invMsg && (
            <div style={{
              marginTop: '14px',
              padding: '10px 14px',
              borderRadius: '7px',
              background: invMsg.type === 'success' ? `${t.green}18` : `${t.red}18`,
              border: `1px solid ${invMsg.type === 'success' ? t.green : t.red}40`,
              fontSize: '.72rem',
              color: invMsg.type === 'success' ? t.green : t.red,
              lineHeight: 1.6,
            }}>
              {invMsg.type === 'success' ? '✓  ' : '✕  '}{invMsg.text}
            </div>
          )}
        </div>
      )}

      {/* ── Users Table ── */}
      {loading ? (
        <div style={{ textAlign: 'center', color: t.text3, padding: '48px', fontSize: '.8rem' }}>Loading users…</div>
      ) : (
        <div style={{ borderRadius: '12px', border: `1px solid ${t.border}`, overflow: 'hidden' }}>

          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.8fr 1fr 0.7fr 0.9fr', background: t.card }}>
            {['Name', 'Email', 'Role', 'Status', 'Action'].map(h => (
              <div key={h} style={{ padding: '10px 16px', fontSize: '.58rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: `1px solid ${t.border}` }}>
                {h}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {users.length === 0 && (
            <div style={{ textAlign: 'center', color: t.text4, padding: '48px', fontSize: '.8rem' }}>No users found.</div>
          )}
          {users.map((u, i) => {
            const rs     = getRoleStyle(u.role)
            const busy   = savingId === u.id
            const active = u.is_active !== false
            const last   = i === users.length - 1
            return (
              <div
                key={u.id}
                style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.8fr 1fr 0.7fr 0.9fr', alignItems: 'center', borderBottom: last ? 'none' : `1px solid ${t.border}20`, transition: 'background .15s' }}
                onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

                {/* Name */}
                <div style={{ padding: '13px 16px', fontSize: '.75rem', color: t.text1, fontWeight: 500 }}>
                  {u.full_name || '—'}
                </div>

                {/* Email */}
                <div style={{ padding: '13px 16px', fontSize: '.72rem', color: t.text3 }}>
                  {u.email}
                </div>

                {/* Role */}
                <div style={{ padding: '13px 16px' }}>
                  {canDo('edit') ? (
                    <select
                      value={u.role || 'viewer'}
                      disabled={busy}
                      onChange={e => updateRole(u.id, e.target.value)}
                      style={{
                        background: `${rs.color}15`,
                        border: `1px solid ${rs.color}50`,
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: rs.color,
                        fontSize: '.68rem',
                        cursor: 'pointer',
                        outline: 'none',
                      }}>
                      {ROLES.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ fontSize: '.68rem', padding: '3px 10px', borderRadius: '100px', background: `${rs.color}15`, color: rs.color }}>
                      {rs.label}
                    </span>
                  )}
                </div>

                {/* Status */}
                <div style={{ padding: '13px 16px' }}>
                  <span style={{ fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase', color: active ? t.green : t.text4 }}>
                    {active ? '● Active' : '○ Inactive'}
                  </span>
                </div>

                {/* Action */}
                <div style={{ padding: '13px 16px' }}>
                  {canDo('edit') && (
                    <button
                      disabled={busy}
                      onClick={() => toggleActive(u.id, active)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${active ? t.red + '50' : t.gold + '50'}`,
                        color: active ? t.red : t.gold,
                        borderRadius: '6px',
                        padding: '4px 12px',
                        fontSize: '.62rem',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        letterSpacing: '.06em',
                        transition: 'all .15s',
                        opacity: busy ? .5 : 1,
                      }}>
                      {busy ? '…' : active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </div>

              </div>
            )
          })}
        </div>
      )}

      {/* ── Role Legend ── */}
      <div style={{ marginTop: '20px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '.58rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Roles:</span>
        {ROLES.map(r => (
          <div key={r.value} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: r.color }}/>
            <span style={{ fontSize: '.62rem', color: t.text3 }}>{r.label}</span>
          </div>
        ))}
      </div>

    </div>
  )
}