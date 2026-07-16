'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'

import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const EMPTY_FORM = { name: '', opening_date: '', state: '', region: '', cluster: '', model_type: 'outside_bangalore', branch_code: '', address: '', city: '', pin_code: '', branch_gstin: '', crm_branch_id: '', pickup_time: '', delivery_tat_hours: 24, pickup_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], tamper_next: '', contact_person: '', contact_phone: '', contact_email: '' }

// Logistics is RULE-BASED in these regions — no per-branch pickup time/days are
// stored and the TAT is stamped from the region rule (Bangalore = same-day HO = 0h,
// Kerala = next-day = 24h). Everywhere else, TAT + pickup days are a per-branch OPS
// decision we must never guess. Single source of truth for both save() and the
// "needs logistics setup" nag, so the two can't drift apart.
const RULE_BASED_REGIONS = new Set(['Bangalore', 'Kerala'])
const isRuleBasedRegion  = (r) => RULE_BASED_REGIONS.has(r)
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function useMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return m
}

export default function BranchManagement({ embedded = false } = {}) {
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
  const [filterLogistics,  setFilterLogistics]  = useState(false)

  // Filters
  const [selRegions,   setSelRegions]   = useState(() => new Set())  // multi-select region
  const [statusFilter, setStatusFilter] = useState('all')            // all | active | inactive
  const [selBranches,  setSelBranches]  = useState(() => new Set())  // multi-select specific branches
  const [pickerOpen,   setPickerOpen]   = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [sortKey,      setSortKey]      = useState('name')
  const [sortDir,      setSortDir]      = useState(1)
  const [activity,     setActivity]     = useState(null)   // { branch_name: last_bill_date } — absent = upcoming
  const [tamper,       setTamper]       = useState({})     // { branch_name: last_used_tmp_no (numeric) }

  // Google address auto-resolution state
  const [resolveOpen,    setResolveOpen]    = useState(false)
  const [resolving,      setResolving]      = useState(false)
  const [resolveError,   setResolveError]   = useState('')
  const [resolveResults, setResolveResults] = useState([])  // [{ branch_name, suggestion?, error?, accepted }]
  const [savingResolved, setSavingResolved] = useState(false)

  useEffect(() => { load(); loadTmap(); loadActivity(); loadTamper() }, [])

  const loadTamper = async () => {
    try {
      const res = await authedFetch('/api/branch-tamper')
      const data = await res.json()
      setTamper(data.lastTmp || {})
    } catch { setTamper({}) }
  }
  // Format a numeric tamper-proof to WG######; helpers for last/next.
  const fmtTmp = (n) => (n && n > 0) ? `WG${String(n).padStart(6, '0')}` : '—'
  const lastTmpOf = (name) => tamper[name] || 0
  const nextTmpOf = (name) => fmtTmp((tamper[name] || 0) + 1)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('branches').select('*').order('name')
    if (data) setBranches(data)
    setLoading(false)
  }

  const loadActivity = async () => {
    try {
      const res = await authedFetch('/api/branch-activity')
      const data = await res.json()
      setActivity(data.activity || {})
    } catch { setActivity({}) }
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

  const regions = [...new Set(branches.map(b => b.region).filter(Boolean))].sort()

  // Upcoming = branch is active but has never billed (only known once activity loads).
  const isUpcoming = (b) => activity != null && b.is_active && !activity[b.name]
  // Incomplete = missing core master data — but only nag OPERATIONAL branches,
  // not upcoming ones (they get cluster/address assigned when they go live).
  const isIncomplete = (b) => (!b.state || !b.region || !b.cluster) && !isUpcoming(b)
  const incompleteBranches = branches.filter(isIncomplete)

  // ── Logistics setup ───────────────────────────────────────────────────────
  // delivery TAT + pickup days are ops decisions we must never guess: TAT drives
  // the HO-arrival math in Booking Volume, and pickup days decide whether a branch
  // enters the "pickup pending today" pool at all. A branch missing them is
  // INVISIBLE to the bid desk and its arrival silently falls back to 24h. Unlike
  // isIncomplete, this DOES nag upcoming branches — they must be configured BEFORE
  // they start purchasing, not after.
  const isBlank = (v) => v === null || v === undefined || String(v).trim() === '' || (Array.isArray(v) && v.length === 0)
  // Bangalore/Kerala are rule-based (TAT stamped from the region, no stored pickup
  // days) — a null there is CORRECT, so they must never trip this nag.
  const needsLogistics = (b) => b.is_active && !isRuleBasedRegion(b.region)
    && (isBlank(b.delivery_tat_hours) || isBlank(b.pickup_days))
  const logisticsBranches = branches.filter(needsLogistics)
  // Softer nudge: pickup_time only feeds the "at-risk" dispatch flag. Scoped to
  // non-rule-based regions too, else all 72 Bangalore/Kerala branches (correctly
  // null) would show up as a phantom backlog.
  const noPickupTime = branches.filter(b => b.is_active && !isRuleBasedRegion(b.region)
    && !needsLogistics(b) && isBlank(b.pickup_time))

  const q = search.trim().toLowerCase()
  const filtered = branches.filter(b => {
    if (filterIncomplete && !isIncomplete(b)) return false
    if (filterLogistics  && !needsLogistics(b)) return false
    if (selRegions.size  && !selRegions.has(b.region)) return false
    if (statusFilter === 'active'   && !b.is_active)  return false
    if (statusFilter === 'inactive' &&  b.is_active)  return false
    if (statusFilter === 'upcoming' && !isUpcoming(b)) return false
    if (selBranches.size && !selBranches.has(b.name)) return false
    if (q) return [b.name, b.state, b.region, b.cluster, b.branch_code, b.crm_branch_id].some(v => v?.toLowerCase().includes(q))
    return true
  }).sort((a, b) => {
    if (sortKey === 'status') return (Number(b.is_active) - Number(a.is_active)) * sortDir
    return String(a[sortKey] || '').localeCompare(String(b[sortKey] || '')) * sortDir
  })

  const anyFilter = q || filterIncomplete || filterLogistics || selRegions.size || statusFilter !== 'all' || selBranches.size
  const clearAllFilters = () => { setSearch(''); setFilterIncomplete(false); setFilterLogistics(false); setSelRegions(new Set()); setStatusFilter('all'); setSelBranches(new Set()) }
  const toggleRegion = (r) => setSelRegions(s => { const n = new Set(s); n.has(r) ? n.delete(r) : n.add(r); return n })
  const toggleBranch = (name) => setSelBranches(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
  const toggleSort = (k) => { if (sortKey === k) setSortDir(d => -d); else { setSortKey(k); setSortDir(1) } }
  const stats = { total: branches.length, active: branches.filter(b => b.is_active).length, inactive: branches.filter(b => !b.is_active).length, upcoming: branches.filter(isUpcoming).length, regions: regions.length }

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
      // Logistics — Bangalore/Kerala are rule-based (daily pickup; Bangalore
      // same-day, Kerala next-day 24h), so we don't store a pickup time/days for
      // them; delivery_tat_hours is stamped to the region rule (0 / 24).
      pickup_time:        isRuleBasedRegion(form.region) ? null : (form.pickup_time || null),
      // Blank stays NULL — never silently fall back to 24h. A guessed TAT quietly
      // mis-predicts HO arrival in Booking Volume, so the branch keeps showing in
      // the "needs logistics setup" banner until ops actually enters a number.
      delivery_tat_hours: form.region === 'Bangalore' ? 0 : form.region === 'Kerala' ? 24
                          : (form.delivery_tat_hours === '' || form.delivery_tat_hours == null
                              ? null : (Number(form.delivery_tat_hours) || null)),
      pickup_days:        isRuleBasedRegion(form.region) ? null : (form.pickup_days?.length ? form.pickup_days : null),
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

    // Tamper-proof: if the operator set a Next number different from the current
    // one, seed a consignment row at (next − 1) so the generator issues exactly
    // that number next (same mechanism as the Bangalore seal seeding).
    const wantNext = parseInt(String(form.tamper_next || '').replace(/\D/g, '')) || 0
    const curNext  = (tamper[payload.name] || 0) + 1
    if (wantNext > 0 && wantNext !== curNext) {
      const seedNo = `WG${String(wantNext - 1).padStart(6, '0')}`
      const sc = (payload.name.match(/^([A-Z]{2})-/) || [])[1] || 'KA'
      await supabase.from('consignments').insert({
        consignment_no: `SEED-${payload.name}-${seedNo}`, tmp_prf_no: seedNo,
        external_no: `SEED-${payload.name}-${seedNo}`, challan_no: `SEED-${payload.name}-${seedNo}`,
        branch_name: payload.name, branch_code: payload.branch_code || payload.name.substring(0, 3).toUpperCase(),
        state_code: sc, movement_type: 'EXTERNAL', status: 'seed', total_bills: 0, total_net_wt: 0, total_amount: 0, created_by: 'SYSTEM_SEED',
      })
      loadTamper()
    }
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
      // Leave genuinely-unset logistics BLANK so ops has to make a deliberate
      // choice — prefilling 24h / Mon–Sat would let a guess become truth on a
      // single Save. (?? not ||, so a real 0h Bangalore TAT isn't clobbered.)
      delivery_tat_hours: b.delivery_tat_hours ?? '',
      pickup_days: b.pickup_days ?? [],
      tamper_next: nextTmpOf(b.name) === '—' ? '' : nextTmpOf(b.name),
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

  // The branch form opens as a focused full-screen sheet (ops sees ONLY the branch
  // they clicked, not an inline block above a 125-row table), so lock the page
  // behind it and let Escape close it.
  useEffect(() => {
    if (!formOpen) return
    const onKey = (e) => { if (e.key === 'Escape') cancelForm() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [formOpen])   // eslint-disable-line react-hooks/exhaustive-deps
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
    label:      { fontSize: '.62rem', color: t.text3, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: '6px', display: 'block', fontWeight: 600 },
    input:      { width: '100%', background: t.bg, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '9px 12px', color: t.text1, fontSize: '.8rem', boxSizing: 'border-box', transition: 'border-color .15s, box-shadow .15s' },
    // Elevated section card (t.card) sits on the recessed editor page (t.bg).
    section:    { background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '22px 24px', marginBottom: '16px', boxShadow: '0 1px 2px rgba(40,28,0,.05), 0 10px 30px rgba(40,28,0,.03)' },
    secHead:    { marginBottom: '20px', paddingBottom: '14px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '12px' },
    secTitle:   { fontSize: '.94rem', fontWeight: 650, color: t.text1, letterSpacing: '.005em' },
    secDesc:    { fontSize: '.68rem', color: t.text4, lineHeight: 1.5 },
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

  // Section header — a gold icon chip + title + one-line description, hairline under.
  const SEC_ICONS = {
    identity:  (<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 13h7"/><circle cx="15.5" cy="9.5" r="1.6"/></>),
    address:   (<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.6"/></>),
    contact:   (<path d="M22 16.9v2.5a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.7 2 2 0 0 1 4.1 2.5h2.5a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.6 10.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>),
    logistics: (<><rect x="1" y="5" width="13" height="11" rx="1"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="6" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></>),
    seal:      (<><path d="M12 3l7 3v5c0 5-3.4 8-7 9-3.6-1-7-4-7-9V6z"/><path d="M9.2 12l2 2 3.6-3.8"/></>),
  }
  const SectionHead = ({ icon, title, desc }) => (
    <div style={s.secHead}>
      <span style={{ width: '32px', height: '32px', borderRadius: '9px', background: `${t.gold}18`, border: `1px solid ${t.gold}33`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={t.gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{SEC_ICONS[icon]}</svg>
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <div style={s.secTitle}>{title}</div>
        {desc && <div style={s.secDesc}>{desc}</div>}
      </div>
    </div>
  )

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
    <div style={{ ...s.wrap, paddingTop: embedded ? '10px' : s.wrap.padding }}>
      <div style={{ ...s.header, marginBottom: embedded ? '12px' : s.header.marginBottom }}>
        {!embedded && (
          <div>
            <div style={s.title}>Branch Management</div>
            <div style={s.sub}>Add, activate, and manage all branches · new branches auto-add daily when they start purchasing</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginLeft: 'auto' }}>
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

      {/* Logistics setup needed — ops must set delivery TAT + pickup days per
          branch. We never guess these: a wrong TAT mis-predicts HO arrival in
          Booking Volume, and missing pickup days hides the branch from the bid
          desk entirely. Click a chip to jump straight into that branch's Edit form. */}
      {logisticsBranches.length > 0 && (
        <div style={{ background: '#e0555510', border: '1px solid #e0555555', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.74rem', color: '#e05555', fontWeight: 700 }}>
              ⚠ {logisticsBranches.length} {logisticsBranches.length === 1 ? 'branch needs' : 'branches need'} logistics setup — delivery TAT &amp; pickup days not set
            </span>
            <button
              onClick={() => setFilterLogistics(f => !f)}
              style={{ background: filterLogistics ? '#e0555522' : 'transparent', border: '1px solid #e0555566', borderRadius: '6px', padding: '4px 12px', fontSize: '.66rem', color: '#e05555', cursor: 'pointer', fontWeight: 700 }}>
              {filterLogistics ? 'Clear filter' : 'View them'}
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
            {logisticsBranches.map(b => (
              <button key={b.id} onClick={() => startEdit(b)}
                title={`Set TAT & pickup days for ${b.name}`}
                style={{ background: '#e0555514', border: '1px solid #e0555544', borderRadius: '20px', padding: '3px 11px', fontSize: '.65rem', color: t.text1, cursor: 'pointer', fontWeight: 600 }}>
                {b.name} <span style={{ color: '#e05555', marginLeft: '3px' }}>↗</span>
              </button>
            ))}
          </div>
          {noPickupTime.length > 0 && (
            <div style={{ fontSize: '.62rem', color: t.text4, marginTop: '9px', borderTop: `1px solid ${t.border}`, paddingTop: '7px' }}>
              {noPickupTime.length} more {noPickupTime.length === 1 ? 'branch has' : 'branches have'} no pickup time — lower priority, it only drives the &quot;at-risk&quot; dispatch flag.
            </div>
          )}
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

      {/* FORM — full-screen editor. Portalled to <body> so it escapes any
          transformed ancestor and covers the TRUE viewport (hides the sidebar,
          the breadcrumb bar and the stuck-bookings banner) — a real "new screen",
          not a box floating inside the content column. */}
      {formOpen && typeof document !== 'undefined' && createPortal((
        <div className="bm-editor" style={{ position: 'fixed', inset: 0, background: t.bg, zIndex: 4000, display: 'flex', flexDirection: 'column' }}>
          <style>{`
            .bm-editor input:focus, .bm-editor select:focus, .bm-editor textarea:focus {
              outline: none; border-color: ${t.gold}; box-shadow: 0 0 0 3px ${t.gold}22;
            }
            .bm-editor input::placeholder, .bm-editor textarea::placeholder { color: ${t.text4}; opacity: 1; }
          `}</style>
          {/* Header bar: back · title · CRM id · close */}
          <div style={{ flexShrink: 0, background: t.card, borderBottom: `1px solid ${t.border}`, padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
              <button onClick={cancelForm} title="Back to branches (Esc)"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '6px 12px', color: t.text2, fontSize: '.72rem', cursor: 'pointer', flexShrink: 0 }}>← Back</button>
              {editId && form.name && (
                <span style={{ width: '34px', height: '34px', borderRadius: '9px', background: `linear-gradient(135deg, ${t.gold}, ${t.gold}bb)`, color: '#1a0a00', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '.72rem', fontWeight: 800, letterSpacing: '.02em', flexShrink: 0 }}>
                  {(form.name.match(/^([A-Za-z]{2})-/)?.[1] || form.name.slice(0, 2)).toUpperCase()}
                </span>
              )}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
                <span style={{ fontSize: '.65rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  {editId ? 'Editing branch' : 'New Branch'}
                </span>
                {editId && <span style={{ fontSize: '1.05rem', fontWeight: 800, color: t.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{form.name}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              {form.crm_branch_id && (
                <span style={{ fontSize: '.65rem', color: t.text3, fontFamily: 'monospace' }}>CRM ID: <span style={{ color: t.gold }}>{form.crm_branch_id}</span></span>
              )}
              <button onClick={cancelForm} title="Close (Esc)"
                style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', width: '30px', height: '30px', color: t.text3, fontSize: '15px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
          </div>
          {/* Scrollable middle — between the header and the footer action bar */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* Centered content column — wide so the form fills the screen */}
          <div style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '28px 32px 32px' }}>
          <div style={s.section}>
          <SectionHead icon="identity" title="Identity & classification" desc="What the branch is called, and where it sits in the state → region → cluster hierarchy." />
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
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: isMobile ? '12px' : '16px', marginTop: '16px' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: isMobile ? '12px' : '16px', marginTop: '16px' }}>
              <div>
                <label style={s.label}>Logistics Pickup Time</label>
                <input style={s.input} placeholder="e.g. Mon/Wed/Fri 4 PM"
                  value={form.pickup_time} onChange={e => setField('pickup_time', e.target.value)} />
                <div style={{ fontSize: '.6rem', color: t.text4, marginTop: '4px' }}>Shown in Branch Stock Overview · free-form text</div>
              </div>
            </div>
          )}
          </div>

          {/* Address */}
          <div style={s.section}>
            <SectionHead icon="address" title="Address" desc="Prints as the branch's dispatch address on the Delivery Challan, Issue Voucher and E-Invoice." />
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
          <div style={s.section}>
            <SectionHead icon="contact" title="Branch contact" desc="Name + phone print on the Delivery Challan / Issue Voucher. Operators can also edit these during Create Consignment — changes there sync back here." />
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

          {/* Logistics — pickup / delivery TAT / days. Bangalore & Kerala are
              rule-based (daily pickup; Bangalore same-day, Kerala next-day 24h). */}
          <div style={s.section}>
            <SectionHead icon="logistics" title="Logistics" desc="Pickup schedule and delivery TAT — drives dispatch timing and whether the branch shows on the bid desk." />
            {(form.region === 'Bangalore' || form.region === 'Kerala') ? (
              <div style={{ fontSize: '.72rem', color: t.text3, background: `${t.gold}0a`, border: `1px solid ${t.gold}30`, borderRadius: '6px', padding: '10px 14px' }}>
                ◷ <strong>Daily pickup</strong> — {form.region === 'Bangalore' ? 'same-day delivery' : 'next-day delivery (24h)'}. Rule-based; {form.region} branches don't set a pickup time or days.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={s.label}>Pickup Time</label>
                  <input type="time" style={s.input} value={form.pickup_time} onChange={e => setField('pickup_time', e.target.value)} />
                </div>
                <div>
                  <label style={s.label}>Delivery TAT</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {[24, 48, 72].map(h => { const on = Number(form.delivery_tat_hours) === h
                      return <button key={h} type="button" onClick={() => setField('delivery_tat_hours', h)}
                        style={{ flex: 1, background: on ? t.gold : 'transparent', color: on ? '#1a0a00' : t.text3, border: `1px solid ${on ? t.gold : t.border}`, borderRadius: '6px', padding: '8px 0', fontSize: '.72rem', fontWeight: on ? 700 : 500, cursor: 'pointer' }}>{h}h</button>
                    })}
                  </div>
                </div>
                <div style={{ gridColumn: isMobile ? 'auto' : '1 / -1' }}>
                  <label style={s.label}>Pickup Days</label>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {WEEK_DAYS.map(d => { const on = (form.pickup_days || []).includes(d)
                      return <button key={d} type="button" title={d} onClick={() => setField('pickup_days', on ? (form.pickup_days || []).filter(x => x !== d) : [...(form.pickup_days || []), d])}
                        style={{ width: '38px', background: on ? `${t.gold}22` : 'transparent', color: on ? t.gold : t.text4, border: `1px solid ${on ? t.gold : t.border}`, borderRadius: '6px', padding: '7px 0', fontSize: '.7rem', fontWeight: 700, cursor: 'pointer' }}>{d[0]}</button>
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Tamper-proof seal — last used (derived) + next (editable → seeds). */}
          <div style={s.section}>
            <SectionHead icon="seal" title="Tamper-proof seal" desc="The tamper-proof number sequence used on this branch's consignments." />
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={s.label}>Last used <span style={{ color: t.text4, fontWeight: 400 }}>(from consignments)</span></label>
                <input style={{ ...s.input, color: t.text3, background: `${t.border}22`, cursor: 'not-allowed' }} value={editId ? fmtTmp(lastTmpOf(form.name)) : '—'} readOnly />
              </div>
              <div>
                <label style={s.label}>Next number <span style={{ color: t.text4, fontWeight: 400 }}>(editable)</span></label>
                <input style={s.input} placeholder="WG000123" value={form.tamper_next} onChange={e => setField('tamper_next', e.target.value.toUpperCase())} />
              </div>
            </div>
            <div style={{ fontSize: '.6rem', color: t.text4, marginTop: '6px' }}>Setting Next writes a seed so the branch's next consignment uses exactly that seal number.</div>
          </div>

          </div>
          </div>
          {/* Footer action bar — anchored at the bottom so a short form leaves no void */}
          <div style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, background: t.card, padding: '12px 32px' }}>
            <div style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button style={s.btnGold} onClick={save} disabled={saving}>
                {saving ? 'Saving...' : editId ? 'Update Branch' : 'Save Branch'}
              </button>
              <button style={s.btnOutline} onClick={cancelForm}>Cancel</button>
              {msg && <span style={{ fontSize: '.72rem', color: msg.includes('success') ? t.green : '#e05555' }}>{msg}</span>}
            </div>
          </div>
        </div>
      ), document.body)}

      {/* STATS */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {[['Total', stats.total, t.text1], ['Active', stats.active, t.green], ['Upcoming', stats.upcoming, '#6b8cce'], ['Inactive', stats.inactive, '#e05555'], ['Regions', stats.regions, t.gold]].map(([label, val, color]) => (
          <div key={label} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 16px', minWidth: '92px' }}>
            <div style={{ fontSize: '1.15rem', fontWeight: 600, color, fontFamily: 'monospace' }}>{val}</div>
            <div style={{ fontSize: '.56rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: '2px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* FILTER BAR */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '.58rem', color: t.text3, textTransform: 'uppercase', letterSpacing: '.08em', marginRight: '2px' }}>Region</span>
          {regions.map(r => {
            const on = selRegions.has(r)
            return <button key={r} onClick={() => toggleRegion(r)} style={{ background: on ? `${t.gold}22` : 'transparent', border: `1px solid ${on ? t.gold : t.border}`, color: on ? t.gold : t.text3, borderRadius: '999px', padding: '4px 11px', fontSize: '.66rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>{r}</button>
          })}
        </div>
        <div style={{ display: 'flex', border: `1px solid ${t.border}`, borderRadius: '6px', overflow: 'hidden' }}>
          {['all', 'active', 'upcoming', 'inactive'].map((v, i, arr) => (
            <button key={v} onClick={() => setStatusFilter(v)} style={{ background: statusFilter === v ? `${t.gold}22` : 'transparent', border: 'none', color: statusFilter === v ? t.gold : t.text3, padding: '5px 12px', fontSize: '.66rem', cursor: 'pointer', textTransform: 'capitalize', borderRight: i !== arr.length - 1 ? `1px solid ${t.border}` : 'none' }}>{v}</button>
          ))}
        </div>

        {/* Multi-select branch picker */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setPickerOpen(o => !o)} style={{ background: selBranches.size ? `${t.gold}22` : 'transparent', border: `1px solid ${selBranches.size ? t.gold : t.border}`, color: selBranches.size ? t.gold : t.text3, borderRadius: '6px', padding: '5px 12px', fontSize: '.66rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {selBranches.size ? `${selBranches.size} branch${selBranches.size > 1 ? 'es' : ''} selected` : 'Select branches'} <span style={{ opacity: .6 }}>▾</span>
          </button>
          {pickerOpen && (
            <>
              <div onClick={() => setPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: '115%', left: 0, zIndex: 50, width: '290px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', boxShadow: '0 12px 34px rgba(0,0,0,.45)', padding: '8px' }}>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                  <input autoFocus value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="Filter branches…" style={{ ...s.input, padding: '5px 8px', fontSize: '.7rem' }} />
                  {selBranches.size > 0 && <button onClick={() => setSelBranches(new Set())} style={{ background: 'transparent', border: `1px solid ${t.border}`, color: t.text3, borderRadius: '5px', padding: '0 9px', fontSize: '.62rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>Clear</button>}
                </div>
                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                  {branches.filter(b => !pickerSearch || b.name.toLowerCase().includes(pickerSearch.toLowerCase())).map(b => (
                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', fontSize: '.72rem', color: t.text1, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selBranches.has(b.name)} onChange={() => toggleBranch(b.name)} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                      {!b.is_active && <span style={{ fontSize: '.54rem', color: t.text4, textTransform: 'uppercase' }}>inactive</span>}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {anyFilter ? <button onClick={clearAllFilters} style={{ background: 'transparent', border: '1px solid #e0555544', color: '#e05555', borderRadius: '6px', padding: '5px 12px', fontSize: '.66rem', fontWeight: 600, cursor: 'pointer' }}>Clear all</button> : null}
      </div>

      {/* SEARCH + EXPORT */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            style={s.search}
            placeholder="🔍  Search name, code, CRM ID, region…"
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
        <span style={{ fontSize: '.7rem', color: t.text3 }}>{anyFilter ? `${filtered.length} of ${branches.length}` : `${branches.length}`} branches</span>
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
              <tr>{[['#', null], ['Branch Name', 'name'], ['CRM ID', null], ['Code', null], ['Address', null], ['State', 'state'], ['Region', 'region'], ['Model', null], ['Status', 'status'], ['Next TMP', null], ['Action', null]].map(([h, key]) =>
                  <th key={h} onClick={key ? () => toggleSort(key) : undefined} style={{ ...s.th, textAlign: h === '#' ? 'center' : 'left', cursor: key ? 'pointer' : 'default', color: key && sortKey === key ? t.gold : t.text3, userSelect: 'none' }}>
                    {h}{key && sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                )}</tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr key={b.id} style={{ background: editId === b.id ? `${t.gold}08` : (!b.state || !b.region || !b.cluster) ? '#c9a84c06' : 'transparent' }}>
                  <td style={{ ...s.td, textAlign: 'center', color: t.text3, fontSize: '.65rem', width: '40px' }}>{i + 1}</td>
                  <td style={{ ...s.td, color: t.gold, fontWeight: 400 }}>
                    {b.name}
                    {isUpcoming(b) && <span style={{ marginLeft: '6px', fontSize: '.58rem', color: '#6b8cce', border: '1px solid #6b8cce55', borderRadius: '3px', padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>upcoming</span>}
                    {isIncomplete(b) && <span style={{ marginLeft: '6px', fontSize: '.58rem', color: t.gold, opacity: .6, border: `1px solid ${t.gold}44`, borderRadius: '3px', padding: '1px 4px' }}>incomplete</span>}
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
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '.68rem', color: nextTmpOf(b.name) === '—' ? t.text4 : t.gold }}>{nextTmpOf(b.name)}</td>
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
                <tr><td colSpan={11} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                  {anyFilter ? 'No branches match the current filters.' : 'No branches yet.'}
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