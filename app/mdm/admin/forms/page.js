'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { authedFetch } from '../../../../lib/authedFetch'

const FIELD_TYPES = [
  { v: 'text', l: 'Text' }, { v: 'textarea', l: 'Long text' }, { v: 'number', l: 'Number' },
  { v: 'date', l: 'Date' }, { v: 'select', l: 'Dropdown' }, { v: 'checkbox', l: 'Checkbox' }, { v: 'file', l: 'Document' },
]

export default function MdmForms() {
  const router = useRouter()
  const [state, setState] = useState('loading')   // loading | denied | ok
  const [forms, setForms] = useState([])
  const [sel, setSel] = useState(null)            // selected form id
  const [fields, setFields] = useState([])
  const [newForm, setNewForm] = useState('')
  const [nf, setNf] = useState({ label: '', type: 'text', options: '', required: false })
  const [msg, setMsg] = useState('')

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b', red = '#dc2626', line = '#e2e8f0'

  const loadForms = useCallback(async () => {
    const r = await authedFetch('/api/mdm/forms')
    if (r.ok) { const j = await r.json(); setForms(j.forms || []) }
  }, [])

  const loadFields = useCallback(async (id) => {
    if (!id) { setFields([]); return }
    const r = await authedFetch(`/api/mdm/forms?id=${id}`)
    if (r.ok) { const j = await r.json(); setFields(j.fields || []) }
  }, [])

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/mdm/login'); return }
      const r = await authedFetch('/api/mdm/me'); const j = r.ok ? await r.json() : {}
      if (!j.member || !j.member.active || j.member.role !== 'admin') { setState('denied'); return }
      setState('ok'); loadForms()
    })()
  }, [router, loadForms])

  useEffect(() => { loadFields(sel) }, [sel, loadFields])

  const createForm = async () => {
    if (!newForm.trim()) return
    const r = await authedFetch('/api/mdm/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newForm }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(j.error || 'Failed'); return }
    setNewForm(''); await loadForms(); setSel(j.form.id)
  }
  const patchForm = async (id, body) => { await authedFetch('/api/mdm/forms', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }); loadForms() }
  const delForm = async (id) => { if (!confirm('Delete this form and all its data?')) return; await authedFetch(`/api/mdm/forms?id=${id}`, { method: 'DELETE' }); setSel(null); loadForms() }

  const addField = async () => {
    setMsg('')
    if (!nf.label.trim()) return
    const body = { form_id: sel, label: nf.label, type: nf.type, required: nf.required, options: nf.type === 'select' ? nf.options.split(',').map(s => s.trim()).filter(Boolean) : [] }
    const r = await authedFetch('/api/mdm/fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(j.error || 'Failed'); return }
    setNf({ label: '', type: 'text', options: '', required: false }); loadFields(sel); loadForms()
  }
  const patchField = async (id, body) => { await authedFetch('/api/mdm/fields', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }); loadFields(sel) }
  const delField = async (id) => { await authedFetch(`/api/mdm/fields?id=${id}`, { method: 'DELETE' }); loadFields(sel); loadForms() }
  const move = async (i, dir) => {
    const j = i + dir; if (j < 0 || j >= fields.length) return
    const a = fields[i], b = fields[j]
    await patchField(a.id, { sort_order: b.sort_order }); await patchField(b.id, { sort_order: a.sort_order })
  }

  if (state === 'loading') return <Center>Loading…</Center>
  if (state === 'denied') return <Center><div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, color: slate }}>IT admin only</div><a href="/mdm" style={{ color: blue, fontSize: '.8rem' }}>← Back</a></div></Center>

  const selForm = forms.find(f => f.id === sel)
  const input = { padding: '8px 11px', border: `1px solid #cbd5e1`, borderRadius: 8, fontSize: '.82rem', color: slate, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: `1px solid ${line}`, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href="/mdm/admin" style={{ textDecoration: 'none', color: sub, fontSize: '.8rem' }}>←</a>
        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: slate }}>Form builder</div>
      </div>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '22px', display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18 }}>
        {/* Forms list */}
        <div>
          <div style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '11px 14px', borderBottom: `1px solid #f1f5f9`, fontSize: '.78rem', fontWeight: 700, color: slate }}>Forms</div>
            {forms.map(f => (
              <div key={f.id} onClick={() => setSel(f.id)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f8fafc', background: sel === f.id ? '#eff6ff' : 'transparent' }}>
                <div style={{ fontSize: '.82rem', fontWeight: 600, color: slate }}>{f.name}{!f.is_active && <span style={{ color: sub, fontWeight: 500 }}> · hidden</span>}</div>
                <div style={{ fontSize: '.68rem', color: sub }}>{f._counts?.fields || 0} fields · {f._counts?.records || 0} records</div>
              </div>
            ))}
            {forms.length === 0 && <div style={{ padding: 14, fontSize: '.78rem', color: sub }}>No forms yet.</div>}
            <div style={{ padding: 12, display: 'flex', gap: 8 }}>
              <input value={newForm} onChange={e => setNewForm(e.target.value)} onKeyDown={e => e.key === 'Enter' && createForm()} placeholder="New form name" style={{ ...input, flex: 1 }} />
              <button onClick={createForm} style={{ padding: '8px 12px', background: blue, color: '#fff', border: 'none', borderRadius: 8, fontSize: '.78rem', fontWeight: 700, cursor: 'pointer' }}>+</button>
            </div>
          </div>
        </div>

        {/* Field editor */}
        <div>
          {!selForm ? (
            <div style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 12, padding: 28, color: sub, fontSize: '.84rem' }}>Select a form, or create one, to add fields.</div>
          ) : (
            <div style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 12, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <input defaultValue={selForm.name} onBlur={e => e.target.value.trim() && e.target.value !== selForm.name && patchForm(selForm.id, { name: e.target.value })} style={{ ...input, fontSize: '1rem', fontWeight: 700, flex: 1, border: '1px solid transparent', background: '#f8fafc' }} />
                <label style={{ fontSize: '.74rem', color: sub, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selForm.is_active} onChange={e => patchForm(selForm.id, { is_active: e.target.checked })} /> Visible to users
                </label>
                <button onClick={() => delForm(selForm.id)} style={{ fontSize: '.74rem', color: red, background: 'transparent', border: `1px solid ${red}33`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }}>Delete</button>
              </div>

              {/* Existing fields */}
              {fields.map((f, i) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f8fafc' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button onClick={() => move(i, -1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: sub, fontSize: 10, lineHeight: 1 }}>▲</button>
                    <button onClick={() => move(i, 1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: sub, fontSize: 10, lineHeight: 1 }}>▼</button>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '.84rem', fontWeight: 600, color: slate }}>{f.label}{f.required && <span style={{ color: red }}> *</span>}</div>
                    <div style={{ fontSize: '.68rem', color: sub }}>{FIELD_TYPES.find(t => t.v === f.type)?.l || f.type}{f.type === 'select' && f.options?.length ? ` · ${f.options.join(', ')}` : ''}</div>
                  </div>
                  <label style={{ fontSize: '.7rem', color: sub, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={f.required} onChange={e => patchField(f.id, { required: e.target.checked })} /> req
                  </label>
                  <button onClick={() => delField(f.id)} style={{ fontSize: '.72rem', color: red, background: 'transparent', border: 'none', cursor: 'pointer' }}>✕</button>
                </div>
              ))}
              {fields.length === 0 && <div style={{ fontSize: '.8rem', color: sub, padding: '8px 0' }}>No fields yet — add the first one below.</div>}

              {/* Add field */}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${line}` }}>
                <div style={{ fontSize: '.76rem', fontWeight: 700, color: slate, marginBottom: 10 }}>Add field</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={nf.label} onChange={e => setNf({ ...nf, label: e.target.value })} placeholder="Field label" style={{ ...input, flex: 1, minWidth: 140 }} />
                  <select value={nf.type} onChange={e => setNf({ ...nf, type: e.target.value })} style={{ ...input }}>
                    {FIELD_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                  <label style={{ fontSize: '.74rem', color: sub, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={nf.required} onChange={e => setNf({ ...nf, required: e.target.checked })} /> Required
                  </label>
                  <button onClick={addField} style={{ padding: '8px 14px', background: blue, color: '#fff', border: 'none', borderRadius: 8, fontSize: '.78rem', fontWeight: 700, cursor: 'pointer' }}>Add</button>
                </div>
                {nf.type === 'select' && (
                  <input value={nf.options} onChange={e => setNf({ ...nf, options: e.target.value })} placeholder="Dropdown options, comma-separated (e.g. Issued, Returned, Lost)" style={{ ...input, width: '100%', marginTop: 8, boxSizing: 'border-box' }} />
                )}
                {msg && <div style={{ marginTop: 8, fontSize: '.74rem', color: red }}>{msg}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>{children}</div>
}
