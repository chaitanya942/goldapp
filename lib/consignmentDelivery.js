// lib/consignmentDelivery.js
// Region-based expected-delivery rules for consignments, shared by the
// Consignment Report screen and the scheduled consignment email report so the
// two never drift.
//
//   Bangalore branches → SAME DAY (arrive HO the day they're dispatched)
//   Kerala branches    → 24h (next working day, Sundays skipped)
//   everyone else      → the branch's own delivery_tat_hours (default 24h)
import { addWorkingDaysSkipSunday } from './dateIst'

export const REGION_ORDER = ['Rest of Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana', 'Bangalore']

export function regionExpectedDelivery(baseDate, region, branchTatHours) {
  if (!baseDate) return null
  if (region === 'Bangalore') return baseDate                        // same day
  const hours = region === 'Kerala' ? 24 : (Number(branchTatHours) || 24)
  return addWorkingDaysSkipSunday(baseDate, Math.max(1, Math.ceil(hours / 24)))
}

// Effective TAT hours after the region override.
export const regionEffTat = (region, branchTatHours) =>
  region === 'Bangalore' ? 0 : (region === 'Kerala' ? 24 : (Number(branchTatHours) || 24))
