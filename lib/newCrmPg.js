// lib/newCrmPg.js
// Shared New-CRM Postgres connection options. Set NEW_CRM_DB_PGBOUNCER=true
// when NEW_CRM_DB_HOST points at a PgBouncer proxy instead of the RDS
// instance directly — this specific proxy doesn't support SSL at all (the
// direct RDS endpoint does), and PgBouncer in transaction-pooling mode
// breaks with prepared statements cached across pooled connections.
const isPgBouncer = () => process.env.NEW_CRM_DB_PGBOUNCER === 'true'

// For `pg` Client/Pool.
export function newCrmSslForPg() {
  if (isPgBouncer()) return false
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
