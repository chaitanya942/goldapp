// lib/docFilename.js
//
// Single source of truth for "what should this generated GST/ops doc be
// named when ops downloads it". Used by every doc route's
// Content-Disposition AND by the client `a.download` hint so the
// server-stamped name and the browser-suggested name always agree.
//
// Convention: {DDMonYY}-{BranchShort}-{DocNumber}.{ext}
//   DDMonYY     — IST consignment created date, e.g. 20May26
//   BranchShort — branches.branch_code if set, else branches.name
//   DocNumber   — per-doc identifier, with '/' and other filesystem-unsafe
//                 characters flattened to '-'
//
// Examples:
//   20May26-DAVANAGERE-WG000004.jpg            (consignee report)
//   20May26-KAYAMKULAM-WGIV-KL-KYL-MAY-2026-12.pdf  (issue voucher, slashes flattened)
//   20May26-DAVANAGERE-132433468019.pdf        (EWB)
//   20May26-KOCHI-WG-KL-26-27-53.pdf           (E-Invoice doc no, slashes flattened)
//
// Pure / isomorphic — no Node-only deps. Safe to import in API routes AND
// in client components (so the filename in <a download="..."> matches what
// the server's Content-Disposition would say).

const ILLEGAL_RE = /[\\/:*?"<>|]+/g

function ddMonYy(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  // IST so the date in the filename matches what ops sees on the row.
  const dd  = dt.toLocaleString('en-GB', { day:   '2-digit', timeZone: 'Asia/Kolkata' })
  const mon = dt.toLocaleString('en-US', { month: 'short',   timeZone: 'Asia/Kolkata' })
  const yy  = dt.toLocaleString('en-GB', { year:  '2-digit', timeZone: 'Asia/Kolkata' })
  return `${dd}${mon}${yy}`
}

function sanitize(s) {
  return String(s == null ? '' : s)
    .replace(ILLEGAL_RE, '-')
    .replace(/\s+/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

function branchShort(branch, fallback) {
  return sanitize(branch?.branch_code || branch?.name || fallback || 'unknown')
}

// docType: 'report' | 'voucher' | 'challan' | 'ewb' | 'einvoice'
// ext:     'pdf'    | 'jpg'     (defaults to 'pdf')
export function docFilename({ consignment, branch, docType, ext = 'pdf' } = {}) {
  const date   = ddMonYy(consignment?.created_at)
  const bShort = branchShort(branch, consignment?.branch_name)
  let docNo = ''
  switch (docType) {
    case 'report':
      docNo = consignment?.tmp_prf_no
      break
    case 'voucher':
    case 'challan':
      // For INTERNAL Branch→Hub, challan_no stores the Issue Voucher number
      // (WGIV/...). For EXTERNAL, it stores the Delivery Challan number.
      // The column is shared; only the human label differs.
      docNo = consignment?.challan_no || consignment?.tmp_prf_no
      break
    case 'ewb':
      docNo = consignment?.eway_bill_no || consignment?.tmp_prf_no
      break
    case 'einvoice':
      // User wants the per-state E-Invoice document number (WG/KA/26-27/...),
      // NOT the 64-char IRN. Fall back to IRN, then TMP_PRF, if missing.
      docNo = consignment?.einvoice_doc_no || consignment?.irn || consignment?.tmp_prf_no
      break
    default:
      docNo = consignment?.tmp_prf_no
  }
  const parts = [date, bShort, sanitize(docNo)].filter(Boolean)
  return `${parts.join('-')}.${ext}`
}
