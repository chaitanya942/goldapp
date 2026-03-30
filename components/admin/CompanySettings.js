'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', green: '#2a8a5a', red: '#c03030' },
}

export default function CompanySettings() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    company_name: '',
    head_office_address: '',
    head_office_city: '',
    head_office_state: '',
    head_office_pin: '',
    gstin: '',
    pan: '',
    hsn_code: '711319',
    transporter_name: 'BVC LOGISTICS PVT. LTD.',
    transportation_mode: 'BY AIR & ROAD',
    logo_url: '',
  })

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    setLoading(true)
    const res = await fetch('/api/company-settings')
    const json = await res.json()
    if (json.data) setForm(json.data)
    setLoading(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    const res = await fetch('/api/company-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
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

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const s = {
    input: { background: t.card2, border: `1px solid ${t.border}`, borderRadius: '8px', padding: '10px 14px', color: t.text1, fontSize: '.75rem', outline: 'none', width: '100%' },
    label: { fontSize: '.68rem', color: t.text3, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 500 },
    btnGold: { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '.75rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '.05em' },
  }

  if (loading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: t.text3 }}>Loading...</div>
  }

  return (
    <div style={{ padding: '32px', maxWidth: '900px' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 300, color: t.text1, letterSpacing: '.03em' }}>Company Settings</div>
        <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>Configure company details for delivery challans</div>
      </div>

      {message && (
        <div style={{ padding: '12px 16px', marginBottom: '20px', borderRadius: '8px', background: message.includes('success') ? `${t.green}15` : `${t.red}15`, border: `1px solid ${message.includes('success') ? t.green : t.red}40`, fontSize: '.75rem', color: message.includes('success') ? t.green : t.red }}>
          {message}
        </div>
      )}

      <div style={{ display: 'grid', gap: '20px' }}>
        {/* Company Details */}
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '24px' }}>
          <div style={{ fontSize: '.9rem', fontWeight: 600, color: t.text1, marginBottom: '16px' }}>Company Details</div>
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <div style={s.label}>Company Name</div>
              <input type="text" style={s.input} value={form.company_name} onChange={e => setField('company_name', e.target.value)} placeholder="WHITE GOLD BULLION PVT.LTD" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <div style={s.label}>GSTIN</div>
                <input type="text" style={s.input} value={form.gstin} onChange={e => setField('gstin', e.target.value)} placeholder="29AAPCA3170M1Z5" />
              </div>
              <div>
                <div style={s.label}>PAN</div>
                <input type="text" style={s.input} value={form.pan} onChange={e => setField('pan', e.target.value)} placeholder="AAPCA3170M" />
              </div>
            </div>
          </div>
        </div>

        {/* Head Office Address */}
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '24px' }}>
          <div style={{ fontSize: '.9rem', fontWeight: 600, color: t.text1, marginBottom: '16px' }}>Head Office Address (Consignee)</div>
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <div style={s.label}>Address</div>
              <textarea style={{ ...s.input, minHeight: '80px', fontFamily: 'inherit' }} value={form.head_office_address} onChange={e => setField('head_office_address', e.target.value)} placeholder="NO-75 FIRST FLOOR HOSUR ROAD KORAMANGALA, INDUSTRIAL AREA" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <div style={s.label}>City</div>
                <input type="text" style={s.input} value={form.head_office_city} onChange={e => setField('head_office_city', e.target.value)} placeholder="BENGALURU URBAN" />
              </div>
              <div>
                <div style={s.label}>State</div>
                <input type="text" style={s.input} value={form.head_office_state} onChange={e => setField('head_office_state', e.target.value)} placeholder="KARNATAKA" />
              </div>
              <div>
                <div style={s.label}>PIN Code</div>
                <input type="text" style={s.input} value={form.head_office_pin} onChange={e => setField('head_office_pin', e.target.value)} placeholder="560095" />
              </div>
            </div>
          </div>
        </div>

        {/* Transporter & Other Details */}
        <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: '24px' }}>
          <div style={{ fontSize: '.9rem', fontWeight: 600, color: t.text1, marginBottom: '16px' }}>Transporter & Product Details</div>
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <div style={s.label}>Transporter Name</div>
                <input type="text" style={s.input} value={form.transporter_name} onChange={e => setField('transporter_name', e.target.value)} placeholder="BVC LOGISTICS PVT. LTD." />
              </div>
              <div>
                <div style={s.label}>Transportation Mode</div>
                <input type="text" style={s.input} value={form.transportation_mode} onChange={e => setField('transportation_mode', e.target.value)} placeholder="BY AIR & ROAD" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
              <div>
                <div style={s.label}>HSN Code</div>
                <input type="text" style={s.input} value={form.hsn_code} onChange={e => setField('hsn_code', e.target.value)} placeholder="711319" />
              </div>
              <div>
                <div style={s.label}>Logo URL (optional)</div>
                <input type="text" style={s.input} value={form.logo_url} onChange={e => setField('logo_url', e.target.value)} placeholder="https://example.com/logo.png" />
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button onClick={handleSave} disabled={saving} style={{ ...s.btnGold, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
