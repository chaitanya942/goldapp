'use client'

// Admin → Branches
// Merged Branch Management + Logistics. Both are views of the SAME `branches`
// table, so they live in one module behind a Directory / Logistics toggle:
//   • Directory  = master data (name, CRM ID, code, region, cluster, address,
//                  status, upcoming) — the old Branch Management.
//   • Logistics  = per-branch courier partner, pickup, TAT, days, hub — the old
//                  Logistics page.
// Each inner component renders `embedded` (its own page title suppressed) so
// this wrapper owns the single title + toggle.

import { useState } from 'react'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import BranchManagement from './BranchManagement'
import Logistics from './Logistics'

export default function Branches({ initialView = 'directory' }) {
  const { theme } = useApp()
  const t = THEMES[theme]
  const [view, setView] = useState(initialView === 'logistics' ? 'logistics' : 'directory')

  const Tab = ({ id, label, sub }) => {
    const on = view === id
    return (
      <button onClick={() => setView(id)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
          background: on ? `${t.gold}18` : 'transparent',
          border: `1px solid ${on ? t.gold : t.border}`,
          borderRadius: '9px', padding: '8px 18px', cursor: 'pointer', minWidth: '160px',
          transition: 'all .15s ease',
        }}>
        <span style={{ fontSize: '.84rem', fontWeight: 600, color: on ? t.gold : t.text2 }}>{label}</span>
        <span style={{ fontSize: '.6rem', color: t.text4 }}>{sub}</span>
      </button>
    )
  }

  return (
    <div>
      <div style={{ padding: '28px 32px 0' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Branches</div>
        <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px', marginBottom: '16px' }}>
          Branch master data and per-branch logistics — two views of the same branches.
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Tab id="directory" label="Directory" sub="Master data · address · status" />
          <Tab id="logistics" label="Logistics" sub="Partner · pickup · TAT · hub" />
        </div>
      </div>
      {view === 'directory' ? <BranchManagement embedded /> : <Logistics embedded />}
    </div>
  )
}
