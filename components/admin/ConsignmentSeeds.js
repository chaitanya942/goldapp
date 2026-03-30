'use client'

import { useState, useEffect } from 'react'
import { useApp } from '../../lib/context'

const THEMES = {
  dark:  { bg: '#0a0a0a', card: '#111111', card2: '#161616', text1: '#f0e6c8', text2: '#c8b89a', text3: '#9a8a6a', text4: '#6a5a3a', gold: '#c9a84c', border: '#1e1e1e', green: '#3aaa6a', red: '#e05555', blue: '#3a8fbf' },
  light: { bg: '#f0ebe0', card: '#e8e2d6', card2: '#e0d9cc', text1: '#1a1208', text2: '#5a4a2a', text3: '#7a6a4a', text4: '#9a8a6a', gold: '#a07830', border: '#d0c8b8', green: '#2a8a5a', red: '#c03030', blue: '#2a6a9a' },
}

export default function ConsignmentSeeds() {
  const { theme } = useApp()
  const t = THEMES[theme]

  const [loading, setLoading] = useState(true)
  const [tmpPrfNo, setTmpPrfNo] = useState('')
  const [branches, setBranches] = useState([])
  const [message, setMessage] = useState(null)

  useEffect(() => { fetchSeeds() }, [])

  async function fetchSeeds() {
    setLoading(true)
    const res = await fetch('/api/consignment-seed')
    const data = await res.json()
    setTmpPrfNo(data.tmp_prf_no || 'WG000000')
    setBranches(data.branches || [])
    setLoading(false)
  }

  async function setSeed(branch) {
    const newExtNo = prompt(`Enter last used External No for ${branch.branch_name}:`, branch.last_external_no)
    if (!newExtNo) return

    const newTmpPrf = prompt('Enter last used TMP PRF No:', tmpPrfNo)
    if (!newTmpPrf) return

    setLoading(true)
    const res = await fetch('/api/consignment-seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch_name: branch.branch_name,
        tmp_prf_no: newTmpPrf,
        external_no: newExtNo,
        challan_no: `SEED-${branch.branch_name}-${newExtNo}`,
        state_code: branch.branch_code?.substring(0, 2) || 'KA',
        branch_code: branch.branch_code
      })
    })

    const result = await res.json()
    if (result.success) {
      setMessage({ type: 'success', text: `Seed set for ${branch.branch_name}` })
      fetchSeeds()
    } else {
      setMessage({ type: 'error', text: result.error })
    }
    setLoading(false)

    setTimeout(() => setMessage(null), 3000)
  }

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '10px' }
  const btnGold = { background: t.gold, color: '#1a0a00', border: 'none', borderRadius: '7px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 300, color: t.text1 }}>Consignment Number Seeds</div>
          <div style={{ fontSize: '11px', color: t.text3, marginTop: '2px' }}>Set initial numbers for auto-generation</div>
        </div>
        <button onClick={fetchSeeds} style={{ background: 'transparent', border: `1px solid ${t.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '12px', color: t.text3, cursor: 'pointer' }}>⟳ Refresh</button>
      </div>

      {/* Message */}
      {message && (
        <div style={{ ...card, padding: '10px 14px', background: message.type === 'success' ? `${t.green}20` : `${t.red}20`, borderColor: message.type === 'success' ? t.green : t.red }}>
          <div style={{ fontSize: '12px', color: message.type === 'success' ? t.green : t.red }}>{message.text}</div>
        </div>
      )}

      {/* Instructions */}
      <div style={{ ...card, padding: '14px 16px', background: `${t.blue}10`, borderColor: t.blue }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: t.blue, marginBottom: '6px' }}>📌 How to Use</div>
        <div style={{ fontSize: '11px', color: t.text2, lineHeight: 1.6 }}>
          • <strong>Before first consignment:</strong> Set the last used numbers from your manual records<br />
          • <strong>Next consignment:</strong> System will auto-generate incremented numbers<br />
          • <strong>TMP PRF:</strong> Global sequential (WG000001, WG000002...)<br />
          • <strong>External No:</strong> Per branch, per month (000001, 000002...)
        </div>
      </div>

      {/* Current TMP PRF */}
      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: '11px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Global TMP PRF Number</div>
        </div>
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: '12px', color: t.text3, marginBottom: '6px' }}>Last Used TMP PRF No:</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: t.gold, fontFamily: 'monospace' }}>{tmpPrfNo}</div>
          <div style={{ fontSize: '11px', color: t.text4, marginTop: '4px' }}>Next will be: <span style={{ color: t.green, fontWeight: 600 }}>WG{String(parseInt(tmpPrfNo.replace('WG', '')) + 1).padStart(6, '0')}</span></div>
        </div>
      </div>

      {/* Branch Seeds */}
      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: '11px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Branch External Numbers</div>
        </div>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: t.text4 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 450px)', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {['Branch', 'Last External No', 'Last Challan No', 'Action'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', fontSize: '10px', color: t.text4, letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'left', background: t.card2, borderBottom: `1px solid ${t.border}`, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branches.map(b => (
                  <tr key={b.branch_name} style={{ borderBottom: `1px solid ${t.border}15` }}
                    onMouseEnter={e => e.currentTarget.style.background = `${t.gold}05`}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '9px 12px', fontSize: '12px', color: t.text1, fontWeight: 500 }}>{b.branch_name}</td>
                    <td style={{ padding: '9px 12px', fontSize: '12px', color: t.gold, fontFamily: 'monospace' }}>{b.last_external_no}</td>
                    <td style={{ padding: '9px 12px', fontSize: '11px', color: t.text3, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.last_challan_no}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <button onClick={() => setSeed(b)} style={{ ...btnGold, padding: '4px 10px', fontSize: '11px' }}>Set Seed</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
