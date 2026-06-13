'use client'

// Reports — container module hosting the two report views as tabs:
//   1. Consignment Report   — what dispatched / in-flight (existing screen)
//   2. EOD Branch Stock      — gold still at branch at end of each day
//
// The nav id stays 'consignment-report' so the permission key + routing are
// unchanged; only the label and the addition of a second tab are new.

import { useState } from 'react'
import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import ConsignmentReport from './ConsignmentReport'
import EodBranchStockReport from './EodBranchStockReport'

const TABS = [
  { id: 'consignment', label: 'Consignment Report' },
  { id: 'eod_branch',  label: 'EOD Branch Stock Report' },
]

export default function Reports() {
  const { theme } = useApp()
  const t = THEMES[theme] || THEMES.dark
  const [tab, setTab] = useState('consignment')

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Module tab strip */}
      <div style={{
        display: 'flex', gap: '4px',
        padding: '14px 16px 0',
        borderBottom: `1px solid ${t.border}`,
      }}>
        {TABS.map(o => {
          const active = tab === o.id
          return (
            <button key={o.id} onClick={() => setTab(o.id)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '10px 18px', fontSize: '12.5px', fontWeight: active ? 700 : 500,
                color: active ? t.gold : t.text3,
                borderBottom: `2px solid ${active ? t.gold : 'transparent'}`,
                marginBottom: '-1px', letterSpacing: '.01em',
                whiteSpace: 'nowrap',
              }}>
              {o.label}
            </button>
          )
        })}
      </div>

      {/* Active tab. ConsignmentReport self-pads; the EOD report doesn't, so
          wrap it to match the module's horizontal rhythm. */}
      {tab === 'consignment' ? (
        <ConsignmentReport />
      ) : (
        <div style={{ padding: '18px 16px' }}>
          <EodBranchStockReport />
        </div>
      )}
    </div>
  )
}
