'use client'

import React, { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'
import { authedFetch } from '../../lib/authedFetch'
import { openPrompt } from '../ui/ConfirmDialog'

import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'

function nextNo(no) {
  return String((parseInt(no) || 0) + 1).padStart(6, '0')
}

export default function ConsignmentSeeds() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [loading, setLoading]       = useState(true)
  const [branches, setBranches]     = useState([])
  const [lastExternalNo, setLastExternalNo] = useState('—')
  const [message, setMessage]     = useState(null)
  const [collapsed, setCollapsed] = useState({})
  const [search, setSearch]       = useState('')
  const [exporting, setExporting] = useState(false)

  // One-shot bulk download of every old-CRM transaction since 2021-03-01.
  // Uses authedFetch so the user's session token is attached — direct browser
  // navigation to /api/crm-export-all would 401 (no Authorization header).
  // One-shot diagnostic — dump the column list of old-CRM transac_tbl
  // straight into the message banner so we can see the exact field names
  // (PAN / bank / payment ref live in a different column name per CRM).
  async function discoverCrmColumns() {
    setExporting(true)
    setMessage(null)
    try {
      const res = await authedFetch('/api/crm-transac-columns')
      const j   = await res.json()
      if (!res.ok || j.error) {
        setMessage({ type: 'error', text: j.error || `Discover failed: ${res.status}` })
        return
      }
      // Make the column list visible in the page banner, AND copy a clean
      // text version to clipboard so it's easy to paste back.
      const names = (j.columns || []).map(c => `${c.field}  (${c.type})`).join('\n')
      try { await navigator.clipboard.writeText(names) } catch {}
      setMessage({ type: 'success', text: `transac_tbl has ${j.columns?.length || 0} columns — list copied to clipboard. Open the browser console (F12) to see the full JSON (sample row included).` })
      console.log('[crm-transac-columns]', j)
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || 'Discover failed' })
    } finally {
      setExporting(false)
    }
  }

  async function downloadCrmExport() {
    setExporting(true)
    setMessage(null)
    try {
      const res = await authedFetch('/api/crm-export-all')
      if (!res.ok) {
        let msg = `Export failed: ${res.status}`
        try { const j = await res.json(); if (j.error) msg = j.error } catch {}
        setMessage({ type: 'error', text: msg })
        return
      }
      const blob = await res.blob()
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = `old-crm-export_from-2021-03-01_${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      setMessage({ type: 'success', text: 'Export downloaded. Open in Excel via Data → From Text/CSV (Text type for phone/PAN columns).' })
      setTimeout(() => setMessage(null), 6000)
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || 'Export failed' })
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => { fetchSeeds() }, [])

  async function fetchSeeds() {
    setLoading(true)
    const res  = await authedFetch('/api/consignment-seed')
    const data = await res.json()
    setBranches(data.branches || [])
    setLastExternalNo(data.last_external_no || '—')
    setLoading(false)
  }

  // One-prompt seed flow. Ops only need to set the TMP PRF (the "tamper-proof"
  // number) for a branch — external_no is a server-side placeholder that
  // never surfaces. Modal title and message show the *current* last-used value
  // so they know what they're modifying.
  async function setSeed(branch) {
    const current = branch.last_tmp_prf_no && branch.last_tmp_prf_no !== '—'
      ? branch.last_tmp_prf_no
      : null
    const newTmpPrf = await openPrompt({
      title:        `Edit last used TMP PRF for ${branch.branch_name}`,
      message:      current
        ? `Current last used: ${current}\n\nEnter the new last used TMP PRF. The next consignment from this branch will use the number right after this value.`
        : `No TMP PRF set yet for this branch.\n\nEnter the last used TMP PRF (e.g. WG000022). The next consignment will use the number right after this value.`,
      defaultValue: current || 'WG000000',
      placeholder:  'WG000022',
      rows:         1,
      maxLength:    20,
      confirmLabel: 'Save',
    })
    if (!newTmpPrf) return

    // Light validation — the value must look like WG followed by digits.
    const normalised = String(newTmpPrf).trim().toUpperCase()
    if (!/^WG\d{1,8}$/.test(normalised)) {
      setMessage({ type: 'error', text: 'TMP PRF must look like WG followed by digits (e.g. WG000022).' })
      setTimeout(() => setMessage(null), 4000)
      return
    }

    setLoading(true)
    const res = await authedFetch('/api/consignment-seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch_name: branch.branch_name,
        tmp_prf_no:  normalised,
        // external_no + challan_no left blank — server fills with placeholders
        state_code:  branch.branch_code?.substring(0, 2) || 'KA',
        branch_code: branch.branch_code,
      }),
    })
    const result = await res.json()
    if (result.success) {
      setMessage({ type: 'success', text: `TMP PRF for ${branch.branch_name} updated to ${normalised}` })
      fetchSeeds()
    } else {
      setMessage({ type: 'error', text: result.error })
    }
    setLoading(false)
    setTimeout(() => setMessage(null), 3000)
  }

  function toggleRegion(region) {
    setCollapsed(prev => ({ ...prev, [region]: !prev[region] }))
  }

  // Filter branches
  const filtered = branches.filter(b =>
    !search || b.branch_name.toLowerCase().includes(search.toLowerCase())
  )

  // Group by region
  const grouped = {}
  for (const b of filtered) {
    if (!grouped[b.region]) grouped[b.region] = []
    grouped[b.region].push(b)
  }
  const regions = Object.keys(grouped)

  function collapseAll() { const s = {}; regions.forEach(r => { s[r] = true }); setCollapsed(s) }
  function expandAll()   { setCollapsed({}) }

  const seeded    = branches.filter(b => b.last_tmp_prf_no !== '—').length
  const pending   = branches.length - seeded

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '4px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1 }}>Consignment Number Seeds</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>Manage initial sequence numbers for all outside-Bangalore branches</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={discoverCrmColumns} disabled={exporting}
            title="Dump the column list of old-CRM transac_tbl so we can wire PAN / bank / payment-ref into the sync"
            style={{ background: 'transparent', border: `1px solid ${t.purple}50`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.purple, cursor: exporting ? 'default' : 'pointer', fontWeight: 600 }}>
            ⌕ Discover CRM columns
          </button>
          <button onClick={downloadCrmExport} disabled={exporting}
            title="One-shot CSV download of every old-CRM transaction since 2021-03-01 (admin-only)"
            style={{ background: exporting ? t.card2 : `${t.blue}15`, border: `1px solid ${t.blue}50`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.blue, cursor: exporting ? 'default' : 'pointer', fontWeight: 600 }}>
            {exporting ? 'Working… (may take a few minutes)' : '↓ Download old-CRM CSV (since Mar 2021)'}
          </button>
          <button onClick={fetchSeeds} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }}>⟳ Refresh</button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div style={{ ...card, padding: '10px 14px', background: message.type === 'success' ? `${t.green}20` : `${t.red}20`, borderColor: message.type === 'success' ? t.green : t.red }}>
          <div style={{ fontSize: '12px', color: message.type === 'success' ? t.green : t.red }}>{message.text}</div>
        </div>
      )}

      {/* Stats bar — branches needing a seed, total seeded, plus the global
          last-used external_no (delivery challan counter) so ops can see at a
          glance where the sequence stands across every branch. */}
      <div style={{ display: 'flex', gap: '10px' }}>
        {[
          { label: 'Total Branches',      value: branches.length,                            color: t.gold },
          { label: 'Seeded',              value: seeded,                                     color: t.green },
          { label: 'Pending',             value: pending,                                    color: pending > 0 ? t.red : t.text4 },
          { label: 'Last External No',    value: lastExternalNo,                             color: t.blue, mono: true, sub: 'global · across all branches' },
        ].map(({ label, value, color, mono, sub }) => (
          <div key={label} style={{ flex: 1, background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 600, color, marginTop: '4px', fontFamily: mono ? 'monospace' : 'inherit', letterSpacing: mono ? '-.01em' : 'normal' }}>{value}</div>
            {sub && <div style={{ fontSize: '9px', color: t.text4, marginTop: '4px', letterSpacing: '.04em' }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Table card */}
      <div style={card}>
        {/* Controls */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search branch..."
            style={{ flex: 1, background: t.card2, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: t.text1, outline: 'none' }}
          />
          <button onClick={expandAll}   style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>Expand All</button>
          <button onClick={collapseAll} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>Collapse All</button>
          {!loading && <div style={{ fontSize: '11px', color: t.text4, whiteSpace: 'nowrap' }}>{filtered.length} branches</div>}
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: t.text4 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {['Branch', 'Last TMP PRF', 'Next TMP PRF', 'Action'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {regions.map(region => {
                  const regionBranches = grouped[region]
                  const isCollapsed    = !!collapsed[region]
                  const seededCount    = regionBranches.filter(b => b.last_tmp_prf_no !== '—').length
                  return (
                    <React.Fragment key={region}>
                      {/* Region header */}
                      <tr onClick={() => toggleRegion(region)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        <td colSpan={4} style={{ padding: '8px 12px', background: `${t.gold}14`, borderBottom: `1px solid ${t.border}`, borderTop: `1px solid ${t.border}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '10px', color: t.gold }}>{isCollapsed ? '▶' : '▼'}</span>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: t.gold, letterSpacing: '.1em', textTransform: 'uppercase' }}>{region}</span>
                            <span style={{ fontSize: '10px', color: t.text4 }}>{regionBranches.length} branches</span>
                            <span style={{ fontSize: '10px', color: t.green }}>{seededCount} seeded</span>
                            {seededCount < regionBranches.length && (
                              <span style={{ fontSize: '10px', color: t.red }}>⚠ {regionBranches.length - seededCount} pending</span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Branch rows */}
                      {!isCollapsed && regionBranches.map(b => {
                        const isSeeded      = b.last_tmp_prf_no !== '—'
                        const nextBranchTmp = isSeeded ? `WG${nextNo(b.last_tmp_prf_no.replace('WG', ''))}` : '—'
                        return (
                          <tr key={b.branch_name} style={{ borderBottom: `1px solid ${t.border}15` }}
                            onMouseEnter={e => e.currentTarget.style.background = `${t.gold}06`}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <td style={{ padding: '9px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                <span style={{ fontSize: '8px', color: isSeeded ? t.green : t.red }}>●</span>
                                <span style={{ fontSize: '12px', color: t.text1, fontWeight: 500 }}>{b.branch_name}</span>
                              </div>
                            </td>
                            <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold,  fontFamily: 'monospace', fontWeight: 600 }}>{b.last_tmp_prf_no}</td>
                            <td style={{ padding: '9px 12px', fontSize: '12px', color: t.green, fontFamily: 'monospace', fontWeight: 600 }}>{nextBranchTmp}</td>
                            <td style={{ padding: '9px 12px' }}>
                              <button onClick={() => setSeed(b)} style={btnGold}
                                title={isSeeded ? `Change the last used TMP PRF (currently ${b.last_tmp_prf_no})` : 'Set the last used TMP PRF for this branch'}>
                                {isSeeded ? 'Edit' : 'Set Seed'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
