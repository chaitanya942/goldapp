'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0e0e0e', card: '#141414', text1: '#f0e6c8', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#2a2a2a', green: '#3aaa6a' },
  light: { bg: '#f5f0e8', card: '#ede8dc', text1: '#2a1f0a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d5cfc0', green: '#2a8a5a' },
}

const EMPTY_FORM = { name: '', opening_date: '', state: '', region: '', cluster: '', model_type: 'outside_bangalore', branch_code: '', address: '', city: '', pin_code: '', branch_gstin: '', crm_branch_id: '' }

export default function BranchManagement() {
  const { theme, loadBranches } = useApp()
  const t = THEMES[theme]

  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [editId, setEditId] = useState(null)

  // Territory map from Supabase
  const [tmap, setTmap] = useState({})

  // Inline add state for each level
  const [addingState, setAddingState] = useState(false)
  const [addingRegion, setAddingRegion] = useState(false)
  const [addingCluster, setAddingCluster] = useState(false)
  const [newState, setNewState] = useState('')
  const [newRegion, setNewRegion] = useState('')
  const [newCluster, setNewCluster] = useState('')

  const [confirmDelete,    setConfirmDelete]    = useState(null)
  const [syncing,          setSyncing]          = useState(false)
  const [syncMsg,          setSyncMsg]          = useState('')
  const [filterIncomplete, setFilterIncomplete] = useState(false)

  useEffect(() => { load(); loadTmap() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('branches').select('*').order('name')
    if (data) setBranches(data)
    setLoading(false)
  }

  const loadTmap = async () => {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'territory_map').single()
    if (data) setTmap(data.value)
  }

  const saveTmap = async (updated) => {
    await supabase.from('app_config').update({ value: updated }).eq('key', 'territory_map')
    setTmap(updated)
  }

  const addState = async () => {
    const s = newState.trim()
    if (!s || tmap[s]) return
    const updated = { ...tmap, [s]: {} }
    await saveTmap(updated)
    setForm(f => ({ ...f, state: s, region: '', cluster: '' }))
    setNewState(''); setAddingState(false)
  }

  const addRegion = async () => {
    const r = newRegion.trim()
    if (!r || !form.state || tmap[form.state]?.[r]) return
    const updated = { ...tmap, [form.state]: { ...tmap[form.state], [r]: [] } }
    await saveTmap(updated)
    setForm(f => ({ ...f, region: r, cluster: '' }))
    setNewRegion(''); setAddingRegion(false)
  }

  const addCluster = async () => {
    const c = newCluster.trim()
    if (!c || !form.state || !form.region) return
    const existing = tmap[form.state]?.[form.region] || []
    if (existing.includes(c)) return
    const updated = {
      ...tmap,
      [form.state]: {
        ...tmap[form.state],
        [form.region]: [...existing, c]
      }
    }
    await saveTmap(updated)
    setForm(f => ({ ...f, cluster: c }))
    setNewCluster(''); setAddingCluster(false)
  }

  const incompleteBranches = branches.filter(b => !b.state || !b.region || !b.cluster)

  const filtered = branches.filter(b => {
    if (filterIncomplete) return !b.state || !b.region || !b.cluster
    return [b.name, b.state, b.region, b.cluster].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  })

  const save = async () => {
    if (!form.name || !form.state || !form.region || !form.cluster) { setMsg('Please fill all required fields'); return }
    if (form.branch_code) {
      const code = form.branch_code.toUpperCase().trim()
      const duplicate = branches.find(b => b.branch_code?.toUpperCase() === code && b.id !== editId)
      if (duplicate) { setMsg(`Branch code "${code}" is already used by ${duplicate.name}`); return }
    }
    setSaving(true); setMsg('')
    const payload = {
      name: form.name.toUpperCase().trim(),
      state: form.state, region: form.region, cluster: form.cluster,
      model_type: form.model_type, opening_date: form.opening_date || null,
      branch_code: form.branch_code?.toUpperCase().trim() || null,
      address: form.address || null,
      city: form.city || null,
      pin_code: form.pin_code || null,
      branch_gstin: form.branch_gstin || null,
    }
    const { error } = editId
      ? await supabase.from('branches').update(payload).eq('id', editId)
      : await supabase.from('branches').insert(payload)
    if (error) { setMsg(error.message); setSaving(false); return }
    setMsg(editId ? 'Branch updated successfully' : 'Branch added successfully')
    setForm(EMPTY_FORM); setFormOpen(false); setEditId(null)
    load(); loadBranches()
    setSaving(false)
  }

  const startEdit = (b) => {
    setForm({
      name: b.name,
      opening_date: b.opening_date ? b.opening_date.split('T')[0] : '',
      state: b.state, region: b.region, cluster: b.cluster, model_type: b.model_type,
      branch_code: b.branch_code || '',
      address: b.address || '',
      city: b.city || '',
      pin_code: b.pin_code || '',
      branch_gstin: b.branch_gstin || '',
      crm_branch_id: b.crm_branch_id || '',
    })
    setEditId(b.id); setFormOpen(true); setMsg('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removeBranch = async (id) => {
    await supabase.from('branches').delete().eq('id', id)
    setConfirmDelete(null)
    load()
  }

  const syncFromCRM = async () => {
    setSyncing(true); setSyncMsg('')
    try {
      const res  = await fetch('/api/sync-branch-addresses', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        const s = data.summary
        const parts = [`${s.new_branches_added} new added`, `${s.crm_id_stamped || 0} linked`, `${s.already_existed} unchanged`]
        if (s.errors) parts.push(`${s.errors} errors`)
        let msg = `✓ ${parts.join(', ')}`
        if (data.errors?.length) {
          msg += '\nFailed: ' + data.errors.map(e => `${e.name} (${e.error})`).join(' | ')
        }
        if (data.new_branches?.length) {
          msg += '\nAdded: ' + data.new_branches.join(', ')
        }
        setSyncMsg(msg)
        if (s.new_branches_added > 0) load()
      } else {
        setSyncMsg(`Error: ${data.error}${data.details ? ` — ${data.details}` : ''}`)
      }
    } catch (e) { setSyncMsg(`Error: ${e.message}`) }
    setSyncing(false)
  }

  const cancelForm = () => { setFormOpen(false); setEditId(null); setForm(EMPTY_FORM); setMsg('') }
  const toggleActive = async (id, current) => { await supabase.from('branches').update({ is_active: !current }).eq('id', id); load() }
  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const EXPORT_COLS = ['#', 'Branch Name', 'State', 'Region', 'Cluster', 'Opening Date', 'Model', 'Status']
  const exportRows = () => filtered.map((b, i) => [
    i + 1, b.name, b.state, b.region, b.cluster,
    b.opening_date ? new Date(b.opening_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
    b.model_type === 'bangalore' ? 'Same-day HO' : 'Consignment',
    b.is_active ? 'Active' : 'Inactive',
  ])

  const exportCSV = () => {
    const rows = [EXPORT_COLS, ...exportRows()]
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'branches.csv'; a.click()
  }

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script'); s.src = src
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })

  const exportXLSX = async () => {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js')
    const XLSX = window.XLSX
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_COLS, ...exportRows()])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Branches')
    XLSX.writeFile(wb, 'branches.xlsx')
  }

  const exportPDF = async () => {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
    const { jsPDF } = window.jspdf
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(14); doc.setTextColor(201, 168, 76)
    doc.text('Branch Management', 14, 16)
    doc.setFontSize(9); doc.setTextColor(120, 106, 74)
    doc.text(`Exported ${new Date().toLocaleDateString('en-IN')} · ${filtered.length} branches`, 14, 23)
    doc.autoTable({
      startY: 28,
      head: [EXPORT_COLS],
      body: exportRows(),
      theme: 'grid',
      headStyles: { fillColor: [30, 20, 0], textColor: [201, 168, 76], fontSize: 7, fontStyle: 'bold' },
      bodyStyles: { fillColor: [20, 20, 20], textColor: [240, 230, 200], fontSize: 7 },
      alternateRowStyles: { fillColor: [26, 26, 26] },
      styles: { cellPadding: 3 },
    })
    doc.save('branches.pdf')
  }

  const s = {
    wrap:       { padding: '32px', width: '100%', boxSizing: 'border-box' },
    header:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
    title:      { fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' },
    sub:        { fontSize: '.72rem', color: t.text3, marginTop: '4px' },
    btnGold:    { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnOutline: { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    card:       { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '20px', marginBottom: '24px' },
    label:      { fontSize: '.62rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '5px', display: 'block' },
    input:      { width: '100%', background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '8px 10px', color: t.text1, fontSize: '.78rem', boxSizing: 'border-box' },
    grid4:      { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' },
    grid2:      { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: '12px' },
    row:        { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '16px' },
    tblWrap:    { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    th:         { padding: '10px 16px', fontSize: '.6rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400 },
    td:         { padding: '11px 16px', fontSize: '.75rem', color: t.text1, borderBottom: `1px solid ${t.border}20` },
    search:     { background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 14px', color: t.text1, fontSize: '.75rem', width: '280px', outline: 'none' },
    addRow:     { display: 'flex', gap: '6px', padding: '6px 8px', borderTop: `1px solid ${t.border}` },
    addInput:   { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: t.text1, fontSize: '.72rem', padding: '2px 4px' },
    addBtn:     { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '.62rem', fontWeight: 700, cursor: 'pointer' },
    addTrigger: { padding: '7px 10px', fontSize: '.68rem', color: t.gold, cursor: 'pointer', borderTop: `1px solid ${t.border}`, display: 'block', background: 'transparent', border: 'none', width: '100%', textAlign: 'left' },
  }

  // Reusable select with inline add
  const SmartSelect = ({ value, onChange, options, placeholder, onAdd, adding, setAdding, newVal, setNewVal }) => (
    <div style={{ position: 'relative' }}>
      <select style={s.input} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o} style={{ background: t.card, color: t.text1 }}>{o}</option>)}
      </select>
      {adding ? (
        <div style={s.addRow}>
          <input
            autoFocus
            style={s.addInput}
            placeholder="Type name & press Enter"
            value={newVal}
            onChange={e => setNewVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onAdd(); if (e.key === 'Escape') setAdding(false) }}
          />
          <button style={s.addBtn} onClick={onAdd}>✓</button>
          <button style={{ ...s.addBtn, background: 'transparent', color: t.text3, border: `1px solid ${t.border}` }} onClick={() => setAdding(false)}>✕</button>
        </div>
      ) : (
        <button style={s.addTrigger} onClick={() => setAdding(true)}>+ Add new</button>
      )}
    </div>
  )

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Branch Management</div>
          <div style={s.sub}>Add, activate, and manage all branches across states</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={syncFromCRM} disabled={syncing} style={{ ...s.btnOutline, opacity: syncing ? .6 : 1 }}>
            {syncing ? 'Syncing…' : '↻ Sync CRM'}
          </button>
          <button style={s.btnGold} onClick={() => formOpen ? cancelForm() : setFormOpen(true)}>
            {formOpen ? '✕ Cancel' : '+ Add Branch'}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div style={{ background: syncMsg.startsWith('✓') ? `${t.green}18` : `${t.red}18`, border: `1px solid ${syncMsg.startsWith('✓') ? t.green : t.red}40`, borderRadius: '6px', padding: '8px 14px', fontSize: '.72rem', color: syncMsg.startsWith('✓') ? t.green : t.red, marginBottom: '16px', whiteSpace: 'pre-line' }}>
          {syncMsg}
        </div>
      )}

      {incompleteBranches.length > 0 && (
        <div
          onClick={() => setFilterIncomplete(f => !f)}
          style={{ background: filterIncomplete ? '#c9a84c18' : '#c9a84c0a', border: `1px solid ${filterIncomplete ? t.gold : t.gold + '44'}`, borderRadius: '6px', padding: '8px 14px', fontSize: '.72rem', color: t.gold, marginBottom: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>⚠ {incompleteBranches.length} {incompleteBranches.length === 1 ? 'branch has' : 'branches have'} incomplete data — missing state / region / cluster. Click to {filterIncomplete ? 'show all' : 'view them'}.</span>
          {filterIncomplete && <span style={{ fontSize: '.68rem', opacity: .7 }}>✕ Clear filter</span>}
        </div>
      )}

      {/* FORM */}
      {formOpen && (
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ fontSize: '.65rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase' }}>
              {editId ? `Editing — ${form.name}` : 'New Branch'}
            </span>
            {form.crm_branch_id && (
              <span style={{ fontSize: '.65rem', color: t.text3, fontFamily: 'monospace' }}>CRM ID: <span style={{ color: t.gold }}>{form.crm_branch_id}</span></span>
            )}
          </div>
          <div style={s.grid4}>
            <div>
              <label style={s.label}>Branch Name *</label>
              <input style={s.input} placeholder="e.g. KORAMANGALA" value={form.name} onChange={e => setField('name', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Branch Code</label>
              <input style={s.input} placeholder="e.g. KOR (auto-generated if blank)" value={form.branch_code} onChange={e => setField('branch_code', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Opening Date</label>
              <input style={s.input} type="date" value={form.opening_date} onChange={e => setField('opening_date', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>State *</label>
              <SmartSelect
                value={form.state}
                onChange={v => setForm(f => ({ ...f, state: v, region: '', cluster: '' }))}
                options={Object.keys(tmap)}
                placeholder="Select state"
                onAdd={addState}
                adding={addingState} setAdding={setAddingState}
                newVal={newState} setNewVal={setNewState}
              />
            </div>
            <div>
              <label style={s.label}>Region *</label>
              <SmartSelect
                value={form.region}
                onChange={v => setForm(f => ({ ...f, region: v, cluster: '' }))}
                options={form.state ? Object.keys(tmap[form.state] || {}) : []}
                placeholder={form.state ? 'Select region' : 'Select state first'}
                onAdd={addRegion}
                adding={addingRegion} setAdding={setAddingRegion}
                newVal={newRegion} setNewVal={setNewRegion}
              />
            </div>
          </div>
          <div style={s.grid2}>
            <div>
              <label style={s.label}>Cluster *</label>
              <SmartSelect
                value={form.cluster}
                onChange={v => setField('cluster', v)}
                options={form.state && form.region ? (tmap[form.state]?.[form.region] || []) : []}
                placeholder={form.region ? 'Select cluster' : 'Select region first'}
                onAdd={addCluster}
                adding={addingCluster} setAdding={setAddingCluster}
                newVal={newCluster} setNewVal={setNewCluster}
              />
            </div>
            <div>
              <label style={s.label}>Model Type</label>
              <select style={s.input} value={form.model_type} onChange={e => setField('model_type', e.target.value)}>
                <option value="bangalore" style={{ background: t.card }}>Bangalore (Same-day HO)</option>
                <option value="outside_bangalore" style={{ background: t.card }}>Outside Bangalore (Consignment)</option>
              </select>
            </div>
          </div>

          {/* Address */}
          <div style={{ borderTop: `1px solid ${t.border}`, marginTop: '20px', paddingTop: '20px' }}>
            <div style={{ fontSize: '.7rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '16px', fontWeight: 600 }}>
              Address (for Delivery Challan)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <label style={s.label}>Full Address</label>
                <textarea style={{ ...s.input, minHeight: '64px', fontFamily: 'inherit', resize: 'vertical' }}
                  placeholder="Street, Area, District..."
                  value={form.address}
                  onChange={e => setField('address', e.target.value)} />
              </div>
              <div>
                <label style={s.label}>City</label>
                <input style={s.input} value={form.city} onChange={e => setField('city', e.target.value)} />
              </div>
              <div>
                <label style={s.label}>PIN Code</label>
                <input style={s.input} value={form.pin_code} onChange={e => setField('pin_code', e.target.value)} />
              </div>
              <div>
                <label style={s.label}>Branch GSTIN</label>
                <input style={s.input} placeholder="29AAPCA3170M1Z5" value={form.branch_gstin} onChange={e => setField('branch_gstin', e.target.value)} />
              </div>
            </div>
          </div>

          <div style={s.row}>
            <button style={s.btnGold} onClick={save} disabled={saving}>
              {saving ? 'Saving...' : editId ? 'Update Branch' : 'Save Branch'}
            </button>
            <button style={s.btnOutline} onClick={cancelForm}>Cancel</button>
            {msg && <span style={{ fontSize: '.72rem', color: msg.includes('success') ? t.green : '#e05555' }}>{msg}</span>}
          </div>
        </div>
      )}

      {/* SEARCH + EXPORT */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            style={s.search}
            placeholder="🔍  Search by name, state, region, cluster..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', color: t.text3, cursor: 'pointer', fontSize: '.85rem', lineHeight: 1, padding: 0 }}
            >✕</button>
          )}
        </div>
        {(search || filterIncomplete) && (
          <span style={{ fontSize: '.7rem', color: t.text3 }}>{filtered.length} of {branches.length} branches</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button style={s.btnOutline} onClick={exportCSV}>↓ CSV</button>
          <button style={s.btnOutline} onClick={exportXLSX}>↓ XLSX</button>
          <button style={s.btnOutline} onClick={exportPDF}>↓ PDF</button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading branches...</div>
      ) : (
        <div style={s.tblWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['#', 'Branch Name', 'CRM ID', 'Code', 'Address', 'State', 'Region', 'Model', 'Status', 'Action'].map(h =>
                  <th key={h} style={{ ...s.th, textAlign: h === '#' ? 'center' : 'left' }}>{h}</th>
                )}</tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr key={b.id} style={{ background: editId === b.id ? `${t.gold}08` : (!b.state || !b.region || !b.cluster) ? '#c9a84c06' : 'transparent' }}>
                  <td style={{ ...s.td, textAlign: 'center', color: t.text3, fontSize: '.65rem', width: '40px' }}>{i + 1}</td>
                  <td style={{ ...s.td, color: t.gold, fontWeight: 400 }}>
                    {b.name}
                    {(!b.state || !b.region || !b.cluster) && <span style={{ marginLeft: '6px', fontSize: '.58rem', color: t.gold, opacity: .6, border: `1px solid ${t.gold}44`, borderRadius: '3px', padding: '1px 4px' }}>incomplete</span>}
                  </td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '.68rem', color: b.crm_branch_id ? t.text2 : t.text4 }}>
                    {b.crm_branch_id || '—'}
                  </td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '.72rem', color: b.branch_code ? t.gold : t.text4 }}>
                    {b.branch_code || '—'}
                  </td>
                  <td style={{ ...s.td, fontSize: '.68rem', color: b.address ? t.text2 : t.text4, maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.address || '—'}
                  </td>
                  <td style={{ ...s.td, color: b.state ? t.text1 : '#c9a84c88' }}>{b.state || '⚠ missing'}</td>
                  <td style={{ ...s.td, color: b.region ? t.text1 : '#c9a84c88' }}>{b.region || '⚠ missing'}</td>
                  <td style={{ ...s.td, fontSize: '.65rem', color: b.model_type === 'bangalore' ? t.green : t.text3 }}>
                    {b.model_type === 'bangalore' ? 'Same-day HO' : 'Consignment'}
                  </td>
                  <td style={{ ...s.td, fontSize: '.62rem', letterSpacing: '.1em', textTransform: 'uppercase', color: b.is_active ? t.green : t.text4 }}>
                    {b.is_active ? 'Active' : 'Inactive'}
                  </td>
                  <td style={{ ...s.td, display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button onClick={() => startEdit(b)} style={{ background: 'transparent', border: `1px solid ${t.gold}40`, color: t.gold, borderRadius: '5px', padding: '4px 10px', fontSize: '.62rem', cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => toggleActive(b.id, b.is_active)} style={{ background: 'transparent', border: `1px solid ${b.is_active ? '#e0555540' : t.gold + '40'}`, color: b.is_active ? '#e05555' : t.gold, borderRadius: '5px', padding: '4px 10px', fontSize: '.62rem', cursor: 'pointer' }}>
                      {b.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    {confirmDelete === b.id ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '.62rem', color: '#e05555' }}>Sure?</span>
                        <button onClick={() => removeBranch(b.id)} style={{ background: '#e05555', border: 'none', color: '#fff', borderRadius: '5px', padding: '4px 8px', fontSize: '.62rem', cursor: 'pointer' }}>Yes</button>
                        <button onClick={() => setConfirmDelete(null)} style={{ background: 'transparent', border: `1px solid ${t.border}`, color: t.text3, borderRadius: '5px', padding: '4px 8px', fontSize: '.62rem', cursor: 'pointer' }}>No</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDelete(b.id)} style={{ background: 'transparent', border: '1px solid #e0555540', color: '#e05555', borderRadius: '5px', padding: '4px 10px', fontSize: '.62rem', cursor: 'pointer' }}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                  {search ? `No branches matching "${search}"` : 'No branches yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}