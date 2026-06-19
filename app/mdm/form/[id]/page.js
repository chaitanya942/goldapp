'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { authedFetch } from '../../../../lib/authedFetch'

// Fill a dynamic form (rendered from its fields), upload documents, and see all
// records. Any active MDM user can add; you can delete your own, admins any.
export default function MdmFill() {
  const router = useRouter()
  const { id } = useParams()
  const [state, setState] = useState('loading')   // loading | denied | ok
  const [form, setForm] = useState(null)
  const [fields, setFields] = useState([])
  const [records, setRecords] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [values, setValues] = useState({})
  const [uploading, setUploading] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b', red = '#dc2626', line = '#e2e8f0', green = '#16a34a'

  const loadRecords = useCallback(async () => {
    const r = await authedFetch(`/api/mdm/records?form_id=${id}`)
    if (r.ok) { const j = await r.json(); setRecords(j.records || []); setIsAdmin(j.is_admin) }
  }, [id])

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/mdm/login'); return }
      const me = await authedFetch('/api/mdm/me'); const mj = me.ok ? await me.json() : {}
      if (!mj.member || !mj.member.active) { setState('denied'); return }
      if (mj.member.must_reset) { router.replace('/mdm/reset'); return }
      const r = await authedFetch(`/api/mdm/forms?id=${id}`)
      if (!r.ok) { setState('denied'); return }
      const j = await r.json()
      setForm(j.form); setFields(j.fields || []); setState('ok'); loadRecords()
    })()
  }, [id, router, loadRecords])

  const setVal = (k, v) => setValues(s => ({ ...s, [k]: v }))

  const onFile = async (field, file) => {
    if (!file) return
    setUploading(u => ({ ...u, [field.field_key]: true })); setMsg('')
    const fd = new FormData(); fd.append('file', file); fd.append('form_id', id)
    const r = await authedFetch('/api/mdm/upload', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({}))
    setUploading(u => ({ ...u, [field.field_key]: false }))
    if (!r.ok) { setMsg(j.error || 'Upload failed'); return }
    setVal(field.field_key, { path: j.path, name: j.name, size: j.size, type: j.type })
  }

  const submit = async () => {
    setMsg(''); setBusy(true)
    const r = await authedFetch('/api/mdm/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form_id: id, data: values }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg(j.error || 'Save failed'); return }
    setValues({}); loadRecords()
  }

  const del = async (rid) => { if (!confirm('Delete this record?')) return; await authedFetch(`/api/mdm/records?id=${rid}`, { method: 'DELETE' }); loadRecords() }

  const download = async (path) => {
    const r = await authedFetch('/api/mdm/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
    const j = await r.json().catch(() => ({}))
    if (j.url) window.open(j.url, '_blank')
  }

  if (state === 'loading') return <Center>Loading…</Center>
  if (state === 'denied') return <Center><div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, color: slate }}>Not available</div><a href="/mdm" style={{ color: blue, fontSize: '.8rem' }}>← Back to portal</a></div></Center>

  const input = { width: '100%', padding: '9px 11px', border: `1px solid #cbd5e1`, borderRadius: 8, fontSize: '.82rem', color: slate, outline: 'none', boxSizing: 'border-box' }
  const renderInput = (f) => {
    const v = values[f.field_key]
    if (f.type === 'textarea') return <textarea value={v || ''} onChange={e => setVal(f.field_key, e.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} />
    if (f.type === 'number') return <input type="number" value={v ?? ''} onChange={e => setVal(f.field_key, e.target.value)} style={input} />
    if (f.type === 'date') return <input type="date" value={v || ''} onChange={e => setVal(f.field_key, e.target.value)} style={input} />
    if (f.type === 'checkbox') return <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.82rem', color: slate }}><input type="checkbox" checked={!!v} onChange={e => setVal(f.field_key, e.target.checked)} /> Yes</label>
    if (f.type === 'select') return <select value={v || ''} onChange={e => setVal(f.field_key, e.target.value)} style={input}><option value="">— select —</option>{(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}</select>
    if (f.type === 'file') return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="file" onChange={e => onFile(f, e.target.files?.[0])} style={{ fontSize: '.78rem', color: sub }} />
        {uploading[f.field_key] && <span style={{ fontSize: '.74rem', color: sub }}>uploading…</span>}
        {v?.path && <span style={{ fontSize: '.74rem', color: green }}>✓ {v.name}</span>}
      </div>
    )
    return <input value={v || ''} onChange={e => setVal(f.field_key, e.target.value)} style={input} />
  }
  const cellVal = (r, f) => {
    const v = r.data?.[f.field_key]
    if (v == null || v === '') return '—'
    if (f.type === 'checkbox') return v ? 'Yes' : 'No'
    if (f.type === 'file') return v.path ? <button onClick={() => download(v.path)} style={{ fontSize: '.74rem', color: blue, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>{v.name || 'download'}</button> : '—'
    return String(v)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: `1px solid ${line}`, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href="/mdm" style={{ textDecoration: 'none', color: sub, fontSize: '.8rem' }}>←</a>
        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: slate }}>{form?.name}</div>
      </div>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '22px' }}>
        {/* Add record */}
        <div style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 12, padding: 20, marginBottom: 18 }}>
          <div style={{ fontSize: '.9rem', fontWeight: 700, color: slate, marginBottom: 14 }}>Add entry</div>
          {fields.length === 0 && <div style={{ fontSize: '.82rem', color: sub }}>This form has no fields yet. Ask the admin to add some.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {fields.map(f => (
              <div key={f.id}>
                <label style={{ display: 'block', fontSize: '.68rem', color: sub, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 6 }}>{f.label}{f.required && <span style={{ color: red }}> *</span>}</label>
                {renderInput(f)}
              </div>
            ))}
          </div>
          {fields.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
              <button onClick={submit} disabled={busy} style={{ padding: '9px 20px', background: blue, color: '#fff', border: 'none', borderRadius: 8, fontSize: '.82rem', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .6 : 1 }}>{busy ? 'Saving…' : 'Save entry'}</button>
              {msg && <span style={{ fontSize: '.76rem', color: red }}>{msg}</span>}
            </div>
          )}
        </div>

        {/* Records */}
        <div style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid #f1f5f9`, fontSize: '.84rem', fontWeight: 700, color: slate }}>Entries · {records.length}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: sub, textAlign: 'left' }}>
                  {fields.map(f => <th key={f.id} style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{f.label}</th>)}
                  <th style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>By</th>
                  <th style={{ padding: '9px 12px' }}></th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    {fields.map(f => <td key={f.id} style={{ padding: '9px 12px', color: slate, whiteSpace: 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cellVal(r, f)}</td>)}
                    <td style={{ padding: '9px 12px', color: sub, whiteSpace: 'nowrap' }}>{r._by}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      {(r._mine || isAdmin) && <button onClick={() => del(r.id)} style={{ fontSize: '.74rem', color: red, background: 'transparent', border: 'none', cursor: 'pointer' }}>Delete</button>}
                    </td>
                  </tr>
                ))}
                {records.length === 0 && <tr><td colSpan={fields.length + 2} style={{ padding: 18, color: sub }}>No entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>{children}</div>
}
