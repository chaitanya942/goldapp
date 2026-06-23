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
import { CONSIGNMENT_THEMES as THEMES, useMobile } from '../../lib/consignmentTheme'

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
  const { theme, role } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const isMobile = useMobile()

  // For role='audit' users we read their current shift assignment so the page
  // can show a "you're on night/morning shift" context banner. Non-audit
  // roles (super_admin/admin/founders_office/etc.) don't see this — the
  // page works the same for them as before. We reuse /api/auditor-access
  // which already knows the auditor's active shift for today.
  const [currentShift, setCurrentShift] = useState(null)   // 'night' | 'morning' | null

  useEffect(() => {
    if (role !== 'audit') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await authedFetch('/api/auditor-access')
        const j   = await res.json().catch(() => ({}))
        if (cancelled || !res.ok) return
        const type = j?.activeShift?.shift_type
        if (type === 'night' || type === 'morning') setCurrentShift(type)
      } catch { /* silent — banner just stays hidden */ }
    })()
    return () => { cancelled = true }
  }, [role])

  const [loading,    setLoading]    = useState(true)
  const [bangalore,  setBangalore]  = useState([])
  const [outstation, setOutstation] = useState([])
  const [activeBill, setActiveBill] = useState(null)
  const [drillBranch, setDrillBranch] = useState(null)   // { name, pool } | null
  const [toast,      setToast]      = useState(null)
  const [search,     setSearch]     = useState('')
  // Arrival filter: 'today' | 'tomorrow' | 'overdue'. No "all" -- ops
  // confirmed the realistic audit horizon is just these three windows;
  // 'today' is the default because that's where the day's work lives.
  // Filter applies at the CONSIGNMENT level (one branch with two trucks
  // arriving on different days shows under each respective filter, with
  // only that day's truck's bills inside).
  const [arrivalFilter, setArrivalFilter] = useState('today')
  // Active region tab within the current arrival filter. null → fall back to
  // the first region in the (bill-count-sorted) list.
  const [activeRegion, setActiveRegion] = useState(null)
  // Region collapse state. Tracked as EXPANDED set so the default
  // (empty set) means every region starts collapsed — Bangalore has
  // ~30 branches and scrolling past them every page load was wasted
  // motion. Ops opens the regions they care about; clicking the band
  // toggles membership.
  const [expandedRegions, setExpandedRegions] = useState(() => new Set())
  const toggleRegion = useCallback((region) => {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region); else next.add(region)
      return next
    })
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch('/api/collection-audit')
      // Defensive parse — non-JSON responses (HTML error pages, plain-text
      // upstream 'Bad Request' from a proxy / Next.js, etc.) used to throw
      // here and the toast would surface the raw thrown text, leaving ops
      // to guess what failed. Now we capture both the JSON shape AND the
      // raw HTTP status so the toast actually carries the diagnostic.
      let j = null
      let rawText = null
      try {
        j = await res.json()
      } catch {
        try { rawText = await res.clone().text() } catch {}
      }
      if (!res.ok || j?.error) {
        const detail = j?.error || rawText?.slice(0, 120) || `HTTP ${res.status}`
        // Stringify the body inline so the actual cause is visible without
        // clicking the collapsed Object — Supabase column-missing errors
        // and similar carry the diagnostic in the body's message field.
        try {
          console.error('[CollectionAudit] fetchAll failed:', `status=${res.status}`, 'body=', JSON.stringify(j ?? rawText))
        } catch {
          console.error('[CollectionAudit] fetchAll failed:', { status: res.status, body: j ?? rawText })
        }
        setToast({ msg: `Failed to load audit queue — ${detail}`, type: 'error', key: Date.now() })
        setLoading(false)
        return
      }
      setBangalore(j?.bangalore || [])
      setOutstation(j?.outstation || [])
    } catch (e) {
      console.error('[CollectionAudit] fetchAll exception:', e)
      setToast({ msg: `Network error — ${e?.message || 'unknown'}`, type: 'error', key: Date.now() })
    }
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
  // Consignment-level arrival match. Used to filter the raw outstation
  // groups BEFORE aggregating by branch, so a multi-truck branch only
  // shows the truck(s) matching the active filter.
  const arrivalMatchesFilter = useCallback((consignment) => {
    if (!consignment?.expected_arrival_date) return false
    const arr = arrivalLabel(consignment.expected_arrival_date, t)
    if (!arr) return false
    if (arrivalFilter === 'today')    return arr.diff === 0
    if (arrivalFilter === 'tomorrow') return arr.diff === 1
    if (arrivalFilter === 'others')   return arr.diff > 1     // arriving day-after or later
    if (arrivalFilter === 'overdue')  return arr.diff < 0
    return false
  }, [arrivalFilter, t])

  // Filter the raw outstation list by consignment arrival, THEN aggregate.
  // VIJAYAPURA with 2 consignments (one arriving today, one tomorrow)
  // splits cleanly across the Today + Tomorrow filters — each filter
  // shows only the trucks (and their bills) that match.
  const outstationFilteredByArrival = useMemo(
    () => outstation.filter(g => arrivalMatchesFilter(g.consignment)),
    [outstation, arrivalMatchesFilter],
  )

  const outstationByBranch = useMemo(() => {
    const m = new Map()
    for (const g of outstationFilteredByArrival) {
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
  }, [outstationFilteredByArrival])

  const bangaloreByBranch = useMemo(() => {
    const m = new Map()
    for (const b of bangalore) {
      const k = b.branch_name || '—'
      if (!m.has(k)) m.set(k, { branch: k, bills: [] })
      m.get(k).bills.push(b)
    }
    return [...m.values()].sort((a, b) => (oldestAge(a.bills, 'purchase_date') ?? Infinity) - (oldestAge(b.bills, 'purchase_date') ?? Infinity))
  }, [bangalore])

  // Search applies on top of the already-arrival-filtered branch list.
  // matchesQuery is all-tokens-AND across branch name + bill + consignment
  // fields, so an auditor can paste a tamper-proof number / app id /
  // customer name and the right branch surfaces immediately.
  const filteredOutstationByBranch = useMemo(
    () => outstationByBranch.filter(b => matchesQuery(b, search)),
    [outstationByBranch, search],
  )
  const filteredBangaloreByBranch = useMemo(
    () => bangaloreByBranch.filter(b => matchesQuery(b, search)),
    [bangaloreByBranch, search],
  )

  // Group outstation cards by region for section headers. Region comes from
  // the bill's source branch (enriched server-side) so leaf cards land
  // under the correct region even when their parent consignment was issued
  // from a hub in the same region.
  //
  // Sort order is data-driven: regions with the most bills first, ties
  // broken alphabetically. Within each region, branches sort A→Z by name
  // so the auditor can scan a long list (Bangalore has ~30) without
  // hunting around. No hardcoded region list — adding a new region to
  // the branches table picks up automatically with no code change.
  const outstationByRegion = useMemo(() => {
    const m = new Map()
    for (const b of filteredOutstationByBranch) {
      const r = b.region || 'Unknown'
      if (!m.has(r)) m.set(r, [])
      m.get(r).push(b)
    }
    const entries = [...m.entries()].map(([region, branches]) => ({
      region,
      branches: [...branches].sort((a, b) =>
        String(a.branch || '').localeCompare(String(b.branch || ''), undefined, { sensitivity: 'base' })
      ),
      _billCount: branches.reduce((s, x) => s + x.bills.length, 0),
    }))
    entries.sort((a, b) => {
      if (b._billCount !== a._billCount) return b._billCount - a._billCount
      return a.region.localeCompare(b.region)
    })
    return entries.map(({ region, branches }) => ({ region, branches }))
  }, [filteredOutstationByBranch])

  // Region tabs: the active region falls back to the first available one
  // whenever the current selection isn't present (arrival filter / search
  // narrowed it away). Derived — no effect needed.
  const effectiveRegion = useMemo(() => {
    const names = outstationByRegion.map(r => r.region)
    return (activeRegion && names.includes(activeRegion)) ? activeRegion : (names[0] || null)
  }, [outstationByRegion, activeRegion])
  const activeRegionData = useMemo(
    () => outstationByRegion.find(r => r.region === effectiveRegion) || null,
    [outstationByRegion, effectiveRegion],
  )

  // Bucket counts for the filter chips. Counts distinct branches that have
  // at least one consignment matching that arrival bucket — same shape as
  // what the filter will show when clicked. Computed from the raw
  // outstation list (not the already-filtered one) so the chip badge for
  // a non-active bucket still reflects what's there.
  const arrivalCounts = useMemo(() => {
    const today = new Set(), tomorrow = new Set(), others = new Set(), overdue = new Set()
    for (const g of outstation) {
      if (!g.consignment?.expected_arrival_date) continue
      const arr = arrivalLabel(g.consignment.expected_arrival_date, t)
      if (!arr) continue
      for (const bill of g.bills) {
        const k = bill.branch_name || g.consignment.branch_name
        if (!k) continue
        if (arr.diff < 0)        overdue.add(k)
        else if (arr.diff === 0) today.add(k)
        else if (arr.diff === 1) tomorrow.add(k)
        else                     others.add(k)
      }
    }
    return { today: today.size, tomorrow: tomorrow.size, others: others.size, overdue: overdue.size }
  }, [outstation, t])

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
    <div style={{
      padding: isMobile ? '12px 12px 80px' : '24px 28px',
      maxWidth: '1400px',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile ? '14px' : '20px',
    }}>
      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Shift context banner — only shown to role='audit' users when an
          active shift is detected. Sets expectations: night auditors do
          weight only; morning auditors do weight + flag bills ready for
          melting (the Melting module proper lands later). Other roles see
          nothing here — page is unchanged for them. */}
      {role === 'audit' && currentShift && <ShiftContextBanner shiftType={currentShift} t={t} />}

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

        /* Blind weight entry — strip spinner arrows + pulse the "Blind" dot.
           type="text" + inputMode="decimal" already prevents most browsers
           from rendering spinners, but Firefox keeps them on type="number"
           and Edge can still show controls on text inputs in some cases.
           Defensive ::-webkit hide + Firefox appearance:textfield. */
        .ca-weight-input::-webkit-outer-spin-button,
        .ca-weight-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .ca-weight-input {
          -moz-appearance: textfield;
          appearance: textfield;
        }
        @keyframes auditBlindPulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(201,168,76,.25); opacity: 1; }
          50%      { box-shadow: 0 0 0 6px rgba(201,168,76,0);   opacity: .6; }
        }
      `}</style>

      {/* ─── Search bar (simple) ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* search box, takes the row */}
        <div style={{ position: 'relative', flex: 1 }}>
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
        <button onClick={fetchAll} title="Reload" className="ca-refresh"
          style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '10px', padding: '10px 14px', fontSize: '11px', color: t.text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.color = t.gold; e.currentTarget.style.borderColor = `${t.gold}60` }}
          onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.borderColor = t.border }}>
          <span className="ca-refresh-icon">⟳</span> Refresh
        </button>
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
          onMarkReceived={async (target) => {
            // Single-bill form: target = { id, application_id }
            // Bulk form:        target = { ids: [...], label: 'WG000051 (4 bills)' }
            const isBulk = target && Array.isArray(target.ids)
            const body   = isBulk
              ? { purchase_ids: target.ids, action: 'mark_received' }
              : { purchase_id:  target.id,  action: 'mark_received' }
            try {
              const res = await authedFetch('/api/collection-audit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              })
              const j = await res.json()
              if (!res.ok || j.error) {
                setToast({ msg: j.error || 'Mark received failed', type: 'error', key: Date.now() })
                return
              }
              if (isBulk) {
                // Build a granular toast so the auditor can verify what
                // actually changed vs what was already done or skipped.
                const parts = [`${j.marked || 0} bill${j.marked === 1 ? '' : 's'} marked`]
                if (j.already_received  > 0) parts.push(`${j.already_received} already received`)
                if (j.skipped_audited   > 0) parts.push(`${j.skipped_audited} already weight-audited`)
                setToast({
                  msg:   `${target.label} — ${parts.join(', ')}.`,
                  type:  (j.marked || 0) > 0 ? 'success' : 'info',
                  key:   Date.now(),
                })
              } else {
                setToast({
                  msg: j.already_received
                    ? `${target.application_id} was already received.`
                    : `${target.application_id} marked received. Weight audit still pending.`,
                  type: 'success',
                  key: Date.now(),
                })
              }
              fetchAll()
            } catch (e) {
              setToast({ msg: e.message || 'Mark received failed', type: 'error', key: Date.now() })
            }
          }}
          onVerifySeal={async (consignmentId, sealNo) => {
            // Auditor types the number printed on the physical tamper bag.
            // Server-side compare: match → stamp seal_verified_at and the
            // bulk-receive / per-bill receive guards unlock for this
            // consignment. Mismatch → red toast, retry on the same row.
            try {
              const res = await authedFetch('/api/collection-audit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify_consignment_seal', consignment_id: consignmentId, seal_no: sealNo }),
              })
              const j = await res.json()
              if (!res.ok || j.error) {
                setToast({ msg: j.error || 'Seal verification failed', type: 'error', key: Date.now() })
                return false
              }
              setToast({
                msg: j.already ? 'Seal already verified.' : 'Tamper seal verified — receive unlocked.',
                type: 'success',
                key: Date.now(),
              })
              fetchAll()
              return true
            } catch (e) {
              setToast({ msg: e.message || 'Seal verification failed', type: 'error', key: Date.now() })
              return false
            }
          }}
          onReportNotReceived={async (bill, consignmentId) => {
            // Bill IS in the audit data but no physical gold — one-click → ops.
            try {
              const res = await authedFetch('/api/collection-audit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'report_not_received', purchase_id: bill.id, consignment_id: consignmentId || null }),
              })
              const j = await res.json().catch(() => ({}))
              if (!res.ok || j.error) { setToast({ msg: j.error || 'Report failed', type: 'error', key: Date.now() }); return false }
              setToast({ msg: j.already ? `${bill.application_id} already reported.` : `${bill.application_id} reported to ops — not received.`, type: 'success', key: Date.now() })
              fetchAll()
              return true
            } catch (e) { setToast({ msg: e.message || 'Report failed', type: 'error', key: Date.now() }); return false }
          }}
          onReportExtra={async ({ consignmentId, appId, gross, note }) => {
            // Physical bill that ISN'T in the audit data — App ID optional.
            try {
              const res = await authedFetch('/api/collection-audit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'report_extra_received', consignment_id: consignmentId || null, app_id: appId || null, gross_g: gross, note: note || null }),
              })
              const j = await res.json().catch(() => ({}))
              if (!res.ok || j.error) { setToast({ msg: j.error || 'Report failed', type: 'error', key: Date.now() }); return false }
              setToast({ msg: `Extra bill reported to ops${appId ? ` (${appId})` : ''}.`, type: 'success', key: Date.now() })
              return true
            } catch (e) { setToast({ msg: e.message || 'Report failed', type: 'error', key: Date.now() }); return false }
          }}
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
              { id: 'today',    label: 'Arriving today',    count: arrivalCounts.today,    color: t.gold,            attract: true  },
              { id: 'tomorrow', label: 'Arriving tomorrow', count: arrivalCounts.tomorrow, color: t.green,           attract: false },
              { id: 'others',   label: 'Others',            count: arrivalCounts.others,   color: t.blue || '#4a90d9', attract: false },
              { id: 'overdue',  label: 'Overdue',           count: arrivalCounts.overdue,  color: t.red,             attract: true  },
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
                  {`${kpis.outstationBranches} branch${kpis.outstationBranches === 1 ? '' : 'es'} · ${kpis.outstationBills} bill${kpis.outstationBills === 1 ? '' : 's'}`}
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
                    : `Nothing arriving ${arrivalFilter}`}
                </div>
                <div style={{ fontSize: '11px', color: t.text4 }}>
                  {hasSearchActive
                    ? 'Try a different keyword or clear search.'
                    : 'Switch the filter chip above to see other arrival windows.'}
                </div>
              </div>
            ) : (
              <div style={{ padding: '14px 16px 18px' }}>
                {/* Region tabs — one per region present in the active arrival
                    bucket. Selecting a tab swaps the branch grid below. */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingBottom: '14px', marginBottom: '14px', borderBottom: `1px solid ${t.border}` }}>
                  {outstationByRegion.map(({ region, branches }) => {
                    const regionBills = branches.reduce((s, b) => s + b.bills.length, 0)
                    const active = region === effectiveRegion
                    return (
                      <button key={region} type="button" onClick={() => setActiveRegion(region)}
                        style={{
                          background: active ? `${t.orange}18` : 'transparent',
                          border: `1px solid ${active ? `${t.orange}80` : t.border}`,
                          borderRadius: '999px',
                          padding: '7px 15px',
                          fontSize: '11.5px',
                          color: active ? t.orange : t.text2,
                          cursor: 'pointer',
                          fontWeight: active ? 700 : 600,
                          letterSpacing: '.04em',
                          textTransform: 'uppercase',
                          display: 'inline-flex', alignItems: 'center', gap: '8px',
                          transition: 'color .15s ease, background .15s ease, border-color .15s ease',
                          boxShadow: active ? `0 0 0 4px ${t.orange}12` : 'none',
                        }}
                        onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = `${t.orange}60`; e.currentTarget.style.color = t.orange } }}
                        onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text2 } }}>
                        {region}
                        <span style={{
                          fontSize: '10px',
                          color: active ? t.orange : t.text4,
                          background: active ? `${t.orange}25` : `${t.border}80`,
                          borderRadius: '999px', padding: '1px 7px', fontWeight: 700, fontFamily: 'monospace', minWidth: '20px', textAlign: 'center',
                        }}>{regionBills}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Active region's branch cards */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '5px',
                }}>
                  {(activeRegionData?.branches || []).map((b, i) => (
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
          isMobile={isMobile}
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
        <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '5px' }}>
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
function BranchDrilldown({ drill, outstationByBranch, bangaloreByBranch, t, onBack, onAudit, onMarkReceived, onVerifySeal, onReportNotReceived, onReportExtra }) {
  // Per-consignment input + in-flight state for the tamper-seal verifier.
  // Keyed by consignment id so multiple verifiers can be open at once
  // (e.g. a hub receiving two trucks in the same hour).
  const [sealInputs, setSealInputs] = useState({})
  const [sealBusy,   setSealBusy]   = useState({})
  // Extra-bill report form — open for one consignment at a time.
  const [extraFor,   setExtraFor]   = useState(null)   // consignment id or null
  const [extraForm,  setExtraForm]  = useState({ appId: '', gross: '', note: '' })
  const [extraBusy,  setExtraBusy]  = useState(false)
  const submitExtra = async (cid) => {
    const gross = parseFloat(extraForm.gross)
    if (!Number.isFinite(gross) || gross <= 0) return
    setExtraBusy(true)
    const ok = await onReportExtra?.({ consignmentId: cid, appId: extraForm.appId.trim(), gross, note: extraForm.note.trim() })
    setExtraBusy(false)
    if (ok) { setExtraFor(null); setExtraForm({ appId: '', gross: '', note: '' }) }
  }
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
      {groups.map((g, gi) => {
        // Bills in this group that haven't been count-received or weight-
        // audited yet -- these are the only ones the bulk button targets.
        const eligibleBills = (g.bills || []).filter(
          b => !b.count_received_at && b.audit_gross_weight == null,
        )
        const bulkLabel = g.consignment?.tmp_prf_no
          ? `${g.consignment.tmp_prf_no} (${eligibleBills.length} bill${eligibleBills.length === 1 ? '' : 's'})`
          : `${eligibleBills.length} bill${eligibleBills.length === 1 ? '' : 's'}`
        return (
          <Fragment key={g.consignment?.id || gi}>
            {g.consignment && (() => {
              const cid          = g.consignment.id
              const sealVerified = !!g.consignment.seal_verified_at
              const sealInput    = sealInputs[cid] || ''
              const verifyBusy   = !!sealBusy[cid]
              const submitSeal   = async () => {
                if (!sealInput.trim() || verifyBusy) return
                setSealBusy(prev => ({ ...prev, [cid]: true }))
                const ok = await onVerifySeal?.(cid, sealInput.trim())
                setSealBusy(prev => { const { [cid]: _, ...rest } = prev; return rest })
                if (ok) setSealInputs(prev => { const { [cid]: _, ...rest } = prev; return rest })
              }
              return (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  padding: '8px 10px',
                  background: sealVerified ? 'transparent' : `${t.orange}08`,
                  border: sealVerified ? 'none' : `1px solid ${t.orange}30`,
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '10px', color: t.gold, background: `${t.gold}18`, borderRadius: '5px', padding: '4px 10px', fontWeight: 700, letterSpacing: '.08em' }}>{g.consignment.tmp_prf_no || '—'}</span>
                    <span style={{ fontSize: '11px', color: t.text2 }}>
                      {g.consignment.branch_name} <span style={{ color: t.text4 }}>→</span> {g.consignment.movement_type === 'INTERNAL' ? g.consignment.dest_branch : 'HO'}
                    </span>
                    <span style={{ fontSize: '10px', color: t.text4, fontFamily: 'monospace' }}>{g.consignment.challan_no}</span>
                    {sealVerified && (
                      <span title={g.consignment.seal_verified_by_email ? `Verified by ${g.consignment.seal_verified_by_email}` : 'Tamper seal verified'}
                        style={{
                          fontSize: '10px', color: t.green,
                          background: `${t.green}18`,
                          border: `1px solid ${t.green}50`,
                          borderRadius: '5px',
                          padding: '3px 9px',
                          fontWeight: 800, letterSpacing: '.06em',
                          textTransform: 'uppercase',
                        }}>
                        ✓ Seal verified
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '10px', color: t.text3 }}>
                        <strong style={{ color: t.text2 }}>{g.bills.length}</strong> bill{g.bills.length === 1 ? '' : 's'}
                      </span>
                      {sealVerified && eligibleBills.length > 0 && (
                        <button
                          onClick={() => onMarkReceived?.({
                            ids:   eligibleBills.map(b => b.id),
                            label: bulkLabel,
                          })}
                          title={`Mark all ${eligibleBills.length} pending bill${eligibleBills.length === 1 ? '' : 's'} on this consignment as received`}
                          style={{
                            background:    `${t.green}12`,
                            color:         t.green,
                            border:        `1px solid ${t.green}50`,
                            borderRadius:  '8px',
                            padding:       '6px 12px',
                            fontSize:      '10.5px',
                            fontWeight:    700,
                            letterSpacing: '.02em',
                            cursor:        'pointer',
                            display:       'inline-flex',
                            alignItems:    'center',
                            gap:           '5px',
                            transition:    'background .15s ease, border-color .15s ease, transform .15s ease',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = `${t.green}22`; e.currentTarget.style.borderColor = `${t.green}90`; e.currentTarget.style.transform = 'translateY(-1px)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = `${t.green}12`; e.currentTarget.style.borderColor = `${t.green}50`; e.currentTarget.style.transform = 'translateY(0)' }}>
                          ✓ Mark all {eligibleBills.length} as received
                        </button>
                      )}
                      {onReportExtra && (
                        <button onClick={() => { setExtraFor(extraFor === cid ? null : cid); setExtraForm({ appId: '', gross: '', note: '' }) }}
                          title="A physical bill arrived that isn't listed here — report it to ops"
                          style={{ background: 'transparent', color: t.blue || '#4a90d9', border: `1px solid ${(t.blue || '#4a90d9')}50`, borderRadius: '8px', padding: '6px 12px', fontSize: '10.5px', fontWeight: 700, letterSpacing: '.02em', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {extraFor === cid ? '✕ Cancel' : '+ Extra bill received'}
                        </button>
                      )}
                    </span>
                  </div>
                  {extraFor === cid && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', background: `${(t.blue || '#4a90d9')}0c`, border: `1px solid ${(t.blue || '#4a90d9')}30`, borderRadius: 10, marginTop: 8 }}>
                      <span style={{ fontSize: '11px', color: t.blue || '#4a90d9', fontWeight: 700 }}>Extra bill received — report to ops</span>
                      <input value={extraForm.appId} onChange={e => setExtraForm(f => ({ ...f, appId: e.target.value }))} placeholder="App ID (optional)"
                        style={{ background: t.card, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '6px 10px', fontFamily: 'monospace', fontSize: '12px', color: t.text1, width: 150, outline: 'none', textTransform: 'uppercase' }} />
                      <input value={extraForm.gross} onChange={e => setExtraForm(f => ({ ...f, gross: e.target.value }))} placeholder="Gross g *" type="number" step="0.01"
                        style={{ background: t.card, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '6px 10px', fontFamily: 'monospace', fontSize: '12px', color: t.text1, width: 110, outline: 'none' }} />
                      <input value={extraForm.note} onChange={e => setExtraForm(f => ({ ...f, note: e.target.value }))} placeholder="Note (optional)"
                        style={{ flex: 1, minWidth: 140, background: t.card, border: `1px solid ${t.border2}`, borderRadius: 7, padding: '6px 10px', fontSize: '12px', color: t.text1, outline: 'none' }} />
                      <button onClick={() => submitExtra(cid)} disabled={extraBusy || !(parseFloat(extraForm.gross) > 0)}
                        style={{ background: parseFloat(extraForm.gross) > 0 ? (t.blue || '#4a90d9') : t.card2, color: parseFloat(extraForm.gross) > 0 ? '#fff' : t.text4, border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: '11px', fontWeight: 800, cursor: parseFloat(extraForm.gross) > 0 ? 'pointer' : 'not-allowed' }}>
                        {extraBusy ? 'Sending…' : 'Send to ops'}
                      </button>
                    </div>
                  )}
                  {!sealVerified && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: t.orange, fontWeight: 700, letterSpacing: '.02em', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        🔒 Tamper seal not verified
                      </span>
                      <span style={{ fontSize: '10.5px', color: t.text3 }}>
                        Receive is locked. Type the number printed on the physical bag to unlock.
                      </span>
                      <input
                        value={sealInput}
                        onChange={e => setSealInputs(prev => ({ ...prev, [cid]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') submitSeal() }}
                        placeholder="e.g. WG000004"
                        disabled={verifyBusy}
                        style={{
                          marginLeft: 'auto',
                          background: t.card,
                          border: `1px solid ${t.border2}`,
                          borderRadius: 7,
                          padding: '6px 10px',
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          color: t.text1,
                          width: 150,
                          outline: 'none',
                          textTransform: 'uppercase',
                        }} />
                      <button
                        onClick={submitSeal}
                        disabled={verifyBusy || !sealInput.trim()}
                        style={{
                          background: verifyBusy ? t.card2 : (sealInput.trim() ? t.gold : t.card2),
                          color:      sealInput.trim() ? '#1a0a00' : t.text4,
                          border:     'none',
                          borderRadius: 7,
                          padding: '7px 14px',
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: '.04em',
                          textTransform: 'uppercase',
                          cursor: verifyBusy || !sealInput.trim() ? 'not-allowed' : 'pointer',
                          opacity: verifyBusy ? 0.6 : 1,
                        }}>
                        {verifyBusy ? 'Verifying…' : 'Verify Seal'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
              {g.bills.map(bill => <BillCard key={bill.id} bill={bill} t={t} dateField={dateF}
                onAudit={() => onAudit(bill)}
                onMarkReceived={() => onMarkReceived?.(bill)}
                onReportNotReceived={() => onReportNotReceived?.(bill, g.consignment?.id)} />)}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

function BillCard({ bill, t, onAudit, onMarkReceived, onReportNotReceived, dateField }) {
  const previouslyAudited = bill.audit_gross_weight != null
  const countReceived     = !!bill.count_received_at && !previouslyAudited
  const age   = ageBadge(bill[dateField], t)
  const isTakeover = bill.transaction_type === 'TAKEOVER'

  // Status line + footer action are driven by three states:
  //   1. previouslyAudited      -> weight audit attempted, re-audit needed
  //   2. countReceived          -> count done, weight pending
  //   3. otherwise              -> nothing done yet
  // The "Mark as Received" button hides once count_received_at is stamped
  // (further marking would be a no-op anyway, and ops shouldn't see a
  // button for a step they've already completed).
  const borderColor = previouslyAudited ? `${t.red}50`
                    : countReceived     ? `${t.green}40`
                    : t.border

  return (
    <div style={{
      background:    t.card,
      border:        `1px solid ${borderColor}`,
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
        e.currentTarget.style.borderColor = borderColor
      }}>

      {/* Top row: Customer + Type + Age (blind audit identifies by customer,
          not the CRM application id) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '15px', color: t.text1, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-.01em' }}>{bill.customer_name || '—'}</span>
          <span style={{ fontSize: '9px', color: isTakeover ? t.purple : t.gold, background: isTakeover ? `${t.purple}18` : `${t.gold}18`, borderRadius: '4px', padding: '2px 7px', fontWeight: 700, letterSpacing: '.05em' }}>
            {bill.transaction_type || '—'}
          </span>
        </div>
        <span style={{ fontSize: '9px', color: age.color, background: age.bg, borderRadius: '4px', padding: '2px 7px', fontWeight: 700, whiteSpace: 'nowrap' }}>{age.label}</span>
      </div>

      {/* Meta */}
      <div style={{ fontSize: '11px', color: t.text4, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <span>{fmtDate(bill[dateField])}</span>
      </div>

      {/* Status + Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${t.border}40`, paddingTop: '10px', marginTop: '4px', gap: '8px', flexWrap: 'wrap' }}>
        {previouslyAudited ? (
          <span style={{ fontSize: '10px', color: t.red, background: `${t.red}18`, borderRadius: '4px', padding: '3px 8px', fontWeight: 700 }}>
            ⚠ Re-audit needed
          </span>
        ) : countReceived ? (
          <span style={{ fontSize: '10px', color: t.green, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              width: '14px', height: '14px', borderRadius: '50%',
              background: `${t.green}20`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', lineHeight: 1,
            }}>✓</span>
            Received — audit pending
          </span>
        ) : (
          <span style={{ fontSize: '10px', color: t.text4, fontWeight: 600 }}>
            Awaiting weight
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!previouslyAudited && onReportNotReceived && (
            <button onClick={() => { if (window.confirm(`Report ${bill.application_id} to ops as NOT RECEIVED (no physical gold)?`)) onReportNotReceived() }}
              title="Bill is in the audit data but no physical gold arrived — report to ops"
              style={{
                background: 'transparent', color: t.red, border: `1px solid ${t.red}50`,
                borderRadius: '8px', padding: '7px 12px', fontSize: '11px', fontWeight: 700,
                letterSpacing: '.02em', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${t.red}12` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              ⚠ Not received
            </button>
          )}
          {!previouslyAudited && !countReceived && (
            <button onClick={onMarkReceived}
              title="Bill is physically here — defer the weight audit"
              style={{
                background: 'transparent',
                color:      t.green,
                border:     `1px solid ${t.green}50`,
                borderRadius: '8px',
                padding:    '7px 12px',
                fontSize:   '11px',
                fontWeight: 700,
                letterSpacing: '.02em',
                cursor:     'pointer',
                display:    'inline-flex',
                alignItems: 'center',
                gap:        '5px',
                transition: 'background .15s ease, border-color .15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${t.green}12`; e.currentTarget.style.borderColor = `${t.green}80` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = `${t.green}50` }}>
              ✓ Mark as received
            </button>
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
    </div>
  )
}

// ─── Blind audit modal ─────────────────────────────────────────────────────
function AuditModal({ bill, t, isMobile, onClose, onDone, onError }) {
  const [weight,           setWeight]           = useState('')
  const [remark,           setRemark]           = useState(bill.audit_remark || '')
  const [busy,             setBusy]             = useState(false)
  const [revealed,         setRevealed]         = useState(null)   // { crm_gross, measured, discrepancy_g }
  // Set once the auditor clicks Re-weigh on the revealed panel — keeps
  // the remark required on the next submit cycle so a re-weigh always
  // carries an explanation.
  const [reweighRequired,  setReweighRequired]  = useState(false)
  // Flips true after the auditor has completed one re-weigh cycle
  // (clicked Re-weigh, entered a new reading, and submitted). Re-weigh
  // is a single-use action: once done, the button hides and the remark
  // becomes locked so the explanation can't be edited post-hoc.
  const [hasReweighed,     setHasReweighed]     = useState(false)

  const measured = parseFloat(weight)
  const valid    = Number.isFinite(measured) && measured > 0
  // Spec: the auditor just enters a weight and moves on — including on a
  // re-weigh. No reason / remark is required (the remark field stays available
  // but optional).
  const remarkNeeded = false
  const remarkLocked = hasReweighed && !!revealed     // re-weigh completed → remark is final

  function onWeightChange(v) {
    setWeight(v)
    if (revealed) setRevealed(null)
  }

  function onReweigh() {
    setRevealed(null)
    setReweighRequired(true)
  }

  async function submit(action) {
    if (!valid) { onError('Enter a valid measured gross weight'); return }
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
          // Second submit after the reveal panel has been shown — tells
          // the backend "auditor has seen the comparison and confirms."
          acknowledged_diff:  !!revealed,
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
        const d    = Number(j.discrepancy_g)
        const sign = d > 0 ? '+' : ''
        const diffLabel = `${sign}${d.toFixed(3)}g`
        const wording   = d > 0
          ? `received with extra weight (${diffLabel} over CRM)`
          : `received with shortfall noted (${diffLabel})`
        onDone(`${bill.application_id} ${wording}.${tail}`)
        return
      }
      if (res.ok && j.success && j.action === 'keep_pending') {
        onDone(`${bill.application_id} kept pending — discrepancy ${j.discrepancy_g}g recorded.`)
        return
      }
      // 409 with reveal: backend wants the auditor to SEE the comparison
      // before confirming. requires_remark left in for old payloads.
      if ((j.reveal || j.requires_remark) && j.crm_gross != null) {
        const d = Number(j.discrepancy_g)
        setRevealed({ crm_gross: Number(j.crm_gross), measured: Number(j.measured), discrepancy_g: d })
        // Pre-fill a default remark by sign so the auditor doesn't type
        // the same boilerplate every time. Skip when there's no
        // discrepancy (the field is hidden), and don't overwrite
        // anything the auditor has already typed (e.g. a re-weigh remark).
        if (!remark.trim() && Math.abs(d) >= 0.0005) {
          setRemark(d > 0
            ? 'Audit weight > CRM Weight'
            : 'Acceptable difference vary from different weighing scales'
          )
        }
        // If this submit followed a Re-weigh click, the cycle is now
        // complete — lock further re-weighs + freeze the remark.
        if (reweighRequired) setHasReweighed(true)
        return
      }
      onError(j.error || j.message || 'Audit action failed')
    } finally { setBusy(false) }
  }

  // Mobile: minimal overlay padding so the card uses the full viewport
  // (auditors hold the phone in one hand while operating the scale —
  // a half-screen modal with chrome around it wastes precious touch area).
  const overlay = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,.76)', backdropFilter: 'blur(6px)',
    zIndex: 1000,
    display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
    padding: isMobile ? '0' : '20px',
  }
  const card = {
    background: t.card,
    border: `1px solid ${t.border}`,
    borderRadius: isMobile ? '16px 16px 0 0' : '16px',
    maxWidth: '580px', width: '100%',
    maxHeight: isMobile ? '92vh' : 'none',
    overflowY: 'auto', overflowX: 'hidden',
    boxShadow: `0 20px 60px rgba(0,0,0,.7)`,
  }
  const label   = { fontSize: '10px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }

  const previouslyAudited = bill.audit_gross_weight != null

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* Hero header — more presence: larger glowing icon, subtle gold
            sheen across the top, app id sits as the visual focal point. */}
        <div style={{
          background: `linear-gradient(135deg, ${t.gold}1a 0%, ${t.gold}06 50%, transparent 100%)`,
          padding: isMobile ? '18px 18px 16px' : '26px 28px 22px',
          borderBottom: `1px solid ${t.border}`,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
            background: `linear-gradient(90deg, transparent, ${t.gold}80, transparent)`,
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '14px',
              background: `linear-gradient(135deg, ${t.gold}38, ${t.gold}12)`,
              border: `1px solid ${t.gold}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '26px',
              flexShrink: 0,
              boxShadow: `0 4px 16px ${t.gold}30, inset 0 1px 0 ${t.gold}40`,
            }}>⚖</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontSize: '9.5px', color: t.gold,
                letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 800,
                background: `${t.gold}15`,
                border: `1px solid ${t.gold}40`,
                borderRadius: '999px',
                padding: '3px 9px',
              }}>
                <span style={{
                  width: '5px', height: '5px', borderRadius: '50%',
                  background: t.gold,
                  boxShadow: `0 0 0 3px ${t.gold}25`,
                  animation: 'auditBlindPulse 1.8s ease-in-out infinite',
                }} />
                Blind Weight Entry
              </div>
              <div style={{ fontSize: '24px', color: t.text1, fontFamily: 'monospace', fontWeight: 800, marginTop: '8px', letterSpacing: '-.02em', lineHeight: 1.1 }}>{bill.application_id}</div>
              <div style={{ fontSize: '11.5px', color: t.text3, marginTop: '5px', fontWeight: 500 }}>
                <span style={{ color: t.text2 }}>{bill.customer_name}</span> <span style={{ opacity: 0.4 }}>·</span> {bill.branch_name} <span style={{ opacity: 0.4 }}>·</span> {fmtDate(bill.purchase_date)}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: isMobile ? '16px 18px' : '24px 28px', display: 'flex', flexDirection: 'column', gap: isMobile ? '14px' : '18px' }}>
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

          {/* Weight input — the hero. inputMode="decimal" forces the numeric
              keypad on mobile (no alpha keys); type="text" + pattern avoids
              the spinner arrows desktop browsers attach to type="number". */}
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '10px', gap: '8px',
            }}>
              <span style={label}>Measured Gross Weight</span>
              {valid && (
                <span style={{
                  fontSize: '9px', color: t.green,
                  background: `${t.green}15`,
                  border: `1px solid ${t.green}40`,
                  borderRadius: '999px',
                  padding: '2px 8px',
                  fontWeight: 700, letterSpacing: '.08em',
                }}>READY</span>
              )}
            </div>
            <div style={{
              position: 'relative',
              background: valid
                ? `linear-gradient(135deg, ${t.gold}0d 0%, ${t.gold}03 100%)`
                : t.card2 || t.card,
              borderRadius: '14px',
              padding: '2px',
              boxShadow: valid ? `0 0 0 1px ${t.gold}55, 0 4px 16px ${t.gold}18` : `0 0 0 1px ${t.border}`,
              transition: 'box-shadow .2s ease, background .2s ease',
            }}>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.,]?[0-9]*"
                autoComplete="off"
                autoFocus={!revealed}
                value={weight}
                onChange={e => onWeightChange(e.target.value.replace(',', '.'))}
                placeholder="0.000"
                aria-label="Measured gross weight in grams"
                readOnly={!!revealed}
                tabIndex={revealed ? -1 : 0}
                className="ca-weight-input"
                style={{
                  background: t.card2 || t.card,
                  border: 'none',
                  borderRadius: '12px',
                  padding: isMobile ? '20px 70px 20px 22px' : '24px 80px 24px 26px',
                  fontSize: isMobile ? '34px' : '42px',
                  color: revealed ? t.text2 : t.text1,
                  fontFamily: 'monospace',
                  fontWeight: 800,
                  letterSpacing: '-.025em',
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  cursor: revealed ? 'not-allowed' : 'text',
                }}
              />
              {revealed && (
                <span
                  title="Submitted reading is locked. Click Re-weigh below to enter a new measurement."
                  style={{
                    position: 'absolute',
                    left: isMobile ? '16px' : '22px',
                    top: '50%', transform: 'translateY(-50%)',
                    fontSize: isMobile ? '14px' : '16px',
                    color: t.text4,
                    pointerEvents: 'none',
                  }}
                >🔒</span>
              )}
              <div style={{
                position: 'absolute', right: isMobile ? '20px' : '26px', top: '50%', transform: 'translateY(-50%)',
                fontSize: isMobile ? '16px' : '20px',
                color: valid ? t.gold : t.text4,
                fontWeight: 700,
                fontFamily: 'monospace',
                pointerEvents: 'none',
                opacity: 0.8,
                transition: 'color .15s ease',
              }}>g</div>
            </div>
            {!revealed && (
              <div style={{
                fontSize: '11px',
                color: t.text3,
                marginTop: '12px',
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px',
                background: `${t.text4}08`,
                border: `1px dashed ${t.text4}30`,
                borderRadius: '8px',
              }}>
                <span style={{ fontSize: '13px', opacity: 0.7 }}>🔒</span>
                <span><strong style={{ color: t.text2 }}>CRM gross is hidden.</strong> Weigh on the scale and submit your reading to compare.</span>
              </div>
            )}
          </div>

          {/* Reveal panel — shown for every comparison (match, over, short).
              Color codes by diff sign so the auditor reads the outcome
              before drilling into the numbers. */}
          {revealed && (() => {
            const d         = Number(revealed.discrepancy_g || 0)
            const isMatch   = Math.abs(d) < 0.0005
            const isOver    = d > 0
            const panelColor = isMatch ? (t.green || '#3aaa6a')
                            : isOver  ? (t.gold  || '#c9a84c')
                            :           (t.red   || '#c03030')
            const headerIcon  = isMatch ? '✓' : isOver ? 'ℹ' : '⚠'
            const headerLabel = isMatch ? 'Weight verified'
                              : isOver  ? 'Extra weight noted'
                              :           'Shortfall detected'
            const detail = isMatch
              ? 'Measured weight matches CRM exactly.'
              : isOver
                ? `Measured ${d.toFixed(3)}g MORE than CRM. Captured for the audit report.`
                : `Measured ${Math.abs(d).toFixed(3)}g LESS than CRM. Captured for the audit report.`
            return (
              <div style={{
                padding: '16px 18px',
                borderRadius: '12px',
                background: `${panelColor}10`,
                border: `1px solid ${panelColor}50`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <span style={{
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: panelColor, color: '#fff',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 900,
                  }}>{headerIcon}</span>
                  <div style={{ fontSize: '11px', color: panelColor, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                    {headerLabel}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  <Reveal t={t} label="Your reading" value={fmtWt(revealed.measured)} color={t.text1} />
                  <Reveal t={t} label="CRM gross"    value={fmtWt(revealed.crm_gross)} color={t.gold} />
                  <Reveal t={t} label="Δ"            value={isMatch ? '0.000g' : `${isOver ? '+' : ''}${d.toFixed(3)}g`} color={panelColor} />
                </div>
                <div style={{ fontSize: '12px', color: t.text2, marginTop: '14px' }}>
                  {detail}
                </div>
              </div>
            )
          })()}

          {/* Show remark when:
                - re-weigh entry mode (auditor must enter one), OR
                - in revealed state AND (there's a discrepancy OR a remark was
                  already captured during a re-weigh cycle).
              Hidden silently when an audit lands exactly on CRM. */}
          {(reweighRequired || (revealed && (Math.abs(Number(revealed.discrepancy_g || 0)) >= 0.0005 || hasReweighed))) && (
            <div>
              <div style={{ ...label, marginBottom: '6px' }}>
                Audit Remark
                {remarkLocked ? (
                  <span style={{ color: t.text3, textTransform: 'none', letterSpacing: 'normal' }}> 🔒 (locked — re-weigh complete)</span>
                ) : remarkNeeded ? (
                  <span style={{ color: t.red, textTransform: 'none', letterSpacing: 'normal' }}> (required for re-weigh)</span>
                ) : (
                  <span style={{ color: t.text4, textTransform: 'none', letterSpacing: 'normal' }}> (optional)</span>
                )}
              </div>
              <textarea
                value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder="Why is there a difference? e.g. stones in casing, packing residue, scale calibration drift…"
                rows={2}
                readOnly={remarkLocked}
                style={{
                  background:   remarkLocked ? `${t.text4}08` : (t.card2 || t.card),
                  border:       `1px solid ${remarkLocked ? `${t.text4}40` : t.border}`,
                  borderRadius: '10px',
                  padding:      '11px 14px',
                  fontSize:     '13px',
                  color:        remarkLocked ? t.text2 : t.text1,
                  outline:      'none',
                  width:        '100%',
                  boxSizing:    'border-box',
                  resize:       remarkLocked ? 'none' : 'vertical',
                  fontFamily:   'inherit',
                  cursor:       remarkLocked ? 'not-allowed' : 'text',
                }}
              />
            </div>
          )}
        </div>

        {/* Action footer — single row on desktop; stacks on mobile so each
            button gets full width for one-handed scale operation. Tightened
            paddings + shorter "Mark Received" CTA so all four fit in one
            row inside the 580px modal. */}
        <div style={{
          padding: isMobile ? '14px 18px' : '14px 22px',
          borderTop: `1px solid ${t.border}`,
          background: t.card2 || t.card,
          display: 'flex',
          gap: isMobile ? '8px' : '6px',
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexDirection: isMobile ? 'column-reverse' : 'row',
          flexWrap: 'nowrap',
        }}>
          <button onClick={onClose}
            style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: isMobile ? '11px 20px' : '9px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Cancel
          </button>
          {!revealed ? (
            <button onClick={() => submit('receive')} disabled={busy || !valid || (remarkNeeded && !remark.trim())}
              style={{
                background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px',
                padding: isMobile ? '11px 26px' : '9px 18px', fontSize: '12.5px', fontWeight: 700,
                cursor: busy ? 'default' : 'pointer',
                opacity: (busy || !valid || (remarkNeeded && !remark.trim())) ? .5 : 1, letterSpacing: '.02em',
                boxShadow: (!busy && valid && (!remarkNeeded || remark.trim())) ? `0 2px 8px ${t.gold}50` : 'none',
                transition: 'opacity .15s, box-shadow .15s',
                whiteSpace: 'nowrap',
              }}>
              {busy ? 'Comparing…' : 'Submit & Compare →'}
            </button>
          ) : (
            <>
              {!hasReweighed && (
                <button onClick={onReweigh} disabled={busy}
                  title="Re-weigh on the scale and enter a new reading. A remark will be required. Re-weigh can only be done once per audit."
                  style={{ background: 'transparent', border: `1px solid ${t.blue || '#3a8fbf'}80`, borderRadius: '8px', padding: isMobile ? '11px 18px' : '9px 12px', fontSize: '11.5px', color: t.blue || '#3a8fbf', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1, whiteSpace: 'nowrap' }}>
                  ↻ Re-weigh
                </button>
              )}
              <button onClick={() => submit('keep_pending')} disabled={busy || !valid}
                style={{ background: 'transparent', border: `1px solid ${t.orange}80`, borderRadius: '8px', padding: isMobile ? '11px 18px' : '9px 12px', fontSize: '11.5px', color: t.orange, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1, whiteSpace: 'nowrap' }}>
                Keep Pending
              </button>
              <button onClick={() => submit('receive')} disabled={busy || !valid}
                style={{
                  background: t.green, color: '#0a0a0a', border: 'none', borderRadius: '8px',
                  padding: isMobile ? '11px 22px' : '9px 14px', fontSize: '12px', fontWeight: 700,
                  cursor: busy ? 'default' : 'pointer',
                  opacity: (busy || !valid) ? .5 : 1,
                  boxShadow: !busy && valid ? `0 2px 8px ${t.green}50` : 'none',
                  transition: 'opacity .15s, box-shadow .15s',
                  whiteSpace: 'nowrap',
                }}>
                {busy ? 'Saving…' : '✓ Mark Received'}
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

// ── Shift context banner ───────────────────────────────────────────────────
// Top-of-page strip shown to role='audit' users only. Names which shift
// they're on and what that shift covers, so a Night Weight auditor doesn't
// look for Melting tasks that don't exist, and a Morning auditor knows
// they're expected to flag bills ready for melting (workflow lands with
// the Melting module — for now this is just an expectation-setter).
function ShiftContextBanner({ shiftType, t }) {
  const isNight = shiftType === 'night'
  const accent  = isNight ? (t.gold || '#c9a84c') : (t.orange || '#e9a942')
  const icon    = isNight ? '🌙' : '☀'
  const title   = isNight ? "You're on the Night shift" : "You're on the Morning shift"
  const detail  = isNight
    ? 'Tonight you do the weight audit only — measure each bill and flip it to received.'
    : 'This morning you do the weight audit and flag bills ready for melting. Melting workflow lands with the dedicated module — for now, focus on weight.'

  return (
    <div style={{
      background:  `linear-gradient(135deg, ${accent}14 0%, ${accent}04 60%, transparent 100%)`,
      border:      `1px solid ${accent}40`,
      borderLeft:  `4px solid ${accent}`,
      borderRadius: '12px',
      padding:     '12px 16px',
      display:     'flex',
      alignItems:  'center',
      gap:         '14px',
      boxShadow:   `0 2px 12px ${accent}10`,
    }}>
      <div style={{
        flexShrink: 0,
        width: '38px', height: '38px', borderRadius: '10px',
        background: `linear-gradient(135deg, ${accent}30, ${accent}10)`,
        border:     `1px solid ${accent}40`,
        color:      accent,
        display:    'flex', alignItems: 'center', justifyContent: 'center',
        fontSize:   '18px',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12.5px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em' }}>
          {title}
        </div>
        <div style={{ fontSize: '11px', color: t.text3, marginTop: '3px', lineHeight: 1.5 }}>
          {detail}
        </div>
      </div>
      <span style={{
        fontSize: '9px',
        color: accent,
        background: `${accent}18`,
        border: `1px solid ${accent}50`,
        borderRadius: '999px',
        padding: '4px 10px',
        fontWeight: 700,
        letterSpacing: '.08em',
        flexShrink: 0,
      }}>
        {isNight ? 'WEIGHT ONLY' : 'WEIGHT + MELTING'}
      </span>
    </div>
  )
}
