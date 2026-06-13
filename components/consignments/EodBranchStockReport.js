'use client'

// EOD Branch Stock Report — how much gold was still sitting AT each branch
// at end of day, for any past date. Reads the existing daily snapshot
// (eod_inventory_snapshots, frozen 23:30 IST via cron) and renders ONLY the
// at-branch ('not_moved') slice — the in-transit positions live in the
// standalone EOD Physical Stock Report.
//
// Pick-a-date model: choose any captured date → see every branch's EOD
// branch stock for that day. Branch-only scope, per ops.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'

const fmtWt   = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtINR  = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
const fmtDate = (yyyymmdd) => yyyymmdd
  ? new Date(yyyymmdd + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'

export default function EodBranchStockReport() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const isMobile = useMobile()
  const isAdmin  = ['super_admin', 'founders_office', 'admin'].includes(userProfile?.role)

  const [snapshot,     setSnapshot]     = useState(null)
  const [available,    setAvailable]    = useState([])      // [{ snapshot_date, generated_at }]
  const [selectedDate, setSelectedDate] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [generating,   setGenerating]   = useState(false)
  const [toast,        setToast]        = useState(null)
  const [search,       setSearch]       = useState('')
  const [sortKey,      setSortKey]      = useState('gross_wt')
  const [sortDir,      setSortDir]      = useState(-1)

  const fetchList = useCallback(async () => {
    const res = await authedFetch('/api/eod-inventory-snapshot?list=1')
    const j   = await res.json().catch(() => ({}))
    setAvailable(j.list || [])
    return j.list || []
  }, [])

  const fetchSnapshot = useCallback(async (date) => {
    setLoading(true)
    const url = date ? `/api/eod-inventory-snapshot?date=${date}` : '/api/eod-inventory-snapshot'
    const res = await authedFetch(url)
    if (res.status === 404) { setSnapshot(null); setLoading(false); return }
    const j = await res.json().catch(() => ({}))
    setSnapshot(j.snapshot || null)
    setSelectedDate(j.snapshot?.snapshot_date || date || null)
    setLoading(false)
  }, [])

  useEffect(() => {
    (async () => {
      const list = await fetchList()
      await fetchSnapshot(list[0]?.snapshot_date || null)
    })()
  }, [fetchList, fetchSnapshot])

  const generateNow = async () => {
    setGenerating(true)
    try {
      const res = await authedFetch('/api/eod-inventory-snapshot', { method: 'POST' })
      const j   = await res.json().catch(() => ({}))
      if (!res.ok || j.error) { setToast({ msg: j.error || 'Snapshot failed', type: 'error', key: Date.now() }); return }
      setToast({ msg: 'Today’s snapshot regenerated.', type: 'success', key: Date.now() })
      await fetchList()
      await fetchSnapshot(j.snapshot?.snapshot_date || null)
    } finally { setGenerating(false) }
  }

  // Branch rows = the at-branch ('not_moved') slice only.
  const rows = useMemo(() => {
    const list = snapshot?.not_moved_by_branch || []
    const q = search.trim().toLowerCase()
    return list
      .filter(b => !q || (b.branch_name || '').toLowerCase().includes(q) || (b.region || '').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        let av, bv
        if (sortKey === 'branch_name') { av = a.branch_name || ''; bv = b.branch_name || ''; return av.localeCompare(bv) * sortDir }
        if (sortKey === 'region')      { av = a.region || '';      bv = b.region || '';      return av.localeCompare(bv) * sortDir }
        av = Number(a[sortKey] || 0); bv = Number(b[sortKey] || 0)
        return (av - bv) * sortDir
      })
  }, [snapshot, search, sortKey, sortDir])

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    bills:     acc.bills     + Number(r.bills     || 0),
    gross_wt:  acc.gross_wt  + Number(r.gross_wt  || 0),
    net_wt:    acc.net_wt    + Number(r.net_wt    || 0),
    gross_amt: acc.gross_amt + Number(r.gross_amt || 0),
  }), { bills: 0, gross_wt: 0, net_wt: 0, gross_amt: 0 }), [rows])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => -d)
    else { setSortKey(key); setSortDir(-1) }
  }

  const exportCsv = () => {
    const cols = [
      ['branch_name', 'Branch'],
      ['region',      'Region'],
      ['bills',       'Bills'],
      ['gross_wt',    'Gross Wt (g)'],
      ['net_wt',      'Net Wt (g)'],
      ['gross_amt',   'Gross Amount'],
    ]
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const lines = [cols.map(c => esc(c[1])).join(',')]
    for (const r of rows) lines.push(cols.map(c => esc(r[c[0]])).join(','))
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `EOD_Branch_Stock_${selectedDate || 'latest'}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // ── Styles ──
  const s = {
    wrap:  { display: 'flex', flexDirection: 'column', gap: '14px' },
    title: { fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' },
    sub:   { fontSize: '11px', color: t.text3 },
    card:  { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    select:{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 11px', color: t.text1, fontSize: '12px', cursor: 'pointer', outline: 'none' },
    btnOut:{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 13px', fontSize: '11px', color: t.text3, cursor: 'pointer', fontWeight: 600 },
    btnGold:{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', letterSpacing: '.04em' },
    input: { background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '12px', outline: 'none' },
    th:    (align) => ({ padding: '11px 14px', textAlign: align || 'left', fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }),
    td:    (align) => ({ padding: '10px 14px', textAlign: align || 'left', fontSize: '12px', color: t.text2, whiteSpace: 'nowrap' }),
  }
  const SortIcon = ({ col }) => (
    <span style={{ marginLeft: 4, fontSize: '8px', color: sortKey === col ? t.gold : t.text4 }}>
      {sortKey === col ? (sortDir === -1 ? '↓' : '↑') : '⇅'}
    </span>
  )

  return (
    <div style={s.wrap}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={s.title}>EOD Branch Stock Report</div>
          <div style={{ ...s.sub, marginTop: '3px' }}>
            Gold still at branch at end of day · snapshot frozen 23:30 IST · {selectedDate ? fmtDate(selectedDate) : 'no date'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={selectedDate || ''} onChange={e => fetchSnapshot(e.target.value || null)} style={s.select} disabled={!available.length}>
            {available.length === 0 && <option value="">No snapshots yet</option>}
            {available.map(a => (
              <option key={a.snapshot_date} value={a.snapshot_date}>{fmtDate(a.snapshot_date)}</option>
            ))}
          </select>
          {isAdmin && (
            <button onClick={generateNow} disabled={generating} style={{ ...s.btnGold, opacity: generating ? .6 : 1 }}>
              {generating ? 'Generating…' : 'Generate Now'}
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search branch or region…"
          style={{ ...s.input, flex: 1, minWidth: '220px' }} />
        <span style={{ fontSize: '11px', color: t.text4 }}>{rows.length} branch{rows.length === 1 ? '' : 'es'}</span>
        <button onClick={exportCsv} disabled={!rows.length}
          style={{ ...s.btnOut, color: rows.length ? t.gold : t.text4, borderColor: rows.length ? `${t.gold}50` : t.border }}>
          ↓ CSV
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : !snapshot ? (
        <div style={{ ...s.card, padding: '60px 20px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>
          No snapshot found for this date.{isAdmin ? ' Click “Generate Now” to create one from current data.' : ''}
        </div>
      ) : (
        <div style={{ ...s.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: t.card2 || t.card, borderBottom: `1px solid ${t.border}` }}>
                <th style={s.th('left')}  onClick={() => handleSort('branch_name')}>Branch<SortIcon col="branch_name" /></th>
                <th style={s.th('left')}  onClick={() => handleSort('region')}>Region<SortIcon col="region" /></th>
                <th style={s.th('right')} onClick={() => handleSort('bills')}>Bills<SortIcon col="bills" /></th>
                <th style={s.th('right')} onClick={() => handleSort('gross_wt')}>Gross Wt (g)<SortIcon col="gross_wt" /></th>
                <th style={s.th('right')} onClick={() => handleSort('net_wt')}>Net Wt (g)<SortIcon col="net_wt" /></th>
                <th style={s.th('right')} onClick={() => handleSort('gross_amt')}>Value<SortIcon col="gross_amt" /></th>
              </tr>
              {/* Σ TOTALS */}
              <tr style={{ background: `${t.gold}0c`, borderBottom: `1px solid ${t.gold}40` }}>
                <td style={{ ...s.td('left'), color: t.gold, fontWeight: 700, letterSpacing: '.04em' }}>Σ TOTALS</td>
                <td style={s.td('left')} />
                <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text1, fontWeight: 700 }}>{totals.bills}</td>
                <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text2, fontWeight: 600 }}>{fmtWt(totals.gross_wt)}</td>
                <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.gold,  fontWeight: 700 }}>{fmtWt(totals.net_wt)}</td>
                <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.blue,  fontWeight: 700 }}>{fmtINR(totals.gross_amt)}</td>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ ...s.td('center'), textAlign: 'center', color: t.text4, padding: '48px' }}>
                  {search ? 'No branches match your search' : 'No branch held stock at EOD on this date'}
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.branch_name || i} style={{ borderBottom: `1px solid ${t.border}25`, background: i % 2 ? `${t.card2}30` : 'transparent' }}>
                  <td style={{ ...s.td('left'), color: t.text1, fontWeight: 600 }}>{r.branch_name || '—'}</td>
                  <td style={{ ...s.td('left'), color: t.text3 }}>{r.region || '—'}</td>
                  <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{r.bills || 0}</td>
                  <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text2 }}>{fmtWt(r.gross_wt)}</td>
                  <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtWt(r.net_wt)}</td>
                  <td style={{ ...s.td('right'), fontFamily: 'monospace', color: t.text2 }}>{fmtINR(r.gross_amt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
