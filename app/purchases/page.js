'use client'

// Rejected / Pending / Walk-in Pipeline / Blacklisted tabs were old-CRM-only
// and are hidden since the old CRM was decoupled (their components remain in
// components/purchases/ for a later New-CRM rebuild).

import PurchaseData from '../../components/purchases/PurchaseData'

export default function PurchasesPage() {
  return <PurchaseData />
}
