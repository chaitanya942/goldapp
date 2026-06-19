'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { authedFetch } from '../../../../lib/authedFetch'

const FIELD_TYPES = [
  { v: 'text',     l: 'Short text', d: 'A single line — e.g. serial no, name' },
  { v: 'textarea', l: 'Long text',  d: 'A paragraph — e.g. notes, remarks' },
  { v: 'number',   l: 'Number',     d: 'Numbers only — e.g. quantity, price' },
  { v: 'date',     l: 'Date',       d: 'A date picker — e.g. issue date' },
  { v: 'select',   l: 'Dropdown',   d: 'Pick one from choices you set' },
  { v: 'checkbox', l: 'Yes / No',   d: 'A single tick box' },
  { v: 'file',     l: 'Document',   d: 'Upload a file/photo — invoice, form' },
]
const typeLabel = (v) => FIELD_TYPES.find(t => t.v === v)?.l || v

export default function MdmForms() {
  const router = useRouter()
  const [state, setState] = useState('loading')
  const [forms, setForms] = useState([])
  const [sel, setSel] = useState(null)
  const [fields, setFields] = useState([])
  const [newForm, setNewForm] = useState('')
  const [nf, setNf] = useState({ label: '', type: 'text', options: '', required: false })
  const [msg, setMsg] = useState('')

  const blue = '#2563eb', slate = '#0f172a', sub = '#64748b', red = '#dc2626', line = '#e2e8f0', soft = '#f8fafc'

  const loadForms = useCallback(async () => {
    const r = await authedFetch('/api/mdm/forms'); if (r.ok) { const j = await r.json(); setForms(j.forms || []) }
  }, [])
  const loadFields = useCallback(async (id) => {
    if (!id) { setFields([]); return }
    const r = await authedFetch(`/api/mdm/forms?id=${id}`); if (r.ok) { const j = await r.json(); setFields(j.fields || []) }
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
    const j = await r.json().catch(() => ({})); if (!r.ok) { setMsg(j.error || 'Failed'); return }
    setNewForm(''); await loadForms(); setSel(j.form.id)
  }
  const patchForm = async (id, body) => { await authedFetch('/api/mdm/forms', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }); loadForms() }
  const delForm = async (id) => { if (!confirm('Delete this form and all its data?')) return; await authedFetch(`/api/mdm/forms?id=${id}`, { method: 'DELETE' }); setSel(null); loadForms() }
  const addField = async () => {
    setMsg(''); if (!nf.label.trim()) { setMsg('Give the field a label first.'); return }
    if (nf.type === 'select' && !nf.options.split(',').map(s => s.trim()).filter(Boolean).length) { setMsg('Add at least one dropdown choice.'); return }
    const body = { form_id: sel, label: nf.label, type: nf.type, required: nf.required, options: nf.type === 'select' ? nf.options.split(',').map(s => s.trim()).filter(Boolean) : [] }
    const r = await authedFetch('/api/mdm/fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({})); if (!r.ok) { setMsg(j.error || 'Failed'); return }
    setNf({ label: '', type: 'text', options: '', required: false }); loadFields(sel); loadForms()
  }
  const patchField = async (id, body) => { await authedFetch('/api/mdm/fields', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }); loadFields(sel) }
  const delField = async (id) => { await authedFetch(`/api/mdm/fields?id=${id}`, { method: 'DELETE' }); loadFields(sel); loadForms() }
  const move = async (i, dir) => { const j = i + dir; if (j < 0 || j >= fields.length) return; const a = fields[i], b = fields[j]; await patchField(a.id, { sort_order: b.sort_order }); await patchField(b.id, { sort_order: a.sort_order }) }

  if (state === 'loading') return <Center>Loading…</Center>
  if (state === 'denied') return <Center><div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, color: slate }}>IT admin only</div><a href="/mdm" style={{ color: blue, fontSize: '.8rem' }}>← Back</a></div></Center>

  const selForm = forms.find(f => f.id === sel)
  const input = { padding: '9px 12px', border: `1px solid #cbd5e1`, borderRadius: 8, fontSize: '.84rem', color: slate, outline: 'none', boxSizing: 'border-box', background: '#fff' }
  const card = { background: '#fff', border: `1px solid ${line}`, borderRadius: 12 }
  const lbl = { display: 'block', fontSize: '.64rem', color: sub, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, marginBottom: 7 }

  // Read-only preview of one field, as the team will see it.
  const previewField = (f) => {
    const dis = { ...input, width: '100%', background: soft, color: '#94a3b8', cursor: 'default' }
    if (f.type === 'textarea') return <div style={{ ...dis, height: 52 }} />
    if (f.type === 'checkbox') return <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.82rem', color: '#94a3b8' }}><input type="checkbox" disabled /> Yes</div>
    if (f.type === 'select') return <div style={{ ...dis }}>{(f.options || [])[0] || '— select —'} ▾</div>
    if (f.type === 'file') return <div style={{ ...dis }}>📎 Choose file…</div>
    if (f.type === 'date') return <div style={{ ...dis }}>dd / mm / yyyy</div>
    return <div style={{ ...dis }} />
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: `1px solid ${line}`, padding: '14px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/mdm/admin" style={{ textDecoration: 'none', color: sub, fontSize: '.8rem' }}>←</a>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: slate }}>Form builder</div>
        </div>
        <div style={{ fontSize: '.76rem', color: sub, marginTop: 4, marginLeft: 24 }}>Create a form → add the fields your team should fill → it appears in their portal. Fields can be text, dropdowns, dates, yes/no, or document uploads.</div>
      </div>

      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '22px', display: 'grid', gridTemplateColumns: '270px 1fr', gap: 18, alignItems: 'start' }}>
        {/* Forms list */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${soft}`, fontSize: '.78rem', fontWeight: 800, color: slate }}>Your forms</div>
          {forms.map(f => (
            <div key={f.id} onClick={() => setSel(f.id)} style={{ padding: '11px 14px', cursor: 'pointer', borderBottom: `1px solid ${soft}`, background: sel === f.id ? '#eff6ff' : 'transparent', borderLeft: `3px solid ${sel === f.id ? blue : 'transparent'}` }}>
              <div style={{ fontSize: '.84rem', fontWeight: 600, color: slate }}>{f.name}{!f.is_active && <span style={{ color: sub, fontWeight: 500, fontSize: '.72rem' }}> · hidden</span>}</div>
              <div style={{ fontSize: '.68rem', color: sub, marginTop: 2 }}>{f._counts?.fields || 0} fields · {f._counts?.records || 0} entries</div>
            </div>
          ))}
          {forms.length === 0 && <div style={{ padding: 14, fontSize: '.76rem', color: sub }}>No forms yet — create your first below.</div>}
          <div style={{ padding: 12 }}>
            <label style={lbl}>Create a new form</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newForm} onChange={e => setNewForm(e.target.value)} onKeyDown={e => e.key === 'Enter' && createForm()} placeholder="e.g. Devices, SIM Cards" style={{ ...input, flex: 1 }} />
              <button onClick={createForm} style={{ padding: '9px 14px', background: blue, color: '#fff', border: 'none', borderRadius: 8, fontSize: '.82rem', fontWeight: 800, cursor: 'pointer' }}>Create</button>
            </div>
          </div>
        </div>

        {/* Editor */}
        {!selForm ? (
          <div style={{ ...card, padding: 30, color: sub }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: slate, marginBottom: 8 }}>Pick a form on the left, or create one</div>
            <div style={{ fontSize: '.84rem', lineHeight: 1.7 }}>
              A <b style={{ color: slate }}>form</b> is a set of questions your team answers. For example a “Devices” form could have:
              a <b style={{ color: slate }}>serial number</b> (short text), a <b style={{ color: slate }}>model</b> (short text),
              a <b style={{ color: slate }}>status</b> (dropdown: Issued / Returned / Lost), an <b style={{ color: slate }}>issue date</b>,
              and a <b style={{ color: slate }}>handover document</b> (document upload).
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {/* Settings */}
            <div style={{ ...card, padding: 18 }}>
              <label style={lbl}>Form name</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input defaultValue={selForm.name} key={selForm.id} onBlur={e => e.target.value.trim() && e.target.value !== selForm.name && patchForm(selForm.id, { name: e.target.value })} style={{ ...input, fontSize: '1rem', fontWeight: 700, flex: 1 }} />
                <button onClick={() => delForm(selForm.id)} style={{ fontSize: '.76rem', color: red, background: 'transparent', border: `1px solid ${red}33`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>Delete form</button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.8rem', color: sub, cursor: 'pointer', marginTop: 12 }}>
                <input type="checkbox" checked={selForm.is_active} onChange={e => patchForm(selForm.id, { is_active: e.target.checked })} />
                <span><b style={{ color: slate }}>Visible to your team</b> — when on, this form shows in everyone’s portal to fill in.</span>
              </label>
            </div>

            {/* Fields */}
            <div style={{ ...card, padding: 18 }}>
              <div style={{ fontSize: '.9rem', fontWeight: 800, color: slate }}>Fields {fields.length > 0 && <span style={{ color: sub, fontWeight: 600 }}>· {fields.length}</span>}</div>
              <div style={{ fontSize: '.74rem', color: sub, marginTop: 3, marginBottom: 14 }}>The questions your team answers, in order. Use the arrows to reorder.</div>

              {fields.map((f, i) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', border: `1px solid ${line}`, borderRadius: 10, marginBottom: 8, background: soft }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <button onClick={() => move(i, -1)} disabled={i === 0} style={{ border: 'none', background: 'transparent', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#cbd5e1' : sub, fontSize: 11, lineHeight: 1 }}>▲</button>
                    <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} style={{ border: 'none', background: 'transparent', cursor: i === fields.length - 1 ? 'default' : 'pointer', color: i === fields.length - 1 ? '#cbd5e1' : sub, fontSize: 11, lineHeight: 1 }}>▼</button>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '.86rem', fontWeight: 600, color: slate }}>{f.label}{f.required && <span style={{ color: red }}> *</span>}</div>
                    <div style={{ fontSize: '.7rem', color: sub, marginTop: 1 }}>
                      <span style={{ background: '#e0e7ff', color: '#4338ca', borderRadius: 5, padding: '1px 7px', fontWeight: 700, fontSize: '.66rem' }}>{typeLabel(f.type)}</span>
                      {f.type === 'select' && f.options?.length ? <span> · {f.options.join(', ')}</span> : null}
                    </div>
                  </div>
                  <label style={{ fontSize: '.72rem', color: sub, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={f.required} onChange={e => patchField(f.id, { required: e.target.checked })} /> Required
                  </label>
                  <button onClick={() => delField(f.id)} title="Remove field" style={{ fontSize: '.9rem', color: sub, background: 'transparent', border: 'none', cursor: 'pointer' }}>✕</button>
                </div>
              ))}
              {fields.length === 0 && <div style={{ fontSize: '.82rem', color: sub, padding: '6px 0 14px' }}>No fields yet — add the first one below.</div>}

              {/* Add field */}
              <div style={{ marginTop: 8, padding: 14, border: `1px dashed #cbd5e1`, borderRadius: 10, background: '#fff' }}>
                <div style={{ fontSize: '.8rem', fontWeight: 800, color: slate, marginBottom: 12 }}>+ Add a field</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 12 }}>
                  <div>
                    <label style={lbl}>Field label</label>
                    <input value={nf.label} onChange={e => setNf({ ...nf, label: e.target.value })} placeholder="e.g. Serial number" style={{ ...input, width: '100%' }} />
                  </div>
                  <div>
                    <label style={lbl}>Field type</label>
                    <select value={nf.type} onChange={e => setNf({ ...nf, type: e.target.value })} style={{ ...input, width: '100%' }}>
                      {FIELD_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: '.72rem', color: sub, marginTop: 6 }}>{FIELD_TYPES.find(t => t.v === nf.type)?.d}</div>
                {nf.type === 'select' && (
                  <div style={{ marginTop: 10 }}>
                    <label style={lbl}>Dropdown choices (comma-separated)</label>
                    <input value={nf.options} onChange={e => setNf({ ...nf, options: e.target.value })} placeholder="Issued, Returned, Lost" style={{ ...input, width: '100%' }} />
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
                  <label style={{ fontSize: '.78rem', color: sub, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={nf.required} onChange={e => setNf({ ...nf, required: e.target.checked })} /> Make this required
                  </label>
                  <button onClick={addField} style={{ marginLeft: 'auto', padding: '9px 18px', background: blue, color: '#fff', border: 'none', borderRadius: 8, fontSize: '.82rem', fontWeight: 800, cursor: 'pointer' }}>Add field</button>
                </div>
                {msg && <div style={{ marginTop: 10, fontSize: '.76rem', color: red }}>{msg}</div>}
              </div>
            </div>

            {/* Live preview */}
            <div style={{ ...card, padding: 18 }}>
              <div style={{ fontSize: '.9rem', fontWeight: 800, color: slate }}>Preview</div>
              <div style={{ fontSize: '.74rem', color: sub, marginTop: 3, marginBottom: 14 }}>This is exactly what your team sees when filling “{selForm.name}”.</div>
              {fields.length === 0 ? (
                <div style={{ fontSize: '.82rem', color: sub }}>Add fields above to see the form preview.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                  {fields.map(f => (
                    <div key={f.id}>
                      <label style={lbl}>{f.label}{f.required && <span style={{ color: red }}> *</span>}</label>
                      {previewField(f)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontFamily: 'var(--font-jakarta), system-ui, sans-serif' }}>{children}</div>
}
