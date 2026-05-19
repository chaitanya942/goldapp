'use client'

// components/consignments/PreviewModal.js
//
// Shared "preview the GST document before generating it" modal. Rendered by
// BOTH the accounts Pending Approvals screen (E-Invoice) and the operations
// Consignment Data screen (EWB self-service) so the review view is byte-for-
// byte identical wherever a document is generated.
//
// Purely presentational — all data + callbacks come in via props:
//   state = { type, consignment, loading, data, audit, generating, error }
//     type        : 'ewb' | 'irn'
//     consignment : the consignment row (uses tmp_prf_no)
//     loading     : preview fetch in flight
//     data        : /api/{eway-bill|e-invoice}/preview response
//     audit       : /api/consignments/document-audit response (optional)
//     generating  : the real NIC/IRP generate call is in flight
//     error       : string to show in the body
//   t        : theme tokens
//   onClose  : () => void
//   onConfirm: () => void   — fires the actual generation

import { createPortal } from 'react-dom'
import { DocAuditPanel } from './workflowParts'

function PreviewKpi({ t, label, value, accent }) {
  return (
    <div style={{ background: t.card, padding: '11px 14px' }}>
      <div style={{ fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '15px', color: accent, fontFamily: 'monospace', fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function PartyCard({ t, title, party }) {
  if (!party) return null
  return (
    <div style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '12px 14px' }}>
      <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: t.gold, marginBottom: '4px' }}>{party.gstin || '—'}</div>
      <div style={{ fontSize: '11px', color: t.text1, fontWeight: 600, marginBottom: '2px' }}>{party.legal_name || '—'}</div>
      <div style={{ fontSize: '10px', color: t.text2, lineHeight: 1.5 }}>
        {party.address1}{party.address2 ? ` ${party.address2}` : ''}
      </div>
      <div style={{ fontSize: '10px', color: t.text3, marginTop: '4px' }}>
        {party.location ? `${party.location} · ` : ''}{party.pin ? `PIN ${party.pin}` : ''}{party.state_code ? ` · ${party.state_code}` : ''}
      </div>
    </div>
  )
}

export default function PreviewModal({ state, t, onClose, onConfirm }) {
  const { type, consignment: c, loading, data, audit, generating, error } = state
  const isEwb   = type === 'ewb'
  const docName = isEwb ? 'E-Way Bill' : 'E-Invoice'
  const accent  = isEwb ? t.green : t.purple
  const fmtINR  = (n) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const summary = data?.summary
  const errors  = data?.validation_errors || []
  const blocked = errors.length > 0 || data?.already_generated || !data?.can_generate

  // Render via portal so the fixed overlay lives at <body> — escapes any
  // CSS containing-block created by ancestor transforms / filters / etc.
  if (typeof document === 'undefined') return null
  return createPortal((
    <div onClick={(e) => { if (e.target === e.currentTarget && !generating) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px', overflow: 'hidden' }}>
      <div style={{
        background: t.card, border: `1px solid ${accent}40`, borderRadius: '12px',
        width: '100%', maxWidth: '720px',
        maxHeight: 'calc(100vh - 40px)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,.6)',
        overflow: 'hidden',  // keeps the rounded corners on header / footer
      }}>

        {/* Header — always visible (outside the scrollable body) */}
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Preview before generation</div>
            <div style={{ fontSize: '1.05rem', color: accent, fontWeight: 600 }}>{docName} for {c.tmp_prf_no}</div>
            <div style={{ fontSize: '.7rem', color: t.text3, marginTop: '4px' }}>
              Review the values below. Click <strong>Confirm &amp; Generate</strong> only if everything matches the Voucher / Challan.
            </div>
          </div>
          <button onClick={onClose} disabled={generating} aria-label="Close preview" style={{ background: 'transparent', border: 'none', color: t.text3, fontSize: '18px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Body — flex-grow + scroll. Only this region scrolls when content overflows. */}
        <div style={{ padding: '18px 22px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading && <div style={{ textAlign: 'center', color: t.text3, fontSize: '12px', padding: '40px 0' }}>Loading preview…</div>}

          {error && (
            <div style={{ background: `${t.red}15`, border: `1px solid ${t.red}40`, borderRadius: '7px', padding: '10px 14px', fontSize: '12px', color: t.red, marginBottom: '12px' }}>
              {error}
            </div>
          )}

          {data?.already_generated && (
            <div style={{ background: `${t.orange}15`, border: `1px solid ${t.orange}40`, borderRadius: '7px', padding: '10px 14px', fontSize: '12px', color: t.orange, marginBottom: '12px' }}>
              {docName} already exists ({data.existing_ewb_no || data.existing_irn}). Cancel it first if you need to regenerate.
            </div>
          )}

          {errors.length > 0 && (
            <div style={{ background: `${t.red}10`, border: `1px solid ${t.red}30`, borderRadius: '7px', padding: '10px 14px', fontSize: '11px', color: t.red, marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Cannot generate — fix these first:</div>
              {errors.map((e, i) => <div key={i} style={{ marginTop: '2px' }}>· {e}</div>)}
            </div>
          )}

          {summary && (
            <>
              {/* Document number banner — accounts wants this front-and-centre,
                  especially for E-Invoice where the per-state sequence number
                  needs to be verified before generation. EWB shows the system
                  fingerprint (TMP_PRF + UUID prefix). */}
              <div style={{
                background:    `${accent}10`,
                border:        `1px solid ${accent}40`,
                borderRadius:  '8px',
                padding:       '10px 14px',
                marginBottom:  '14px',
                display:       'flex',
                justifyContent:'space-between',
                alignItems:    'center',
                gap:           '12px',
                flexWrap:      'wrap',
              }}>
                <div>
                  <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>
                    {isEwb ? 'EWB Document Number' : 'E-Invoice Number'}
                  </div>
                  <div style={{ fontSize: '14px', color: accent, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '.02em' }}>
                    {summary.document_no || '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>Date</div>
                  <div style={{ fontSize: '12px', color: t.text2, fontFamily: 'monospace' }}>{summary.document_date || '—'}</div>
                </div>
              </div>

              {/* Header KPIs — easy to scan against challan */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: t.border, borderRadius: '8px', overflow: 'hidden', marginBottom: '14px' }}>
                <PreviewKpi t={t} label="Quantity (Gross)" value={`${Number(summary.quantity_grams || 0).toFixed(3)}g`} accent={t.gold} />
                <PreviewKpi t={t} label="Taxable Amount"   value={fmtINR(summary.taxable_amount)} accent={t.blue} />
                <PreviewKpi t={t} label="Total Invoice"    value={fmtINR(summary.total_invoice)}  accent={t.green} />
              </div>

              {/* Side-by-side parties */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '14px' }}>
                <PartyCard t={t} title={isEwb ? 'From / Dispatch' : 'Seller'} party={summary.seller} />
                <PartyCard t={t} title={isEwb ? 'To / Ship'       : 'Buyer (HO)'} party={summary.buyer} />
              </div>

              {/* Tax breakdown */}
              <div style={{ background: t.card2 || t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
                <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>Tax breakdown</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '11px' }}>
                  <div><div style={{ color: t.text4 }}>Taxable</div><div style={{ color: t.text1, fontFamily: 'monospace', marginTop: '2px' }}>{fmtINR(summary.taxable_amount)}</div></div>
                  <div><div style={{ color: t.text4 }}>IGST{summary.igst_rate ? ` @${summary.igst_rate}%` : ''}</div><div style={{ color: t.text1, fontFamily: 'monospace', marginTop: '2px' }}>{fmtINR(summary.igst_amount)}</div></div>
                  <div><div style={{ color: t.text4 }}>CGST + SGST</div><div style={{ color: t.text1, fontFamily: 'monospace', marginTop: '2px' }}>{fmtINR((Number(summary.cgst_amount || 0) + Number(summary.sgst_amount || 0)))}</div></div>
                  <div><div style={{ color: t.text4 }}>Total</div><div style={{ color: t.green, fontFamily: 'monospace', marginTop: '2px', fontWeight: 600 }}>{fmtINR(summary.total_invoice)}</div></div>
                </div>
                {isEwb && summary.distance_km != null && (
                  <div style={{ marginTop: '10px', fontSize: '10px', color: t.text3 }}>Distance: <strong style={{ color: t.text2 }}>{summary.distance_km} km</strong> · HSN: <strong style={{ color: t.text2 }}>{summary.hsn}</strong> · Sub-supply: <strong style={{ color: t.text2 }}>{summary.sub_supply_type}</strong></div>
                )}
              </div>

              {/* Cross-doc consistency audit — only shown if audit fetched successfully */}
              {audit && <DocAuditPanel t={t} audit={audit} />}

              {/* Items list */}
              {summary.items?.length > 0 && (
                <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '14px' }}>
                  <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, fontSize: '.6rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Items ({summary.items.length})</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Bill', 'Customer', 'Gross', 'Net', 'Value'].map(h =>
                      <th key={h} style={{ padding: '7px 12px', fontSize: '9px', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: ['Gross','Net','Value'].includes(h) ? 'right' : 'left', fontWeight: 500, borderBottom: `1px solid ${t.border}` }}>{h}</th>
                    )}</tr></thead>
                    <tbody>
                      {summary.items.map((it, i) => (
                        <tr key={i} style={{ borderBottom: i === summary.items.length - 1 ? 'none' : `1px solid ${t.border}25` }}>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.gold, fontFamily: 'monospace' }}>{it.bill_no || '—'}</td>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.text1 }}>{it.customer || '—'}</td>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.gold, textAlign: 'right', fontFamily: 'monospace' }}>{Number(it.gross_weight).toFixed(3)}g</td>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.text2, textAlign: 'right', fontFamily: 'monospace' }}>{Number(it.net_weight).toFixed(3)}g</td>
                          <td style={{ padding: '7px 12px', fontSize: '11px', color: t.blue, textAlign: 'right', fontFamily: 'monospace' }}>{fmtINR(it.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ fontSize: '10px', color: t.text4, textAlign: 'center' }}>
                Document #: <span style={{ fontFamily: 'monospace', color: t.text2 }}>{summary.document_no}</span> · Date: <span style={{ fontFamily: 'monospace', color: t.text2 }}>{summary.document_date}</span>
              </div>
            </>
          )}
        </div>

        {/* Footer — always visible (outside scroll region) */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: `${t.card2 || t.card}80`, flexShrink: 0 }}>
          <div style={{ fontSize: '10px', color: t.text4 }}>
            {!blocked && !generating && '⚠ Clicking Confirm will generate this on the GST portal — real legal document.'}
            {blocked && '✕ Generation blocked — see issues above.'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} disabled={generating}
              style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '7px 16px', fontSize: '11px', color: t.text3, cursor: 'pointer' }}>
              Close
            </button>
            <button onClick={onConfirm} disabled={blocked || generating || loading}
              style={{ background: blocked || generating ? t.border : accent, color: blocked || generating ? t.text3 : '#fff', border: 'none', borderRadius: '6px', padding: '7px 18px', fontSize: '11px', fontWeight: 700, cursor: blocked || generating || loading ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1 }}>
              {generating ? 'Generating…' : `Confirm & Generate ${docName}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}
