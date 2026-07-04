'use client'

// Admin → Branches
// One unified module: master data + logistics + tamper-proof, all per branch.
// The table lists branches; clicking Edit opens the full detail panel (Identity
// / Location / Contact / Logistics / Tamper-proof). No sub-tabs — everything for
// a branch lives in one place. (Logistics.js is retained but no longer routed;
// its per-branch fields are edited in the BranchManagement detail form.)

import { useApp } from '../../lib/context'
import { CONSIGNMENT_THEMES as THEMES } from '../../lib/consignmentTheme'
import BranchManagement from './BranchManagement'

export default function Branches() {
  const { theme } = useApp()
  const t = THEMES[theme]
  return (
    <div>
      <div style={{ padding: '28px 32px 0' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 300, color: t.text1, letterSpacing: '.04em' }}>Branches</div>
        <div style={{ fontSize: '.72rem', color: t.text3, marginTop: '4px' }}>
          Master data, address, contact, logistics and tamper-proof seals — everything for a branch in one place.
        </div>
      </div>
      <BranchManagement embedded />
    </div>
  )
}
