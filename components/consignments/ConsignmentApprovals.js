'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../lib/context'
import GoldSpinner from '../ui/GoldSpinner'
import Toast from '../ui/Toast'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', border2: '#252525', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', orange: '#c9981f', purple: '#8c5ac8' },
  light: { bg: '#f5f0e8', card: '#faf7f2', card2: '#e0d9cc', text1: '#1a1208', text2: '#3a2a10', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#9a7228', border: '#e0dace', border2: '#c5bca8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a', orange: '#a07010', purple: '#6a3a9a' },
}

const fmt   = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—'
const fmtWt = (n) => n != null ? `${Number(n).toFixed(3)}g` : '—'
const fmtTS = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

async function previewDoc(url, filename, onError) {
  // Approval-side preview: append ?preview=accounts so the gate lets it through
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(`${url}${sep}preview=accounts`)
  if (!res.ok) {
    let msg = `Preview failed: ${res.status}`
    try { const j = await res.json(); if (j.error) msg = j.error } catch {}
    onError?.(msg); return
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function ConsignmentApprovals() {
  const { theme, user, userProfile } = useApp()
  const t = THEMES[theme]
  const userEmail = user?.email || userProfile?.email || null

  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  const [toast, setToast] = useState(null)

  const fetchPending = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/consignments?action=pending_approvals')
    const j = await r.json()
    setPending(j.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchPending() }, [fetchPending])

  async function approve(c) {
    if (!confirm(`Approve ${c.tmp_prf_no}? Operations team will be able to download all documents.`)) return
    setActionId(c.id + ':approve')
    try {
      const r = await fetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_consignment', id: c.id, approver_email: userEmail }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { setToast({ msg: j.error || 'Approval failed', type: 'error' }); return }
      setToast({ msg: `Approved ${c.tmp_prf_no} — ops can now download`, type: 'success' })
      await fetchPending()
    } finally { setActionId(null) }
  }

  async function reject(c) {
    const reason = prompt(`Reject ${c.tmp_prf_no}?\n\nEnter a reason (operator will see this):`)
    if (!reason || !reason.trim()) return
    setActionId(c.id + ':reject')
    try {
      const r = await fetch('/api/consignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject_approval', id: c.id, approver_email: userEmail, reason: reason.trim() }),
      })
      const j = await r.json()
      if (!r.ok || j.error) { setToast({ msg: j.error || 'Rejection failed', type: 'error' }); return }
      setToast({ msg: `Rejected ${c.tmp_prf_no}`, type: 'info' })
      await fetchPending()
    } finally { setActionId(null) }
  }

  const card    = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }
  const btnOut  = { background: 'transparent', border: `1px solid ${t.border2}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }

  if (loading) return <div style={{ padding: '60px', textAlign: 'center' }}><GoldSpinner /></div>

  return (
    <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 300, color: t.text1, letterSpacing: '.02em' }}>
            Pending Approvals
          </div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '4px' }}>
            {pending.length === 0
              ? 'No consignments awaiting approval'
              : `${pending.length} consignment${pending.length !== 1 ? 's' : ''} waiting — review and approve or reject`}
          </div>
        </div>
        <button onClick={fetchPending} style={btnOut}>⟳ Refresh</button>
      </div>

      {pending.length === 0 ? (
        <div style={{ ...card, padding: '60px 20px', textAlign: 'center', color: t.text4 }}>
          <div style={{ fontSize: '40px', marginBottom: '8px' }}>✓</div>
          <div style={{ fontSize: '13px' }}>All caught up — no pending approvals.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pending.map(c => {
            const isType   = c.movement_type === 'INTERNAL'
            const isApproveBusy = actionId === c.id + ':approve'
            const isRejectBusy  = actionId === c.id + ':reject'
            return (
              <div key={c.id} style={{ ...card, padding: '16px 20px' }}>
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '15px', color: t.gold, fontWeight: 700, fontFamily: 'monospace' }}>{c.tmp_prf_no}</span>
                      <span style={{ fontSize: '10px', color: isType ? t.purple : t.orange, background: `${isType ? t.purple : t.orange}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>
                        {isType ? 'Via Hub' : 'Direct → HO'}
                      </span>
                      <span style={{ fontSize: '10px', color: t.orange, background: `${t.orange}15`, borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>
                        ⏳ Pending Approval
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: t.text2, marginTop: '6px' }}>
                      <strong>{c.branch_name}</strong>
                      <span style={{ color: t.text4, margin: '0 6px' }}>→</span>
                      {isType ? c.dest_branch : 'Head Office'}
                    </div>
                    <div style={{ fontSize: '11px', color: t.text4, marginTop: '4px' }}>
                      Created {fmtTS(c.created_at)} · by {c.created_by || 'unknown'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => reject(c)} disabled={!!actionId}
                      style={{ background: 'transparent', border: `1px solid ${t.red}`, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', color: t.red, fontWeight: 600, cursor: 'pointer', opacity: isRejectBusy ? 0.6 : 1 }}>
                      {isRejectBusy ? '…' : '✕ Reject'}
                    </button>
                    <button onClick={() => approve(c)} disabled={!!actionId}
                      style={{ ...btnGold, background: t.green, color: '#fff', opacity: isApproveBusy ? 0.6 : 1 }}>
                      {isApproveBusy ? '…' : '✓ Approve'}
                    </button>
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                  {[
                    ['Bills',     c.total_bills],
                    ['Net Wt',    fmtWt(c.total_net_wt)],
                    ['Value',     `₹${fmt(Math.round(c.total_amount))}`],
                    ['EWB',       c.eway_bill_no || '—'],
                    ['IRN',       c.irn ? String(c.irn).slice(0, 12) + '…' : '—'],
                  ].map(([label, val]) => (
                    <div key={label} style={{ background: t.card2, borderRadius: '7px', padding: '8px 12px' }}>
                      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: '12px', color: t.text1, fontWeight: 600, fontFamily: 'monospace', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Document previews */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: t.text3, alignSelf: 'center', marginRight: '6px' }}>Preview:</span>
                  <button onClick={() => previewDoc(`/api/generate-consignee-report?id=${c.id}`, `Report-${c.tmp_prf_no}.jpg`, msg => setToast({ msg, type: 'error' }))}
                    style={{ background: 'transparent', border: `1px solid ${t.purple}50`, borderRadius: '5px', padding: '4px 10px', fontSize: '10px', color: t.purple, fontWeight: 600, cursor: 'pointer' }}>
                    📋 Report
                  </button>
                  <button onClick={() => previewDoc(
                      isType ? `/api/generate-issue-voucher-pdf?id=${c.id}` : `/api/generate-challan-pdf?id=${c.id}`,
                      `${isType ? 'Voucher' : 'Challan'}-${c.tmp_prf_no}.pdf`,
                      msg => setToast({ msg, type: 'error' }))}
                    style={{ background: 'transparent', border: `1px solid ${t.gold}80`, borderRadius: '5px', padding: '4px 10px', fontSize: '10px', color: t.gold, fontWeight: 600, cursor: 'pointer' }}>
                    📄 {isType ? 'Voucher' : 'Challan'}
                  </button>
                  {c.eway_bill_no && (
                    <button onClick={() => previewDoc(`/api/eway-bill/pdf?id=${c.id}`, `EWB-${c.eway_bill_no}.pdf`, msg => setToast({ msg, type: 'error' }))}
                      style={{ background: 'transparent', border: `1px solid ${t.green}80`, borderRadius: '5px', padding: '4px 10px', fontSize: '10px', color: t.green, fontWeight: 600, cursor: 'pointer' }}>
                      ⚡ EWB ({c.eway_bill_no})
                    </button>
                  )}
                  {c.irn && (
                    <button onClick={() => previewDoc(`/api/e-invoice/pdf?id=${c.id}`, `EInvoice-${c.tmp_prf_no}.pdf`, msg => setToast({ msg, type: 'error' }))}
                      style={{ background: 'transparent', border: `1px solid ${t.purple}80`, borderRadius: '5px', padding: '4px 10px', fontSize: '10px', color: t.purple, fontWeight: 600, cursor: 'pointer' }}>
                      ⚡ E-Invoice
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
