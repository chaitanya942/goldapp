'use client'

// Audit Data — blind-audit workflow for HO intake.
//
// Two-level drill-down:
//   Level 0  Branch cards (Outstation in-transit + Bangalore pending).
//            Each card surfaces bill count + oldest-age + discrepancy chips.
//            No weights, no values anywhere.
//   Level 1  Bills from the selected branch as cards (not a table) so each
//            bill has breathing room. Outstation bills stay grouped under
//            their TMP_PRF header for visual structure.
//
// Blind audit modal: auditor types the measured gross weight and hits Submit.
// CRM gross is NEVER revealed pre-submission. The POST response either:
//   - flips stock_status to at_ho on exact match (auto-receive, modal closes), or
//   - returns 400 with crm_gross + diff so the modal can flip into "discrepancy
//     resolution" mode (3-tile comparison + remark + accept/keep-pending).

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'
import { authedFetch } from '../../lib/authedFetch'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

const fmtWt   = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

function ageBadge(d, t) {
  if (!d) return { label: '—', color: t.text4, bg: 'transparent' }
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 0) return { label: 'just now', color: t.text3, bg: `${t.text3}10` }
  const days = Math.floor(ms / 86400000)
  let label
  if (days >= 1) label = `${days}d old`
  else {
    const hrs = Math.floor(ms / 3600000)
    if (hrs >= 1) label = `${hrs}h old`
    else { const mins = Math.max(1, Math.floor(ms / 60000)); label = `${mins}m old` }
  }
  // Only colour-flag genuinely-stale dispatches. Everything < 3 days is
  // normal pace and should read as neutral so the colour-flagged ones
  // (3-7d orange, 7d+ red) actually grab the eye.
  let color
  if (days < 3)      color = t.text3
  else if (days < 7) color = t.orange
  else               color = t.red
  return { label, color, bg: `${color}15` }
}

// Parse a YYYY-MM-DD string into a midnight Date in local time. The audit
// view receives calendar dates (not instants) from the API so all the arrival
// math is timezone-agnostic.
function parseYmd(ymd) {
  if (!ymd || typeof ymd !== 'string') return null
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// Format the next expected arrival into a Today/Tomorrow/specific-date label
// so the auditor can plan their day at a glance. Sundays are excluded
// upstream (server uses addWorkingDaysSkipSunday) — this function just
// renders. Returns null if no date is set.
function arrivalLabel(ymd, t) {
  const arrival = parseYmd(ymd)
  if (!arrival) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((arrival.getTime() - today.getTime()) / 86400000)

  let label, color
  if (diff < 0)      { label = `Overdue ${Math.abs(diff)}d`;  color = t.red }
  else if (diff === 0) { label = 'Today';                       color = t.gold }
  else if (diff === 1) { label = 'Tomorrow';                    color = t.green }
  else                 { label = arrival.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); color = t.text2 }
  return { label, color, bg: `${color}15`, diff }
}

// Short-form dispatch date for the card secondary line ("Dispatched: 30 May").
function fmtShortDate(ymd) {
  const d = parseYmd(ymd)
  if (!d) return null
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function oldestAge(items, dateField) {
  if (!items.length) return null
  return items.reduce((min, b) => {
    const d = b[dateField] ? new Date(b[dateField]).getTime() : Infinity
    return d < min ? d : min
  }, Infinity)
}

// Earliest expected arrival across a branch's consignments — drives the
// "Today / Tomorrow / 3 Jun" pill on each branch card. Returns a YYYY-MM-DD
// string (the API ships calendar dates, not instants — Sundays excluded
// upstream).
function earliestArrival(consignments) {
  if (!consignments?.length) return null
  let earliest = null
  for (const c of consignments) {
    if (!c?.expected_arrival_date) continue
    const d = parseYmd(c.expected_arrival_date)
    if (!d) continue
    if (earliest === null || d.getTime() < earliest.getTime()) earliest = d
  }
  if (!earliest) return null
  return `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-${String(earliest.getDate()).padStart(2, '0')}`
}

// Latest dispatch date across a branch's consignments — shown as the
// secondary line on each card so the auditor knows when the truck(s) left.
function latestDispatchDate(consignments) {
  if (!consignments?.length) return null
  let latest = null
  for (const c of consignments) {
    if (!c?.dispatched_date) continue
    const d = parseYmd(c.dispatched_date)
    if (!d) continue
    if (latest === null || d.getTime() > latest.getTime()) latest = d
  }
  if (!latest) return null
  return `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, '0')}-${String(latest.getDate()).padStart(2, '0')}`
}

// Match a query against a branch's full payload (branch name + every bill's
// app_id / customer / consignment numbers). Case-insensitive, all-tokens-AND.
// Returns true if every whitespace-separated token in q matches SOMETHING in
// the branch's bills/consignments. Empty query matches everything.
function matchesQuery(branch, q) {
  const query = (q || '').trim().toLowerCase()
  if (!query) return true
  const tokens = query.split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const haystack = []
  haystack.push(String(branch.branch || '').toLowerCase())
  for (const c of branch.consignments || []) {
    if (c?.tmp_prf_no)     haystack.push(String(c.tmp_prf_no).toLowerCase())
    if (c?.consignment_no) haystack.push(String(c.consignment_no).toLowerCase())
    if (c?.challan_no)     haystack.push(String(c.challan_no).toLowerCase())
  }
  for (const b of branch.bills || []) {
    if (b?.application_id) haystack.push(String(b.application_id).toLowerCase())
    if (b?.customer_name)  haystack.push(String(b.customer_name).toLowerCase())
    if (b?.branch_name)    haystack.push(String(b.branch_name).toLowerCase())
  }
  const blob = haystack.join(' | ')
  return tokens.every(tok => blob.includes(tok))
}

export default function CollectionAudit() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark

  const [loading,    setLoading]    = useState(true)
  const [bangalore,  setBangalore]  = useState([])
  const [outstation, setOutstation] = useState([])
  const [activeBill, setActiveBill] = useState(null)
  const [drillBranch, setDrillBranch] = useState(null)   // { name, pool } | null
  const [toast,      setToast]      = useState(null)
  const [search,     setSearch]     = useState('')
  // Arrival filter: 'all' | 'today' | 'overdue'. Layered on top of search;
  // matches the arrivalLabel.diff buckets we already compute per card.
  const [arrivalFilter, setArrivalFilter] = useState('all')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const res = await authedFetch('/api/collection-audit')
    const j   = await res.json()
    if (!res.ok || j.error) {
      setToast({ msg: j.error || 'Failed to load audit queue', type: 'error', key: Date.now() })
      setLoading(false)
      return
    }
    setBangalore(j.bangalore || [])
    setOutstation(j.outstation || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Aggregate bills by the BILL'S source branch (the leaf), not by the
  // consignment's source branch (which for Hub → HO bundles equals the hub
  // name and would merge every leaf under one card).
  //
  // For direct Branch → HO consignments these are the same value. For
  // Hub → HO (Bangalore hub dispatches, KL hub → HO runs), each leaf's
  // bills get their own card so the auditor sees BTM, JAYANAGAR, BOMMANAHALLI
  // as separate rows even though the bills travelled together on a single
  // K R PURAM → HO truck. The parent consignment still drives the
  // dispatched / arrives dates per card (latest dispatch + earliest arrival
  // across all consignments touching this leaf) and is dedupped via a Set
  // so the "N consignments" badge is correct.
  const outstationByBranch = useMemo(() => {
    const m = new Map()
    for (const g of outstation) {
      for (const bill of g.bills) {
        const k = bill.branch_name || g.consignment?.branch_name || '—'
        if (!m.has(k)) m.set(k, { branch: k, region: bill.region || 'Unknown', consignmentSet: new Map(), bills: [] })
        const entry = m.get(k)
        if (g.consignment && !entry.consignmentSet.has(g.consignment.id)) {
          entry.consignmentSet.set(g.consignment.id, g.consignment)
        }
        entry.bills.push({ ...bill, _consignment: g.consignment })
      }
    }
    return [...m.values()]
      .map(e => ({ branch: e.branch, region: e.region, consignments: [...e.consignmentSet.values()], bills: e.bills }))
      .sort((a, b) => (oldestAge(a.consignments, 'dispatched_at') ?? Infinity) - (oldestAge(b.consignments, 'dispatched_at') ?? Infinity))
  }, [outstation])

  const bangaloreByBranch = useMemo(() => {
    const m = new Map()
    for (const b of bangalore) {
      const k = b.branch_name || '—'
      if (!m.has(k)) m.set(k, { branch: k, bills: [] })
      m.get(k).bills.push(b)
    }
    return [...m.values()].sort((a, b) => (oldestAge(a.bills, 'purchase_date') ?? Infinity) - (oldestAge(b.bills, 'purchase_date') ?? Infinity))
  }, [bangalore])

  // Search applies AT branch-pool level: filters which branch cards render.
  // matchesQuery is all-tokens-AND across branch name + bill + consignment
  // fields, so an auditor can paste a tamper-proof number / app id / customer
  // name and the right branch surfaces immediately. Empty query passes all.
  // Arrival filter (today / overdue) is layered on top.
  const arrivalBucket = useCallback((branch) => {
    const arr = arrivalLabel(earliestArrival(branch.consignments || []), t)
    if (!arr) return null
    if (arr.diff < 0)  return 'overdue'
    if (arr.diff === 0) return 'today'
    if (arr.diff === 1) return 'tomorrow'
    return 'future'
  }, [t])
  const applyArrivalFilter = useCallback((list) => {
    if (arrivalFilter === 'all') return list
    return list.filter(b => arrivalBucket(b) === arrivalFilter)
  }, [arrivalFilter, arrivalBucket])

  const filteredOutstationByBranch = useMemo(
    () => applyArrivalFilter(outstationByBranch.filter(b => matchesQuery(b, search))),
    [outstationByBranch, search, applyArrivalFilter],
  )
  const filteredBangaloreByBranch = useMemo(
    () => bangaloreByBranch.filter(b => matchesQuery(b, search)),
    [bangaloreByBranch, search],
  )

  // Group outstation cards by region for section headers. Region comes from
  // the bill's source branch (enriched server-side) so leaf cards land under
  // the correct region even when their parent consignment was issued from
  // a hub in the same region. Preserve a custom ordering (Bangalore first,
  // Rest of Karnataka second, then alphabetical) so the layout stays
  // predictable across days.
  const outstationByRegion = useMemo(() => {
    const REGION_ORDER = ['Bangalore', 'Rest of Karnataka', 'Kerala', 'Tamil Nadu', 'Andhra Pradesh', 'Telangana']
    const m = new Map()
    for (const b of filteredOutstationByBranch) {
      const r = b.region || 'Unknown'
      if (!m.has(r)) m.set(r, [])
      m.get(r).push(b)
    }
    const keys = [...m.keys()]
    keys.sort((a, b) => {
      const ai = REGION_ORDER.indexOf(a); const bi = REGION_ORDER.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
    return keys.map(r => ({ region: r, branches: m.get(r) }))
  }, [filteredOutstationByBranch])

  // Bucket counts for the filter chips — show how many branches fall into
  // each arrival window so the auditor knows the size of the wave before
  // they click.
  const arrivalCounts = useMemo(() => {
    const base = outstationByBranch.filter(b => matchesQuery(b, search))
    const out = { all: base.length, today: 0, tomorrow: 0, overdue: 0 }
    for (const b of base) {
      const bucket = arrivalBucket(b)
      if (bucket === 'today' || bucket === 'tomorrow' || bucket === 'overdue') out[bucket] += 1
    }
    return out
  }, [outstationByBranch, search, arrivalBucket])

  const kpis = {
    outstationBranches: filteredOutstationByBranch.length,
    outstationBills:    filteredOutstationByBranch.reduce((s, b) => s + b.bills.length, 0),
    bangaloreBranches:  filteredBangaloreByBranch.length,
    bangaloreBills:     filteredBangaloreByBranch.reduce((s, b) => s + b.bills.length, 0),
    discrepancies:      [...filteredBangaloreByBranch.flatMap(g => g.bills), ...filteredOutstationByBranch.flatMap(g => g.bills)].filter(b => b.audit_gross_weight != null).length,
  }
  const totalBills    = kpis.outstationBills + kpis.bangaloreBills
  const totalBranches = kpis.outstationBranches + kpis.bangaloreBranches
  const hasSearchActive = (search || '').trim().length > 0

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* ── Page-scoped keyframes for the animation suite. Kept inline so it
            travels with the component instead of leaking into globals. ── */}
      <style>{`
        @keyframes caAuditFadeIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes caAuditShimmer {
          0%   { background-position: -300% 0; }
          100% { background-position: 300% 0; }
        }
        @keyframes caAuditUrgentPulse {
          0%, 100% { box-shadow: 0 0 0 0 currentColor; }
          50%      { box-shadow: 0 0 0 4px transparent; }
        }
        @keyframes caAuditSpin {
          to { transform: rotate(360deg); }
        }
        .ca-card-enter {
          animation: caAuditFadeIn .4s cubic-bezier(.34,1.56,.64,1) backwards;
        }
        .ca-urgent-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: currentColor;
          animation: caAuditUrgentPulse 1.8s ease-in-out infinite;
        }
        .ca-refresh-icon { display: inline-block; transition: transform .4s ease; }
        .ca-refresh:hover .ca-refresh-icon { animation: caAuditSpin .6s linear; }
      `}</style>

      {/* ─── Hero header ─── */}
      <div style={{
        background:  `linear-gradient(135deg, ${t.card} 0%, ${t.card2 || t.card} 100%)`,
        border:      `1px solid ${t.border}`,
        borderRadius: '16px',
        padding:     '22px 26px',
        display:     'flex',
        flexDirection: 'column',
        gap:         '18px',
        position:    'relative',
        overflow:    'hidden',
        boxShadow:   `0 1px 3px ${t.border}40`,
      }}>
        {/* Subtle gold sheen (gradient ellipse) + animated shimmer line */}
        <div style={{ position: 'absolute', top: '-50%', right: '-10%', width: '50%', height: '200%', background: `radial-gradient(ellipse at center, ${t.gold}10 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
          background: `linear-gradient(90deg, transparent, ${t.gold}80, transparent)`,
          backgroundSize: '200% 100%',
          animation: 'caAuditShimmer 4s linear infinite',
          opacity: 0.5,
          pointerEvents: 'none',
        }} />

        {/* Row 1: title + stats + refresh */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '20px', flexWrap: 'wrap', zIndex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <div style={{
              width: '54px', height: '54px', borderRadius: '14px',
              background: `linear-gradient(135deg, ${t.gold}25, ${t.gold}10)`,
              border:     `1px solid ${t.gold}40`,
              display:    'flex', alignItems: 'center', justifyContent: 'center',
              fontSize:   '26px',
            }}>
              ⚖
            </div>
            <div>
              <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em', lineHeight: 1.1 }}>Audit Data</div>
              <div style={{ fontSize: '12px', color: t.text3, marginTop: '6px', maxWidth: '520px' }}>
                Drill into a branch, weigh each inbound bill, and match it against the CRM gross — without seeing the CRM number first.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <HeroStat t={t} label={hasSearchActive ? 'Matching bills' : 'Total bills'} value={totalBills} color={t.gold} />
            <HeroStat t={t} label="Branches"    value={totalBranches} color={t.text2} />
            {kpis.discrepancies > 0 && <HeroStat t={t} label="Discrepancies" value={kpis.discrepancies} color={t.red} />}
            <button onClick={fetchAll}
              title="Reload pending audits"
              className="ca-refresh"
              style={{
                background: 'transparent',
                border: `1px solid ${t.border}`,
                borderRadius: '10px',
                padding: '9px 16px',
                fontSize: '11px',
                color: t.text3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'color .2s ease, border-color .2s ease, background .2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = t.gold; e.currentTarget.style.borderColor = `${t.gold}60`; e.currentTarget.style.background = `${t.gold}08` }}
              onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.borderColor = t.border; e.currentTarget.style.background = 'transparent' }}>
              <span className="ca-refresh-icon">⟳</span> Refresh
            </button>
          </div>
        </div>

        {/* Row 2: search box, full-width */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <span style={{
            position: 'absolute', top: '50%', left: '14px', transform: 'translateY(-50%)',
            fontSize: '14px', color: t.text4, pointerEvents: 'none',
          }}>⌕</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by tamper-proof, branch, customer, application ID…"
            style={{
              width: '100%',
              background: t.card2 || t.card,
              border: `1px solid ${hasSearchActive ? `${t.gold}60` : t.border}`,
              borderRadius: '11px',
              padding: '11px 42px 11px 38px',
              fontSize: '13px',
              color: t.text1,
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color .15s ease, box-shadow .15s ease',
              boxShadow: hasSearchActive ? `0 0 0 3px ${t.gold}15` : 'none',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = `${t.gold}80`; e.currentTarget.style.boxShadow = `0 0 0 3px ${t.gold}20` }}
            onBlur={e => { e.currentTarget.style.borderColor = hasSearchActive ? `${t.gold}60` : t.border; e.currentTarget.style.boxShadow = hasSearchActive ? `0 0 0 3px ${t.gold}15` : 'none' }}
          />
          {hasSearchActive && (
            <button onClick={() => setSearch('')}
              title="Clear search"
              style={{
                position: 'absolute', top: '50%', right: '10px', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', color: t.text3, cursor: 'pointer',
                fontSize: '14px', padding: '6px 10px', borderRadius: '6px',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${t.gold}15`; e.currentTarget.style.color = t.gold }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.text3 }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '120px', textAlign: 'center' }}><GoldSpinner /></div>
      ) : drillBranch ? (
        <BranchDrilldown
          drill={drillBranch}
          outstationByBranch={outstationByBranch}
          bangaloreByBranch={bangaloreByBranch}
          t={t}
          onBack={() => setDrillBranch(null)}
          onAudit={(bill) => setActiveBill(bill)}
        />
      ) : (
        <>
          {/* Arrival filter chips — show counts inline so the auditor knows
              the size of each bucket before clicking. Today + Overdue carry
              a pulsing accent dot when non-zero to attract the eye. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
            padding: '4px 2px', margin: '-4px 0 -8px',
          }}>
            <span style={{ fontSize: '10px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginRight: '4px' }}>Filter</span>
            {[
              { id: 'all',      label: 'All arrivals',  count: arrivalCounts.all,      color: t.text2, attract: false },
              { id: 'today',    label: 'Arriving today',count: arrivalCounts.today,    color: t.gold,  attract: true },
              { id: 'tomorrow', label: 'Tomorrow',      count: arrivalCounts.tomorrow, color: t.green, attract: false },
              { id: 'overdue',  label: 'Overdue',       count: arrivalCounts.overdue,  color: t.red,   attract: true },
            ].map(chip => {
              const active = arrivalFilter === chip.id
              const dim    = chip.count === 0 && !active
              const showDot = chip.attract && chip.count > 0 && !active
              return (
                <button key={chip.id} onClick={() => setArrivalFilter(chip.id)} disabled={dim}
                  style={{
                    background: active ? `${chip.color}18` : 'transparent',
                    border: `1px solid ${active ? `${chip.color}80` : t.border}`,
                    borderRadius: '999px',
                    padding: '6px 14px',
                    fontSize: '11px',
                    color: dim ? t.text4 : (active ? chip.color : t.text2),
                    cursor: dim ? 'default' : 'pointer',
                    fontWeight: active ? 700 : 500,
                    display: 'inline-flex', alignItems: 'center', gap: '7px',
                    transition: 'transform .18s cubic-bezier(.34,1.56,.64,1), color .15s ease, background .15s ease, border-color .15s ease, box-shadow .2s ease',
                    opacity: dim ? 0.4 : 1,
                    boxShadow: active ? `0 0 0 4px ${chip.color}12, 0 2px 6px ${chip.color}25` : 'none',
                    transform: 'translateY(0)',
                  }}
                  onMouseEnter={e => {
                    if (active || dim) return
                    e.currentTarget.style.borderColor = `${chip.color}60`
                    e.currentTarget.style.color       = chip.color
                    e.currentTarget.style.transform   = 'translateY(-1px)'
                  }}
                  onMouseLeave={e => {
                    if (active || dim) return
                    e.currentTarget.style.borderColor = t.border
                    e.currentTarget.style.color       = t.text2
                    e.currentTarget.style.transform   = 'translateY(0)'
                  }}>
                  {showDot && <span className="ca-urgent-dot" style={{ color: chip.color }} />}
                  {chip.label}
                  <span style={{
                    fontSize: '10px',
                    color: active ? chip.color : t.text4,
                    background: active ? `${chip.color}25` : `${t.border}80`,
                    borderRadius: '999px',
                    padding: '1px 7px',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    minWidth: '20px',
                    textAlign: 'center',
                  }}>{chip.count}</span>
                </button>
              )
            })}
          </div>

          {/* Outstation pool wrapper. Per-region sections render inside. */}
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', overflow: 'hidden', position: 'relative', boxShadow: `0 1px 3px ${t.border}40` }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${t.orange} 0%, ${t.orange}30 60%, transparent 100%)` }} />
            <div style={{ padding: '18px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '10px', color: t.orange, background: `${t.orange}18`, borderRadius: '6px', padding: '5px 11px', fontWeight: 700, letterSpacing: '.1em' }}>OUTSTATION</span>
              <div>
                <div style={{ fontSize: '15px', color: t.text1, fontWeight: 600, letterSpacing: '-.01em' }}>In-Transit Branches</div>
                <div style={{ fontSize: '11px', color: t.text4, marginTop: '3px' }}>
                  {hasSearchActive || arrivalFilter !== 'all'
                    ? `${kpis.outstationBranches} matching branch${kpis.outstationBranches === 1 ? '' : 'es'} · ${kpis.outstationBills} bill${kpis.outstationBills === 1 ? '' : 's'}`
                    : `${kpis.outstationBranches} branch${kpis.outstationBranches === 1 ? '' : 'es'} · ${kpis.outstationBills} bill${kpis.outstationBills === 1 ? '' : 's'} awaiting receipt`}
                </div>
              </div>
            </div>
            {outstationByRegion.length === 0 ? (
              <div style={{ padding: '70px 20px 80px', textAlign: 'center' }}>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: `linear-gradient(135deg, ${t.green}18, ${t.green}06)`,
                  border: `1px solid ${t.green}30`,
                  margin: '0 auto 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '24px', color: t.green,
                }}>
                  {hasSearchActive || arrivalFilter !== 'all' ? '⌕' : '✓'}
                </div>
                <div style={{ fontSize: '13px', color: t.text2, fontWeight: 600, marginBottom: '4px' }}>
                  {hasSearchActive
                    ? `No matches for "${search}"`
                    : arrivalFilter !== 'all'
                      ? `Nothing arriving ${arrivalFilter}`
                      : 'All caught up'}
                </div>
                <div style={{ fontSize: '11px', color: t.text4 }}>
                  {hasSearchActive
                    ? 'Try a different keyword or clear search to see everything.'
                    : arrivalFilter !== 'all'
                      ? 'Switch the filter chip above to see other arrival windows.'
                      : 'No outstation consignments are currently in transit.'}
                </div>
              </div>
            ) : (
              <div style={{ padding: '6px 16px 18px' }}>
                {outstationByRegion.map(({ region, branches }, regionIdx) => {
                  const regionBills = branches.reduce((s, b) => s + b.bills.length, 0)
                  return (
                    <div key={region} style={{ marginTop: regionIdx === 0 ? '10px' : '20px' }}>
                      {/* Region band — full-width strip with left accent bar
                          and pill-styled count. Heavier visual presence than
                          a small dot so the auditor can scan the page by
                          region without needing the title's full attention. */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        margin: '0 0 12px', padding: '8px 0 8px 4px',
                        borderBottom: `1px solid ${t.border}`,
                        position: 'relative',
                      }}>
                        <span style={{
                          width: '3px', alignSelf: 'stretch', borderRadius: '2px',
                          background: `linear-gradient(180deg, ${t.orange}, ${t.orange}40)`,
                        }} />
                        <span style={{
                          fontSize: '12px', color: t.text1, fontWeight: 700,
                          letterSpacing: '.06em', textTransform: 'uppercase',
                        }}>{region}</span>
                        <span style={{
                          fontSize: '10px',
                          color: t.text3,
                          background: `${t.orange}10`,
                          border: `1px solid ${t.orange}25`,
                          borderRadius: '999px',
                          padding: '2px 9px',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                        }}>
                          {branches.length} · {regionBills} bill{regionBills === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div style={{
                        display: 'grid',
                        // auto-fit collapses empty trailing tracks. Cap max
                        // at 280px so a row with 3 cards doesn't stretch
                        // them to 400px each -- the last row stays half-
                        // empty (honest) rather than visually inflated.
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 280px))',
                        gap: '5px',
                        justifyContent: 'start',
                      }}>
                        {branches.map((b, i) => (
                          <div key={b.branch}
                               className="ca-card-enter"
                               style={{ animationDelay: `${Math.min(i * 30, 400)}ms` }}>
                            <BranchCard
                              t={t}
                              accent={t.orange}
                              branch={b.branch}
                              billCount={b.bills.length}
                              extraLabel={`${b.consignments.length} consignment${b.consignments.length === 1 ? '' : 's'}`}
                              oldestAt={oldestAge(b.consignments, 'dispatched_at')}
                              dispatchedYmd={latestDispatchDate(b.consignments)}
                              arrivalAt={earliestArrival(b.consignments)}
                              discrepancies={b.bills.filter(x => x.audit_gross_weight != null).length}
                              onPick={() => setDrillBranch({ name: b.branch, pool: 'outstation' })}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Bangalore pool is intentionally hidden when empty (post 1 Jun
              cutover the walk-in flow is gone — Bangalore bills land in the
              Outstation pool once their hub-level EWB is generated). */}
          {filteredBangaloreByBranch.length > 0 && (
            <BranchPool
              t={t}
              accent={t.gold}
              badge="BANGALORE"
              title="Pending at HO"
              subtitle={hasSearchActive
                ? `${kpis.bangaloreBranches} matching branch${kpis.bangaloreBranches === 1 ? '' : 'es'} · ${kpis.bangaloreBills} bill${kpis.bangaloreBills === 1 ? '' : 's'}`
                : `${kpis.bangaloreBranches} branch${kpis.bangaloreBranches === 1 ? '' : 'es'} · ${kpis.bangaloreBills} bill${kpis.bangaloreBills === 1 ? '' : 's'} walking in`}
              empty={hasSearchActive ? `No Bangalore matches for "${search}"` : 'No Bangalore bills currently pending.'}
              branches={filteredBangaloreByBranch.map(b => ({
                branch:        b.branch,
                billCount:     b.bills.length,
                extraLabel:    null,
                oldestAt:      oldestAge(b.bills, 'purchase_date'),
                dispatchedYmd: null,
                arrivalAt:     null,
                discrepancies: b.bills.filter(x => x.audit_gross_weight != null).length,
              }))}
              onPick={(branch) => setDrillBranch({ name: branch, pool: 'bangalore' })}
            />
          )}
        </>
      )}

      {activeBill && createPortal(
        <AuditModal
          bill={activeBill}
          t={t}
          onClose={() => setActiveBill(null)}
          onDone={(msg) => { setToast({ msg, type: 'success', key: Date.now() }); setActiveBill(null); fetchAll() }}
          onError={(msg) => setToast({ msg, type: 'error', key: Date.now() })}
        />,
        document.body,
      )}
    </div>
  )
}

function HeroStat({ t, label, value, color }) {
  return (
    <div style={{
      background:  `linear-gradient(135deg, ${color}15 0%, ${color}08 100%)`,
      border:      `1px solid ${color}30`,
      borderRadius: '11px',
      padding:     '10px 18px',
      minWidth:    '96px',
      textAlign:   'center',
      position:    'relative',
      overflow:    'hidden',
      transition:  'transform .2s ease, box-shadow .2s ease',
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${color}20` }}
    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)';    e.currentTarget.style.boxShadow = 'none' }}>
      {/* Top sliver glow that hints depth without taking attention */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg, transparent, ${color}50, transparent)`, pointerEvents: 'none' }} />
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '22px', color, fontWeight: 700, fontFamily: 'monospace', marginTop: '4px', lineHeight: 1, letterSpacing: '-.02em' }}>{value}</div>
    </div>
  )
}

// ─── Pool of branch cards (Level 0) ─────────────────────────────────────────
function BranchPool({ t, accent, badge, title, subtitle, empty, branches, onPick }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', overflow: 'hidden', position: 'relative', boxShadow: `0 1px 3px ${t.border}40` }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${accent} 0%, ${accent}30 60%, transparent 100%)` }} />
      <div style={{ padding: '18px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '14px' }}>
        <span style={{ fontSize: '10px', color: accent, background: `${accent}18`, borderRadius: '6px', padding: '5px 11px', fontWeight: 700, letterSpacing: '.1em' }}>{badge}</span>
        <div>
          <div style={{ fontSize: '15px', color: t.text1, fontWeight: 600, letterSpacing: '-.01em' }}>{title}</div>
          <div style={{ fontSize: '11px', color: t.text4, marginTop: '3px' }}>{subtitle}</div>
        </div>
      </div>
      {branches.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', fontSize: '12px', color: t.text4 }}>{empty}</div>
      ) : (
        <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 280px))', gap: '5px', justifyContent: 'start' }}>
          {branches.map(b => <BranchCard key={b.branch} {...b} t={t} accent={accent} onPick={() => onPick(b.branch)} />)}
        </div>
      )}
    </div>
  )
}

function BranchCard({ branch, billCount, extraLabel, oldestAt, dispatchedYmd, arrivalAt, discrepancies, t, accent, onPick }) {
  const age      = ageBadge(oldestAt ? new Date(oldestAt) : null, t)
  const arrival  = arrivalLabel(arrivalAt, t)
  const dispLbl  = fmtShortDate(dispatchedYmd)
  // "Urgent" border for stale dispatches OR overdue arrivals so the
  // auditor's eye lands on the cards that genuinely need attention.
  const ageUrgent     = age.color === t.red || age.color === t.orange
  const arrivalUrgent = arrival?.diff != null && arrival.diff <= 0
  const urgent        = ageUrgent || arrivalUrgent
  const urgentBorder  = arrivalUrgent ? `${arrival.color}50` : `${age.color}40`
  // Urgent cards carry a permanent soft halo so the eye is drawn to them
  // before the auditor has even hovered. Subtle so non-urgent cards don't
  // feel ignored.
  const restingShadow = urgent
    ? `0 0 0 1px ${urgentBorder.replace('40', '30')}, 0 2px 10px ${arrivalUrgent ? arrival.color : age.color}15`
    : 'none'
  return (
    <button onClick={onPick}
      style={{
        background:    `linear-gradient(180deg, ${t.card} 0%, ${t.card2 || t.card} 100%)`,
        border:        `1px solid ${urgent ? urgentBorder : t.border}`,
        borderRadius:  '11px',
        padding:       '12px 14px 10px',
        cursor:        'pointer',
        textAlign:     'left',
        display:       'flex',
        flexDirection: 'column',
        gap:           '8px',
        position:      'relative',
        overflow:      'hidden',
        boxShadow:     restingShadow,
        transition:    'transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease, border-color .18s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform   = 'translateY(-2px)'
        e.currentTarget.style.boxShadow   = `0 6px 18px ${accent}28, 0 0 0 1px ${accent}50 inset`
        e.currentTarget.style.borderColor = `${accent}80`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform   = 'translateY(0)'
        e.currentTarget.style.boxShadow   = restingShadow
        e.currentTarget.style.borderColor = urgent ? urgentBorder : t.border
      }}>
      {/* Row 1: branch name + age pill. Branch name wraps to 2 lines instead
          of getting ellipsis-cropped so long KL- names (KL-THIRUVANANTHAPURAM
          MGROAD etc.) stay legible. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{
          fontSize: '12.5px',
          color: t.text1,
          fontWeight: 700,
          letterSpacing: '-.01em',
          lineHeight: 1.2,
          flex: 1,
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>{branch}</div>
        <span title="Age of oldest dispatch on this branch"
              style={{ fontSize: '9px', color: age.color, background: age.bg, borderRadius: '4px', padding: '2px 6px', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{age.label}</span>
      </div>

      {/* Row 2: two columns. Left = hero count + consignment count.
                 Right = dispatched + arrives. Fills the right-side empty
                 space the auditor flagged. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ flex: '0 0 auto', minWidth: '78px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
            <div style={{ fontSize: '26px', color: accent, fontWeight: 700, lineHeight: 1, fontFamily: 'monospace', letterSpacing: '-.02em' }}>{billCount}</div>
            <div style={{ fontSize: '10.5px', color: t.text3, fontWeight: 500 }}>bill{billCount === 1 ? '' : 's'}</div>
          </div>
          {extraLabel && <div style={{ fontSize: '10px', color: t.text4, marginTop: '3px' }}>{extraLabel}</div>}
        </div>
        {(dispLbl || arrival) && (
          <div style={{
            flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column', gap: '4px',
            paddingLeft: '10px', borderLeft: `1px solid ${t.border}80`,
            alignItems: 'flex-end',
          }}>
            {dispLbl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '8.5px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>Dispatched</span>
                <span style={{ fontSize: '10.5px', color: t.text2, fontWeight: 600, fontFamily: 'monospace' }}>{dispLbl}</span>
              </div>
            )}
            {arrival && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '8.5px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>Arrives</span>
                <span style={{
                  fontSize: '9.5px', color: arrival.color, background: arrival.bg,
                  borderRadius: '4px', padding: '2px 7px', fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}>{arrival.label}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 3: footer — status + open affordance. The "ready" state used
                 to read "No discrepancies" in muted grey; now it's a green
                 ✓ + label so the affordance ("this card is ready to audit")
                 is visible from across the grid. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: '10px', paddingTop: '6px',
        borderTop: `1px solid ${t.border}60`,
      }}>
        {discrepancies > 0 ? (
          <span style={{ color: t.red, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            ⚠ {discrepancies} discrepanc{discrepancies === 1 ? 'y' : 'ies'}
          </span>
        ) : (
          <span style={{ color: t.green, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{
              width: '14px', height: '14px', borderRadius: '50%',
              background: `${t.green}20`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', lineHeight: 1,
            }}>✓</span>
            Ready to audit
          </span>
        )}
        <span style={{ color: accent, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          Open <span style={{ fontSize: '11px' }}>→</span>
        </span>
      </div>
    </button>
  )
}

// ─── Drill-down (Level 1) ───────────────────────────────────────────────────
function BranchDrilldown({ drill, outstationByBranch, bangaloreByBranch, t, onBack, onAudit }) {
  const source = drill.pool === 'outstation'
    ? outstationByBranch.find(b => b.branch === drill.name)
    : bangaloreByBranch.find(b => b.branch === drill.name)

  if (!source) {
    return (
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '14px', padding: '40px', textAlign: 'center', color: t.text4 }}>
        Branch no longer has any pending bills.{' '}
        <button onClick={onBack} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '11px', color: t.text3, cursor: 'pointer', marginLeft: '10px' }}>← Back</button>
      </div>
    )
  }

  const accent  = drill.pool === 'outstation' ? t.orange : t.gold
  const badgeLb = drill.pool === 'outstation' ? 'OUTSTATION' : 'BANGALORE'
  const dateF   = drill.pool === 'outstation' ? 'dispatched_at' : 'purchase_date'
  const pendingCount = source.bills.filter(b => b.audit_gross_weight == null).length
  const flaggedCount = source.bills.filter(b => b.audit_gross_weight != null).length

  const groups = drill.pool === 'outstation'
    ? Object.values(source.bills.reduce((acc, b) => {
        const cid = b._consignment?.id || 'orphan'
        if (!acc[cid]) acc[cid] = { consignment: b._consignment, bills: [] }
        acc[cid].bills.push(b)
        return acc
      }, {}))
    : [{ consignment: null, bills: source.bills }]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Sticky-ish drill-down header */}
      <div style={{
        background:  `linear-gradient(135deg, ${accent}10, ${t.card})`,
        border:      `1px solid ${accent}40`,
        borderRadius: '14px',
        padding:     '18px 22px',
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'space-between',
        gap:         '16px',
        flexWrap:    'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <button onClick={onBack}
            style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 14px', fontSize: '11px', color: t.text2, cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = `${accent}80`; e.currentTarget.style.color = accent }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text2 }}>
            ← Branches
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '10px', color: accent, background: `${accent}25`, borderRadius: '6px', padding: '5px 11px', fontWeight: 700, letterSpacing: '.1em' }}>{badgeLb}</span>
            <div>
              <div style={{ fontSize: '18px', color: t.text1, fontWeight: 700, letterSpacing: '-.015em', lineHeight: 1.1 }}>{source.branch}</div>
              <div style={{ fontSize: '11px', color: t.text4, marginTop: '3px' }}>
                {source.bills.length} bill{source.bills.length === 1 ? '' : 's'} pending audit
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <HeroStat t={t} label="Pending" value={pendingCount} color={accent} />
          {flaggedCount > 0 && <HeroStat t={t} label="Flagged" value={flaggedCount} color={t.red} />}
        </div>
      </div>

      {/* Bill cards grouped by consignment (outstation) or flat (bangalore) */}
      {groups.map((g, gi) => (
        <Fragment key={g.consignment?.id || gi}>
          {g.consignment && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 4px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: t.gold, background: `${t.gold}18`, borderRadius: '5px', padding: '4px 10px', fontWeight: 700, letterSpacing: '.08em' }}>{g.consignment.tmp_prf_no || '—'}</span>
              <span style={{ fontSize: '11px', color: t.text2 }}>
                {g.consignment.branch_name} <span style={{ color: t.text4 }}>→</span> {g.consignment.movement_type === 'INTERNAL' ? g.consignment.dest_branch : 'HO'}
              </span>
              <span style={{ fontSize: '10px', color: t.text4, fontFamily: 'monospace' }}>{g.consignment.challan_no}</span>
              <span style={{ marginLeft: 'auto', fontSize: '10px', color: t.text3 }}>
                <strong style={{ color: t.text2 }}>{g.bills.length}</strong> bill{g.bills.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
            {g.bills.map(bill => <BillCard key={bill.id} bill={bill} t={t} dateField={dateF} onAudit={() => onAudit(bill)} />)}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function BillCard({ bill, t, onAudit, dateField }) {
  const previouslyAudited = bill.audit_gross_weight != null
  const age   = ageBadge(bill[dateField], t)
  const isTakeover = bill.transaction_type === 'TAKEOVER'

  return (
    <div style={{
      background:    t.card,
      border:        `1px solid ${previouslyAudited ? `${t.red}50` : t.border}`,
      borderRadius:  '12px',
      padding:       '14px 16px',
      display:       'flex',
      flexDirection: 'column',
      gap:           '10px',
      position:      'relative',
      overflow:      'hidden',
      transition:    'border-color .15s ease, box-shadow .15s ease',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow   = `0 4px 14px ${t.gold}20`
        e.currentTarget.style.borderColor = `${t.gold}60`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow   = 'none'
        e.currentTarget.style.borderColor = previouslyAudited ? `${t.red}50` : t.border
      }}>

      {/* Top row: App ID + Type + Age */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '-.01em' }}>{bill.application_id}</span>
          <span style={{ fontSize: '9px', color: isTakeover ? t.purple : t.gold, background: isTakeover ? `${t.purple}18` : `${t.gold}18`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.05em' }}>
            {bill.transaction_type || '—'}
          </span>
        </div>
        <span style={{ fontSize: '9px', color: age.color, background: age.bg, borderRadius: '4px', padding: '2px 7px', fontWeight: 700, whiteSpace: 'nowrap' }}>{age.label}</span>
      </div>

      {/* Customer */}
      <div style={{ fontSize: '14px', color: t.text1, fontWeight: 500, lineHeight: 1.2 }}>{bill.customer_name || '—'}</div>

      {/* Meta */}
      <div style={{ fontSize: '11px', color: t.text4, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <span>{fmtDate(bill[dateField])}</span>
      </div>

      {/* Status + Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${t.border}40`, paddingTop: '10px', marginTop: '4px' }}>
        {previouslyAudited ? (
          <span style={{ fontSize: '10px', color: t.red, background: `${t.red}18`, borderRadius: '4px', padding: '3px 8px', fontWeight: 700 }}>
            ⚠ Re-audit needed
          </span>
        ) : (
          <span style={{ fontSize: '10px', color: t.text4, fontWeight: 600 }}>
            Awaiting weight
          </span>
        )}
        <button onClick={onAudit}
          style={{
            background: previouslyAudited ? t.orange : t.gold,
            color:      previouslyAudited ? '#fff' : '#1a0a00',
            border:     'none',
            borderRadius: '8px',
            padding:    '8px 16px',
            fontSize:   '11px',
            fontWeight: 700,
            letterSpacing: '.02em',
            cursor:     'pointer',
            display:    'inline-flex',
            alignItems: 'center',
            gap:        '6px',
          }}>
          ⚖ {previouslyAudited ? 'Re-weigh' : 'Weigh bill'}
        </button>
      </div>
    </div>
  )
}

// ─── Blind audit modal ─────────────────────────────────────────────────────
function AuditModal({ bill, t, onClose, onDone, onError }) {
  const [weight,   setWeight]   = useState('')
  const [remark,   setRemark]   = useState(bill.audit_remark || '')
  const [busy,     setBusy]     = useState(false)
  const [revealed, setRevealed] = useState(null)   // { crm_gross, measured, discrepancy_g }

  const measured = parseFloat(weight)
  const valid    = Number.isFinite(measured) && measured > 0

  function onWeightChange(v) {
    setWeight(v)
    if (revealed) setRevealed(null)
  }

  async function submit(action) {
    if (!valid) { onError('Enter a valid measured gross weight'); return }
    if (revealed && action === 'receive' && !remark.trim()) {
      onError('Discrepancy is flagged — add a remark before accepting.')
      return
    }
    setBusy(true)
    try {
      const res = await authedFetch('/api/collection-audit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          purchase_id:        bill.id,
          audit_gross_weight: measured,
          action,
          remark:             remark.trim() || null,
        }),
      })
      const j = await res.json()

      if (res.ok && j.success && j.action === 'receive' && Number(j.discrepancy_g) === 0) {
        const tail = j.consignment_received ? ' · Parent consignment also marked received.' : ''
        onDone(`${bill.application_id} matched CRM exactly — received at HO.${tail}`)
        return
      }
      if (res.ok && j.success && j.action === 'receive') {
        const tail = j.consignment_received ? ' · Parent consignment also marked received.' : ''
        onDone(`${bill.application_id} received with discrepancy noted (Δ ${j.discrepancy_g}g).${tail}`)
        return
      }
      if (res.ok && j.success && j.action === 'keep_pending') {
        onDone(`${bill.application_id} kept pending — discrepancy ${j.discrepancy_g}g recorded.`)
        return
      }
      if (j.requires_remark && j.crm_gross != null) {
        setRevealed({ crm_gross: Number(j.crm_gross), measured: Number(j.measured), discrepancy_g: Number(j.discrepancy_g) })
        return
      }
      onError(j.error || 'Audit action failed')
    } finally { setBusy(false) }
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.76)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '16px', maxWidth: '580px', width: '100%', overflow: 'hidden', boxShadow: `0 20px 60px rgba(0,0,0,.7)` }
  const label   = { fontSize: '10px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }

  const previouslyAudited = bill.audit_gross_weight != null

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* Hero header */}
        <div style={{ background: `linear-gradient(135deg, ${t.gold}15, transparent)`, padding: '24px 28px', borderBottom: `1px solid ${t.border}`, position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '46px', height: '46px', borderRadius: '12px',
              background: `linear-gradient(135deg, ${t.gold}30, ${t.gold}10)`,
              border: `1px solid ${t.gold}40`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '22px',
            }}>⚖</div>
            <div>
              <div style={label}>Blind weight entry</div>
              <div style={{ fontSize: '22px', color: t.gold, fontFamily: 'monospace', fontWeight: 700, marginTop: '4px', letterSpacing: '-.015em' }}>{bill.application_id}</div>
              <div style={{ fontSize: '12px', color: t.text3, marginTop: '2px' }}>
                {bill.customer_name} · {bill.branch_name} · {fmtDate(bill.purchase_date)}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Re-audit context */}
          {previouslyAudited && !revealed && (
            <div style={{ padding: '12px 14px', borderRadius: '10px', background: `${t.orange}10`, border: `1px solid ${t.orange}40`, fontSize: '12px', color: t.orange, display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '14px' }}>↻</span>
              <div>
                <strong>Re-audit:</strong> previous reading was <strong style={{ fontFamily: 'monospace' }}>{fmtWt(bill.audit_gross_weight)}</strong>
                {bill.audit_remark ? <> — <em>"{bill.audit_remark}"</em></> : null}.
                Re-weigh on the scale; CRM gross is still hidden.
              </div>
            </div>
          )}

          {/* Weight input — the hero */}
          <div>
            <div style={{ ...label, marginBottom: '8px' }}>Measured Gross Weight</div>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                step="0.001"
                autoFocus
                value={weight}
                onChange={e => onWeightChange(e.target.value)}
                placeholder="0.000"
                style={{
                  background:   t.card2 || t.card,
                  border:       `1.5px solid ${valid ? `${t.gold}60` : t.border}`,
                  borderRadius: '10px',
                  padding:      '18px 60px 18px 18px',
                  fontSize:     '28px',
                  color:        t.text1,
                  fontFamily:   'monospace',
                  fontWeight:   700,
                  letterSpacing: '-.02em',
                  outline:      'none',
                  width:        '100%',
                  boxSizing:    'border-box',
                  transition:   'border-color .15s ease',
                }}
              />
              <div style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', color: t.text4, fontWeight: 600, pointerEvents: 'none' }}>g</div>
            </div>
            {!revealed && (
              <div style={{ fontSize: '11px', color: t.text4, marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '13px' }}>🔒</span>
                CRM gross is hidden. Submit your reading to compare.
              </div>
            )}
          </div>

          {/* Reveal panel */}
          {revealed && (
            <div style={{ padding: '16px 18px', borderRadius: '12px', background: `${t.red}10`, border: `1px solid ${t.red}50` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span style={{ fontSize: '18px' }}>⚠</span>
                <div style={{ fontSize: '11px', color: t.red, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  Discrepancy detected
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <Reveal t={t} label="Your reading" value={fmtWt(revealed.measured)} color={t.text1} />
                <Reveal t={t} label="CRM gross"    value={fmtWt(revealed.crm_gross)} color={t.gold} />
                <Reveal t={t} label="Δ"            value={`${revealed.discrepancy_g > 0 ? '+' : ''}${revealed.discrepancy_g.toFixed(3)}g`} color={t.red} />
              </div>
              <div style={{ fontSize: '12px', color: t.text2, marginTop: '14px' }}>
                {revealed.measured > revealed.crm_gross ? 'You measured MORE than CRM.' : 'You measured LESS than CRM.'} Add a remark and decide below.
              </div>
            </div>
          )}

          {revealed && (
            <div>
              <div style={{ ...label, marginBottom: '6px' }}>
                Audit Remark <span style={{ color: t.red, textTransform: 'none', letterSpacing: 'normal' }}>(required to accept)</span>
              </div>
              <textarea
                value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder="Why is there a difference? e.g. stones in casing, packing residue, scale calibration drift…"
                rows={2}
                style={{
                  background:   t.card2 || t.card,
                  border:       `1px solid ${t.border}`,
                  borderRadius: '10px',
                  padding:      '11px 14px',
                  fontSize:     '13px',
                  color:        t.text1,
                  outline:      'none',
                  width:        '100%',
                  boxSizing:    'border-box',
                  resize:       'vertical',
                  fontFamily:   'inherit',
                }}
              />
            </div>
          )}
        </div>

        {/* Action footer */}
        <div style={{ padding: '16px 28px', borderTop: `1px solid ${t.border}`, background: t.card2 || t.card, display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '9px', padding: '11px 20px', fontSize: '12px', color: t.text3, cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          {!revealed ? (
            <button onClick={() => submit('receive')} disabled={busy || !valid}
              style={{
                background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '9px',
                padding: '11px 26px', fontSize: '13px', fontWeight: 700,
                cursor: busy ? 'default' : 'pointer',
                opacity: (busy || !valid) ? .5 : 1, letterSpacing: '.02em',
                boxShadow: !busy && valid ? `0 2px 8px ${t.gold}50` : 'none',
                transition: 'opacity .15s, box-shadow .15s',
              }}>
              {busy ? 'Comparing…' : 'Submit & Compare →'}
            </button>
          ) : (
            <>
              <button onClick={() => submit('keep_pending')} disabled={busy || !valid}
                style={{ background: 'transparent', border: `1px solid ${t.orange}80`, borderRadius: '9px', padding: '11px 20px', fontSize: '12px', color: t.orange, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>
                Keep Pending
              </button>
              <button onClick={() => submit('receive')} disabled={busy || !valid || !remark.trim()}
                style={{
                  background: t.green, color: '#0a0a0a', border: 'none', borderRadius: '9px',
                  padding: '11px 22px', fontSize: '12px', fontWeight: 700,
                  cursor: busy ? 'default' : 'pointer',
                  opacity: (busy || !valid || !remark.trim()) ? .5 : 1,
                  boxShadow: !busy && valid && remark.trim() ? `0 2px 8px ${t.green}50` : 'none',
                  transition: 'opacity .15s, box-shadow .15s',
                }}>
                {busy ? 'Saving…' : '✓ Accept & Mark Received'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Reveal({ t, label, value, color }) {
  return (
    <div style={{ background: t.card, padding: '12px 14px', borderRadius: '10px', textAlign: 'center', border: `1px solid ${t.border}40` }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '18px', color, fontWeight: 700, fontFamily: 'monospace', marginTop: '6px', letterSpacing: '-.01em' }}>{value}</div>
    </div>
  )
}
