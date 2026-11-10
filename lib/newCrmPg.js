// lib/newCrmPg.js
// Shared New-CRM Postgres connection options — every app connection to the
// CRM database takes its SSL setting from here.
//
//   NEW_CRM_DB_PGBOUNCER=true  → NEW_CRM_DB_HOST is the PgBouncer proxy
//                                (52.66.100.170:6432): no SSL (this proxy
//                                doesn't support it) and no prepared statements
//                                (transaction pooling breaks them).
//   NEW_CRM_DB_SSL=false       → force SSL OFF (also: 0 / no / off / disable).
//   NEW_CRM_DB_SSL=true        → force SSL ON  (also: 1 / yes / on / require).
//   NEW_CRM_DB_SSL unset       → SSL off for PgBouncer, on for the direct RDS.
//   NEW_CRM_DB_CA              → optional CA bundle to verify the RDS cert.
//
// Values are read case-insensitively and trimmed, so "TRUE", "False " or a
// trailing newline from a dashboard paste still mean what they say.

const flag = (name) => String(process.env[name] ?? '').trim().toLowerCase()
const isOn  = (v) => ['true', '1', 'yes', 'on', 'require'].includes(v)
const isOff = (v) => ['false', '0', 'no', 'off', 'disable'].includes(v)

const isPgBouncer = () => isOn(flag('NEW_CRM_DB_PGBOUNCER'))

function sslEnabled() {
  const ssl = flag('NEW_CRM_DB_SSL')
  if (isOff(ssl)) return false
  if (isOn(ssl)) return true
  return !isPgBouncer()
}

// For `pg` Client/Pool.
export function newCrmSslForPg() {
  if (!sslEnabled()) return false
  return process.env.NEW_CRM_DB_CA
    ? { ca: process.env.NEW_CRM_DB_CA, rejectUnauthorized: true }
    : { rejectUnauthorized: false }
}

// For the `postgres` package — same ssl rule, plus prepared statements
// disabled under PgBouncer (porsager/postgres's `prepare: false`).
export function newCrmOptsForPostgresPkg() {
  return {
    ssl: newCrmSslForPg(),
    ...(isPgBouncer() ? { prepare: false } : {}),
  }
}
