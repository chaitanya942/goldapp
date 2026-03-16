'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0e0e0e', card: '#141414', text1: '#f0e6c8', text2: '#c8b89a', text3: '#7a6a4a', text4: '#4a3a2a', gold: '#c9a84c', border: '#2a2a2a', green: '#3aaa6a', red: '#e05555' },
  light: { bg: '#f5f0e8', card: '#ede8dc', text1: '#2a1f0a', text2: '#6a5a3a', text3: '#8a7a5a', text4: '#b0a080', gold: '#a07830', border: '#d5cfc0', green: '#2a8a5a', red: '#c03030' },
}

const STATUS_COLORS = {
  at_branch:        { color: '#3a8fbf', label: 'At Branch' },
  at_ho:            { color: '#3aaa6a', label: 'At HO' },
  in_consignment:   { color: '#c9981f', label: 'In Transit' },
  sent_for_melting: { color: '#bf5a3a', label: 'Melting' },
  melted:           { color: '#8c5ac8', label: 'Melted' },
  sold:             { color: '#888888', label: 'Sold' },
}

function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const parseRow = (line) => {
    const result = []; let current = ''; let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes }
      else if ((line[i] === ',' || line[i] === '\t') && !inQuotes) { result.push(current.trim()); current = '' }
      else { current += line[i] }
    }
    result.push(current.trim()); return result
  }
  const headers = parseRow(lines[0])
  const get = (row, name) => {
    const idx = headers.findIndex(h => h.replace(/"/g,'').trim().toLowerCase() === name.toLowerCase())
    return idx >= 0 ? (row[idx] || '').replace(/"/g,'').trim() : ''
  }
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const row = parseRow(l)
    const p = (v) => parseFloat(v.replace(/,/g,'')) || 0
    const rawDate = get(row, 'Date')
    let purchaseDate = null
    if (rawDate) { const parts = rawDate.split('-'); if (parts.length === 3) purchaseDate = `${parts[2]}-${parts[1]}-${parts[0]}` }
    return {
      purchase_date: purchaseDate, customer_name: get(row, 'Cust Name') || null,
      phone_number: get(row, 'Mobile Number') || null, branch_name: get(row, 'Branch') || null,
      gross_weight: p(get(row, 'Grs Wt')), stone_weight: p(get(row, 'Stone')), wastage: p(get(row, 'Wastage')),
      net_weight: p(get(row, 'Net Weight')), net_weight_crm: p(get(row, 'Net Weight')), net_weight_calculated: p(get(row, 'Net Weight')),
      purity: p(get(row, 'Purity')), total_amount: p(get(row, 'Total Amount')),
      service_charge_pct: p(get(row, 'Service Charge percentage')),
      service_charge_amount_crm: p(get(row, 'Service Charge Amount')), service_charge_amount_calc: p(get(row, 'Service Charge Amount')),
      final_amount_crm: p(get(row, 'Final Amount')), final_amount_calc: p(get(row, 'Final Amount')),
      transaction_type: get(row, 'Transaction Type') || null, application_id: get(row, 'Application No.') || null,
      stock_status: 'at_branch', net_weight_mismatch: false, service_charge_mismatch: false, final_amount_mismatch: false,
    }
  }).filter(r => r.application_id)
}

// ── EXPORT HELPERS ──────────────────────────────────────────────────────────
const EXPORT_COLS = [
  { key: 'application_id',          label: 'App ID' },
  { key: 'purchase_date',           label: 'Date' },
  { key: 'customer_name',           label: 'Customer' },
  { key: 'phone_number',            label: 'Phone' },
  { key: 'branch_name',             label: 'Branch' },
  { key: 'gross_weight',            label: 'Gross Wt (g)' },
  { key: 'stone_weight',            label: 'Stone (g)' },
  { key: 'wastage',                 label: 'Wastage (g)' },
  { key: 'net_weight',              label: 'Net Wt (g)' },
  { key: 'purity',                  label: 'Purity (%)' },
  { key: 'total_amount',            label: 'Gross Amt (₹)' },
  { key: 'service_charge_pct',      label: 'Svc %' },
  { key: 'service_charge_amount_crm', label: 'Svc Amt (₹)' },
  { key: 'final_amount_crm',        label: 'Final Amt (₹)' },
  { key: 'transaction_type',        label: 'Type' },
  { key: 'stock_status',            label: 'Status' },
  { key: 'is_duplicate',            label: 'Duplicate' },
]

function exportCSV(rows, filename) {
  const header = EXPORT_COLS.map(c => c.label).join(',')
  const body   = rows.map(r =>
    EXPORT_COLS.map(c => {
      const v = r[c.key] ?? ''
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : v
    }).join(',')
  ).join('\n')
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script'); s.src = src
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

async function exportXLSX(rows, filename) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js')
  const data = [
    EXPORT_COLS.map(c => c.label),
    ...rows.map(r => EXPORT_COLS.map(c => r[c.key] ?? ''))
  ]
  const ws = window.XLSX.utils.aoa_to_sheet(data)
  const wb = window.XLSX.utils.book_new()
  window.XLSX.utils.book_append_sheet(wb, ws, 'Purchases')
  window.XLSX.writeFile(wb, filename)
}

export default function PurchaseData() {
  const { theme, user, userProfile } = useApp()
  const t = THEMES[theme]
  const fileInputRef = useRef(null)
  const isSuperAdmin = userProfile?.role === 'super_admin'

  const [purchases, setPurchases]   = useState([])
  const [allBranches, setAllBranches] = useState([])
  const [loading, setLoading]       = useState(false)
  const [exporting, setExporting]   = useState(false)
  const [search, setSearch]         = useState('')
  const [filterStatus, setFilterStatus]       = useState('')
  const [filterBranch, setFilterBranch]       = useState('')
  const [filterDuplicate, setFilterDuplicate] = useState(false)

  const [page, setPage]             = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const PAGE_SIZE = 100

  const [kpis, setKpis] = useState(null)

  const [selectedIds, setSelectedIds]             = useState(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteAllMode, setDeleteAllMode]         = useState(false)
  const [deleting, setDeleting]                   = useState(false)

  const [importState, setImportState]         = useState('idle')
  const [importFile, setImportFile]           = useState(null)
  const [preview, setPreview]                 = useState([])
  const [duplicates, setDuplicates]           = useState(new Set())
  const [unknownBranches, setUnknownBranches] = useState([])
  const [importing, setImporting]             = useState(false)
  const [importResult, setImportResult]       = useState(null)

  useEffect(() => {
    supabase.from('branches').select('name').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setAllBranches(data.map(b => b.name)) })
    loadKpis()
    loadPage(0)
  }, [])

  useEffect(() => { loadPage(page) }, [page, search, filterStatus, filterBranch, filterDuplicate])

  const loadKpis = async () => {
    const { data } = await supabase.rpc('get_purchase_kpis')
    if (data) setKpis(data)
  }

  const buildQuery = (forExport = false) => {
    let q = forExport
      ? supabase.from('purchases').select('*')
      : supabase.from('purchases').select('*', { count: 'exact' })
    if (search)          q = q.or(`customer_name.ilike.%${search}%,application_id.ilike.%${search}%,branch_name.ilike.%${search}%`)
    if (filterStatus)    q = q.eq('stock_status', filterStatus)
    if (filterBranch)    q = q.eq('branch_name', filterBranch)
    if (filterDuplicate) q = q.eq('is_duplicate', true)
    return q
  }

  const loadPage = async (pageNum) => {
    setLoading(true)
    const from = pageNum * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1
    const { data, count } = await buildQuery()
      .order('purchase_date', { ascending: true })
      .range(from, to)
    if (data) setPurchases(data)
    if (count !== null) setTotalCount(count)
    setSelectedIds(new Set())
    setLoading(false)
  }

  const load = () => { setPage(0); loadKpis(); loadPage(0) }

  // ── EXPORT ALL FILTERED ──
  const handleExport = async (format) => {
    setExporting(true)
    try {
      let allRows = []
      let from = 0
      const CHUNK = 1000
      while (true) {
        const { data } = await buildQuery(true)
          .order('purchase_date', { ascending: true })
          .range(from, from + CHUNK - 1)
        if (!data || data.length === 0) break
        allRows = [...allRows, ...data]
        if (data.length < CHUNK) break
        from += CHUNK
      }
      const ts       = new Date().toISOString().slice(0, 10)
      const suffix   = filterBranch ? `_${filterBranch}` : filterDuplicate ? '_duplicates' : ''
      const filename = `purchases${suffix}_${ts}`
      if (format === 'csv')  exportCSV(allRows, `${filename}.csv`)
      if (format === 'xlsx') await exportXLSX(allRows, `${filename}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  const toggleRow = (id) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const toggleAll = () => {
    if (filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(p => p.id)))
  }

  const handleDeleteSelected = async () => {
    setDeleting(true)
    if (deleteAllMode) {
      // Delete ALL records matching current filters, in chunks of 500
      while (true) {
        const { data } = await buildQuery(true).select('id').limit(500)
        if (!data || data.length === 0) break
        const ids = data.map(r => r.id)
        for (let i = 0; i < ids.length; i += 100)
          await supabase.from('purchases').delete().in('id', ids.slice(i, i + 100))
        if (ids.length < 500) break
      }
    } else {
      const ids = [...selectedIds]
      for (let i = 0; i < ids.length; i += 100)
        await supabase.from('purchases').delete().in('id', ids.slice(i, i + 100))
    }
    setShowDeleteConfirm(false); setDeleteAllMode(false); setDeleting(false); load()
  }

  const handleFileSelect = async (file) => {
    if (!file) return
    setImportFile(file)
    const text = await file.text()
    const rows = parseCSV(text)
    const appIds = rows.map(r => r.application_id).filter(Boolean)

    const { data: existing } = await supabase.from('purchases').select('application_id').in('application_id', appIds)
    const existingSet = new Set((existing || []).map(r => r.application_id))
    const seenInFile = new Set(); const dupSet = new Set()
    rows.forEach(r => {
      if (!r.application_id) return
      if (existingSet.has(r.application_id) || seenInFile.has(r.application_id)) dupSet.add(r.application_id)
      seenInFile.add(r.application_id)
    })

    const csvBranches = [...new Set(rows.map(r => r.branch_name).filter(Boolean))]
    const { data: knownBranches } = await supabase.from('branches').select('name').in('name', csvBranches)
    const knownSet = new Set((knownBranches || []).map(b => b.name))
    const unknownList = csvBranches.filter(b => !knownSet.has(b))
    setUnknownBranches(unknownList)

    setDuplicates(dupSet); setPreview(rows); setImportState('preview')
  }

  const confirmImport = async () => {
    setImporting(true)
    const batchId = crypto.randomUUID()
    const now = new Date().toISOString()
    const toInsert = preview.map(r => ({
      ...r, is_duplicate: duplicates.has(r.application_id),
      import_batch_id: batchId, imported_by: user?.id, imported_at: now,
    }))
    const BATCH_SIZE = 100; let inserted = 0, errors = 0
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from('purchases').insert(batch)
      if (error) { errors += batch.length } else { inserted += batch.length }
    }
    await supabase.from('csv_import_logs').insert({
      id: batchId, filename: importFile.name, total_rows: preview.length,
      rows_imported: inserted, rows_rejected: errors,
      status: errors === 0 ? 'success' : 'partial', uploaded_by: user?.id, uploaded_at: now,
    })
    setImportResult({ inserted, errors, duplicates: duplicates.size })
    setImportState('done'); setImporting(false); load()
  }

  const resetImport = () => {
    setImportState('idle'); setImportFile(null)
    setPreview([]); setDuplicates(new Set()); setUnknownBranches([]); setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const fmt     = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  const filtered   = purchases
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))

  const s = {
    wrap:           { padding: '32px', maxWidth: '100%' },
    header:         { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
    title:          { fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' },
    sub:            { fontSize: '.72rem', color: t.text3, marginTop: '4px' },
    btnGold:        { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnOutline:     { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    btnSmall:       { background: 'transparent', color: t.text3, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 14px', fontSize: '.68rem', letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all .15s' },
    btnDanger:      { background: 'transparent', color: t.red, border: `1px solid ${t.red}60`, borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer', transition: 'background .2s' },
    btnDangerSolid: { background: t.red, color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 20px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' },
    card:           { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', marginBottom: '24px' },
    dropzone:       { border: `2px dashed ${t.border}`, borderRadius: '12px', padding: '48px', textAlign: 'center', cursor: 'pointer', marginBottom: '24px' },
    tblWrap:        { overflowX: 'auto', borderRadius: '10px', border: `1px solid ${t.border}` },
    th:             { padding: '10px 14px', fontSize: '.58rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${t.border}`, background: t.card, fontWeight: 400, whiteSpace: 'nowrap' },
    td:             { padding: '10px 14px', fontSize: '.72rem', color: t.text1, borderBottom: `1px solid ${t.border}20`, whiteSpace: 'nowrap' },
    select:         { background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 10px', color: t.text1, fontSize: '.72rem', cursor: 'pointer' },
    input:          { background: t.card, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 14px', color: t.text1, fontSize: '.75rem', outline: 'none', width: '240px' },
    checkbox:       { width: '15px', height: '15px', accentColor: t.gold, cursor: 'pointer' },
  }

  // ── DELETE MODAL ──
  const DeleteModal = () => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: t.card, border: `1px solid ${t.red}40`, borderRadius: '14px', padding: '36px', maxWidth: '420px', width: '90%', boxShadow: `0 0 60px ${t.red}18` }}>
        <div style={{ fontSize: '1.4rem', marginBottom: '12px', textAlign: 'center' }}>⚠</div>
        <div style={{ fontSize: '1rem', color: t.text1, fontWeight: 400, textAlign: 'center', marginBottom: '8px' }}>
          {deleteAllMode
            ? `Delete ALL ${totalCount.toLocaleString('en-IN')} records?`
            : `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'record' : 'records'}?`}
        </div>
        <div style={{ fontSize: '.72rem', color: t.red, textAlign: 'center', marginBottom: '28px', lineHeight: 1.7 }}>
          {deleteAllMode
            ? <>Permanently deletes <strong>ALL {totalCount.toLocaleString('en-IN')}</strong> purchase records{(filterBranch || filterStatus || search) ? ' matching current filters' : ''}.<br />This cannot be undone.</>
            : <>Permanently deletes <strong>{selectedIds.size}</strong> purchase {selectedIds.size === 1 ? 'record' : 'records'}.<br />This cannot be undone.</>
          }
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button style={s.btnOutline} onClick={() => { setShowDeleteConfirm(false); setDeleteAllMode(false) }} disabled={deleting}>Cancel</button>
          <button style={s.btnDangerSolid} onClick={handleDeleteSelected} disabled={deleting}>
            {deleting ? 'Deleting...' : deleteAllMode
              ? `Delete All ${totalCount.toLocaleString('en-IN')} Records`
              : `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'Record' : 'Records'}`}
          </button>
        </div>
      </div>
    </div>
  )

  // ── PREVIEW ──
  if (importState === 'preview') {
    const dupCount      = duplicates.size
    const newCount      = preview.length - preview.filter(r => duplicates.has(r.application_id)).length
    const totalGross    = preview.reduce((s, r) => s + (r.gross_weight || 0), 0)
    const totalNet      = preview.reduce((s, r) => s + (r.net_weight || 0), 0)
    const totalAmount   = preview.reduce((s, r) => s + (r.final_amount_crm || 0), 0)
    const branchCount   = new Set(preview.map(r => r.branch_name).filter(Boolean)).size
    const dates         = preview.map(r => r.purchase_date).filter(Boolean).sort()
    const dateRange     = dates.length ? (dates[0] === dates[dates.length-1] ? fmtDate(dates[0]) : `${fmtDate(dates[0])} — ${fmtDate(dates[dates.length-1])}`) : '—'
    const physicalCount = preview.filter(r => r.transaction_type === 'PHYSICAL').length
    const takeoverCount = preview.filter(r => r.transaction_type === 'TAKEOVER').length

    const previewKpis = [
      { label: 'Total Rows',     value: preview.length,  color: t.gold,    size: '2rem' },
      { label: 'New Records',    value: newCount,        color: t.green,   size: '2rem' },
      { label: 'Duplicates',     value: dupCount,        color: dupCount > 0 ? t.red : t.text3, size: '2rem' },
      { label: 'Branches',       value: branchCount,     color: '#7eb8d4', size: '2rem' },
      { label: 'Total Gross Wt', value: `${totalGross.toLocaleString('en-IN', { maximumFractionDigits: 2 })}g`, color: t.text1, size: '1.4rem' },
      { label: 'Total Net Wt',   value: `${totalNet.toLocaleString('en-IN', { maximumFractionDigits: 2 })}g`,   color: t.gold,  size: '1.4rem' },
      { label: 'Total Value',    value: `₹${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: t.green, size: '1.1rem' },
      { label: 'Physical',       value: physicalCount,   color: '#7eb8d4', size: '2rem' },
      { label: 'Takeover',       value: takeoverCount,   color: '#c9981f', size: '2rem' },
    ]

    return (
      <div style={s.wrap}>
        <div style={s.header}>
          <div>
            <div style={s.title}>Import Preview</div>
            <div style={s.sub}>{importFile?.name} · {preview.length} rows · {dateRange}</div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={s.btnOutline} onClick={resetImport}>← Cancel</button>
            <button style={s.btnGold} onClick={confirmImport} disabled={importing}>{importing ? 'Importing...' : `Import ${preview.length} Rows`}</button>
          </div>
        </div>

        {unknownBranches.length > 0 && (
          <div style={{
            background: `${t.red}10`, border: `1px solid ${t.red}40`,
            borderRadius: '10px', padding: '14px 20px', marginBottom: '20px',
            display: 'flex', gap: '12px', alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: '1.1rem', lineHeight: 1, marginTop: '1px' }}>⚠️</span>
            <div>
              <div style={{ fontSize: '.78rem', color: t.red, fontWeight: 600, marginBottom: '5px' }}>
                {unknownBranches.length} unknown {unknownBranches.length === 1 ? 'branch' : 'branches'} found in this CSV
              </div>
              <div style={{ fontSize: '.72rem', color: t.text2, lineHeight: 1.7 }}>
                The following {unknownBranches.length === 1 ? 'branch is' : 'branches are'} not registered in Branch Management.
                Records will still import but won't be linked to a branch profile:{' '}
                <span style={{ color: t.red, fontWeight: 500 }}>{unknownBranches.join(' · ')}</span>
              </div>
              <div style={{ fontSize: '.65rem', color: t.text3, marginTop: '6px' }}>
                To fix this, add the {unknownBranches.length === 1 ? 'branch' : 'branches'} in Admin → Branch Management before importing.
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '28px' }}>
          {previewKpis.map(c => (
            <div key={c.label} style={{ ...s.card, textAlign: 'center', padding: '18px 16px', marginBottom: 0 }}>
              <div style={{ fontSize: c.size, fontWeight: 200, color: c.color, lineHeight: 1.1 }}>{c.value}</div>
              <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '6px' }}>{c.label}</div>
            </div>
          ))}
        </div>

        <div style={s.tblWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['App ID','Date','Customer','Branch','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Svc Amt','Final Amt','Type','Flag'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {preview.slice(0, 50).map((r, i) => {
                const isUnknownBranch = unknownBranches.includes(r.branch_name)
                return (
                  <tr key={i} style={{ background: duplicates.has(r.application_id) ? `${t.red}08` : 'transparent' }}>
                    <td style={{ ...s.td, color: t.gold }}>{r.application_id || '—'}</td>
                    <td style={s.td}>{fmtDate(r.purchase_date)}</td>
                    <td style={s.td}>{r.customer_name}</td>
                    <td style={{ ...s.td }}>
                      <span style={{ color: isUnknownBranch ? t.red : t.text2 }}>{r.branch_name}</span>
                      {isUnknownBranch && (
                        <span style={{ marginLeft: '6px', fontSize: '.58rem', color: t.red, background: `${t.red}18`, border: `1px solid ${t.red}40`, borderRadius: '3px', padding: '1px 5px' }}>NEW</span>
                      )}
                    </td>
                    <td style={s.td}>{r.gross_weight}g</td><td style={s.td}>{r.stone_weight}g</td>
                    <td style={s.td}>{r.wastage}g</td><td style={s.td}>{r.net_weight}g</td>
                    <td style={s.td}>{r.purity}%</td><td style={s.td}>₹{fmt(r.total_amount)}</td>
                    <td style={s.td}>{r.service_charge_pct}%</td><td style={s.td}>₹{fmt(r.service_charge_amount_crm)}</td>
                    <td style={s.td}>₹{fmt(r.final_amount_crm)}</td>
                    <td style={{ ...s.td, fontSize: '.65rem', color: t.text3 }}>{r.transaction_type}</td>
                    <td style={s.td}>
                      {duplicates.has(r.application_id) && (
                        <span style={{ fontSize: '.6rem', color: t.red, background: `${t.red}18`, border: `1px solid ${t.red}40`, borderRadius: '4px', padding: '2px 6px' }}>DUPLICATE</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {preview.length > 50 && <tr><td colSpan={15} style={{ ...s.td, textAlign: 'center', color: t.text3, padding: '12px' }}>Showing first 50 of {preview.length} rows</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── DONE ──
  if (importState === 'done' && importResult) {
    return (
      <div style={s.wrap}>
        <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '2rem', marginBottom: '16px' }}>✓</div>
          <div style={{ fontSize: '1.2rem', color: t.text1, fontWeight: 300, marginBottom: '8px' }}>Import Complete</div>
          <div style={{ fontSize: '.75rem', color: t.text3, marginBottom: '24px' }}>{importResult.inserted} rows imported · {importResult.duplicates} duplicates flagged · {importResult.errors} errors</div>
          <button style={s.btnGold} onClick={resetImport}>← Back to Purchase Data</button>
        </div>
      </div>
    )
  }

  // ── MAIN VIEW ──
  return (
    <div style={s.wrap}>
      {showDeleteConfirm && <DeleteModal />}

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <div style={s.title}>Purchase Data</div>
          <div style={s.sub}>Import CRM exports and view all purchase records</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {isSuperAdmin && totalCount > 0 && (
            <button style={{ ...s.btnDanger, borderColor: `${t.red}80` }}
              onClick={() => { setDeleteAllMode(true); setShowDeleteConfirm(true) }}
              onMouseEnter={e => { e.currentTarget.style.background = `${t.red}15` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              🗑 Delete All {totalCount.toLocaleString('en-IN')}
            </button>
          )}
          {isSuperAdmin && selectedIds.size > 0 && (
            <button style={s.btnDanger}
              onClick={() => { setDeleteAllMode(false); setShowDeleteConfirm(true) }}
              onMouseEnter={e => { e.currentTarget.style.background = `${t.red}15` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              🗑 Delete {selectedIds.size} Selected
            </button>
          )}
          <button style={s.btnGold} onClick={() => fileInputRef.current?.click()}>↑ Import CSV</button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFileSelect(e.target.files[0])} />

      {/* KPI CARDS */}
      {kpis && (() => {
        const dateRange = kpis.min_date
          ? (kpis.min_date === kpis.max_date ? fmtDate(kpis.min_date) : `${fmtDate(kpis.min_date)} — ${fmtDate(kpis.max_date)}`)
          : '—'
        const cards = [
          { label: 'Total Records',  value: Number(kpis.total_count).toLocaleString('en-IN'),                                                     color: t.gold,    size: '1.8rem', clickable: false },
          { label: 'Date Range',     value: dateRange,                                                                                            color: t.text2,   size: '.85rem', clickable: false },
          { label: 'Duplicates',     value: Number(kpis.dup_count),                                                                               color: kpis.dup_count > 0 ? t.red : t.text3, size: '1.8rem', clickable: true },
          { label: 'Branches',       value: Number(kpis.branch_count),                                                                            color: '#7eb8d4', size: '1.8rem', clickable: false },
          { label: 'Total Gross Wt', value: `${Number(kpis.total_gross).toLocaleString('en-IN', { maximumFractionDigits: 2 })}g`,                 color: t.text1,   size: '1.2rem', clickable: false },
          { label: 'Total Net Wt',   value: `${Number(kpis.total_net).toLocaleString('en-IN', { maximumFractionDigits: 2 })}g`,                   color: t.gold,    size: '1.2rem', clickable: false },
          { label: 'Total Value',    value: `₹${Number(kpis.total_value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,                 color: t.green,   size: '1rem',   clickable: false },
          { label: 'Physical',       value: Number(kpis.physical_count).toLocaleString('en-IN'),                                                  color: '#7eb8d4', size: '1.8rem', clickable: false },
          { label: 'Takeover',       value: Number(kpis.takeover_count).toLocaleString('en-IN'),                                                  color: '#c9981f', size: '1.8rem', clickable: false },
        ]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '28px' }}>
            {cards.map(c => (
              <div key={c.label}
                onClick={c.clickable ? () => { setFilterDuplicate(f => !f); setPage(0) } : undefined}
                style={{
                  ...s.card, textAlign: 'center', padding: '20px 16px', marginBottom: 0,
                  cursor: c.clickable ? 'pointer' : 'default',
                  outline: c.label === 'Duplicates' && filterDuplicate ? `2px solid ${t.red}` : 'none',
                  boxShadow: c.label === 'Duplicates' && filterDuplicate ? `0 0 20px ${t.red}22` : 'none',
                  transition: 'outline .15s, box-shadow .15s',
                }}>
                <div style={{ fontSize: c.size, fontWeight: 200, color: c.color, lineHeight: 1.15 }}>{c.value}</div>
                <div style={{ fontSize: '.6rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '6px' }}>
                  {c.label}{c.label === 'Duplicates' && filterDuplicate ? ' — FILTERED ✕' : ''}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* DROPZONE */}
      {purchases.length === 0 && !loading && !filterDuplicate && (
        <div style={s.dropzone} onClick={() => fileInputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]) }}>
          <div style={{ fontSize: '2rem', color: t.text3, marginBottom: '12px' }}>⬡</div>
          <div style={{ fontSize: '.88rem', color: t.text1, marginBottom: '6px' }}>Drop your CRM CSV here, or click to browse</div>
          <div style={{ fontSize: '.72rem', color: t.text3 }}>Exports from the White Gold CRM</div>
        </div>
      )}

      {/* FILTERS + TABLE */}
      {(purchases.length > 0 || filterDuplicate) && (
        <>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={s.input} placeholder="Search customer, app ID, branch..." value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />

            <select style={s.select} value={filterBranch} onChange={e => { setFilterBranch(e.target.value); setPage(0) }}>
              <option value="">All Branches</option>
              {allBranches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            <select style={s.select} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0) }}>
              <option value="">All Status</option>
              {Object.entries(STATUS_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>

            {filterDuplicate && (
              <div onClick={() => { setFilterDuplicate(false); setPage(0) }} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', borderRadius: '20px',
                background: `${t.red}18`, border: `1px solid ${t.red}50`,
                color: t.red, fontSize: '.68rem', fontWeight: 600,
                cursor: 'pointer', letterSpacing: '.04em',
              }}>● Duplicates Only &nbsp;✕</div>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button style={s.btnSmall} disabled={exporting} onClick={() => handleExport('csv')}
                onMouseEnter={e => { e.currentTarget.style.color = t.gold; e.currentTarget.style.borderColor = `${t.gold}60` }}
                onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.borderColor = t.border }}>
                {exporting ? '...' : '↓ CSV'}
              </button>
              <button style={s.btnSmall} disabled={exporting} onClick={() => handleExport('xlsx')}
                onMouseEnter={e => { e.currentTarget.style.color = t.gold; e.currentTarget.style.borderColor = `${t.gold}60` }}
                onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.borderColor = t.border }}>
                {exporting ? '...' : '↓ Excel'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginBottom: '12px', fontSize: '.7rem', color: t.text3 }}>
            {selectedIds.size > 0 && <span style={{ color: t.gold }}>{selectedIds.size} selected</span>}
            <span>Showing {totalCount === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString('en-IN')} of {totalCount.toLocaleString('en-IN')} records</span>
            <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: page === 0 ? t.text4 : t.text2, cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: '.7rem' }}>←</button>
              <span>Page {page + 1} of {totalPages || 1}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '3px 10px', color: page >= totalPages - 1 ? t.text4 : t.text2, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', fontSize: '.7rem' }}>→</button>
            </span>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', color: t.text3, padding: '48px' }}>Loading...</div>
          ) : (
            <div style={s.tblWrap}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {isSuperAdmin && (
                      <th style={{ ...s.th, width: '40px', textAlign: 'center' }}>
                        <input type="checkbox" style={s.checkbox} checked={allFilteredSelected} onChange={toggleAll} />
                      </th>
                    )}
                    {['App ID','Date','Customer','Phone','Branch','Gross Wt','Stone','Wastage','Net Wt','Purity','Gross Amt','Svc%','Svc Amt','Final Amt','Type','Status','Flag'].map(h =>
                      <th key={h} style={s.th}>{h}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const status     = STATUS_COLORS[p.stock_status] || { color: t.text3, label: p.stock_status }
                    const isSelected = selectedIds.has(p.id)
                    return (
                      <tr key={p.id} style={{
                        background: isSelected ? `${t.gold}12` : p.is_duplicate ? `${t.red}06` : 'transparent',
                        outline: isSelected ? `1px solid ${t.gold}30` : 'none',
                      }}>
                        {isSuperAdmin && (
                          <td style={{ ...s.td, textAlign: 'center', padding: '10px 8px' }}>
                            <input type="checkbox" style={s.checkbox} checked={isSelected} onChange={() => toggleRow(p.id)} />
                          </td>
                        )}
                        <td style={{ ...s.td, color: t.gold, fontWeight: 500 }}>{p.application_id}</td>
                        <td style={s.td}>{fmtDate(p.purchase_date)}</td>
                        <td style={s.td}>{p.customer_name}</td>
                        <td style={{ ...s.td, color: t.text3 }}>{p.phone_number}</td>
                        <td style={{ ...s.td, color: t.text2 }}>{p.branch_name}</td>
                        <td style={s.td}>{p.gross_weight}g</td>
                        <td style={s.td}>{p.stone_weight}g</td>
                        <td style={s.td}>{p.wastage}g</td>
                        <td style={s.td}>{p.net_weight}g</td>
                        <td style={s.td}>{p.purity}%</td>
                        <td style={s.td}>₹{fmt(p.total_amount)}</td>
                        <td style={s.td}>{p.service_charge_pct}%</td>
                        <td style={s.td}>₹{fmt(p.service_charge_amount_crm)}</td>
                        <td style={{ ...s.td, fontWeight: 500 }}>₹{fmt(p.final_amount_crm)}</td>
                        <td style={{ ...s.td, fontSize: '.65rem', color: t.text3 }}>{p.transaction_type}</td>
                        <td style={s.td}>
                          <span style={{ fontSize: '.62rem', color: status.color, background: `${status.color}18`, border: `1px solid ${status.color}40`, borderRadius: '4px', padding: '2px 7px', whiteSpace: 'nowrap' }}>{status.label}</span>
                        </td>
                        <td style={s.td}>
                          {p.is_duplicate && <span style={{ fontSize: '.6rem', color: t.red, background: `${t.red}18`, border: `1px solid ${t.red}40`, borderRadius: '4px', padding: '2px 6px' }}>DUP</span>}
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={isSuperAdmin ? 18 : 17} style={{ ...s.td, textAlign: 'center', color: t.text4, padding: '48px' }}>
                      {filterDuplicate ? 'No duplicate records found' : search || filterStatus || filterBranch ? 'No records match your filters' : 'No purchases yet'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}