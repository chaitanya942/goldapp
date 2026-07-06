// lib/reports/index.js
// Registry of emailable reports. Add a report by giving it a key, a label, and a
// build(dateYmd) that returns { subject, html, filename, xlsxBase64, isEmpty, ... }.
import { buildPurchaseReport } from './purchaseReport'

export const REPORTS = {
  purchase_report: {
    key: 'purchase_report',
    label: 'Purchase Report',
    description: 'Daily region & branch purchase summary + bill-level Excel',
    build: buildPurchaseReport,
  },
}

export function getReport(key) {
  return REPORTS[key] || null
}

export function listReports() {
  return Object.values(REPORTS).map(({ key, label, description }) => ({ key, label, description }))
}
