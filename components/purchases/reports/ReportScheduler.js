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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await authedJson('/api/reports/schedules')
      setSchedules(data.schedules || [])
      setReports(data.reports || [])
    } catch (e) {
      flash('err', e.message || 'Failed to load schedules')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])

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

  const downloadXlsx = () => {
    if (!preview?.xlsxBase64) return
    const bin = atob(preview.xlsxBase64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = preview.filename || 'report.xlsx'; a.click()
    URL.revokeObjectURL(url)
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
        {!form && <button style={btn(t.gold, '#0c0c0c')} onClick={startNew}>+ New schedule</button>}
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
              {preview && !preview.isEmpty && <button style={btn(t.card2, t.text1)} onClick={downloadXlsx}>⬇ Excel</button>}
              {preview && !preview.isEmpty && <button style={btn(t.card2, t.text1)} disabled={pngBusy} onClick={downloadPng}>{pngBusy ? 'Rendering…' : '⬇ PNG'}</button>}
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

      {/* ── SCHEDULE LIST ──────────────────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ color: t.text3, fontSize: 13, padding: 20 }}>Loading…</div>
        ) : schedules.length === 0 ? (
          <div style={{ color: t.text3, fontSize: 13, padding: 20, textAlign: 'center', border: `1px dashed ${t.border}`, borderRadius: 10 }}>
            No schedules yet. Click <b>+ New schedule</b> to email a report automatically.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {schedules.map(s => {
              const rpt = reports.find(r => r.key === s.report_key)
              return (
                <div key={s.id} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <button onClick={() => toggleEnabled(s)} title={s.enabled ? 'Enabled — click to pause' : 'Paused — click to enable'}
                    style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative', background: s.enabled ? t.green : t.border, flexShrink: 0 }}>
                    <span style={{ position: 'absolute', top: 2, left: s.enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                  </button>
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.text1 }}>{s.label || rpt?.label || s.report_key}</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{cadenceText(s)} · covers {s.report_date_basis === 'today' ? 'same day' : 'previous day'}</div>
                    <div style={{ fontSize: 12, color: t.text2, marginTop: 4 }}>→ {(s.recipients || []).join(', ')}{s.cc?.length ? ` · cc ${s.cc.join(', ')}` : ''}</div>
                  </div>
                  <div style={{ fontSize: 11, color: t.text3, textAlign: 'right', minWidth: 130 }}>
                    {s.last_sent_at
                      ? <>last: <span style={{ color: s.last_status?.startsWith('sent') ? t.green : t.red }}>{s.last_status}</span><br />{new Date(s.last_sent_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</>
                      : 'never sent'}
                    {s.last_error && <div style={{ color: t.red, marginTop: 2, maxWidth: 180 }}>{s.last_error.slice(0, 80)}</div>}
                  </div>
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
