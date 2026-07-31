// lib/companyMail.js
// Shared, isomorphic (client + server) helpers for validating that an email
// looks right BEFORE we hand it to SMTP. SMTP accepts almost anything and then
// bounces asynchronously, so a typo'd branch address (e.g. whitegold1.money)
// silently fails while the app records "sent". These checks catch the common
// case — a wrong DOMAIN — up front.
//
// The company mail domain defaults to whitegold.money (every branch mailbox is
// on it) and can be overridden with NEXT_PUBLIC_COMPANY_MAIL_DOMAIN so it stays
// out of the code as a hard constant.

export const COMPANY_MAIL_DOMAIN = String(
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_COMPANY_MAIL_DOMAIN) || 'whitegold.money'
).toLowerCase()

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emailDomain(e) {
  return String(e || '').trim().toLowerCase().split('@')[1] || ''
}

// Valid-format AND on the company domain. Used for BRANCH addresses, which must
// always be @<COMPANY_MAIL_DOMAIN>.
export function isCompanyEmail(e) {
  return EMAIL_RE.test(String(e || '').trim()) && emailDomain(e) === COMPANY_MAIL_DOMAIN
}
