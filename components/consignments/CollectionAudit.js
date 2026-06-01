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
  if (ms < 0) return { label: 'just now', color: t.green, bg: `${t.green}15` }
  const days = Math.floor(ms / 86400000)
  let label
  if (days >= 1) label = `${days}d old`
  else {
    const hrs = Math.floor(ms / 3600000)
    if (hrs >= 1) label = `${hrs}h old`
    else { const mins = Math.max(1, Math.floor(ms / 60000)); label = `${mins}m old` }
  }
  const color = days < 1 ? t.green : days < 3 ? t.gold : days < 7 ? t.orange : t.red
  return { label, color, bg: `${color}18` }
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

  // Aggregate bills by source branch.
  const outstationByBranch = useMemo(() => {
    const m = new Map()
    for (const g of outstation) {
      const k = g.consignment?.branch_name || '—'
      if (!m.has(k)) m.set(k, { branch: k, consignments: [], bills: [] })
      const entry = m.get(k)
      entry.consignments.push(g.consignment)
      entry.bills.push(...g.bills.map(b => ({ ...b, _consignment: g.consignment })))
    }
    return [...m.values()].sort((a, b) => (oldestAge(a.consignments, 'dispatched_at') ?? Infinity) - (oldestAge(b.consignments, 'dispatched_at') ?? Infinity))
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
  const filteredOutstationByBranch = useMemo(
    () => outstationByBranch.filter(b => matchesQuery(b, search)),
    [outstationByBranch, search],
  )
  const filteredBangaloreByBranch = useMemo(
    () => bangaloreByBranch.filter(b => matchesQuery(b, search)),
    [bangaloreByBranch, search],
  )

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

      {/* ─── Hero header ─── */}
      <div style={{
        background:  `linear-gradient(135deg, ${t.card} 0%, ${t.card2 || t.card} 100%)`,
        border:      `1px solid ${t.border}`,
        borderRadius: '14px',
        padding:     '22px 26px',
        display:     'flex',
        flexDirection: 'column',
        gap:         '18px',
        position:    'relative',
        overflow:    'hidden',
      }}>
        {/* Subtle gold sheen */}
        <div style={{ position: 'absolute', top: '-50%', right: '-10%', width: '50%', height: '200%', background: `radial-gradient(ellipse at center, ${t.gold}10 0%, transparent 70%)`, pointerEvents: 'none' }} />

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
              style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '9px', padding: '9px 14px', fontSize: '11px', color: t.text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              onMouseEnter={e => { e.currentTarget.style.color = t.gold; e.currentTarget.style.borderColor = `${t.gold}60` }}
              onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.borderColor = t.border }}>
              ⟳ Refresh
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
          <BranchPool
            t={t}
            accent={t.orange}
            badge="OUTSTATION"
            title="In-Transit Branches"
            subtitle={hasSearchActive
              ? `${kpis.outstationBranches} matching branch${kpis.outstationBranches === 1 ? '' : 'es'} · ${kpis.outstationBills} bill${kpis.outstationBills === 1 ? '' : 's'}`
              : `${kpis.outstationBranches} branch${kpis.outstationBranches === 1 ? '' : 'es'} · ${kpis.outstationBills} bill${kpis.outstationBills === 1 ? '' : 's'} awaiting receipt`}
            empty={hasSearchActive ? `No outstation matches for "${search}"` : 'No outstation consignments are currently in transit.'}
            branches={filteredOutstationByBranch.map(b => ({
              branch:        b.branch,
              billCount:     b.bills.length,
              extraLabel:    `${b.consignments.length} consignment${b.consignments.length === 1 ? '' : 's'}`,
              oldestAt:      oldestAge(b.consignments, 'dispatched_at'),
              dispatchedYmd: latestDispatchDate(b.consignments),
              arrivalAt:     earliestArrival(b.consignments),
              discrepancies: b.bills.filter(x => x.audit_gross_weight != null).length,
            }))}
            onPick={(branch) => setDrillBranch({ name: branch, pool: 'outstation' })}
          />

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
    <div style={{ background: `${color}10`, border: `1px solid ${color}30`, borderRadius: '10px', padding: '10px 16px', minWidth: '90px', textAlign: 'center' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '20px', color, fontWeight: 700, fontFamily: 'monospace', marginTop: '4px', lineHeight: 1 }}>{value}</div>
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
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
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
  // "Urgent" border kicks in for stale dispatches OR overdue arrivals so the
  // auditor's eye lands on the cards that genuinely need attention.
  const ageUrgent     = age.color === t.red || age.color === t.orange
  const arrivalUrgent = arrival?.diff != null && arrival.diff <= 0
  const urgent        = ageUrgent || arrivalUrgent
  const urgentBorder  = arrivalUrgent ? `${arrival.color}50` : `${age.color}40`
  return (
    <button onClick={onPick}
      style={{
        background:    t.card,
        border:        `1px solid ${urgent ? urgentBorder : t.border}`,
        borderRadius:  '12px',
        padding:       '0',
        cursor:        'pointer',
        textAlign:     'left',
        display:       'flex',
        flexDirection: 'column',
        position:      'relative',
        overflow:      'hidden',
        transition:    'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform   = 'translateY(-2px)'
        e.currentTarget.style.boxShadow   = `0 6px 18px ${accent}25, 0 0 0 1px ${accent}40 inset`
        e.currentTarget.style.borderColor = `${accent}80`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform   = 'translateY(0)'
        e.currentTarget.style.boxShadow   = 'none'
        e.currentTarget.style.borderColor = urgent ? urgentBorder : t.border
      }}>
      {/* Top accent stripe */}
      <div style={{ height: '3px', background: `linear-gradient(90deg, ${accent}, ${accent}40 80%, transparent)` }} />

      <div style={{ padding: '18px 18px 16px' }}>
        {/* Branch name + age pill */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '12px' }}>
          <div style={{ fontSize: '14px', color: t.text1, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.2, flex: 1 }}>{branch}</div>
          <span title="Age of oldest dispatch on this branch"
                style={{ fontSize: '9px', color: age.color, background: age.bg, borderRadius: '5px', padding: '3px 7px', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{age.label}</span>
        </div>

        {/* Hero count */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <div style={{ fontSize: '36px', color: accent, fontWeight: 700, lineHeight: 1, fontFamily: 'monospace', letterSpacing: '-.02em' }}>{billCount}</div>
          <div style={{ fontSize: '12px', color: t.text3, fontWeight: 500 }}>bill{billCount === 1 ? '' : 's'}</div>
        </div>

        {extraLabel && <div style={{ fontSize: '11px', color: t.text4, marginTop: '6px' }}>{extraLabel}</div>}

        {/* Dispatched + Expected-arrival rows. Calendar dates from the
            server; Sundays already excluded from the arrival calc upstream
            (addWorkingDaysSkipSunday — BVC doesn't operate Sundays). The
            auditor reads "left Friday → arrives Monday" at a glance. */}
        {(dispLbl || arrival) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '12px', paddingTop: '10px', borderTop: `1px dashed ${t.border}` }}>
            {dispLbl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '9px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, minWidth: '60px' }}>Dispatched</span>
                <span style={{ fontSize: '11px', color: t.text2, fontWeight: 600 }}>{dispLbl}</span>
              </div>
            )}
            {arrival && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '9px', color: t.text4, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, minWidth: '60px' }}>Arrives</span>
                <span style={{
                  fontSize: '10px', color: arrival.color, background: arrival.bg,
                  borderRadius: '5px', padding: '3px 8px', fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}>{arrival.label}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer row */}
      <div style={{
        marginTop:   'auto',
        padding:     '10px 18px',
        borderTop:   `1px solid ${t.border}40`,
        background:  `${accent}06`,
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'space-between',
        fontSize:    '10px',
      }}>
        {discrepancies > 0 ? (
          <span style={{ color: t.red, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            ⚠ {discrepancies} discrepancy{discrepancies === 1 ? '' : ' follow-ups'}
          </span>
        ) : (
          <span style={{ color: t.text4 }}>No discrepancies</span>
        )}
        <span style={{ color: accent, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          Open <span style={{ fontSize: '12px' }}>→</span>
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
