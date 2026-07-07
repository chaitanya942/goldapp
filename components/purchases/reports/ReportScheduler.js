'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../../lib/context'
import { authedFetch, authedJson } from '../../../lib/authedFetch'

// Lazy-load a script once (same pattern as the SheetJS/xlsx loader elsewhere).
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(s)
  })
}

const THEMES = {
  dark:  { bg: '#0c0c0c', card: '#141414', card2: '#1a1a1a', text1: '#f0e6c8', text2: '#c8bda0', text3: '#8a7f66', gold: '#c9a84c', border: '#242424', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf', amber: '#e58a3b' },
  light: { bg: '#f5f1e8', card: '#ffffff', card2: '#faf7f0', text1: '#1a1208', text2: '#4a3f28', text3: '#7a6a4a', gold: '#9a7228', border: '#e0dace', green: '#2a8a52', red: '#c23b3b', blue: '#2a6a9a', amber: '#b5661f' },
}

const REPORT_ROLES = ['super_admin', 'founders_office', 'admin', 'accounts']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
const istYesterday = () => new Date(Date.now() + 5.5 * 3600000 - 86400000).toISOString().slice(0, 10)

const EMPTY = {
  report_key: 'purchase_report', label: '', enabled: true,
  frequency: 'daily', send_time: '09:30', weekdays: [1, 2, 3, 4, 5],
  report_date_basis: 'yesterday', recipients: '', cc: '',
}

function cadenceText(s) {
  const time = s.send_time || '09:00'
  if (s.frequency === 'daily') return `Daily · ${time}`
  const days = (s.weekdays || []).map(d => WEEKDAYS[d]).join(', ') || '—'
  return `${s.frequency === 'weekly' ? 'Weekly' : 'Custom'} · ${days} · ${time}`
}

// Per-report icon + accent colour (keyed on report_key, graceful fallback).
const REPORT_META = {
  purchase_report:    { icon: '📊', color: '#c9a84c' },
  purchase_register:  { icon: '📒', color: '#3a8fbf' },
  consignment_report: { icon: '📦', color: '#3aaa6a' },
}
const reportMeta = (key) => REPORT_META[key] || { icon: '📄', color: '#8a7f66' }

// Human status pill for last_status.
function statusMeta(s, t) {
  const st = s.last_status
  if (!s.last_sent_at || !st) return { label: 'Never sent', color: t.text3 }
  if (st === 'sent')          return { label: 'Sent', color: t.green }
  if (st === 'sent_empty')    return { label: 'Sent · no bills', color: t.green }
  if (st === 'skipped_empty') return { label: 'Skipped · no bills', color: t.amber }
  if (st === 'error')         return { label: 'Error', color: t.red }
  return { label: st, color: t.text3 }
}

// Relative "x ago" from an ISO timestamp.
function relTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

// Next scheduled fire time (IST), or null if paused / none in the next week.
function nextRun(s) {
  if (!s.enabled) return null
  const [hh, mm] = (s.send_time || '09:00').split(':').map(Number)
  const now = new Date(Date.now() + 5.5 * 3600000)   // IST wall-clock in UTC fields
  for (let d = 0; d < 8; d++) {
    const cand = new Date(now)
    cand.setUTCDate(cand.getUTCDate() + d)
    cand.setUTCHours(hh, mm, 0, 0)
    if (cand <= now) continue
    const wd = cand.getUTCDay()
    const ok = s.frequency === 'daily' || ((s.frequency === 'weekly' || s.frequency === 'custom') && (s.weekdays || []).includes(wd))
    if (ok) return cand
  }
  return null
}
function nextRunLabel(s) {
  const cand = nextRun(s)
  if (!cand) return null
  const now = new Date(Date.now() + 5.5 * 3600000)
  const time = `${String(cand.getUTCHours()).padStart(2, '0')}:${String(cand.getUTCMinutes()).padStart(2, '0')}`
  const dayDiff = Math.floor((Date.UTC(cand.getUTCFullYear(), cand.getUTCMonth(), cand.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000)
  if (dayDiff === 0) return `Today ${time}`
  if (dayDiff === 1) return `Tomorrow ${time}`
  return `${WEEKDAYS[cand.getUTCDay()]} ${time}`
}

export default function ReportScheduler() {
  const { theme, role } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const allowed = REPORT_ROLES.includes(role)

  const [schedules, setSchedules] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)      // null = not editing; object = create/edit
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)        // { kind:'ok'|'err', text }

  const [previewDate, setPreviewDate] = useState(istYesterday())
  const [preview, setPreview] = useState(null)  // { html, filename, xlsxBase64, subject, counts }
  const [previewBusy, setPreviewBusy] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [pngBusy, setPngBusy] = useState(false)
  const previewRef = useRef(null)

  const flash = (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await authedJson('/api/reports/schedules')
      setSchedules(data.schedules || [])
      setReports(data.reports || [])
    } catch (e) {
      if (!silent) flash('err', e.message || 'Failed to load schedules')
    } finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  // Poll every 30s so "last sent" / status updates after the cron dispatches,
  // without needing a manual refresh. Silent (no loading flash).
  useEffect(() => {
    if (!allowed) return
    const iv = setInterval(() => load(true), 30000)
    return () => clearInterval(iv)
  }, [allowed, load])

  const startNew = () => setForm({ ...EMPTY })
  const startEdit = (s) => setForm({
    ...s,
    recipients: (s.recipients || []).join(', '),
    cc: (s.cc || []).join(', '),
    weekdays: s.weekdays || [],
  })
  const cancel = () => setForm(null)

  const save = async () => {
    if (!form) return
    const recips = (form.recipients || '').split(',').map(x => x.trim()).filter(Boolean)
    if (!recips.length) return flash('err', 'Add at least one recipient email')
    setSaving(true)
    try {
      const payload = {
        report_key: form.report_key, label: form.label, enabled: form.enabled,
        frequency: form.frequency, send_time: form.send_time,
        weekdays: form.frequency === 'daily' ? [] : form.weekdays,
        report_date_basis: form.report_date_basis,
        recipients: recips, cc: (form.cc || '').split(',').map(x => x.trim()).filter(Boolean),
      }
      if (form.id) {
        await authedJson('/api/reports/schedules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: form.id, ...payload }) })
        flash('ok', 'Schedule updated')
      } else {
        await authedJson('/api/reports/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        flash('ok', 'Schedule created')
      }
      setForm(null); load()
    } catch (e) { flash('err', e.message || 'Save failed') } finally { setSaving(false) }
  }

  const toggleEnabled = async (s) => {
    try {
      await authedJson('/api/reports/schedules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, enabled: !s.enabled }) })
      load()
    } catch (e) { flash('err', e.message) }
  }

  const remove = async (s) => {
    if (!window.confirm(`Delete this schedule?\n\n${s.label || s.report_key} → ${(s.recipients || []).join(', ')}`)) return
    try {
      await authedJson(`/api/reports/schedules?id=${s.id}`, { method: 'DELETE' })
      flash('ok', 'Schedule deleted'); load()
    } catch (e) { flash('err', e.message) }
  }

  const runPreview = async () => {
    setPreviewBusy(true); setPreview(null)
    try {
      const rk = form?.report_key || 'purchase_report'
      const data = await authedJson(`/api/reports/preview?report=${rk}&date=${previewDate}`)
      setPreview(data)
    } catch (e) { flash('err', e.message || 'Preview failed') } finally { setPreviewBusy(false) }
  }

  const b64ToBlob = (b64, type) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: type || 'application/octet-stream' })
  }
  const downloadAttachment = (att) => {
    const url = URL.createObjectURL(b64ToBlob(att.contentBase64, att.contentType))
    const a = document.createElement('a'); a.href = url; a.download = att.filename; a.click()
    URL.revokeObjectURL(url)
  }
  const attLabel = (att) => {
    if (att.contentType?.includes('spreadsheet')) return 'Excel'
    if (att.contentType === 'image/png') return att.filename.replace(/^Consignment_/, '').replace(/_\d{4}-\d{2}-\d{2}\.png$/, '').replace(/_/g, ' ') || 'PNG'
    return att.filename
  }

  const downloadPng = async () => {
    if (!previewRef.current) return
    setPngBusy(true)
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')
      const canvas = await window.html2canvas(previewRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `Purchase_Report_${previewDate}.png`; a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    } catch (e) { flash('err', e.message || 'PNG export failed') } finally { setPngBusy(false) }
  }

  const sendTest = async () => {
    const recips = (form?.recipients || '').split(',').map(x => x.trim()).filter(Boolean)
    const to = recips.length ? recips : (window.prompt('Send test to (comma-separated emails):') || '').split(',').map(x => x.trim()).filter(Boolean)
    if (!to.length) return
    if (!window.confirm(`Send a REAL email now to:\n${to.join(', ')}\n\nReport date: ${previewDate}`)) return
    setSendBusy(true)
    try {
      const data = await authedJson('/api/reports/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: form?.report_key || 'purchase_report', date: previewDate, to }) })
      flash('ok', `Sent to ${to.join(', ')}${data.isEmpty ? ' (no bills that day)' : ''}`)
    } catch (e) { flash('err', e.message || 'Send failed') } finally { setSendBusy(false) }
  }

  if (!allowed) {
    return <div style={{ padding: 40, color: t.text3, fontSize: 13 }}>You don’t have access to report scheduling. (Requires admin or accounts role.)</div>
  }

  const inp = { background: t.card2, border: `1px solid ${t.border}`, borderRadius: 6, padding: '8px 10px', color: t.text1, fontSize: 13, outline: 'none' }
  const btn = (bg, fg) => ({ background: bg, color: fg, border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })
  const lbl = { fontSize: 11, color: t.text3, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }

  return (
    <div style={{ background: t.bg, minHeight: '100vh', padding: '20px 24px', color: t.text1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: t.text1 }}>Scheduled Reports</div>
          <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>Auto-email reports to Finance on a daily / weekly / custom schedule.</div>
        </div>
        {!form && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn(t.card2, t.text2)} onClick={() => load()} title="Refresh status">↻ Refresh</button>
            <button style={btn(t.gold, '#0c0c0c')} onClick={startNew}>+ New schedule</button>
          </div>
        )}
      </div>

      {msg && (
        <div style={{ margin: '10px 0', padding: '8px 12px', borderRadius: 6, fontSize: 13,
          background: msg.kind === 'ok' ? `${t.green}22` : `${t.red}22`,
          border: `1px solid ${msg.kind === 'ok' ? t.green : t.red}66`,
          color: msg.kind === 'ok' ? t.green : t.red }}>{msg.text}</div>
      )}

      {/* ── EDIT / CREATE FORM ─────────────────────────────────────────── */}
      {form && (
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 10, padding: 18, margin: '12px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>{form.id ? 'Edit schedule' : 'New schedule'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={lbl}>Report</label>
              <select style={{ ...inp, width: '100%' }} value={form.report_key} onChange={e => setForm(f => ({ ...f, report_key: e.target.value }))}>
                {reports.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Label (optional)</label>
              <input style={{ ...inp, width: '100%' }} value={form.label || ''} placeholder="e.g. Finance daily" onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Frequency</label>
              <select style={{ ...inp, width: '100%' }} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="custom">Custom days</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Send time (IST)</label>
              <input type="time" style={{ ...inp, width: '100%' }} value={form.send_time} onChange={e => setForm(f => ({ ...f, send_time: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Report covers</label>
              <select style={{ ...inp, width: '100%' }} value={form.report_date_basis} onChange={e => setForm(f => ({ ...f, report_date_basis: e.target.value }))}>
                <option value="yesterday">Previous day</option>
                <option value="today">Same day (till send time)</option>
              </select>
            </div>
          </div>

          {form.frequency !== 'daily' && (
            <div style={{ marginTop: 14 }}>
              <label style={lbl}>Days of week</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {WEEKDAYS.map((d, i) => {
                  const on = (form.weekdays || []).includes(i)
                  return (
                    <button key={i} onClick={() => setForm(f => ({ ...f, weekdays: on ? f.weekdays.filter(x => x !== i) : [...(f.weekdays || []), i].sort() }))}
                      style={{ ...btn(on ? t.gold : t.card2, on ? '#0c0c0c' : t.text2), border: `1px solid ${on ? t.gold : t.border}`, padding: '6px 12px' }}>{d}</button>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <label style={lbl}>Recipients (To) — comma-separated</label>
            <input style={{ ...inp, width: '100%' }} value={form.recipients} placeholder="finance@whitegold.money, cfo@whitegold.money" onChange={e => setForm(f => ({ ...f, recipients: e.target.value }))} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={lbl}>CC (optional)</label>
            <input style={{ ...inp, width: '100%' }} value={form.cc} placeholder="" onChange={e => setForm(f => ({ ...f, cc: e.target.value }))} />
          </div>

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: t.text2, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
              Enabled
            </label>
            <div style={{ flex: 1 }} />
            <button style={btn(t.card2, t.text2)} onClick={cancel}>Cancel</button>
            <button style={btn(t.green, '#fff')} disabled={saving} onClick={save}>{saving ? 'Saving…' : (form.id ? 'Update' : 'Create')}</button>
          </div>

          {/* Preview / test within the form context */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${t.border}` }}>
            <div style={{ fontSize: 12, color: t.text3, fontWeight: 700, marginBottom: 8 }}>PREVIEW &amp; TEST</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input type="date" style={inp} value={previewDate} max={istToday()} onChange={e => setPreviewDate(e.target.value)} />
              <button style={btn(t.blue, '#fff')} disabled={previewBusy} onClick={runPreview}>{previewBusy ? 'Building…' : 'Preview'}</button>
              {preview && !preview.isEmpty && (preview.attachments || []).map(att => (
                <button key={att.filename} style={btn(t.card2, t.text1)} onClick={() => downloadAttachment(att)}>⬇ {attLabel(att)}</button>
              ))}
              {preview && !preview.isEmpty && <button style={btn(t.card2, t.text1)} disabled={pngBusy} onClick={downloadPng}>{pngBusy ? 'Rendering…' : '⬇ Summary PNG'}</button>}
              <button style={btn(t.amber, '#0c0c0c')} disabled={sendBusy} onClick={sendTest}>{sendBusy ? 'Sending…' : 'Send now →'}</button>
            </div>
            {preview && preview.isEmpty && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, background: `${t.amber}18`, border: `1px solid ${t.amber}55`, color: t.amber }}>
                No purchases on {previewDate} — branches were likely closed (Sunday / holiday). Scheduled sends automatically skip empty days, so Finance won’t get a blank email. Pick a working day to preview a populated report.
              </div>
            )}
            {preview && !preview.isEmpty && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: t.text3, marginBottom: 6 }}>Subject: <span style={{ color: t.text1 }}>{preview.subject}</span></div>
                <div ref={previewRef} style={{ background: '#fff', borderRadius: 8, padding: 16, maxHeight: 480, overflow: 'auto', border: `1px solid ${t.border}` }}
                  dangerouslySetInnerHTML={{ __html: preview.html }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SUMMARY STRIP ──────────────────────────────────────────────── */}
      {!loading && schedules.length > 0 && (() => {
        const active = schedules.filter(s => s.enabled)
        const upcoming = active.map(s => ({ s, at: nextRun(s) })).filter(x => x.at).sort((a, b) => a.at - b.at)[0]
        const stat = (label, value, color) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: color || t.text1, lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>{label}</span>
          </div>
        )
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', background: t.card, border: `1px solid ${t.border}`, borderRadius: 10, padding: '14px 20px', margin: '4px 0 14px' }}>
            {stat('Schedules', schedules.length)}
            {stat('Active', active.length, t.green)}
            {stat('Paused', schedules.length - active.length, schedules.length - active.length ? t.amber : t.text3)}
            <div style={{ width: 1, alignSelf: 'stretch', background: t.border }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.text1, lineHeight: 1.3 }}>
                {upcoming ? `${reportMeta(upcoming.s.report_key).icon} ${nextRunLabel(upcoming.s)}` : '—'}
              </span>
              <span style={{ fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>Next send{upcoming ? ` · ${upcoming.s.label || (reports.find(r => r.key === upcoming.s.report_key)?.label) || upcoming.s.report_key}` : ''}</span>
            </div>
          </div>
        )
      })()}

      {/* ── SCHEDULE LIST ──────────────────────────────────────────────── */}
      <div>
        {loading ? (
          <div style={{ color: t.text3, fontSize: 13, padding: 20 }}>Loading…</div>
        ) : schedules.length === 0 ? (
          <div style={{ color: t.text3, fontSize: 13, padding: 40, textAlign: 'center', border: `1px dashed ${t.border}`, borderRadius: 10 }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>✉</div>
            No schedules yet. Click <b>+ New schedule</b> to email a report automatically.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {schedules.map(s => {
              const rpt = reports.find(r => r.key === s.report_key)
              const meta = reportMeta(s.report_key)
              const st = statusMeta(s, t)
              const nrl = nextRunLabel(s)
              const chip = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 9px', borderRadius: 6, background: t.card2, color: t.text2, border: `1px solid ${t.border}`, whiteSpace: 'nowrap' }
              const mailChip = { fontSize: 11, padding: '2px 8px', borderRadius: 6, background: t.card2, color: t.text2, border: `1px solid ${t.border}` }
              return (
                <div key={s.id} style={{ background: t.card, border: `1px solid ${t.border}`, borderLeft: `3px solid ${s.enabled ? meta.color : t.border}`, borderRadius: 10, padding: 16, display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', opacity: s.enabled ? 1 : 0.72 }}>
                  {/* toggle */}
                  <button onClick={() => toggleEnabled(s)} title={s.enabled ? 'Enabled — click to pause' : 'Paused — click to enable'}
                    style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative', background: s.enabled ? t.green : t.border, flexShrink: 0, marginTop: 4 }}>
                    <span style={{ position: 'absolute', top: 2, left: s.enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                  </button>
                  {/* icon */}
                  <div style={{ width: 38, height: 38, borderRadius: 9, background: `${meta.color}1e`, border: `1px solid ${meta.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{meta.icon}</div>
                  {/* main */}
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14.5, fontWeight: 800, color: t.text1 }}>{s.label || rpt?.label || s.report_key}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}33`, borderRadius: 5, padding: '1px 7px' }}>{rpt?.label || s.report_key}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      <span style={chip}>🕘 {cadenceText(s)}</span>
                      <span style={chip}>covers {s.report_date_basis === 'today' ? 'same day' : 'previous day'}</span>
                      {nrl && s.enabled && <span style={{ ...chip, background: `${t.blue}12`, borderColor: `${t.blue}40`, color: t.blue }}>→ next {nrl}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10.5, color: t.text3, fontWeight: 700, textTransform: 'uppercase' }}>To</span>
                      {(s.recipients || []).map(r => <span key={r} style={mailChip}>{r}</span>)}
                      {s.cc?.length ? <><span style={{ fontSize: 10.5, color: t.text3, fontWeight: 700, textTransform: 'uppercase', marginLeft: 4 }}>Cc</span>{s.cc.map(r => <span key={r} style={{ ...mailChip, opacity: 0.75 }}>{r}</span>)}</> : null}
                    </div>
                  </div>
                  {/* status */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 130 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: `${st.color}1c`, color: st.color, border: `1px solid ${st.color}55` }}>{st.label}</span>
                    {s.last_sent_at && <span style={{ fontSize: 11, color: t.text3 }} title={new Date(s.last_sent_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}>{relTime(s.last_sent_at)}</span>}
                    {s.last_error && <span style={{ fontSize: 10.5, color: t.red, maxWidth: 180, textAlign: 'right' }}>{s.last_error.slice(0, 80)}</span>}
                  </div>
                  {/* actions */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btn(t.card2, t.text1)} onClick={() => startEdit(s)}>Edit</button>
                    <button style={{ ...btn('transparent', t.red), border: `1px solid ${t.red}66` }} onClick={() => remove(s)}>Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
