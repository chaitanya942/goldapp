'use client'

// EOD Physical Stock Report — daily inventory snapshot in the WGB Inventory
// Report format. Snapshots are frozen at 23:30 IST every day (via cron) so
// historical "what did we have at EOD on this date" queries are stable.
//
// Two views inside the page:
//   Region view — three rollups (Karnataka / Kerala / AP+TS) per section
//                 (Not Moved + In Transit). Matches the WGB report.
//   Branch view — every branch listed; same two sections.
//
// Admin/super_admin can click "Generate Now" to force a refresh of today's
// snapshot (useful for backfills or before the 23:30 cron fires).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmtWt   = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fmtAmt  = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtDate = (yyyymmdd) => yyyymmdd ? new Date(yyyymmdd + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

const REPORT_REGIONS = ['Karnataka', 'Kerala', 'Andhra Pradesh and Telangana']

export default function EodStockReport() {
  const { theme, userProfile } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const isAdmin = ['super_admin', 'founders_office', 'admin'].includes(userProfile?.role)

  const [view,      setView]      = useState('region')   // 'region' | 'branch'
  const [snapshot,  setSnapshot]  = useState(null)
  const [available, setAvailable] = useState([])         // [{ snapshot_date, generated_at }]
  const [selectedDate, setSelectedDate] = useState(null) // YYYY-MM-DD
  const [loading,    setLoading]    = useState(true)
  const [generating, setGenerating] = useState(false)
  const [toast,      setToast]      = useState(null)

  const fetchList = useCallback(async () => {
    const res = await authedFetch('/api/eod-inventory-snapshot?list=1')
    const j   = await res.json()
    setAvailable(j.list || [])
    return j.list || []
  }, [])

  const fetchSnapshot = useCallback(async (date) => {
    setLoading(true)
    const url = date ? `/api/eod-inventory-snapshot?date=${date}` : '/api/eod-inventory-snapshot'
    const res = await authedFetch(url)
    if (res.status === 404) {
      setSnapshot(null)
      setLoading(false)
      return
    }
    const j = await res.json()
    setSnapshot(j.snapshot || null)
    setSelectedDate(j.snapshot?.snapshot_date || null)
    setLoading(false)
  }, [])

  useEffect(() => { (async () => {
    await fetchList()
    await fetchSnapshot(null)   // most recent
  })() }, [fetchList, fetchSnapshot])

  async function generateNow() {
    setGenerating(true)
    try {
      const res = await authedFetch('/api/eod-inventory-snapshot', { method: 'POST' })
      const j   = await res.json()
      if (!res.ok || j.error) {
        setToast({ msg: j.error || 'Generate failed', type: 'error', key: Date.now() })
        return
      }
      setToast({ msg: 'Today’s snapshot regenerated.', type: 'success', key: Date.now() })
      await fetchList()
      await fetchSnapshot(j.snapshot?.snapshot_date || null)
    } finally { setGenerating(false) }
  }

  // ── Derived ──
  const notMovedRegions = useMemo(() => REPORT_REGIONS.map(rg => ({
    region: rg,
    ...(snapshot?.not_moved_by_region?.[rg] || { gross_wt: 0, net_wt: 0, gross_amt: 0, bills: 0 }),
  })), [snapshot])
  const inTransitRegions = useMemo(() => REPORT_REGIONS.map(rg => ({
    region: rg,
    ...(snapshot?.in_transit_by_region?.[rg] || { gross_wt: 0, net_wt: 0, gross_amt: 0, bills: 0 }),
  })), [snapshot])

  // ── Styles ──
  const s = {
    wrap:     { padding: '22px 26px', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' },
    title:    { fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' },
    sub:      { fontSize: '11px', color: t.text3 },
    btnOut:   { background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 14px', fontSize: '11px', color: t.text3, cursor: 'pointer', fontWeight: 600 },
    btnGold:  { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', letterSpacing: '.04em' },
    select:   { background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '8px 12px', color: t.text1, fontSize: '12px', cursor: 'pointer', outline: 'none' },
    pageCard: { background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', overflow: 'hidden' },
  }

  return (
    <div style={s.wrap}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={s.title}>EOD Physical Stock Report</div>
          <div style={{ ...s.sub, marginTop: '4px' }}>
            Daily inventory snapshot frozen at 23:30 IST · branch + in-transit positions
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Date selector */}
          <select
            value={selectedDate || ''}
            onChange={e => fetchSnapshot(e.target.value || null)}
            style={s.select}
            disabled={!available.length}>
            {available.length === 0 && <option value="">No snapshots yet</option>}
            {available.map(s2 => (
              <option key={s2.snapshot_date} value={s2.snapshot_date}>
                {fmtDate(s2.snapshot_date)}
              </option>
            ))}
          </select>
          {isAdmin && (
            <button onClick={generateNow} disabled={generating} style={{ ...s.btnGold, opacity: generating ? .6 : 1 }}>
              {generating ? 'Generating…' : 'Generate Now'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${t.border}` }}>
        {[
          { id: 'region', label: 'Region View' },
          { id: 'branch', label: 'Branch View' },
        ].map(o => {
          const active = view === o.id
          return (
            <button key={o.id} onClick={() => setView(o.id)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '10px 18px', fontSize: '12px', fontWeight: 600,
                color: active ? t.gold : t.text3,
                borderBottom: `2px solid ${active ? t.gold : 'transparent'}`,
                marginBottom: '-1px',
              }}>
              {o.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : !snapshot ? (
        <div style={{ ...s.pageCard, padding: '60px 20px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>
          No snapshot found for this date.{isAdmin ? ' Click "Generate Now" to create one from current data.' : ''}
        </div>
      ) : (
        <ReportTable
          t={t}
          snapshot={snapshot}
          view={view}
          notMovedRegions={notMovedRegions}
          inTransitRegions={inTransitRegions}
        />
      )}
    </div>
  )
}

function ReportTable({ t, snapshot, view, notMovedRegions, inTransitRegions }) {
  const HEADER_BG = '#1f3a6b'   // deep navy from the screenshot
  const HEADER_FG = '#ffffff'
  const SECTION_BG = '#dbe6f4'  // light steel-blue
  const ROW_ZEBRA  = '#e9eef7'

  const card = {
    background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px',
    overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.15)',
  }
  const wrap = { background: '#f4f6fa', padding: '20px', borderRadius: '12px' }
  const titleBar = {
    background: HEADER_BG, color: HEADER_FG,
    padding: '14px 0', textAlign: 'center',
    fontSize: '15px', fontWeight: 700, letterSpacing: '.04em',
  }
  const th = { padding: '12px 18px', background: HEADER_BG, color: HEADER_FG, fontSize: '11px', fontWeight: 700, letterSpacing: '.04em', textAlign: 'left' }
  const thR = { ...th, textAlign: 'right' }
  const td  = { padding: '10px 18px', fontSize: '12px', color: '#1f2c3e' }
  const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace' }
  const sectionTd = { padding: '11px 18px', background: SECTION_BG, color: '#0f2747', fontWeight: 700, fontSize: '12px' }
  const sectionTdR = { ...sectionTd, textAlign: 'right', fontFamily: 'monospace' }

  return (
    <div style={card}>
      <div style={wrap}>
        <div style={{
          background: '#fff', border: '1px solid #c8d3e3', borderRadius: 0, overflow: 'hidden',
        }}>
          <div style={titleBar}>WGB Inventory Report - {fmtDate(snapshot.snapshot_date)}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Summary</th>
                <th style={thR}>Gross Wt</th>
                <th style={thR}>Net Wt</th>
                <th style={thR}>Gross Amount</th>
                <th style={thR}>No. of Bills</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Not Moved ── */}
              <tr>
                <td style={sectionTd}>Gold Stock&nbsp;&nbsp;-&nbsp;&nbsp;Not Moved</td>
                <td style={sectionTdR}>{fmtWt(snapshot.not_moved_total?.gross_wt)}</td>
                <td style={sectionTdR}>{fmtWt(snapshot.not_moved_total?.net_wt)}</td>
                <td style={sectionTdR}>{fmtAmt(snapshot.not_moved_total?.gross_amt)}</td>
                <td style={sectionTdR}>{snapshot.not_moved_total?.bills || 0}</td>
              </tr>
              {view === 'region'
                ? notMovedRegions.map((r, i) => (
                    <tr key={r.region} style={{ background: i % 2 === 0 ? '#fff' : ROW_ZEBRA }}>
                      <td style={{ ...td, paddingLeft: '46px' }}>- {r.region}</td>
                      <td style={tdR}>{fmtWt(r.gross_wt)}</td>
                      <td style={tdR}>{fmtWt(r.net_wt)}</td>
                      <td style={tdR}>{fmtAmt(r.gross_amt)}</td>
                      <td style={tdR}>{r.bills}</td>
                    </tr>
                  ))
                : (snapshot.not_moved_by_branch || []).map((b, i) => (
                    <tr key={`nm-${b.branch_name}`} style={{ background: i % 2 === 0 ? '#fff' : ROW_ZEBRA }}>
                      <td style={{ ...td, paddingLeft: '46px' }}>- {b.branch_name} <span style={{ color: '#5a6b85', fontSize: '11px' }}>· {b.report_region}</span></td>
                      <td style={tdR}>{fmtWt(b.gross_wt)}</td>
                      <td style={tdR}>{fmtWt(b.net_wt)}</td>
                      <td style={tdR}>{fmtAmt(b.gross_amt)}</td>
                      <td style={tdR}>{b.bills}</td>
                    </tr>
                  ))}

              {/* ── In Transit ── */}
              <tr>
                <td style={sectionTd}>Gold Stock - In Transit</td>
                <td style={sectionTdR}>{fmtWt(snapshot.in_transit_total?.gross_wt)}</td>
                <td style={sectionTdR}>{fmtWt(snapshot.in_transit_total?.net_wt)}</td>
                <td style={sectionTdR}>{fmtAmt(snapshot.in_transit_total?.gross_amt)}</td>
                <td style={sectionTdR}>{snapshot.in_transit_total?.bills || 0}</td>
              </tr>
              {view === 'region'
                ? inTransitRegions.map((r, i) => (
                    <tr key={r.region} style={{ background: i % 2 === 0 ? '#fff' : ROW_ZEBRA }}>
                      <td style={{ ...td, paddingLeft: '46px' }}>- {r.region}</td>
                      <td style={tdR}>{fmtWt(r.gross_wt)}</td>
                      <td style={tdR}>{fmtWt(r.net_wt)}</td>
                      <td style={tdR}>{fmtAmt(r.gross_amt)}</td>
                      <td style={tdR}>{r.bills}</td>
                    </tr>
                  ))
                : (snapshot.in_transit_by_branch || []).map((b, i) => (
                    <tr key={`it-${b.branch_name}`} style={{ background: i % 2 === 0 ? '#fff' : ROW_ZEBRA }}>
                      <td style={{ ...td, paddingLeft: '46px' }}>- {b.branch_name} <span style={{ color: '#5a6b85', fontSize: '11px' }}>· {b.report_region}</span></td>
                      <td style={tdR}>{fmtWt(b.gross_wt)}</td>
                      <td style={tdR}>{fmtWt(b.net_wt)}</td>
                      <td style={tdR}>{fmtAmt(b.gross_amt)}</td>
                      <td style={tdR}>{b.bills}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: '12px', fontSize: '10px', color: t.text4, textAlign: 'right' }}>
          Snapshot generated {new Date(snapshot.generated_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          {snapshot.generated_by ? ` · by ${snapshot.generated_by}` : null}
        </div>
      </div>
    </div>
  )
}
