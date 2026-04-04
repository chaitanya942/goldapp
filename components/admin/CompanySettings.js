'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', green: '#2a8a5a', red: '#c03030' },
}

const EMPTY_FORM = {
  // ── Core ─────────────────────────────────────────────────────────────────
  company_name:          '',
  pan:                   '',
  // ── Head Office / Consignee ───────────────────────────────────────────────
  gstin:                 '',   // HO GSTIN (Karnataka — consignee side of challan)
  head_office_building:  '',
  head_office_address:   '',
  head_office_city:      '',
  head_office_state:     '',
  head_office_pin:       '',
  // ── State-wise branch GSTINs (bill-from side of challan) ──────────────────
  gstin_ka:              '',
  gstin_ap:              '',
  gstin_kl:              '',
  gstin_ts:              '',
  gstin_tn:              '',
  // ── Transport & product ───────────────────────────────────────────────────
  transporter_name:      'BVC LOGISTICS PVT. LTD.',
  transportation_mode:   'BY AIR & ROAD',
  hsn_code:              '711319',
  // ── Tax rates ─────────────────────────────────────────────────────────────
  igst_rate:             '3',
  value_uplift_pct:      '7.5',
  // ── Logo ──────────────────────────────────────────────────────────────────
  logo_url:              '',
}

export default function CompanySettings() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [message, setMessage] = useState('')
  const [form,    setForm]    = useState(EMPTY_FORM)

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    setLoading(true)
    const res  = await fetch('/api/company-settings')
    const json = await res.json()
    if (json.data) setForm(f => ({ ...f, ...json.data }))
    setLoading(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    const res  = await fetch('/api/company-settings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const json = await res.json()
    if (json.error) {
      setMessage(json.error)
    } else {
      setMessage('Settings saved successfully!')
      setTimeout(() => setMessage(''), 3000)
    }
    setSaving(false)
  }

  const sf = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const s = {
    input:  { background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '10px 14px', color: t.text1, fontSize: '.75rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
    label:  { fontSize: '.68rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 500, display: 'block' },
    section:{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '24px', display: 'grid', gap: '16px' },
    title:  { fontSize: '.9rem', fontWeight: 600, color: t.text1, marginBottom: '4px' },
    sub:    { fontSize: '.72rem', color: t.text3, marginBottom: '12px' },
  }

  const Field = ({ label, fieldKey, placeholder, type = 'text', half }) => (
    <div style={half ? {} : {}}>
      <label style={s.label}>{label}</label>
      <input
        type={type}
        style={s.input}
        value={form[fieldKey] ?? ''}
        onChange={e => sf(fieldKey, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )

  if (loading) return <div style={{ padding: '32px', textAlign: 'center', color: t.text3 }}>Loading...</div>

  return (
    <div style={{ padding: '32px', maxWidth: '900px' }}>

      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Company Settings</div>
        <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>All delivery challan data is pulled from here — no hardcoding</div>
      </div>

      {message && (
        <div style={{
          padding: '12px 16px', marginBottom: '20px', borderRadius: '8px',
          background: message.includes('success') ? `${t.green}15` : `${t.red}15`,
          border: `1px solid ${message.includes('success') ? t.green : t.red}40`,
          fontSize: '.75rem', color: message.includes('success') ? t.green : t.red,
        }}>
          {message}
        </div>
      )}

      <div style={{ display: 'grid', gap: '20px' }}>

        {/* ── Company Core ─────────────────────────────────────────────────── */}
        <div style={s.section}>
          <div>
            <div style={s.title}>Company Details</div>
            <div style={s.sub}>Core identity used throughout the challan</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <Field label="Company Name"   fieldKey="company_name"   placeholder="WHITE GOLD BULLION PVT.LTD" />
            <Field label="PAN"            fieldKey="pan"            placeholder="AAPCA3170M" />
          </div>
        </div>

        {/* ── Head Office / Consignee ──────────────────────────────────────── */}
        <div style={s.section}>
          <div>
            <div style={s.title}>Head Office — Consignee (Right side of challan)</div>
            <div style={s.sub}>This is the receiving end — always White Gold HO, Bengaluru</div>
          </div>
          <Field label="HO GSTIN (Karnataka — consignee side)" fieldKey="gstin" placeholder="29AAPCA3170M1Z5" />
          <Field label="Building / Landmark Name" fieldKey="head_office_building" placeholder="HOUSE OF WHITE GOLD" />
          <Field label="Street Address" fieldKey="head_office_address" placeholder="NO. 1, COMMERCIAL STREET" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <Field label="City"     fieldKey="head_office_city"  placeholder="BENGALURU" />
            <Field label="State"    fieldKey="head_office_state" placeholder="KARNATAKA" />
            <Field label="PIN Code" fieldKey="head_office_pin"   placeholder="560001" />
          </div>
        </div>

        {/* ── State-wise Branch GSTINs ────────────────────────────────────── */}
        <div style={s.section}>
          <div>
            <div style={s.title}>State-wise Branch GSTINs — Bill From (Left side of challan)</div>
            <div style={s.sub}>Used when a branch does not have a GSTIN stored individually. These are the company's registrations in each state.</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={s.label}>Karnataka (KA — 29)</label>
              <input type="text" style={s.input} value={form.gstin_ka ?? ''} onChange={e => sf('gstin_ka', e.target.value)} placeholder="29AAPCA3170M1Z5" />
            </div>
            <div>
              <label style={s.label}>Andhra Pradesh (AP — 37)</label>
              <input type="text" style={s.input} value={form.gstin_ap ?? ''} onChange={e => sf('gstin_ap', e.target.value)} placeholder="37AAPCA3170M1Z8" />
            </div>
            <div>
              <label style={s.label}>Kerala (KL — 32)</label>
              <input type="text" style={s.input} value={form.gstin_kl ?? ''} onChange={e => sf('gstin_kl', e.target.value)} placeholder="32AAPCA3170M1ZI" />
            </div>
            <div>
              <label style={s.label}>Telangana (TS — 36)</label>
              <input type="text" style={s.input} value={form.gstin_ts ?? ''} onChange={e => sf('gstin_ts', e.target.value)} placeholder="36AAPCA3170M1ZA" />
            </div>
            <div>
              <label style={s.label}>Tamil Nadu (TN — 33)</label>
              <input type="text" style={s.input} value={form.gstin_tn ?? ''} onChange={e => sf('gstin_tn', e.target.value)} placeholder="33AAPCA3170M1ZG" />
            </div>
          </div>
          <div style={{ fontSize: '.68rem', color: t.text3, padding: '10px 12px', background: `${t.gold}10`, borderRadius: '6px', border: `1px solid ${t.gold}30` }}>
            Priority order: Branch record (branch_gstin) → State GSTIN above → Blank
          </div>
        </div>

        {/* ── Transport & Product ──────────────────────────────────────────── */}
        <div style={s.section}>
          <div>
            <div style={s.title}>Transporter & Product</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <Field label="Transporter Name"    fieldKey="transporter_name"    placeholder="BVC LOGISTICS PVT. LTD." />
            <Field label="Transportation Mode" fieldKey="transportation_mode"  placeholder="BY AIR & ROAD" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
            <Field label="HSN Code" fieldKey="hsn_code" placeholder="711319" />
            <Field label="Logo URL (optional — leave blank to use /logo.png)" fieldKey="logo_url" placeholder="https://..." />
          </div>
        </div>

        {/* ── Tax Rates ────────────────────────────────────────────────────── */}
        <div style={s.section}>
          <div>
            <div style={s.title}>Interstate Tax Rates</div>
            <div style={s.sub}>Applied only for non-Karnataka branches (interstate stock transfer)</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={s.label}>Value Uplift % (applied to invoice value before IGST)</label>
              <input type="number" step="0.01" style={s.input} value={form.value_uplift_pct ?? ''} onChange={e => sf('value_uplift_pct', e.target.value)} placeholder="7.5" />
            </div>
            <div>
              <label style={s.label}>IGST Rate %</label>
              <input type="number" step="0.01" style={s.input} value={form.igst_rate ?? ''} onChange={e => sf('igst_rate', e.target.value)} placeholder="3" />
            </div>
          </div>
          <div style={{ fontSize: '.68rem', color: t.text3, padding: '10px 12px', background: `${t.gold}10`, borderRadius: '6px', border: `1px solid ${t.gold}30` }}>
            Formula: Value of Goods = Invoice Amount × (1 + Uplift%) &nbsp;|&nbsp; IGST = Value of Goods × IGST% &nbsp;|&nbsp; Grand Total = Value of Goods + IGST
          </div>
        </div>

        {/* ── Save ─────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '10px 28px', fontSize: '.75rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '.05em', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

      </div>
    </div>
  )
}
