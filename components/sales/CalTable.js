'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/context'

const T = {
  dark: {
    bg: '#0a0a0a', card: '#121212', card2: '#181818', card3: '#1e1e1e',
    text1: '#f0e6c8', text2: '#d4c49a', text3: '#8a7a5a', text4: '#4a3a2a',
    gold: '#c9a84c', goldDim: 'rgba(201,168,76,.12)', goldBdr: 'rgba(201,168,76,.3)',
    border: '#222', border2: '#2a2a2a',
    green: '#3aaa6a', greenDim: 'rgba(58,170,106,.12)',
    red: '#e05555', redDim: 'rgba(224,85,85,.12)',
    blue: '#4a9fd4', blueDim: 'rgba(74,159,212,.12)',
    orange: '#e09040', orangeDim: 'rgba(224,144,64,.12)',
    rowAlt: 'rgba(255,255,255,.018)',
  },
  light: {
    bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', card3: '#d8d0c2',
    text1: '#1a1208', text2: '#4a3a1a', text3: '#8a7a5a', text4: '#b0a080',
    gold: '#a07830', goldDim: 'rgba(160,120,48,.1)', goldBdr: 'rgba(160,120,48,.35)',
    border: '#ccc5b5', border2: '#c0b8a8',
    green: '#2a7a4a', greenDim: 'rgba(42,122,74,.1)',
    red: '#c03030', redDim: 'rgba(192,48,48,.1)',
    blue: '#2a6a9a', blueDim: 'rgba(42,106,154,.1)',
    orange: '#b06020', orangeDim: 'rgba(176,96,32,.1)',
    rowAlt: 'rgba(0,0,0,.022)',
  },
}

const PARTY_COLORS = ['#c9a84c','#4a9fd4','#3aaa6a','#8c5ac8','#e05555','#e09040','#2a9d8f','#e76f51','#457b9d','#6a994e']
const _pcm = {}; let _pci = 0
const partyColor = (name) => { if (!_pcm[name]) _pcm[name] = PARTY_COLORS[_pci++ % PARTY_COLORS.length]; return _pcm[name] }

const PRECISION = 0.0001
const fmt  = (n, d = 2) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—'
const fmtSmart = (n) => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 4, minimumFractionDigits: 0 }) : '—'
const fmtW = (n) => n != null ? `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 4, minimumFractionDigits: 2 })}g` : '—'
const fmtV = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—'
const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d } }

function allocateGold(quotas, bars, targetDate) {
  const outputRows = []
  const highestRate = quotas.length ? Math.max(...quotas.map(q => q.rate)) : 0
  const qClone = quotas.map(q => ({ ...q, remCap: Number(q.weight) }))
  const staffBars   = bars.filter(b => b.batch.toUpperCase() === 'STAFF SALE')
  const regularBars = bars.filter(b => b.batch.toUpperCase() !== 'STAFF SALE')
  regularBars.sort((a, b) => b.purity - a.purity)
  for (const bar of staffBars) {
    const netGold = Number(bar.market_weight) * Number(bar.purity) / 100
    outputRows.push({ date: targetDate, party: 'Staff', batch: bar.batch, rate: highestRate,
      allocated_weight: Number(bar.market_weight), purity: Number(bar.purity),
      net_gold: netGold, sale_value: highestRate * netGold, state: bar.state })
  }
  function distribute(tQ, tB) {
    if (!tB.length || !tQ.length) return
    tQ.sort((a, b) => b.rate - a.rate)
    const partyMaxRate = {}
    for (const q of tQ) { if (!partyMaxRate[q.party] || q.rate > partyMaxRate[q.party]) partyMaxRate[q.party] = q.rate }
    const sortedParties = Object.keys(partyMaxRate).sort((a, b) => partyMaxRate[b] - partyMaxRate[a])
    const pqMap = {}
    for (const p of sortedParties) pqMap[p] = tQ.filter(q => q.party === p).sort((a, b) => b.rate - a.rate)
    let cpIdx = 0
    for (const bar of tB) {
      let allocated = false
      while (!allocated && cpIdx < sortedParties.length) {
        const party = sortedParties[cpIdx]
        const cap = pqMap[party].reduce((s, q) => s + q.remCap, 0)
        if (cap <= PRECISION) { cpIdx++; continue }
        let rem = Number(bar.market_weight)
        for (const quota of pqMap[party]) {
          if (rem <= PRECISION) break
          if (quota.remCap <= PRECISION) continue
          const take = Math.min(rem, quota.remCap)
          const netGold = take * Number(bar.purity) / 100
          outputRows.push({ date: targetDate, party, batch: bar.batch, rate: quota.rate,
            allocated_weight: take, purity: Number(bar.purity),
            net_gold: netGold, sale_value: quota.rate * netGold, state: bar.state })
          rem -= take; quota.remCap -= take
        }
        if (rem > PRECISION) {
          const hp = sortedParties[0]; const hq = pqMap[hp][0]
          const netGold = rem * Number(bar.purity) / 100
          outputRows.push({ date: targetDate, party: hp, batch: bar.batch, rate: hq.rate,
            allocated_weight: rem, purity: Number(bar.purity),
            net_gold: netGold, sale_value: hq.rate * netGold, state: bar.state + ' (SURPLUS)' })
        }
        allocated = true
      }
      if (!allocated) {
        const hp = sortedParties[0]; const hq = pqMap[hp][0]
        const netGold = Number(bar.market_weight) * Number(bar.purity) / 100
        outputRows.push({ date: targetDate, party: hp, batch: bar.batch, rate: hq.rate,
          allocated_weight: Number(bar.market_weight), purity: Number(bar.purity),
          net_gold: netGold, sale_value: hq.rate * netGold, state: bar.state + ' (SURPLUS)' })
      }
    }
  }
  distribute(qClone.filter(q => q.is_kl),  regularBars.filter(b => b.state.toUpperCase() === 'KL'))
  distribute(qClone.filter(q => !q.is_kl), regularBars.filter(b => b.state.toUpperCase() !== 'KL'))
  outputRows.sort((a, b) => b.rate - a.rate)
  return outputRows
}

function parseDate(txt) {
  txt = (txt || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt
  const m1 = txt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' }
  const m2 = txt.match(/^(\d{1,2})[\/\-]([a-zA-Z]{3})[\/\-](\d{2,4})$/)
  if (m2) { const mon = months[m2[2].toLowerCase()]; const yr = m2[3].length === 2 ? '20'+m2[3] : m2[3]; if (mon) return `${yr}-${mon}-${m2[1].padStart(2,'0')}` }
  return null
}

function parseQuotaPaste(text, fallbackDate) {
  const rows = []; const skipped = []
  text.trim().split('\n').forEach((line, i) => {
    const cols = line.trim().split(/\t|,/)
    let dateISO, party, weight, rate, kl
    if (cols.length >= 5) { dateISO = parseDate(cols[0]) || fallbackDate; party = cols[1]?.trim(); weight = parseFloat(cols[2]); rate = parseFloat(cols[3]); kl = cols[4]?.trim().toUpperCase() }
    else if (cols.length === 4) { dateISO = fallbackDate; party = cols[0]?.trim(); weight = parseFloat(cols[1]); rate = parseFloat(cols[2]); kl = cols[3]?.trim().toUpperCase() }
    else if (cols.length === 3) { dateISO = fallbackDate; party = cols[0]?.trim(); weight = parseFloat(cols[1]); rate = parseFloat(cols[2]); kl = 'NO' }
    else { skipped.push(i + 1); return }
    if (!party || isNaN(weight) || isNaN(rate) || !dateISO) { skipped.push(i + 1); return }
    rows.push({ date: dateISO, party, weight, rate, is_kl: ['YES','Y','KL'].includes(kl) })
  })
  return { rows, skipped }
}

function parseBarPaste(text, fallbackDate) {
  const rows = []; const skipped = []
  text.trim().split('\n').forEach((line, i) => {
    const cols = line.trim().split(/\t|,/)
    let dateISO, batch, market_weight, purity, state
    if (cols.length >= 5) { dateISO = parseDate(cols[0]) || fallbackDate; batch = cols[1]?.trim(); market_weight = parseFloat(cols[2]); purity = parseFloat(cols[3]); state = cols[4]?.trim() }
    else if (cols.length === 4) { dateISO = fallbackDate; batch = cols[0]?.trim(); market_weight = parseFloat(cols[1]); purity = parseFloat(cols[2]); state = cols[3]?.trim() }
    else if (cols.length === 3) { dateISO = fallbackDate; batch = cols[0]?.trim(); market_weight = parseFloat(cols[1]); purity = parseFloat(cols[2]); state = 'KA' }
    else { skipped.push(i + 1); return }
    if (!batch || isNaN(market_weight) || isNaN(purity) || !dateISO) { skipped.push(i + 1); return }
    rows.push({ date: dateISO, batch, market_weight, purity, state: state || 'Non-KL' })
  })
  return { rows, skipped }
}

function generatePrintReport(date, results) {
  if (!results.length) return null
  const tSale = results.reduce((s, r) => s + Number(r.sale_value), 0)
  const tGold = results.reduce((s, r) => s + Number(r.net_gold), 0)
  const tWt   = results.reduce((s, r) => s + Number(r.allocated_weight), 0)
  const avgP  = tWt > 0 ? (tGold / tWt) * 100 : 0
  const surN  = results.filter(r => r.state.includes('SURPLUS')).length
  const stfN  = results.filter(r => r.party === 'Staff').length
  const pmap = {}
  for (const r of results) { if (!pmap[r.party]) pmap[r.party] = { sale: 0, netGold: 0 }; pmap[r.party].sale += Number(r.sale_value); pmap[r.party].netGold += Number(r.net_gold) }
  const partyEntries = Object.entries(pmap).sort((a, b) => b[1].sale - a[1].sale)
  const maxSale = partyEntries[0]?.[1]?.sale || 1
  const th = (label, align = 'left') => `<th style="padding:8px 12px;background:#1a1814;text-align:${align};font-family:monospace;font-size:8px;font-weight:600;color:rgba(237,232,212,.3);letter-spacing:.18em;text-transform:uppercase;border-bottom:2px solid #2a2720;white-space:nowrap">${label}</th>`
  const detailRows = results.map((r, i) => {
    const isSurplus = r.state.includes('SURPLUS'); const isStaff = r.party === 'Staff'
    const bg = isSurplus ? 'rgba(224,85,85,.1)' : isStaff ? 'rgba(74,159,212,.08)' : i % 2 !== 0 ? 'rgba(255,255,255,.015)' : 'transparent'
    return `<tr style="background:${bg}"><td style="padding:7px 12px;border-bottom:1px solid #2a2720;font-weight:700;color:#f0e6c8">${r.party}</td><td style="padding:7px 12px;border-bottom:1px solid #2a2720;font-family:monospace;font-size:11px;color:rgba(240,230,200,.5)">${r.batch}</td><td style="padding:7px 12px;border-bottom:1px solid #2a2720;text-align:right;font-family:monospace;color:#c9a84c;font-weight:700">₹${Number(r.rate).toLocaleString('en-IN')}</td><td style="padding:7px 12px;border-bottom:1px solid #2a2720;text-align:right;font-family:monospace;color:#f0e6c8">${Number(r.allocated_weight).toFixed(4)}</td><td style="padding:7px 12px;border-bottom:1px solid #2a2720;text-align:right;font-family:monospace;color:#f0e6c8">${Number(r.purity).toFixed(4)}</td><td style="padding:7px 12px;border-bottom:1px solid #2a2720;text-align:right;font-family:monospace;font-weight:700;color:#c9a84c">${Number(r.net_gold).toFixed(4)}</td><td style="padding:7px 12px;border-bottom:1px solid #2a2720;text-align:right;font-family:monospace;font-weight:700;color:#3aaa6a">₹${Number(r.sale_value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td style="padding:7px 12px;border-bottom:1px solid #2a2720;font-family:monospace;font-size:10px;color:${isSurplus ? '#e09040' : isStaff ? '#4a9fd4' : 'rgba(240,230,200,.4)'}">${r.state}</td></tr>`
  }).join('')
  const partyRows = partyEntries.map(([name, d]) => {
    const pct = Math.round((d.sale / maxSale) * 100)
    return `<tr><td style="padding:9px 14px;border-bottom:1px solid #2a2720;font-weight:700;color:#f0e6c8">${name}</td><td style="padding:9px 14px;border-bottom:1px solid #2a2720"><div style="height:18px;background:#1e1c16;border-radius:3px;overflow:hidden"><div style="width:${Math.max(4,pct)}%;height:100%;background:#c9a84c;opacity:.7"></div></div></td><td style="padding:9px 14px;border-bottom:1px solid #2a2720;text-align:right;font-family:monospace;color:#c9a84c">${d.netGold.toFixed(4)}g</td><td style="padding:9px 14px;border-bottom:1px solid #2a2720;text-align:right;font-family:monospace;font-weight:700;color:#3aaa6a">₹${d.sale.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td></tr>`
  }).join('')
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>White Gold — Allocation ${date}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0a;color:#f0e6c8;font-family:'DM Sans',Arial,sans-serif;padding:32px 28px;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.no-print{display:none!important}@page{size:A4 landscape;margin:10mm}}table{width:100%;border-collapse:collapse}</style></head><body>
<div class="no-print" style="text-align:center;margin-bottom:28px"><button onclick="window.print()" style="background:#c9a84c;color:#1a0a00;border:none;border-radius:8px;padding:12px 36px;font-family:monospace;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer">🖨 Print / Save as PDF</button><div style="margin-top:8px;font-family:monospace;font-size:10px;color:rgba(240,230,200,.25)">Print dialog → Save as PDF → Landscape orientation</div></div>
<div style="background:#141414;border:1px solid #222;border-top:3px solid #c9a84c;border-radius:12px;padding:22px 24px;margin-bottom:18px"><div style="display:flex;align-items:center;gap:14px;margin-bottom:14px"><div style="width:44px;height:44px;background:#1c1a12;border:1px solid rgba(201,168,76,.3);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px">◈</div><div><div style="font-size:20px;font-weight:700;color:#f0e6c8">White Gold</div><div style="font-size:8px;color:#c9a84c;letter-spacing:.24em;text-transform:uppercase;margin-top:3px">Sales Allocation Report</div></div></div><div style="font-family:monospace;font-size:11px;color:rgba(240,230,200,.35);border-top:1px solid #222;padding-top:12px;line-height:2">Date: <strong style="color:#c9a84c">${date}</strong> &nbsp;|&nbsp; Generated: ${new Date().toLocaleString('en-IN')} &nbsp;|&nbsp; ${results.length} rows &nbsp;|&nbsp; ${partyEntries.length} parties</div></div>
<table style="margin-bottom:18px"><tr>${[['Total Sale Value',`₹${tSale.toLocaleString('en-IN',{maximumFractionDigits:0})}`,'#3aaa6a'],['Net Gold Sold',`${tGold.toFixed(4)}g`,'#c9a84c'],['Avg Purity',`${avgP.toFixed(4)}%`,'#f0e6c8'],['Surplus Rows',String(surN),surN>0?'#e09040':'#3aaa6a']].map(([l,v,c])=>`<td style="padding:0 6px 0 0"><div style="background:#141414;border:1px solid #222;border-top:2px solid ${c};border-radius:8px;padding:14px 16px"><div style="font-size:8px;color:rgba(240,230,200,.3);letter-spacing:.2em;text-transform:uppercase;margin-bottom:8px;font-family:monospace">${l}</div><div style="font-size:20px;font-weight:700;color:${c};font-family:monospace">${v}</div></div></td>`).join('')}</tr></table>
<div style="background:#141414;border:1px solid #222;border-radius:10px;overflow:hidden;margin-bottom:16px"><div style="background:#1a1814;padding:11px 16px;border-bottom:1px solid #222;font-family:monospace;font-size:9px;font-weight:600;color:rgba(240,230,200,.35);letter-spacing:.18em;text-transform:uppercase">Party Summary</div><table><thead><tr>${th('Party')}${th('Distribution')}${th('Net Gold','right')}${th('Sale Value','right')}</tr></thead><tbody>${partyRows}</tbody><tfoot><tr style="background:#1a1814;border-top:2px solid #2a2720"><td colspan="2" style="padding:10px 14px;font-family:monospace;font-size:8px;color:rgba(240,230,200,.3);text-transform:uppercase;letter-spacing:.1em">Total</td><td style="padding:10px 14px;text-align:right;font-family:monospace;font-weight:700;color:#c9a84c">${tGold.toFixed(4)}g</td><td style="padding:10px 14px;text-align:right;font-family:monospace;font-weight:700;font-size:15px;color:#3aaa6a">₹${tSale.toLocaleString('en-IN',{maximumFractionDigits:0})}</td></tr></tfoot></table></div>
<div style="background:#141414;border:1px solid #222;border-radius:10px;overflow:hidden;margin-bottom:16px"><div style="background:#1a1814;padding:11px 16px;border-bottom:1px solid #222;font-family:monospace;font-size:9px;font-weight:600;color:rgba(240,230,200,.35);letter-spacing:.18em;text-transform:uppercase">Allocation Detail — ${results.length} rows${surN?' · '+surN+' surplus':''}${stfN?' · '+stfN+' staff':''}</div><table><thead><tr>${th('Party')}${th('Batch')}${th('Rate','right')}${th('Alloc Wt','right')}${th('Purity','right')}${th('Net Gold','right')}${th('Sale Value','right')}${th('State')}</tr></thead><tbody>${detailRows}</tbody><tfoot><tr style="background:#1a1814;border-top:2px solid #2a2720"><td colspan="5" style="padding:11px 12px;font-family:monospace;font-size:8px;color:rgba(240,230,200,.3);text-align:right;text-transform:uppercase;letter-spacing:.1em">Total</td><td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:700;color:#c9a84c">${tGold.toFixed(4)}</td><td style="padding:11px 12px;text-align:right;font-family:monospace;font-weight:700;font-size:14px;color:#3aaa6a">₹${tSale.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td></td></tr></tfoot></table></div>
<div style="text-align:center;font-family:monospace;font-size:9px;color:rgba(240,230,200,.12);letter-spacing:.1em;margin-top:24px">CONFIDENTIAL — For internal use only · White Gold Sales Calculation System</div></body></html>`
}

const newQuota = (date) => ({ _id: crypto.randomUUID(), _new: true, date, party: '', weight: '', rate: '', is_kl: false })
const newBar   = (date, existingBars = []) => {
  // Auto-generate next G-number, skip STAFF SALE, find highest existing G-number
  const gNums = existingBars
    .map(b => b.batch?.match(/^G(\d+)$/i))
    .filter(Boolean)
    .map(m => parseInt(m[1]))
  const next = gNums.length ? Math.max(...gNums) + 1 : 1
  return { _id: crypto.randomUUID(), _new: true, date, batch: `G${next}`, market_weight: '', purity: '', state: 'KA' }
}

function Cell({ value, onChange, onKeyDown, type = 'text', placeholder, inputRef, style, align = 'left' }) {
  const { theme } = useApp(); const t = T[theme]
  const [focused, setFocused] = useState(false)
  return <input ref={inputRef} type={type} value={value} placeholder={placeholder}
    onChange={e => onChange && onChange(e.target.value)} onKeyDown={onKeyDown}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: t.text1, fontSize: '0.9rem', fontFamily: 'inherit', padding: '0', textAlign: align, boxShadow: focused ? `inset 0 -2px 0 ${t.gold}` : 'none', transition: 'box-shadow .15s', caretColor: t.gold, ...style }} />
}

function ActionBtn({ icon, title, onClick, color, t }) {
  const [hov, setHov] = useState(false)
  return <button onClick={onClick} title={title} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
    style={{ background: hov ? t.card3 : 'transparent', border: 'none', color, cursor: 'pointer', borderRadius: '5px', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', transition: 'background .12s' }}>{icon}</button>
}

function PasteModal({ type, date, onClose, onImport, t }) {
  const [text, setText] = useState('')
  const hint = type === 'quotas'
    ? 'Party, Weight(g), Rate(₹)  — one row per line, tab or comma separated\nOr with date: Date, Party, Weight, Rate, KL'
    : 'Batch, Weight(g), Purity(%)  — one row per line, tab or comma separated\nOr with date: Date, Batch, Weight, Purity, State'
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: t.card, border: `1px solid ${t.border2}`, borderRadius: '14px', padding: '28px', width: '100%', maxWidth: '520px', boxShadow: '0 32px 80px rgba(0,0,0,.4)' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, color: t.text1, marginBottom: '6px' }}>Paste {type === 'quotas' ? 'Quota' : 'Bar'} Data</div>
        <div style={{ fontSize: '0.78rem', color: t.text3, marginBottom: '14px', lineHeight: 1.7, fontFamily: 'monospace', background: t.card2, borderRadius: '7px', padding: '10px 14px', whiteSpace: 'pre-line' }}>{hint}</div>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste your data here…"
          style={{ width: '100%', height: '180px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.82rem', background: t.card2, border: `1.5px solid ${t.border2}`, borderRadius: '8px', padding: '12px', color: t.text1, outline: 'none' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '9px 20px', color: t.text3, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={() => { if (text.trim()) onImport(type === 'quotas' ? parseQuotaPaste(text, date) : parseBarPaste(text, date)) }}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '9px 24px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Import</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ message, onConfirm, onCancel, t }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: t.card, border: `1px solid ${t.red}40`, borderTop: `3px solid ${t.red}`, borderRadius: '14px', padding: '28px', width: '100%', maxWidth: '400px' }}>
        <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>⚠️</div>
        <div style={{ fontSize: '0.95rem', color: t.text1, fontWeight: 500, marginBottom: '8px' }}>Are you sure?</div>
        <div style={{ fontSize: '0.82rem', color: t.text3, marginBottom: '22px', lineHeight: 1.7 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onCancel} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 18px', color: t.text3, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={onConfirm} style={{ background: t.redDim, border: `1px solid ${t.red}60`, borderRadius: '7px', padding: '8px 18px', color: t.red, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Yes, clear</button>
        </div>
      </div>
    </div>
  )
}

export default function CalTable() {
  const { theme, user } = useApp(); const t = T[theme] || T.dark
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const [tab, setTab]             = useState('quotas')
  const [date, setDate]           = useState(today())
  const [quotas, setQuotas]       = useState([])
  const [bars, setBars]           = useState([])
  const [results, setResults]     = useState([])
  const [loadingQ, setLQ]         = useState(false)
  const [loadingB, setLB]         = useState(false)
  const [loadingR, setLR]         = useState(false)
  const [running, setRunning]     = useState(false)
  const [pasteModal, setPasteModal] = useState(null)
  const [confirmClear, setConfirmClear] = useState(null)
  const [toast, setToast]         = useState(null)
  const [resFilter, setResFilter] = useState('all')
  const [resSearch, setResSearch] = useState('')
  const [sortCol, setSortCol]     = useState('rate')
  const [sortAsc, setSortAsc]     = useState(false)
  const inputRefs = useRef({})

  // ── FORM STATE ──────────────────────────────────────────────────────────
  const nextBatchName = (existingBars) => {
    const gNums = existingBars.filter(b => !b._new).map(b => b.batch?.match(/^G(\d+)$/i)).filter(Boolean).map(m => parseInt(m[1]))
    return gNums.length ? `G${Math.max(...gNums) + 1}` : 'G1'
  }
  const [qForm, setQForm]   = useState({ party: '', weight: '', rate: '', is_kl: false })
  const [qEditId, setQEditId] = useState(null)
  const [bForm, setBForm]   = useState({ batch: 'G1', market_weight: '', purity: '', state: 'KA' })
  const [bEditId, setBEditId] = useState(null)
  const [barCount, setBarCount] = useState('')
  const [generatedBars, setGeneratedBars] = useState([]) // local unsaved rows with names
  const [ocrWeight, setOcrWeight] = useState({ loading: false, preview: null, status: '' })
  const [ocrPurity, setOcrPurity] = useState({ loading: false, preview: null, status: '' })
  const weightFileRef = useRef(null)
  const purityFileRef = useRef(null)
  const toastTimer = useRef(null)

  const showToast = (msg) => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2600) }
  useEffect(() => { loadAll() }, [date])
  const loadAll = () => { loadQuotas(); loadBars(); loadResults() }

  const loadQuotas = async () => { setLQ(true); const { data } = await supabase.from('cal_quotas').select('*').eq('date', date).order('created_at'); setQuotas((data || []).map(r => ({ ...r, _id: r.id, _new: false }))); setLQ(false) }
  const loadBars   = async () => { setLB(true); const { data } = await supabase.from('cal_bars').select('*').eq('date', date).order('created_at'); const loaded = (data || []).map(r => ({ ...r, _id: r.id, _new: false })); setBars(loaded); setBForm(f => ({ ...f, batch: nextBatchName(loaded) })); setLB(false) }
  const loadResults = async () => { setLR(true); const { data } = await supabase.from('cal_results').select('*').eq('date', date).order('rate', { ascending: false }); setResults(data || []); setLR(false) }

  const addQuota = () => { const row = newQuota(date); setQuotas(p => [...p, row]); setTimeout(() => inputRefs.current[`q-${row._id}-party`]?.focus(), 50) }
  const updateQuota = (id, f, v) => setQuotas(p => p.map(r => r._id === id ? { ...r, [f]: v } : r))
  const saveQuota = async (row) => {
    if (!row.party?.trim() || !row.weight || !row.rate) return
    const payload = { date, party: row.party.trim(), weight: parseFloat(row.weight), rate: parseFloat(row.rate), is_kl: row.is_kl, created_by: user?.id }
    if (row._new) { const { data } = await supabase.from('cal_quotas').insert(payload).select().single(); if (data) setQuotas(p => p.map(r => r._id === row._id ? { ...data, _id: data.id, _new: false } : r)) }
    else await supabase.from('cal_quotas').update(payload).eq('id', row.id)
  }
  const deleteQuota = async (row) => { if (!row._new) await supabase.from('cal_quotas').delete().eq('id', row.id); setQuotas(p => p.filter(r => r._id !== row._id)) }
  const duplicateQuota = (row) => { const dup = { ...row, _id: crypto.randomUUID(), _new: true, id: undefined }; setQuotas(p => { const i = p.findIndex(r => r._id === row._id); const n = [...p]; n.splice(i+1,0,dup); return n }); saveQuota(dup) }
  const clearQuotas = async () => { const ids = quotas.filter(r => !r._new).map(r => r.id); if (ids.length) await supabase.from('cal_quotas').delete().in('id', ids); setQuotas([]); setConfirmClear(null); showToast('All quotas cleared') }

  const addBar = () => { const row = newBar(date, bars); setBars(p => [...p, row]); setTimeout(() => inputRefs.current[`b-${row._id}-market_weight`]?.focus(), 50) }
  const updateBar = (id, f, v) => setBars(p => p.map(r => r._id === id ? { ...r, [f]: v } : r))
  const saveBar = async (row) => {
    if (!row.batch?.trim() || !row.market_weight || !row.purity) return
    const payload = { date, batch: row.batch.trim(), market_weight: parseFloat(row.market_weight), purity: parseFloat(row.purity), state: row.state, created_by: user?.id }
    if (row._new) { const { data } = await supabase.from('cal_bars').insert(payload).select().single(); if (data) setBars(p => p.map(r => r._id === row._id ? { ...data, _id: data.id, _new: false } : r)) }
    else await supabase.from('cal_bars').update(payload).eq('id', row.id)
  }
  const deleteBar = async (row) => { if (!row._new) await supabase.from('cal_bars').delete().eq('id', row.id); setBars(p => p.filter(r => r._id !== row._id)) }
  const duplicateBar = (row) => { const dup = { ...row, _id: crypto.randomUUID(), _new: true, id: undefined }; setBars(p => { const i = p.findIndex(r => r._id === row._id); const n = [...p]; n.splice(i+1,0,dup); return n }); saveBar(dup) }
  const clearBars = async () => { const ids = bars.filter(r => !r._new).map(r => r.id); if (ids.length) await supabase.from('cal_bars').delete().in('id', ids); setBars([]); setConfirmClear(null); showToast('All bars cleared') }

  // ── FORM SUBMIT ─────────────────────────────────────────────────────────
  const submitQuota = async () => {
    if (!qForm.party || !qForm.weight || !qForm.rate) return
    const payload = { date, party: qForm.party.trim(), weight: parseFloat(qForm.weight), rate: parseFloat(qForm.rate), is_kl: qForm.is_kl, created_by: user?.id }
    if (qEditId) {
      await supabase.from('cal_quotas').update(payload).eq('id', qEditId)
      setQuotas(p => p.map(r => r.id === qEditId ? { ...r, ...payload, _id: r._id, _new: false } : r))
      setQEditId(null); showToast('✓ Quota updated')
    } else {
      const { data } = await supabase.from('cal_quotas').insert(payload).select().single()
      if (data) setQuotas(p => [...p, { ...data, _id: data.id, _new: false }])
      showToast('✓ Quota added')
    }
    setQForm({ party: '', weight: '', rate: '', is_kl: false })
  }

  const submitBar = async () => {
    if (!bForm.batch || !bForm.market_weight) return
    const payload = { date, batch: bForm.batch.trim(), market_weight: parseFloat(bForm.market_weight), purity: parseFloat(bForm.purity), state: bForm.state || 'KA', created_by: user?.id }
    if (bEditId) {
      await supabase.from('cal_bars').update(payload).eq('id', bEditId)
      setBars(p => p.map(r => r.id === bEditId ? { ...r, ...payload, _id: r._id, _new: false } : r))
      setBEditId(null); showToast('✓ Bar updated')
    } else {
      const { data } = await supabase.from('cal_bars').insert(payload).select().single()
      if (data) setBars(p => [...p, { ...data, _id: data.id, _new: false }])
      showToast('✓ Bar added')
    }
    setBForm(f => ({ batch: nextBatchName([...bars, { batch: bForm.batch, _new: false }]), market_weight: '', purity: '', state: f.state || 'KA' }))
    setOcrWeight({ loading: false, preview: null, status: '' })
    setOcrPurity({ loading: false, preview: null, status: '' })
  }

  // ── GENERATE BAR ROWS ──────────────────────────────────────────────────
  const generateBarRows = () => {
    const n = parseInt(barCount)
    if (!n || n < 1 || n > 50) return
    // Find current highest G number across saved bars
    const existing = bars.filter(b => !b._new)
    const gNums = existing.map(b => b.batch?.match(/^G(\d+)$/i)).filter(Boolean).map(m => parseInt(m[1]))
    const startFrom = gNums.length ? Math.max(...gNums) + 1 : 1
    const rows = Array.from({ length: n }, (_, i) => ({
      _id: crypto.randomUUID(),
      name: `G${startFrom + i}`,
      saved: false
    }))
    setGeneratedBars(rows)
  }

  const updateGeneratedName = (id, name) => {
    setGeneratedBars(p => p.map(r => r._id === id ? { ...r, name } : r))
  }

  // ── OCR SCAN ─────────────────────────────────────────────────────────────
  // CURRENT (testing): Claude Vision API — ~₹0.33/scan (~$0.004)
  // This is acceptable even for testing given accuracy on scale displays + assay certs
  // PRODUCTION: Same Claude Vision API. At 20 scans/day → ~₹200/month total.

  const scanWithClaude = async (file, type) => {
    const set = type === 'weight' ? setOcrWeight : setOcrPurity
    set({ loading: true, preview: URL.createObjectURL(file), status: 'Scanning...' })

    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.onerror = rej
      reader.readAsDataURL(file)
    })

    try {
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64,
          mediaType: file.type || 'image/jpeg',
          type
        })
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error)
      const parsed = result.data

      if (type === 'weight') {
        if (parsed.weight != null) {
          setBForm(f => ({ ...f, market_weight: String(parsed.weight) }))
          set(s => ({ ...s, loading: false, status: `✓ ${parsed.weight} g` }))
          showToast(`✓ Weight: ${parsed.weight}g`)
        } else {
          set(s => ({ ...s, loading: false, status: 'Could not read — enter manually' }))
        }
      } else {
        if (parsed.purity != null) {
          setBForm(f => ({ ...f, purity: String(parsed.purity) }))
          set(s => ({ ...s, loading: false, status: `✓ ${parsed.purity}%` }))
          showToast(`✓ Purity: ${parsed.purity}%`)
        } else {
          set(s => ({ ...s, loading: false, status: 'Could not read — enter manually' }))
        }
      }
    } catch (err) {
      console.error('OCR error:', err)
      set(s => ({ ...s, loading: false, status: 'Scan failed — enter manually' }))
    }
  }

  const handleWeightScan = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    await scanWithClaude(file, 'weight')
    if (weightFileRef.current) weightFileRef.current.value = ''
  }

  const handlePurityScan = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    await scanWithClaude(file, 'purity')
    if (purityFileRef.current) purityFileRef.current.value = ''
  }



  const handlePasteImport = async ({ rows, skipped }) => {
    if (!rows.length) { showToast(`Nothing to import${skipped.length ? ` (${skipped.length} skipped)` : ''}`); setPasteModal(null); return }
    const inserted = []
    const table = pasteModal === 'quotas' ? 'cal_quotas' : 'cal_bars'
    for (const row of rows) { const { data } = await supabase.from(table).insert({ ...row, created_by: user?.id }).select().single(); if (data) inserted.push({ ...data, _id: data.id, _new: false }) }
    if (pasteModal === 'quotas') setQuotas(p => [...p, ...inserted]); else setBars(p => [...p, ...inserted])
    showToast(`✓ ${inserted.length} rows imported${skipped.length ? `, ${skipped.length} skipped` : ''}`)
    setPasteModal(null)
  }

  const quotaKeys = ['party', 'weight', 'rate']
  const barKeys   = ['batch', 'market_weight', 'purity']

  const handleQuotaKey = (e, rowId, field, row) => {
    if (e.key === 'Tab') { e.preventDefault(); const idx = quotaKeys.indexOf(field)
      if (!e.shiftKey && idx < quotaKeys.length - 1) inputRefs.current[`q-${rowId}-${quotaKeys[idx+1]}`]?.focus()
      else if (e.shiftKey && idx > 0) inputRefs.current[`q-${rowId}-${quotaKeys[idx-1]}`]?.focus()
      else if (!e.shiftKey) { saveQuota(row); const all = quotas; const i = all.findIndex(r => r._id === rowId); if (i < all.length-1) inputRefs.current[`q-${all[i+1]._id}-party`]?.focus(); else addQuota() } }
    if (e.key === 'Enter') { saveQuota(row); addQuota() }
    if (e.key === 'Escape') saveQuota(row)
  }
  const handleBarKey = (e, rowId, field, row) => {
    if (e.key === 'Tab') { e.preventDefault(); const idx = barKeys.indexOf(field)
      if (!e.shiftKey && idx < barKeys.length - 1) inputRefs.current[`b-${rowId}-${barKeys[idx+1]}`]?.focus()
      else if (e.shiftKey && idx > 0) inputRefs.current[`b-${rowId}-${barKeys[idx-1]}`]?.focus()
      else if (!e.shiftKey) { saveBar(row); const all = bars; const i = all.findIndex(r => r._id === rowId); if (i < all.length-1) inputRefs.current[`b-${all[i+1]._id}-batch`]?.focus(); else addBar() } }
    if (e.key === 'Enter') { saveBar(row); addBar() }
    if (e.key === 'Escape') saveBar(row)
  }

  const runAllocation = async () => {
    const vQ = quotas.filter(q => q.party && q.weight && q.rate)
    const vB = bars.filter(b => b.batch && b.market_weight && b.purity)
    if (!vQ.length || !vB.length) return
    setRunning(true)
    await Promise.all([...vQ.filter(q => q._new).map(saveQuota), ...vB.filter(b => b._new).map(saveBar)])
    const output = allocateGold(vQ, vB, date)
    await supabase.from('cal_results').delete().eq('date', date)
    if (output.length) await supabase.from('cal_results').insert(output.map(r => ({ date: r.date, party: r.party, batch: r.batch, rate: r.rate, allocated_weight: r.allocated_weight, purity: r.purity, net_gold: r.net_gold, sale_value: r.sale_value, state: r.state })))
    await loadResults(); setTab('output'); setRunning(false)
    showToast(`✓ ${output.length} allocation rows generated`)
  }

  const printReport = () => {
    if (!results.length) return
    const html = generatePrintReport(fmtDate(date), results)
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close() }
  }

  const filteredResults = (() => {
    let rows = results
    if (resFilter === 'surplus') rows = rows.filter(r => r.state.includes('SURPLUS'))
    else if (resFilter === 'staff') rows = rows.filter(r => r.party === 'Staff')
    else if (resFilter === 'normal') rows = rows.filter(r => !r.state.includes('SURPLUS') && r.party !== 'Staff')
    if (resSearch.trim()) { const q = resSearch.toLowerCase(); rows = rows.filter(r => r.party.toLowerCase().includes(q) || r.batch.toLowerCase().includes(q) || r.state.toLowerCase().includes(q)) }
    if (sortCol) { rows = [...rows].sort((a, b) => { let va = a[sortCol], vb = b[sortCol]; if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase() }; if (va < vb) return sortAsc ? -1 : 1; if (va > vb) return sortAsc ? 1 : -1; return 0 }) }
    return rows
  })()

  const handleSort = (col) => { if (sortCol === col) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(false) } }
  const sortIcon = (col) => sortCol !== col ? ' ⇅' : sortAsc ? ' ▲' : ' ▼'

  const totalSale = results.reduce((s, r) => s + Number(r.sale_value), 0)
  const totalNet  = results.reduce((s, r) => s + Number(r.net_gold), 0)
  const totalWt   = results.reduce((s, r) => s + Number(r.allocated_weight), 0)
  const surplusCount = results.filter(r => r.state.includes('SURPLUS')).length
  const validQ = quotas.filter(q => q.party && q.weight && q.rate).length
  const validB = bars.filter(b => b.batch && b.market_weight && b.purity).length
  const canRun = validQ > 0 && validB > 0

  const partyGroups = results.reduce((acc, r) => {
    const key = `${r.party}__${r.rate}`
    if (!acc[key]) acc[key] = { party: r.party, rate: Number(r.rate), weight: 0, netGold: 0, saleValue: 0 }
    acc[key].weight += Number(r.allocated_weight); acc[key].netGold += Number(r.net_gold); acc[key].saleValue += Number(r.sale_value)
    return acc
  }, {})

  const surN = results.filter(r => r.state.includes('SURPLUS')).length
  const stfN = results.filter(r => r.party === 'Staff').length
  const nrmN = results.length - surN - stfN
  const filteredSale = filteredResults.reduce((s, r) => s + Number(r.sale_value), 0)
  const filteredNet  = filteredResults.reduce((s, r) => s + Number(r.net_gold), 0)
  const filteredWt   = filteredResults.reduce((s, r) => s + Number(r.allocated_weight), 0)

  const css = {
    card:  { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden' },
    th:    { padding: '11px 14px', fontSize: '0.68rem', fontWeight: 600, color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', userSelect: 'none' },
    td:    { padding: '0 14px', height: '48px', fontSize: '0.9rem', color: t.text1, borderBottom: `1px solid ${t.border}20`, verticalAlign: 'middle' },
    btn:   { border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', letterSpacing: '.03em', transition: 'all .15s', fontFamily: 'inherit' },
    pill:  (active) => ({ padding: isMobile ? '10px 20px' : '7px 18px', borderRadius: '8px', border: `1px solid ${active ? t.gold : t.border}`, background: active ? t.goldDim : 'transparent', color: active ? t.gold : t.text3, fontSize: isMobile ? '0.9rem' : '0.8rem', fontWeight: active ? 600 : 400, cursor: 'pointer', transition: 'all .15s', fontFamily: 'inherit', flex: isMobile ? 1 : 'none', textAlign: 'center' }),
    fchip: (active) => ({ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '20px', border: `1.5px solid ${active ? t.text1 : t.border}`, background: active ? t.text1 : 'transparent', color: active ? t.bg : t.text3, fontSize: '0.78rem', fontWeight: active ? 600 : 400, cursor: 'pointer', transition: 'all .15s', fontFamily: 'inherit' }),
  }

  const SortTh = ({ col, label, right }) => (
    <th onClick={() => handleSort(col)} style={{ ...css.th, cursor: 'pointer', textAlign: right ? 'right' : 'left', color: sortCol === col ? t.gold : t.text3 }}>
      {label}<span style={{ fontSize: '0.6rem', opacity: .7 }}>{sortIcon(col)}</span>
    </th>
  )

  return (
    <div style={{ padding: isMobile ? '16px 14px' : '28px 32px', minHeight: '100%' }}>
      {toast && <div style={{ position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)', background: t.text1, color: t.bg, fontFamily: 'monospace', fontSize: '0.78rem', padding: '10px 22px', borderRadius: '24px', zIndex: 99999, letterSpacing: '.06em', boxShadow: '0 8px 32px rgba(0,0,0,.3)', whiteSpace: 'nowrap' }}>{toast}</div>}
      {pasteModal && <PasteModal type={pasteModal} date={date} onClose={() => setPasteModal(null)} onImport={handlePasteImport} t={t} />}
      {confirmClear === 'quotas' && <ConfirmModal message={`Permanently delete all ${quotas.length} quota rows for ${fmtDate(date)}?`} onConfirm={clearQuotas} onCancel={() => setConfirmClear(null)} t={t} />}
      {confirmClear === 'bars'   && <ConfirmModal message={`Permanently delete all ${bars.length} bar rows for ${fmtDate(date)}?`}   onConfirm={clearBars}   onCancel={() => setConfirmClear(null)} t={t} />}

      {/* HEADER */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <div>
            <div style={{ fontSize: isMobile ? '1.3rem' : '1.7rem', fontWeight: 300, color: t.text1, letterSpacing: '.05em' }}>Cal Table</div>
            <div style={{ fontSize: '0.78rem', color: t.text3, marginTop: '3px' }}>{fmtDate(date)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '7px 12px' }}>
            <span style={{ fontSize: '0.68rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase' }}>Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ background: 'transparent', border: 'none', outline: 'none', color: t.text1, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' }} />
          </div>
        </div>
        <button onClick={runAllocation} disabled={!canRun || running}
          style={{ ...css.btn, width: '100%', background: canRun ? t.green : t.border, color: canRun ? '#fff' : t.text4, opacity: running ? .7 : 1, cursor: canRun && !running ? 'pointer' : 'not-allowed', padding: '13px', fontSize: '1rem' }}>
          {running ? '⟳ Running...' : '▶ Run Allocation'}
        </button>
      </div>

      {/* STATUS STRIP */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? '4px' : 0 }}>
        {[
          { label: 'quota rows', value: validQ, color: t.gold },
          { label: 'bar rows',   value: validB, color: t.gold },
          ...(results.length ? [{ label: 'last run total', value: `₹${totalSale.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: t.green }] : []),
          ...(!canRun ? [{ label: !validQ ? 'Add quotas to run' : 'Add bars to run', value: '', color: t.orange, hint: true }] : []),
        ].map((s, i) => (
          <div key={i} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!s.hint && <span style={{ fontSize: '1.05rem', fontWeight: 600, color: s.color, fontFamily: 'monospace' }}>{s.value}</span>}
            <span style={{ fontSize: '0.75rem', color: s.hint ? s.color : t.text3 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
        {[{ id: 'quotas', label: 'Quotas', count: validQ }, { id: 'bars', label: 'Bars', count: validB }, { id: 'output', label: 'Output', count: results.length }].map(tab_ => (
          <button key={tab_.id} onClick={() => setTab(tab_.id)} style={css.pill(tab === tab_.id)}>
            {tab_.label}
            {tab_.count > 0 && <span style={{ marginLeft: '7px', background: tab === tab_.id ? t.gold : t.border, color: tab === tab_.id ? '#1a0a00' : t.text3, borderRadius: '99px', padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700 }}>{tab_.count}</span>}
          </button>
        ))}
      </div>

      {/* QUOTAS TAB */}
      {tab === 'quotas' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', gap: '16px', alignItems: 'start' }}>
          {/* LEFT: FORM */}
          <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', overflow: 'hidden', position: 'sticky', top: '20px' }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, background: t.card2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: t.text1 }}>New Quota</div>
              <span style={{ background: t.gold, color: '#1a0a00', borderRadius: '20px', padding: '2px 9px', fontSize: '0.68rem', fontWeight: 700 }}>{validQ}</span>
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
              <FormField label="Party Name" required t={t}>
                <PartyDropdown value={qForm.party} t={t} onChange={v => setQForm(f => ({ ...f, party: v }))} />
              </FormField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <FormField label="Weight (g)" required t={t}>
                  <input type="number" value={qForm.weight} onChange={e => setQForm(f => ({ ...f, weight: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && submitQuota()}
                    placeholder="0.0000" step="any"
                    style={{ width: '100%', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 10px', fontSize: '0.85rem', color: t.text1, outline: 'none', fontFamily: 'inherit' }}
                    onFocus={e => e.target.style.borderColor = t.gold} onBlur={e => e.target.style.borderColor = t.border} />
                </FormField>
                <FormField label="Rate (₹/g)" required t={t}>
                  <input type="number" value={qForm.rate} onChange={e => setQForm(f => ({ ...f, rate: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && submitQuota()}
                    placeholder="0" step="1"
                    style={{ width: '100%', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '8px 10px', fontSize: '0.85rem', color: t.text1, outline: 'none', fontFamily: 'inherit' }}
                    onFocus={e => e.target.style.borderColor = t.gold} onBlur={e => e.target.style.borderColor = t.border} />
                </FormField>
              </div>
              <FormField label="KL Quota" t={t}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {['No', 'Yes'].map(v => (
                    <button key={v} onClick={() => setQForm(f => ({ ...f, is_kl: v === 'Yes' }))}
                      style={{ flex: 1, padding: '7px', borderRadius: '7px', border: `1px solid ${(v === 'Yes') === qForm.is_kl ? t.blue : t.border}`, background: (v === 'Yes') === qForm.is_kl ? t.blueDim : 'transparent', color: (v === 'Yes') === qForm.is_kl ? t.blue : t.text3, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: (v === 'Yes') === qForm.is_kl ? 600 : 400 }}>
                      {v}
                    </button>
                  ))}
                </div>
              </FormField>
            </div>
            <div style={{ padding: '12px 18px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: '8px' }}>
              <button onClick={submitQuota}
                style={{ flex: 1, background: t.text1, color: t.bg, border: 'none', borderRadius: '8px', padding: '11px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.03em' }}>
                {qEditId ? 'Update Quota' : 'Add Quota'}
              </button>
              {qEditId && <button onClick={() => { setQForm({ party: '', weight: '', rate: '', is_kl: false }); setQEditId(null) }}
                style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '8px', padding: '11px 14px', color: t.text3, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem' }}>↺</button>}
            </div>
          </div>

          {/* RIGHT: TABLE */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '0.72rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase' }}>Quota Ledger</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setPasteModal('quotas')} style={{ ...css.btn, background: t.card, border: `1px solid ${t.border}`, color: t.text2, padding: '7px 13px', fontSize: '0.75rem' }}>📥 Paste</button>
                {quotas.filter(q => !q._new).length > 0 && <button onClick={() => setConfirmClear('quotas')} style={{ ...css.btn, background: 'transparent', border: `1px solid ${t.border}`, color: t.text3, padding: '7px 13px', fontSize: '0.75rem' }}>Clear all</button>}
              </div>
            </div>
            {loadingQ ? <LoadingCard t={t} /> : (
              <div style={css.card}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...css.th, width: '32px', textAlign: 'center' }}>#</th>
                    <th style={css.th}>Party</th>
                    <th style={{ ...css.th, textAlign: 'right' }}>Weight (g)</th>
                    <th style={{ ...css.th, textAlign: 'right' }}>Rate (₹/g)</th>
                    <th style={{ ...css.th, textAlign: 'center', width: '60px' }}>KL</th>
                    <th style={{ ...css.th, width: '64px' }}></th>
                  </tr></thead>
                  <tbody>
                    {quotas.filter(q => !q._new).length === 0 ? (
                      <tr><td colSpan={6} style={{ ...css.td, textAlign: 'center', color: t.text4, padding: '48px', fontSize: '0.82rem' }}>
                        No quotas yet — use the form to add
                      </td></tr>
                    ) : quotas.filter(q => !q._new).map((row, i) => (
                      <tr key={row._id}
                        style={{ background: qEditId === row.id ? `${t.gold}10` : i % 2 !== 0 ? t.rowAlt : 'transparent', cursor: 'pointer' }}
                        onClick={() => { setQForm({ party: row.party, weight: row.weight, rate: row.rate, is_kl: row.is_kl }); setQEditId(row.id) }}>
                        <td style={{ ...css.td, textAlign: 'center', color: t.text4, fontSize: '0.72rem' }}>{i + 1}</td>
                        <td style={css.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: partyColor(row.party), flexShrink: 0 }} />
                            <span style={{ fontWeight: 500, color: t.text1 }}>{row.party}</span>
                          </div>
                        </td>
                        <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold }}>{fmtSmart(row.weight)}</td>
                        <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace' }}>₹{Number(row.rate).toLocaleString('en-IN')}</td>
                        <td style={{ ...css.td, textAlign: 'center' }}>
                          {row.is_kl && <span style={{ background: t.blueDim, color: t.blue, borderRadius: '4px', padding: '2px 7px', fontSize: '0.68rem', fontWeight: 700 }}>KL</span>}
                        </td>
                        <td style={css.td} onClick={e => e.stopPropagation()}>
                          <button onClick={() => deleteQuota(row)}
                            style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: '4px 8px', borderRadius: '5px', fontSize: '0.78rem' }}
                            onMouseEnter={e => e.currentTarget.style.color = t.red}
                            onMouseLeave={e => e.currentTarget.style.color = t.text4}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {quotas.filter(q => !q._new).length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: `1px solid ${t.border}`, background: t.card2 }}>
                        <td colSpan={2} style={{ ...css.td, fontSize: '0.68rem', color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase' }}>Total</td>
                        <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtSmart(quotas.filter(q => !q._new).reduce((s, q) => s + Number(q.weight || 0), 0))}g</td>
                        <td colSpan={3} style={css.td}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
            {quotas.filter(q => !q._new).length > 0 && <QuotaSummary quotas={quotas} t={t} />}
          </div>
        </div>
      )}

      {/* BARS TAB */}
      {tab === 'bars' && (
        <div>
          {/* Hidden file inputs — one pair per active scan */}
          <input ref={weightFileRef} type="file" accept="image/*" capture="environment" onChange={handleWeightScan} style={{ display: 'none' }} />
          <input ref={purityFileRef} type="file" accept="image/*" capture="environment" onChange={handlePurityScan} style={{ display: 'none' }} />

          {/* ── STEP 1: How many bars? ── */}
          {!generatedBars.length && bars.filter(b => !b._new).length === 0 && (
            <div style={{ maxWidth: '420px', margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: t.text1, marginBottom: '6px' }}>How many bars today?</div>
              <div style={{ fontSize: '0.82rem', color: t.text3, marginBottom: '24px' }}>Enter the number and we'll create rows for each bar</div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'center' }}>
                <input type="number" value={barCount} onChange={e => setBarCount(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && generateBarRows()}
                  placeholder="e.g. 10" min="1" max="50"
                  style={{ width: '130px', background: t.card, border: `2px solid ${t.border}`, borderRadius: '10px', padding: '14px 16px', fontSize: '1.6rem', color: t.text1, outline: 'none', fontFamily: 'monospace', textAlign: 'center' }}
                  onFocus={e => e.target.style.borderColor = t.gold}
                  onBlur={e => e.target.style.borderColor = t.border}
                  autoFocus />
                <button onClick={generateBarRows}
                  style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Generate →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Bar rows ── */}
          {(generatedBars.length > 0 || bars.filter(b => !b._new).length > 0) && (
            <div>
              {/* Top bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: t.text1 }}>
                    {bars.filter(b => !b._new).length} bars saved
                    {bars.filter(b => !b._new && !b.purity).length > 0 && (
                      <span style={{ marginLeft: '10px', color: t.orange, fontSize: '0.78rem', fontWeight: 400 }}>
                        ⚠ {bars.filter(b => !b._new && !b.purity).length} purity pending
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: t.text3, marginTop: '3px' }}>Tap 📷 on each bar to scan</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {/* Add more rows */}
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', background: t.card, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '6px 10px' }}>
                    <span style={{ fontSize: '0.75rem', color: t.text3 }}>Add more:</span>
                    <input type="number" value={barCount} onChange={e => setBarCount(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && generateBarRows()}
                      placeholder="n" min="1" max="50"
                      style={{ width: '52px', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '5px', padding: '4px 6px', fontSize: '0.85rem', color: t.text1, outline: 'none', fontFamily: 'monospace', textAlign: 'center' }}
                      onFocus={e => e.target.style.borderColor = t.gold}
                      onBlur={e => e.target.style.borderColor = t.border} />
                    <button onClick={generateBarRows}
                      style={{ background: t.goldDim, border: `1px solid ${t.goldBdr}`, borderRadius: '6px', padding: '4px 10px', fontSize: '0.78rem', color: t.gold, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+</button>
                  </div>
                  <button onClick={() => setPasteModal('bars')} style={{ ...css.btn, background: t.card, border: `1px solid ${t.border}`, color: t.text2, padding: '7px 13px', fontSize: '0.75rem' }}>📥 Paste</button>
                  {bars.filter(b => !b._new).length > 0 && (
                    <button onClick={() => setConfirmClear('bars')} style={{ ...css.btn, background: 'transparent', border: `1px solid ${t.border}`, color: t.text3, padding: '7px 13px', fontSize: '0.75rem' }}>Clear all</button>
                  )}
                </div>
              </div>

              {/* Bar cards grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {/* Generated (unsaved) rows */}
                {generatedBars.map((gen, i) => (
                  <BarCard key={gen._id}
                    gen={gen}
                    index={i}
                    t={t}
                    date={date}
                    user={user}
                    onNameChange={name => updateGeneratedName(gen._id, name)}
                    onSaved={(savedBar) => {
                      setGeneratedBars(p => p.filter(r => r._id !== gen._id))
                      setBars(p => [...p, { ...savedBar, _id: savedBar.id, _new: false }])
                    }}
                    onRemove={() => setGeneratedBars(p => p.filter(r => r._id !== gen._id))}
                    showToast={showToast}
                  />
                ))}

                {/* Saved bars */}
                {bars.filter(b => !b._new).map((row, i) => (
                  <SavedBarCard key={row._id}
                    row={row}
                    t={t}
                    date={date}
                    user={user}
                    onUpdate={(updated) => setBars(p => p.map(r => r.id === updated.id ? { ...r, ...updated, _id: r._id } : r))}
                    onDelete={() => deleteBar(row)}
                    showToast={showToast}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* OUTPUT TAB */}
      {tab === 'output' && (
        <div>
          {loadingR ? <LoadingCard t={t} /> : !results.length ? (
            <div style={{ textAlign: 'center', padding: '80px 48px', color: t.text4 }}>
              <div style={{ fontSize: '2.5rem', opacity: .15, marginBottom: '16px' }}>▶</div>
              <div style={{ fontSize: '0.88rem', color: t.text3, marginBottom: '8px' }}>No results yet</div>
              <div style={{ fontSize: '0.8rem' }}>Add quotas and bars, then click <span style={{ color: t.green, fontWeight: 600 }}>Run Allocation</span></div>
            </div>
          ) : (
            <>
              {/* KPI row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
                {[
                  { label: 'Total Sale Value', value: `₹${totalSale.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: t.green, big: true },
                  { label: 'Total Net Gold',   value: fmtW(totalNet),  color: t.gold },
                  { label: 'Total Alloc Wt',   value: fmtW(totalWt),   color: t.gold },
                  { label: 'Surplus Rows',     value: surplusCount,    color: surplusCount > 0 ? t.orange : t.text3 },
                ].map(k => (
                  <div key={k.label} style={{ background: t.card, border: `1px solid ${t.border}`, borderTop: `2px solid ${k.color}`, borderRadius: '10px', padding: '18px 20px' }}>
                    <div style={{ fontSize: '0.68rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' }}>{k.label}</div>
                    <div style={{ fontSize: k.big ? '1.45rem' : '1.2rem', fontWeight: 300, color: k.color, lineHeight: 1, fontFamily: 'monospace' }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Party cards */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '0.68rem', color: t.text3, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '10px' }}>Party Breakdown</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {Object.entries(partyGroups).map(([key, g]) => {
                    const color = partyColor(g.party)
                    return (
                      <div key={key} style={{ background: t.card, border: `1px solid ${t.border}`, borderLeft: `3px solid ${color}`, borderRadius: '8px', padding: '14px 18px', minWidth: '190px', flex: '1 1 190px', maxWidth: '260px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: t.text1 }}>{g.party}</span>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: t.text3, background: t.card2, borderRadius: '5px', padding: '2px 8px', fontFamily: 'monospace' }}>₹{Number(g.rate).toLocaleString('en-IN')}/g</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {[['Alloc Wt', fmtW(g.weight), t.text1], ['Net Gold', fmtW(g.netGold), t.gold]].map(([l, v, c]) => (
                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                              <span style={{ color: t.text3 }}>{l}</span>
                              <span style={{ color: c, fontFamily: 'monospace', fontWeight: l === 'Net Gold' ? 600 : 400 }}>{v}</span>
                            </div>
                          ))}
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', borderTop: `1px solid ${t.border}`, paddingTop: '5px', marginTop: '2px' }}>
                            <span style={{ color: t.text3 }}>Sale Value</span>
                            <span style={{ color: t.green, fontFamily: 'monospace', fontWeight: 700 }}>{`₹${Number(g.saleValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Filter chips + search */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[{ id: 'all', label: 'All', count: results.length }, { id: 'normal', label: 'Normal', count: nrmN }, { id: 'surplus', label: '⚠ Surplus', count: surN }, { id: 'staff', label: '★ Staff', count: stfN }].map(f => (
                    <button key={f.id} onClick={() => setResFilter(f.id)} style={css.fchip(resFilter === f.id)}>
                      {f.label}
                      <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', padding: '1px 6px', borderRadius: '10px', background: resFilter === f.id ? 'rgba(255,255,255,.15)' : t.card2, color: resFilter === f.id ? 'inherit' : t.text4 }}>{f.count}</span>
                    </button>
                  ))}
                </div>
                <div style={{ marginLeft: 'auto', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.78rem', color: t.text4, pointerEvents: 'none' }}>🔍</span>
                  <input value={resSearch} onChange={e => setResSearch(e.target.value)} placeholder="Search party, batch…"
                    style={{ paddingLeft: '30px', paddingRight: resSearch ? '28px' : '12px', paddingTop: '7px', paddingBottom: '7px', background: t.card, border: `1.5px solid ${t.border}`, borderRadius: '8px', color: t.text1, fontSize: '0.8rem', outline: 'none', fontFamily: 'inherit', width: '210px' }} />
                  {resSearch && <button onClick={() => setResSearch('')} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>}
                </div>
              </div>

              <div style={{ fontSize: '0.72rem', color: t.text3, marginBottom: '10px' }}>
                {filteredResults.length} of {results.length} rows{resSearch && <span style={{ color: t.gold }}> · "{resSearch}"</span>}
              </div>

              {/* Table */}
              <div style={css.card}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...css.th, width: '36px', textAlign: 'center' }}>#</th>
                    <SortTh col="party"            label="Party" />
                    <SortTh col="batch"            label="Batch" />
                    <SortTh col="rate"             label="Rate"       right />
                    <SortTh col="allocated_weight" label="Alloc Wt"   right />
                    <SortTh col="purity"           label="Purity"     right />
                    <SortTh col="net_gold"         label="Net Gold"   right />
                    <SortTh col="sale_value"       label="Sale Value" right />
                    <th style={css.th}>State</th>
                  </tr></thead>
                  <tbody>
                    {filteredResults.length === 0 ? (
                      <tr><td colSpan={9} style={{ ...css.td, textAlign: 'center', color: t.text4, padding: '48px', fontSize: '0.82rem' }}>No rows match filter</td></tr>
                    ) : filteredResults.map((r, i) => {
                      const isSurplus = r.state.includes('SURPLUS'); const isStaff = r.party === 'Staff'
                      const rowBg = isStaff ? t.blueDim : isSurplus ? t.orangeDim : i % 2 !== 0 ? t.rowAlt : 'transparent'
                      const color = partyColor(r.party)
                      return (
                        <tr key={r.id} style={{ background: rowBg }}>
                          <td style={{ ...css.td, color: t.text4, fontSize: '0.72rem', textAlign: 'center' }}>{i + 1}</td>
                          <td style={css.td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: t.text1 }}>{r.party}</span>
                            </div>
                          </td>
                          <td style={css.td}><span style={{ background: t.card2, border: `1px solid ${t.border}`, borderRadius: '5px', padding: '2px 9px', fontSize: '0.8rem', fontFamily: 'monospace', color: t.text2 }}>{r.batch}</span></td>
                          <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>₹{Number(r.rate).toLocaleString('en-IN')}</td>
                          <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.text1 }}>{fmtW(r.allocated_weight)}</td>
                          <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.purity, 4)}%</td>
                          <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtW(r.net_gold)}</td>
                          <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.green, fontWeight: 700 }}>{`₹${Number(r.sale_value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                          <td style={css.td}><StateBadge state={r.state} t={t} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${t.border}`, background: t.card2 }}>
                      <td colSpan={4} style={{ ...css.td, color: t.text3, fontSize: '0.68rem', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>{filteredResults.length < results.length ? `${filteredResults.length} shown` : 'Total'}</td>
                      <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtW(filteredWt)}</td>
                      <td style={css.td}></td>
                      <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.gold, fontWeight: 600 }}>{fmtW(filteredNet)}</td>
                      <td style={{ ...css.td, textAlign: 'right', fontFamily: 'monospace', color: t.green, fontWeight: 700, fontSize: '0.95rem' }}>{`₹${filteredSale.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                      <td style={css.td}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function QuotaRow({ row, i, t, css, inputRefs, onChange, onSave, onDelete, onDuplicate, onKeyDown }) {
  const [hover, setHover] = useState(false)
  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: hover ? `${t.gold}08` : i % 2 !== 0 ? t.rowAlt : 'transparent', transition: 'background .1s' }}>
      <td style={{ ...css.td, textAlign: 'center', color: t.text4, fontSize: '0.75rem', width: '36px' }}>{i + 1}</td>
      <td style={{ ...css.td, minWidth: '160px' }}>
        <PartyDropdown value={row.party} t={t}
          onChange={v => { onChange('party', v); setTimeout(onSave, 50) }}
          onKeyDown={e => onKeyDown(e, 'party')} />
      </td>
      <td style={css.td}><Cell value={row.weight} onChange={v => onChange('weight', v)} onKeyDown={e => onKeyDown(e, 'weight')} type="number" placeholder="0.0000" align="right" inputRef={el => inputRefs.current[`q-${row._id}-weight`] = el} /></td>
      <td style={css.td}><Cell value={row.rate} onChange={v => onChange('rate', v)} onKeyDown={e => onKeyDown(e, 'rate')} type="number" placeholder="0" align="right" inputRef={el => inputRefs.current[`q-${row._id}-rate`] = el} /></td>
      <td style={{ ...css.td, textAlign: 'center', width: '90px' }}>
        <button onClick={() => { onChange('is_kl', !row.is_kl); setTimeout(onSave, 50) }}
          style={{ border: `1px solid ${row.is_kl ? t.blue : t.border}`, background: row.is_kl ? t.blueDim : 'transparent', color: row.is_kl ? t.blue : t.text4, borderRadius: '6px', padding: '4px 12px', fontSize: '0.75rem', fontWeight: row.is_kl ? 700 : 400, cursor: 'pointer', transition: 'all .15s', fontFamily: 'inherit' }}>
          {row.is_kl ? 'KL ✓' : 'KL'}
        </button>
      </td>
      <td style={{ ...css.td, width: '72px' }}>
        <div style={{ display: 'flex', gap: '2px', justifyContent: 'flex-end', opacity: hover ? 1 : 0, transition: 'opacity .15s' }}>
          <ActionBtn icon="⧉" title="Duplicate" onClick={onDuplicate} color={t.text3} t={t} />
          <ActionBtn icon="✕" title="Delete" onClick={onDelete} color={t.red} t={t} />
        </div>
      </td>
    </tr>
  )
}

function BarRow({ row, i, t, css, inputRefs, onChange, onSave, onDelete, onDuplicate, onKeyDown }) {
  const [hover, setHover] = useState(false)
  const isStaff = row.batch.toUpperCase() === 'STAFF SALE'
  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: isStaff ? t.blueDim : hover ? `${t.gold}08` : i % 2 !== 0 ? t.rowAlt : 'transparent', transition: 'background .1s' }}>
      <td style={{ ...css.td, textAlign: 'center', color: t.text4, fontSize: '0.75rem', width: '36px' }}>{i + 1}</td>
      <td style={css.td}><Cell value={row.batch} onChange={v => onChange('batch', v)} onKeyDown={e => onKeyDown(e, 'batch')} placeholder="Batch name" style={{ color: isStaff ? t.blue : undefined }} inputRef={el => inputRefs.current[`b-${row._id}-batch`] = el} /></td>
      <td style={css.td}><Cell value={row.market_weight} onChange={v => onChange('market_weight', v)} onKeyDown={e => onKeyDown(e, 'market_weight')} type="number" placeholder="0.0000" align="right" inputRef={el => inputRefs.current[`b-${row._id}-market_weight`] = el} /></td>
      <td style={css.td}><Cell value={row.purity} onChange={v => onChange('purity', v)} onKeyDown={e => onKeyDown(e, 'purity')} type="number" placeholder="99.50" align="right" inputRef={el => inputRefs.current[`b-${row._id}-purity`] = el} /></td>
      <td style={{ ...css.td, width: '130px' }}>
        <StateDropdown value={row.state} t={t} onChange={v => { onChange('state', v); setTimeout(onSave, 50) }} />
      </td>
      <td style={{ ...css.td, width: '72px' }}>
        <div style={{ display: 'flex', gap: '2px', justifyContent: 'flex-end', opacity: hover ? 1 : 0, transition: 'opacity .15s' }}>
          <ActionBtn icon="⧉" title="Duplicate" onClick={onDuplicate} color={t.text3} t={t} />
          <ActionBtn icon="✕" title="Delete" onClick={onDelete} color={t.red} t={t} />
        </div>
      </td>
    </tr>
  )
}

// ── SHARED DROPDOWN PORTAL ───────────────────────────────────────────────
function DropPortal({ triggerRef, open, children }) {
  const [style, setStyle] = useState({})
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, width: 240, zIndex: 99999 })
  }, [open])
  if (!open || typeof window === 'undefined') return null
  return createPortal(<div style={{...style, width: 240}}>{children}</div>, document.body)
}

// ── OCR BOX ───────────────────────────────────────────────────────────────
function OcrBox({ label, required, value, onChange, onScan, ocr, onClear, placeholder, hint, highlight, t }) {
  return (
    <FormField label={label} required={required} t={t}>
      {/* Scan area — click to upload */}
      {!ocr.preview ? (
        <div onClick={onScan}
          style={{ border: `1.5px dashed ${ocr.loading ? t.gold : t.border2}`, borderRadius: '8px', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', background: ocr.loading ? t.goldDim : 'transparent', transition: 'all .15s' }}
          onMouseEnter={e => { if (!ocr.loading) e.currentTarget.style.borderColor = t.gold }}
          onMouseLeave={e => { if (!ocr.loading) e.currentTarget.style.borderColor = t.border2 }}>
          <span style={{ fontSize: '1.1rem' }}>{ocr.loading ? '⟳' : '📷'}</span>
          <span style={{ fontSize: '0.75rem', color: ocr.loading ? t.gold : t.text3 }}>
            {ocr.loading ? 'Scanning...' : hint}
          </span>
        </div>
      ) : (
        <div style={{ marginBottom: '6px', position: 'relative' }}>
          <img src={ocr.preview} alt="scan"
            style={{ width: '100%', maxHeight: '80px', objectFit: 'contain', borderRadius: '6px', border: `1px solid ${t.border}`, background: t.card2 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: ocr.status.startsWith('✓') ? t.green : t.text3 }}>
              {ocr.status}
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={onScan}
                style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '5px', padding: '2px 8px', fontSize: '0.68rem', color: t.text3, cursor: 'pointer', fontFamily: 'inherit' }}>
                Rescan
              </button>
              <button onClick={onClear}
                style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: '0.72rem', padding: '2px 4px' }}>✕</button>
            </div>
          </div>
        </div>
      )}
      {/* Manual input */}
      <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} step="any"
        style={{ width: '100%', background: ocr.status.startsWith('✓') ? `${t.green}12` : t.card2, border: `1px solid ${ocr.status.startsWith('✓') ? t.green : t.border}`, borderRadius: '7px', padding: '8px 10px', fontSize: '0.85rem', color: t.text1, outline: 'none', fontFamily: 'inherit', transition: 'all .2s' }}
        onFocus={e => { e.target.style.borderColor = t.gold; e.target.style.background = t.card2 }}
        onBlur={e => { e.target.style.borderColor = ocr.status.startsWith('✓') ? t.green : t.border; e.target.style.background = ocr.status.startsWith('✓') ? `${t.green}12` : t.card2 }} />
    </FormField>
  )
}

// ── FORM FIELD ────────────────────────────────────────────────────────────
function FormField({ label, required, t, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={{ fontSize: '0.68rem', fontWeight: 600, color: t.text3, letterSpacing: '.14em', textTransform: 'uppercase' }}>
        {label}{required && <span style={{ color: t.gold, marginLeft: '3px' }}>·</span>}
      </label>
      {children}
    </div>
  )
}

// ── PARTY DROPDOWN ────────────────────────────────────────────────────────
const partyCache = { list: null }

function PartyDropdown({ value, onChange, t }) {
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newVal, setNewVal] = useState('')
  const [search, setSearch] = useState('')
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (partyCache.list) { setOptions(partyCache.list); return }
    supabase.from('cal_parties').select('*').order('name').then(({ data }) => {
      const list = (data || []).map(r => ({ id: r.id, name: r.name }))
      partyCache.list = list; setOptions(list)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!triggerRef.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        { setOpen(false); setAdding(false); setNewVal(''); setSearch('') }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const addParty = async () => {
    const name = newVal.trim()
    if (!name || options.find(o => o.name.toLowerCase() === name.toLowerCase())) { setNewVal(''); setAdding(false); return }
    const { data } = await supabase.from('cal_parties').insert({ name }).select().single()
    if (data) {
      const updated = [...options, { id: data.id, name: data.name }].sort((a, b) => a.name.localeCompare(b.name))
      partyCache.list = updated; setOptions(updated); onChange(data.name)
    }
    setNewVal(''); setAdding(false); setOpen(false); setSearch('')
  }

  const deleteParty = async (opt, e) => {
    e.stopPropagation()
    await supabase.from('cal_parties').delete().eq('id', opt.id)
    const updated = options.filter(o => o.id !== opt.id)
    partyCache.list = updated; setOptions(updated)
    if (value === opt.name) onChange('')
  }

  const filtered = search.trim() ? options.filter(o => o.name.toLowerCase().includes(search.toLowerCase())) : options
  const dotColor = value ? partyColor(value) : t.text4

  const menuStyle = {
    background: t.card, border: `1px solid ${t.border2}`,
    borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,.5)',
    overflow: 'hidden', width: '100%'
  }

  return (
    <>
      <div ref={triggerRef} onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', width: '100%', padding: '4px 0' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotColor, flexShrink: 0, opacity: value ? 1 : 0.3 }} />
        <span style={{ flex: 1, fontSize: '0.88rem', color: value ? t.text1 : t.text4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || 'Select party…'}
        </span>
        <span style={{ fontSize: '0.55rem', color: t.text4, opacity: .5 }}>▼</span>
      </div>

      <DropPortal triggerRef={triggerRef} open={open}>
        <div ref={menuRef} style={menuStyle}>
          {/* Search */}
          <div style={{ padding: '8px' }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search parties…"
              onKeyDown={e => e.key === 'Escape' && setOpen(false)}
              style={{ width: '100%', background: t.card2, border: `1px solid ${t.border}`, borderRadius: '7px', padding: '7px 11px', fontSize: '0.82rem', color: t.text1, outline: 'none', fontFamily: 'inherit' }} />
          </div>
          {/* List */}
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {filtered.length === 0
              ? <div style={{ padding: '14px', textAlign: 'center', fontSize: '0.78rem', color: t.text4 }}>No results</div>
              : filtered.map(opt => (
                <div key={opt.id} onClick={e => { e.stopPropagation(); onChange(opt.name); setOpen(false); setSearch('') }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', cursor: 'pointer', background: opt.name === value ? t.goldDim : 'transparent' }}
                  onMouseEnter={e => { if (opt.name !== value) e.currentTarget.style.background = t.card2 }}
                  onMouseLeave={e => { e.currentTarget.style.background = opt.name === value ? t.goldDim : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: partyColor(opt.name), flexShrink: 0 }} />
                    <span style={{ fontSize: '0.88rem', color: opt.name === value ? t.gold : t.text1, fontWeight: opt.name === value ? 600 : 400 }}>{opt.name}</span>
                  </div>
                  <button onClick={e => deleteParty(opt, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text4, padding: '3px 6px', borderRadius: '4px', fontSize: '0.75rem' }}
                    onMouseEnter={e => e.currentTarget.style.color = t.red}
                    onMouseLeave={e => e.currentTarget.style.color = t.text4}>✕</button>
                </div>
              ))}
          </div>
          {/* Add */}
          <div style={{ borderTop: `1px solid ${t.border}`, padding: '8px' }}>
            {adding ? (
              <div style={{ display: 'flex', gap: '6px' }}>
                <input autoFocus value={newVal} onChange={e => setNewVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addParty(); if (e.key === 'Escape') { setAdding(false); setNewVal('') } }}
                  placeholder="Party name"
                  style={{ flex: 1, background: t.card2, border: `1px solid ${t.goldBdr}`, borderRadius: '6px', padding: '7px 10px', fontSize: '0.82rem', color: t.text1, outline: 'none', fontFamily: 'inherit' }} />
                <button onClick={addParty}
                  style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Add</button>
              </div>
            ) : (
              <button onClick={e => { e.stopPropagation(); setAdding(true) }}
                style={{ width: '100%', background: 'none', border: `1px dashed ${t.border2}`, borderRadius: '7px', color: t.gold, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', padding: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                + Add new party
              </button>
            )}
          </div>
        </div>
      </DropPortal>
    </>
  )
}

// ── STATE DROPDOWN ────────────────────────────────────────────────────────
const stateCache = { list: null }

function StateDropdown({ value, onChange, t }) {
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newVal, setNewVal] = useState('')
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (stateCache.list) { setOptions(stateCache.list); return }
    supabase.from('cal_states').select('*').order('name').then(({ data }) => {
      const list = (data || []).map(r => ({ id: r.id, name: r.name }))
      stateCache.list = list; setOptions(list)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!triggerRef.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        { setOpen(false); setAdding(false); setNewVal('') }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const addState = async () => {
    const name = newVal.trim().toUpperCase()
    if (!name || options.find(o => o.name === name)) { setNewVal(''); setAdding(false); return }
    const { data } = await supabase.from('cal_states').insert({ name }).select().single()
    if (data) {
      const updated = [...options, { id: data.id, name: data.name }].sort((a, b) => a.name.localeCompare(b.name))
      stateCache.list = updated; setOptions(updated); onChange(data.name)
    }
    setNewVal(''); setAdding(false); setOpen(false)
  }

  const deleteState = async (opt, e) => {
    e.stopPropagation()
    await supabase.from('cal_states').delete().eq('id', opt.id)
    const updated = options.filter(o => o.id !== opt.id)
    stateCache.list = updated; setOptions(updated)
    if (value === opt.name && updated.length) onChange(updated[0].name)
  }

  const display = (!value || value === 'Non-KL') ? (options[0]?.name || '') : value
  const isKL = display === 'KL'

  const menuStyle = {
    background: t.card, border: `1px solid ${t.border2}`,
    borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,.5)',
    overflow: 'hidden', width: '100%'
  }

  return (
    <>
      <button ref={triggerRef} onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.card2, border: `1px solid ${isKL ? t.blue : t.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.85rem', color: isKL ? t.blue : t.text1, fontWeight: isKL ? 600 : 400, fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
        <span>{display || '—'}</span>
        <span style={{ fontSize: '0.55rem', opacity: .5 }}>▼</span>
      </button>

      <DropPortal triggerRef={triggerRef} open={open}>
        <div ref={menuRef} style={menuStyle}>
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {options.map(opt => (
              <div key={opt.id} onClick={e => { e.stopPropagation(); onChange(opt.name); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer', background: opt.name === display ? t.goldDim : 'transparent' }}
                onMouseEnter={e => { if (opt.name !== display) e.currentTarget.style.background = t.card2 }}
                onMouseLeave={e => { e.currentTarget.style.background = opt.name === display ? t.goldDim : 'transparent' }}>
                <span style={{ fontSize: '0.88rem', color: opt.name === display ? t.gold : t.text1, fontWeight: opt.name === display ? 600 : 400 }}>{opt.name}</span>
                <button onClick={e => deleteState(opt, e)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text4, padding: '3px 6px', borderRadius: '4px', fontSize: '0.75rem' }}
                  onMouseEnter={e => e.currentTarget.style.color = t.red}
                  onMouseLeave={e => e.currentTarget.style.color = t.text4}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ borderTop: `1px solid ${t.border}`, padding: '8px' }}>
            {adding ? (
              <div style={{ display: 'flex', gap: '6px' }}>
                <input autoFocus value={newVal} onChange={e => setNewVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addState(); if (e.key === 'Escape') { setAdding(false); setNewVal('') } }}
                  placeholder="e.g. MH" maxLength={10}
                  style={{ flex: 1, background: t.card2, border: `1px solid ${t.goldBdr}`, borderRadius: '6px', padding: '7px 10px', fontSize: '0.82rem', color: t.text1, outline: 'none', fontFamily: 'inherit', textTransform: 'uppercase' }} />
                <button onClick={addState}
                  style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Add</button>
              </div>
            ) : (
              <button onClick={e => { e.stopPropagation(); setAdding(true) }}
                style={{ width: '100%', background: 'none', border: `1px dashed ${t.border2}`, borderRadius: '7px', color: t.gold, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', padding: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                + Add new state
              </button>
            )}
          </div>
        </div>
      </DropPortal>
    </>
  )
}

function StateBadge({ state, t }) {
  const isSurplus = state.includes('SURPLUS'); const isKL = state.toUpperCase() === 'KL'
  const color = isSurplus ? t.orange : isKL ? t.blue : t.green
  const bg    = isSurplus ? t.orangeDim : isKL ? t.blueDim : t.greenDim
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 600, color, background: bg, letterSpacing: '.04em', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{state}</span>
}

function QuotaSummary({ quotas, t }) {
  const valid = quotas.filter(q => q.party && q.weight && q.rate)
  const totalWt = valid.reduce((s, q) => s + Number(q.weight), 0)
  const partyMap = valid.reduce((acc, q) => { if (!acc[q.party]) acc[q.party] = { weight: 0, isKL: q.is_kl }; acc[q.party].weight += Number(q.weight); return acc }, {})
  return (
    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: '0.68rem', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Summary:</span>
      {Object.entries(partyMap).map(([party, d]) => (
        <div key={party} style={{ background: t.card, border: `1px solid ${t.border}`, borderLeft: `3px solid ${partyColor(party)}`, borderRadius: '6px', padding: '5px 12px', fontSize: '0.8rem', display: 'flex', gap: '7px', alignItems: 'center' }}>
          <span style={{ color: t.text1, fontWeight: 600 }}>{party}</span>
          <span style={{ color: t.text3 }}>·</span>
          <span style={{ color: t.gold, fontFamily: 'monospace' }}>{Number(d.weight).toLocaleString('en-IN', { maximumFractionDigits: 4, minimumFractionDigits: 0 })}g</span>
          {d.isKL && <span style={{ color: t.blue, fontSize: '0.65rem', fontWeight: 700, background: t.blueDim, borderRadius: '4px', padding: '1px 6px' }}>KL</span>}
        </div>
      ))}
      <div style={{ marginLeft: 'auto', background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 12px', fontSize: '0.8rem' }}>
        <span style={{ color: t.text3 }}>Total: </span>
        <span style={{ color: t.gold, fontFamily: 'monospace', fontWeight: 600 }}>{Number(totalWt).toLocaleString('en-IN', { maximumFractionDigits: 4, minimumFractionDigits: 0 })}g</span>
      </div>
    </div>
  )
}

function BarSummary({ bars, t }) {
  const valid = bars.filter(b => b.batch && b.market_weight && b.purity)
  const totalWt = valid.reduce((s, b) => s + Number(b.market_weight), 0)
  const klWt    = valid.filter(b => b.state === 'KL').reduce((s, b) => s + Number(b.market_weight), 0)
  const nonKLWt = valid.filter(b => b.state !== 'KL').reduce((s, b) => s + Number(b.market_weight), 0)
  return (
    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: '0.68rem', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase' }}>Summary:</span>
      {[{ label: 'Total', value: totalWt, color: t.gold }, { label: 'KL', value: klWt, color: t.blue }, { label: 'Non-KL', value: nonKLWt, color: t.text2 }].map(s => (
        <div key={s.label} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '5px 12px', fontSize: '0.8rem', display: 'flex', gap: '7px', alignItems: 'center' }}>
          <span style={{ color: t.text3 }}>{s.label}</span>
          <span style={{ color: s.color, fontFamily: 'monospace', fontWeight: 600 }}>{Number(s.value).toLocaleString('en-IN', { maximumFractionDigits: 4 })}g</span>
        </div>
      ))}
    </div>
  )
}

// ── BAR CARD (unsaved, generated row) ────────────────────────────────────
function BarCard({ gen, index, t, date, user, onNameChange, onSaved, onRemove, showToast }) {
  const [weight, setWeight]   = useState('')
  const [purity, setPurity]   = useState('')
  const [state, setState]     = useState('KA')
  const [saving, setSaving]   = useState(false)
  const [wOcr, setWOcr]       = useState({ loading: false, preview: null, status: '' })
  const [pOcr, setPOcr]       = useState({ loading: false, preview: null, status: '' })
  const [name, setName]       = useState(gen.name)
  const wRef = useRef(null)
  const pRef = useRef(null)

  const scanImage = async (file, type) => {
    const set = type === 'weight' ? setWOcr : setPOcr
    set({ loading: true, preview: URL.createObjectURL(file), status: 'Scanning...' })
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file)
    })
    try {
      const resp = await fetch('/api/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType: file.type || 'image/jpeg', type })
      })
      const result = await resp.json()
      if (!result.success) throw new Error(result.error)
      const parsed = result.data
      if (type === 'weight' && parsed.weight != null) {
        setWeight(String(parsed.weight))
        setWOcr(s => ({ ...s, loading: false, status: `✓ ${parsed.weight} g` }))
      } else if (type === 'purity' && parsed.purity != null) {
        setPurity(String(parsed.purity))
        setPOcr(s => ({ ...s, loading: false, status: `✓ ${parsed.purity}%` }))
      } else {
        set(s => ({ ...s, loading: false, status: 'Could not read — type manually' }))
      }
    } catch (err) {
      set(s => ({ ...s, loading: false, status: 'Scan failed — type manually' }))
    }
  }

  const save = async () => {
    if (!weight) return
    setSaving(true)
    const payload = { date, batch: name.trim(), market_weight: parseFloat(weight), purity: purity ? parseFloat(purity) : null, state, created_by: user?.id }
    const { data } = await supabase.from('cal_bars').insert(payload).select().single()
    if (data) { onSaved(data); showToast(`✓ ${name} saved`) }
    setSaving(false)
  }

  const hasPurity = !!purity
  const hasWeight = !!weight

  return (
    <div style={{ background: t.card, border: `1px solid ${hasWeight && hasPurity ? t.green + '40' : hasWeight ? t.gold + '30' : t.border}`, borderRadius: '12px', overflow: 'hidden', transition: 'border-color .2s' }}>
      <input ref={wRef} type="file" accept="image/*" capture="environment" onChange={e => { const f = e.target.files?.[0]; if (f) scanImage(f, 'weight'); e.target.value = '' }} style={{ display: 'none' }} />
      <input ref={pRef} type="file" accept="image/*" capture="environment" onChange={e => { const f = e.target.files?.[0]; if (f) scanImage(f, 'purity'); e.target.value = '' }} style={{ display: 'none' }} />

      {/* Card header */}
      <div style={{ padding: '10px 14px', background: t.card2, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <input value={name} onChange={e => { setName(e.target.value); onNameChange(e.target.value) }}
          style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '1rem', fontWeight: 700, color: t.gold, fontFamily: 'monospace', width: '80px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StateDropdown value={state} t={t} onChange={setState} />
          <button onClick={onRemove} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: '0.8rem', padding: '2px 4px' }}
            onMouseEnter={e => e.currentTarget.style.color = t.red}
            onMouseLeave={e => e.currentTarget.style.color = t.text4}>✕</button>
        </div>
      </div>

      {/* Weight row */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}20`, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={() => wRef.current?.click()} disabled={wOcr.loading}
          style={{ background: hasWeight ? t.greenDim : t.goldDim, border: `1px solid ${hasWeight ? t.green + '50' : t.goldBdr}`, borderRadius: '8px', padding: '8px 12px', cursor: wOcr.loading ? 'wait' : 'pointer', color: hasWeight ? t.green : t.gold, fontSize: '1.1rem', flexShrink: 0, lineHeight: 1 }}>
          {wOcr.loading ? '⟳' : hasWeight ? '✓' : '📷'}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.65rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>Weight (g)</div>
          <input type="number" value={weight} onChange={e => setWeight(e.target.value)} placeholder="Scan or type"
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: '1.2rem', fontWeight: 600, color: hasWeight ? t.gold : t.text3, fontFamily: 'monospace' }} />
        </div>
        {wOcr.preview && <img src={wOcr.preview} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '5px', border: `1px solid ${t.border}` }} />}
      </div>

      {/* Purity row */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}20`, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={() => pRef.current?.click()} disabled={pOcr.loading}
          style={{ background: hasPurity ? t.greenDim : t.card2, border: `1px solid ${hasPurity ? t.green + '50' : t.border}`, borderRadius: '8px', padding: '8px 12px', cursor: pOcr.loading ? 'wait' : 'pointer', color: hasPurity ? t.green : t.text3, fontSize: '1.1rem', flexShrink: 0, lineHeight: 1 }}>
          {pOcr.loading ? '⟳' : hasPurity ? '✓' : '📷'}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.65rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '3px' }}>Purity % <span style={{ color: t.text4, fontWeight: 400 }}>(optional now)</span></div>
          <input type="number" value={purity} onChange={e => setPurity(e.target.value)} placeholder="Scan later"
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: '1.2rem', fontWeight: 600, color: hasPurity ? t.gold : t.text3, fontFamily: 'monospace' }} />
        </div>
        {pOcr.preview && <img src={pOcr.preview} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '5px', border: `1px solid ${t.border}` }} />}
      </div>

      {/* Save button */}
      <div style={{ padding: '10px 14px' }}>
        <button onClick={save} disabled={!hasWeight || saving}
          style={{ width: '100%', background: hasWeight ? t.text1 : t.border, color: hasWeight ? t.bg : t.text4, border: 'none', borderRadius: '8px', padding: '10px', fontSize: '0.85rem', fontWeight: 700, cursor: hasWeight ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'all .15s' }}>
          {saving ? '⟳ Saving...' : hasWeight ? `Save ${name}` : 'Scan weight first'}
        </button>
      </div>
    </div>
  )
}

// ── SAVED BAR CARD ────────────────────────────────────────────────────────
function SavedBarCard({ row, t, date, user, onUpdate, onDelete, showToast }) {
  const [editing, setEditing]   = useState(false)
  const [purity, setPurity]     = useState(row.purity || '')
  const [pOcr, setPOcr]         = useState({ loading: false, preview: null, status: '' })
  const [saving, setSaving]     = useState(false)
  const pRef = useRef(null)
  const needsPurity = !row.purity

  const scanPurity = async (file) => {
    setPOcr({ loading: true, preview: URL.createObjectURL(file), status: 'Scanning...' })
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file)
    })
    try {
      const resp = await fetch('/api/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType: file.type || 'image/jpeg', type: 'purity' })
      })
      const result = await resp.json()
      if (!result.success) throw new Error(result.error)
      if (result.data.purity != null) {
        setPurity(String(result.data.purity))
        setPOcr(s => ({ ...s, loading: false, status: `✓ ${result.data.purity}%` }))
      } else {
        setPOcr(s => ({ ...s, loading: false, status: 'Could not read — type manually' }))
      }
    } catch { setPOcr(s => ({ ...s, loading: false, status: 'Scan failed' })) }
  }

  const savePurity = async () => {
    if (!purity) return
    setSaving(true)
    await supabase.from('cal_bars').update({ purity: parseFloat(purity) }).eq('id', row.id)
    onUpdate({ ...row, purity: parseFloat(purity) })
    showToast(`✓ ${row.batch} purity saved`)
    setEditing(false); setSaving(false)
    setPOcr({ loading: false, preview: null, status: '' })
  }

  const borderColor = needsPurity ? t.orange + '60' : t.green + '40'

  return (
    <div style={{ background: t.card, border: `1px solid ${borderColor}`, borderRadius: '12px', overflow: 'hidden' }}>
      <input ref={pRef} type="file" accept="image/*" capture="environment"
        onChange={e => { const f = e.target.files?.[0]; if (f) scanPurity(f); e.target.value = '' }} style={{ display: 'none' }} />

      {/* Header */}
      <div style={{ padding: '10px 14px', background: t.card2, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: t.gold, fontFamily: 'monospace' }}>{row.batch}</span>
          <span style={{ background: row.state === 'KL' ? t.blueDim : t.card3, color: row.state === 'KL' ? t.blue : t.text3, borderRadius: '4px', padding: '1px 7px', fontSize: '0.68rem' }}>{row.state}</span>
        </div>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: '0.78rem', padding: '2px 6px' }}
          onMouseEnter={e => e.currentTarget.style.color = t.red}
          onMouseLeave={e => e.currentTarget.style.color = t.text4}>✕</button>
      </div>

      {/* Weight — always saved */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}20`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '2px' }}>Weight</div>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: t.gold, fontFamily: 'monospace' }}>{Number(row.market_weight).toLocaleString('en-IN', { maximumFractionDigits: 4, minimumFractionDigits: 0 })}g</span>
        </div>
        <span style={{ fontSize: '0.72rem', color: t.green }}>✓ saved</span>
      </div>

      {/* Purity */}
      <div style={{ padding: '10px 14px' }}>
        {needsPurity || editing ? (
          <div>
            <div style={{ fontSize: '0.65rem', color: t.orange, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>
              {needsPurity ? '⚠ Purity pending' : 'Update Purity'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <button onClick={() => pRef.current?.click()} disabled={pOcr.loading}
                style={{ background: purity ? t.greenDim : t.goldDim, border: `1px solid ${purity ? t.green + '50' : t.goldBdr}`, borderRadius: '8px', padding: '12px 16px', cursor: pOcr.loading ? 'wait' : 'pointer', color: purity ? t.green : t.gold, fontSize: '1.3rem', lineHeight: 1, minWidth: '52px', textAlign: 'center' }}>
                {pOcr.loading ? '⟳' : purity ? '✓' : '📷'}
              </button>
              <input type="number" value={purity} onChange={e => setPurity(e.target.value)} placeholder="Scan or type"
                style={{ flex: 1, background: t.card2, border: `1px solid ${purity ? t.green + '50' : t.border}`, borderRadius: '7px', padding: '8px 10px', fontSize: '0.95rem', fontWeight: 600, color: purity ? t.gold : t.text3, fontFamily: 'monospace', outline: 'none' }} />
            </div>
            {pOcr.status && <div style={{ fontSize: '0.72rem', color: pOcr.status.startsWith('✓') ? t.green : t.text3, fontFamily: 'monospace', marginBottom: '8px' }}>{pOcr.status}</div>}
            <button onClick={savePurity} disabled={!purity || saving}
              style={{ width: '100%', background: purity ? t.green : t.border, color: purity ? '#fff' : t.text4, border: 'none', borderRadius: '8px', padding: '9px', fontSize: '0.85rem', fontWeight: 700, cursor: purity ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              {saving ? '⟳ Saving...' : '✓ Save Purity'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.65rem', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '2px' }}>Purity</div>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: t.text1, fontFamily: 'monospace' }}>{Number(row.purity).toLocaleString('en-IN', { maximumFractionDigits: 4, minimumFractionDigits: 0 })}%</span>
            </div>
            <button onClick={() => { setEditing(true); setPurity(String(row.purity)) }}
              style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '6px', padding: '4px 10px', color: t.text3, cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit' }}>Edit</button>
          </div>
        )}
      </div>
    </div>
  )
}

function LoadingCard({ t }) {
  return <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '48px', textAlign: 'center', color: t.text3, fontSize: '0.82rem' }}>Loading…</div>
}