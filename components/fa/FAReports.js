'use client'

// F&A Reports — the Finance & Accounts reporting module. Currently hosts the
// scheduled Email Reports (Purchase Report / Purchase Register / Consignment
// Report). Replaced the old "Purchase Register" nav slot (id 'purchase-register'
// reused so existing role visibility carries over). Room to grow into a tabbed
// hub if more F&A reports are added.
import ReportScheduler from '../purchases/reports/ReportScheduler'

export default function FAReports() {
  return <ReportScheduler />
}
