// lib/pdfHelpers.js
//
// Shared helpers used by all three PDF / image renderers (Issue Voucher,
// Delivery Challan, Consignee Report). Three near-identical copies of these
// functions used to live across those files. Each iteration risked drift —
// LACS vs LAKH, paise handling, edge-case rounding. Centralising means a
// fix lands everywhere at once.
//
// All exports are pure functions with no side effects.

// Indian-format integer → all-caps English words.
// Example: 12345 → "TWELVE THOUSAND THREE HUNDRED FORTY FIVE"
//          1234567 → "TWELVE LAKH THIRTY FOUR THOUSAND FIVE HUNDRED SIXTY SEVEN"
//          12345678 → "ONE CRORE TWENTY THREE LAKH FORTY FIVE THOUSAND ..."
//
// Indian numbering: ones < 100, hundred (3-digit), thousand (4-5 digit),
// lakh (6-7 digit), crore (8+ digit). Paise are NOT handled here — the
// caller's amountToWords() decides whether to render them.
export function numberToWords(num) {
  if (num === 0) return 'ZERO'
  const ones = [
    '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN',
    'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
  ]
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  const b100  = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''))
  const b1000 = (n) => (n < 100 ? b100(n) : ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + b100(n % 100) : ''))
  let r = '', n = num
  if (n >= 10000000) { r += b100(Math.floor(n / 10000000))  + ' CRORE ';    n %= 10000000 }
  if (n >= 100000)   { r += b1000(Math.floor(n / 100000))   + ' LAKH ';     n %= 100000 }   // LAKH (consistent across all docs — was LACS in voucher only)
  if (n >= 1000)     { r += b1000(Math.floor(n / 1000))     + ' THOUSAND '; n %= 1000 }
  if (n > 0)         { r += b1000(n) }
  return r.trim()
}

// Float amount → "RUPEES … AND … PAISE ONLY" (or just "RUPEES … ONLY" if
// no paise). Used in the words-on-the-PDF blocks.
export function amountToWords(amount) {
  const rupees = Math.floor(amount)
  const paise  = Math.round((amount - rupees) * 100)
  let r = 'RUPEES ' + numberToWords(rupees)
  if (paise > 0) r += ' AND ' + numberToWords(paise) + ' PAISE'
  return r + ' ONLY'
}

// Indian-format INR with 2 decimals. Currency symbol intentionally omitted —
// the caller injects it (Rs. for jsPDF docs that can't render ₹, ₹ for the
// HTML-based renderers).
export function fmtIN(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
