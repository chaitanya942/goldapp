'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'

import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const EMPTY_FORM = { name: '', opening_date: '', state: '', region: '', cluster: '', model_type: 'outside_bangalore', branch_code: '', address: '', city: '', pin_code: '', branch_gstin: '', crm_branch_id: '', pickup_time: '', contact_person: '', contact_phone: '', contact_email: '' }

function useMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return m
}

export default function BranchManagement() {
  const { theme, loadBranches } = useApp()
  const t = THEMES[theme]
  const isMobile = useMobile()

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
  const [syncMsg,          setSyncMsg]          = useState('')
  const [filterIncomplete, setFilterIncomplete] = useState(false)

  // Google address auto-resolution state
  const [resolveOpen,    setResolveOpen]    = useState(false)
  const [resolving,      setResolving]      = useState(false)
  const [resolveError,   setResolveError]   = useState('')
  const [resolveResults, setResolveResults] = useState([])  // [{ branch_name, suggestion?, error?, accepted }]
  const [savingResolved, setSavingResolved] = useState(false)

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
      pickup_time: form.pickup_time || null,
      // Branch contact — prints on Delivery Challan / Issue Voucher. The
      // Create Consignment modal pre-fills from these defaults, and any
      // override entered there sticks back here, so this row is the live
      // source of truth either way.
      contact_person: form.contact_person?.trim() || null,
      contact_phone:  form.contact_phone?.trim()  || null,
      contact_email:  form.contact_email?.trim()  || null,
      // Manual save = human-verified. Locks the row from future auto-resolution overrides.
      address_verified: true,
      address_source:   'manual',
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
      pickup_time: b.pickup_time || '',
      contact_person: b.contact_person || '',
      contact_phone:  b.contact_phone  || '',
      contact_email:  b.contact_email  || '',
    })
    setEditId(b.id); setFormOpen(true); setMsg('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removeBranch = async (id) => {
    await supabase.from('branches').delete().eq('id', id)
    setConfirmDelete(null)
    load()
  }

  // Open the Google auto-resolve panel. Builds the candidate list:
  // every branch where address is empty AND address_verified is not true.
  // Verified rows are skipped — manual edit beats auto-fill, always.
  const openResolve = async () => {
    setResolveOpen(true); setResolveError(''); setResolveResults([]); setResolving(true)
    try {
      const candidates = branches
        .filter(b => !b.address_verified && (!b.address || !b.pin_code))
        .map(b => b.name)
      if (candidates.length === 0) {
        setResolveError('All branches already have a verified address. Nothing to resolve.')
        setResolving(false)
        return
      }
      const res  = await authedFetch('/api/branches/resolve-address', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ branch_names: candidates }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResolveError(data.error || 'Resolve failed')
        setResolving(false)
        return
      }
      // Default: accept all suggestions that came back. Operator can untick before saving.
      setResolveResults((data.results || []).map(r => ({ ...r, accepted: !!r.suggestion })))
    } catch (e) {
      setResolveError(e.message || 'Resolve failed')
    }
    setResolving(false)
  }

  const toggleResolveAccept = (branch_name) => {
    setResolveResults(rs => rs.map(r => r.branch_name === branch_name ? { ...r, accepted: !r.accepted } : r))
  }

  const saveResolved = async () => {
    const accepted = resolveResults
      .filter(r => r.accepted && r.suggestion)
      .map(r => ({ branch_name: r.branch_name, ...r.suggestion }))
    if (accepted.length === 0) { setResolveError('Nothing selected to save.'); return }
    setSavingResolved(true); setResolveError('')
    try {
      const res  = await authedFetch('/api/branches/save-resolved-addresses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accepted }),
      })
      const data = await res.json()
      if (!res.ok) { setResolveError(data.error || 'Save failed'); setSavingResolved(false); return }
      setSyncMsg(`✓ Saved ${data.saved} address${data.saved === 1 ? '' : 'es'}.${data.skipped?.length ? ` Skipped ${data.skipped.length}: ${data.skipped.map(s => s.branch_name).join(', ')}` : ''}`)
      setResolveOpen(false); setResolveResults([])
      load(); loadBranches()
    } catch (e) { setResolveError(e.message || 'Save failed') }
    setSavingResolved(false)
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
    grid4:      { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: isMobile ? '12px' : '16px' },
    grid2:      { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: isMobile ? '12px' : '16px', marginTop: '12px' },
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
          <div style={s.sub}>Add, activate, and manage all branches · new branches auto-add daily when they start purchasing</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={openResolve} disabled={resolving} style={{ ...s.btnOutline, opacity: resolving ? .6 : 1 }}>
            {resolving ? 'Resolving…' : 'Auto-resolve addresses'}
          </button>
          <button style={s.btnGold} onClick={() => formOpen ? cancelForm() : setFormOpen(true)}>
            {formOpen ? 'Cancel' : 'Add branch'}
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
          <span>{incompleteBranches.length} {incompleteBranches.length === 1 ? 'branch has' : 'branches have'} incomplete data: missing state, region, or cluster. Click to {filterIncomplete ? 'show all' : 'view them'}.</span>
          {filterIncomplete && <span style={{ fontSize: '.68rem', opacity: .7 }}>Clear filter</span>}
        </div>
      )}

      {/* FORM */}
      {formOpen && (
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ fontSize: '.65rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase' }}>
              {editId ? `Editing: ${form.name}` : 'New Branch'}
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

          {form.model_type === 'outside_bangalore' && (
            <div style={{ marginTop: '16px' }}>
              <label style={s.label}>Logistics Pickup Time</label>
              <input style={s.input} placeholder="e.g. Mon/Wed/Fri 4 PM"
                value={form.pickup_time} onChange={e => setField('pickup_time', e.target.value)} />
              <div style={{ fontSize: '.6rem', color: t.text4, marginTop: '4px' }}>Shown in Branch Stock Overview · free-form text</div>
            </div>
          )}

          {/* Address */}
          <div style={{ borderTop: `1px solid ${t.border}`, marginTop: '20px', paddingTop: '20px' }}>
            <div style={{ fontSize: '.7rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '16px', fontWeight: 600 }}>
              Address (for Delivery Challan)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr 1fr', gap: isMobile ? '12px' : '16px' }}>
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

          {/* Branch Contact — name + phone print on Delivery Challan and
              Issue Voucher. Email is captured here but currently informational
              (no document uses it). Changes here are the source of truth;
              any edit made via the Create Consignment modal sticks back to
              these fields automatically. */}
          <div style={{ borderTop: `1px solid ${t.border}`, marginTop: '20px', paddingTop: '20px' }}>
            <div style={{ fontSize: '.7rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 600 }}>
              Branch Contact
            </div>
            <div style={{ fontSize: '.65rem', color: t.text4, marginBottom: '16px' }}>
              Name + phone print on Delivery Challan / Issue Voucher. Operators can also edit Name &amp; Phone during Create Consignment — any edit there auto-syncs back here.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1.4fr', gap: isMobile ? '12px' : '16px' }}>
              <div>
                <label style={s.label}>Name</label>
                <input style={s.input} placeholder="Branch person responsible for dispatch"
                  value={form.contact_person} onChange={e => setField('contact_person', e.target.value)} />
              </div>
              <div>
                <label style={s.label}>Phone</label>
                <input style={s.input} placeholder="+91 9XXXXXXXXX" inputMode="tel"
                  value={form.contact_phone}
                  onChange={e => setField('contact_phone', e.target.value.replace(/[^\d+ ]/g, '').slice(0, 18))} />
              </div>
              <div>
                <label style={s.label}>Email <span style={{ color: t.text4, fontWeight: 400 }}>(optional)</span></label>
                <input style={s.input} type="email" placeholder="branch.contact@example.com"
                  value={form.contact_email} onChange={e => setField('contact_email', e.target.value.trim())} />
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

      {/* Address auto-resolve review modal */}
      {resolveOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !savingResolved) setResolveOpen(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '40px 20px', overflowY: 'auto' }}
        >
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', width: '100%', maxWidth: '900px', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '1rem', color: t.text1, fontWeight: 400, letterSpacing: '.04em' }}>Auto-resolve branch addresses</div>
                <div style={{ fontSize: '.7rem', color: t.text3, marginTop: '4px' }}>Google Maps suggestions for branches missing address. Review, then save accepted ones.</div>
              </div>
              <button onClick={() => !savingResolved && setResolveOpen(false)} style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ padding: '20px 24px', maxHeight: '60vh', overflowY: 'auto' }}>
              {resolving && <div style={{ textAlign: 'center', color: t.text3, padding: '32px', fontSize: '.8rem' }}>Looking up addresses with Google Maps…</div>}
              {resolveError && (
                <div style={{ background: '#e0555518', border: '1px solid #e0555540', borderRadius: '6px', padding: '10px 14px', fontSize: '.72rem', color: '#e05555', marginBottom: '12px' }}>{resolveError}</div>
              )}
              {!resolving && resolveResults.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...s.th, width: '36px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={resolveResults.every(r => !r.suggestion || r.accepted)}
                          onChange={(e) => setResolveResults(rs => rs.map(r => r.suggestion ? { ...r, accepted: e.target.checked } : r))}
                        />
                      </th>
                      <th style={s.th}>Branch</th>
                      <th style={s.th}>Suggested Address</th>
                      <th style={{ ...s.th, width: '90px' }}>PIN</th>
                      <th style={{ ...s.th, width: '80px' }}>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolveResults.map(r => (
                      <tr key={r.branch_name}>
                        <td style={{ ...s.td, textAlign: 'center' }}>
                          {r.suggestion ? (
                            <input type="checkbox" checked={!!r.accepted} onChange={() => toggleResolveAccept(r.branch_name)} />
                          ) : '—'}
                        </td>
                        <td style={{ ...s.td, color: t.gold, fontWeight: 400 }}>{r.branch_name}</td>
                        <td style={{ ...s.td, fontSize: '.7rem', color: r.suggestion ? t.text1 : '#e05555' }}>
                          {r.suggestion?.address || r.error || 'No suggestion'}
                          {r.suggestion?.city && (
                            <div style={{ fontSize: '.62rem', color: t.text3, marginTop: '2px' }}>{r.suggestion.city}{r.suggestion.state ? `, ${r.suggestion.state}` : ''}</div>
                          )}
                        </td>
                        <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '.7rem', color: r.suggestion?.pin_code ? t.text1 : t.text4 }}>
                          {r.suggestion?.pin_code || '—'}
                        </td>
                        <td style={{ ...s.td, fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.08em', color: r.suggestion?.confidence === 'high' ? t.green : r.suggestion?.confidence === 'medium' ? t.gold : t.text4 }}>
                          {r.suggestion?.confidence || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!resolving && resolveResults.length === 0 && !resolveError && (
                <div style={{ textAlign: 'center', color: t.text3, padding: '32px', fontSize: '.8rem' }}>No suggestions returned.</div>
              )}
            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '.68rem', color: t.text3 }}>
                {resolveResults.filter(r => r.accepted).length} of {resolveResults.length} accepted · manual edits stay locked
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setResolveOpen(false)} disabled={savingResolved} style={s.btnOutline}>Cancel</button>
                <button onClick={saveResolved} disabled={savingResolved || resolving || resolveResults.filter(r => r.accepted).length === 0} style={{ ...s.btnGold, opacity: (savingResolved || resolveResults.filter(r => r.accepted).length === 0) ? .5 : 1 }}>
                  {savingResolved ? 'Saving…' : `Save ${resolveResults.filter(r => r.accepted).length} address${resolveResults.filter(r => r.accepted).length === 1 ? '' : 'es'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}