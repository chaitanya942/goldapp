// Data layer for /api/jarvis-footfall: CRM walk-in queries + the pure join of
// Jarvis footfall with walk-ins per branch per IST day.
//
// Walk-ins use the same definition as the dashboard "Walked in" tile:
//   old CRM customer_walkin rows (dated by walk-in time, IST)
// + new CRM Transactions created that day (fresh walk-ins)
// + new CRM re-walk-ins (opened on an earlier day, final payment that day).

import mysql from 'mysql2/promise'
import postgres from 'postgres'
import { aliasBranchName } from './crmBranchAlias'
import { newCrmOptsForPostgresPkg } from './newCrmPg'
import { storeKey } from './jarvis'

let _pool
function oldCrmPool() {
  if (!_pool) {
    _pool = mysql.createPool({
      host: process.env.CRM_DB_HOST,
      port: parseInt(process.env.CRM_DB_PORT || '3306', 10),
      database: process.env.CRM_DB_NAME,
      user: process.env.CRM_DB_USER,
      password: process.env.CRM_DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
      connectTimeout: 8000,
    })
  }
  return _pool
}

export async function oldCrmWalkins(from, to) {
  // Coarse ±1 day prefilter on the raw column keeps it index-friendly and is
  // safe whatever the session time zone; the exact IST-day test follows.
  const [rows] = await oldCrmPool().execute(`
    SELECT branch_id,
           DATE_FORMAT(DATE(date + INTERVAL 330 MINUTE), '%Y-%m-%d') AS d,
           COUNT(*) AS c
    FROM customer_walkin
    WHERE date >= DATE_SUB(?, INTERVAL 1 DAY) AND date < DATE_ADD(?, INTERVAL 2 DAY)
      AND DATE(date + INTERVAL 330 MINUTE) BETWEEN ? AND ?
    GROUP BY branch_id, d
  `, [from, to, from, to])
  return rows
}

export async function newCrmWalkins(from, to) {
  const sql = postgres({
    host: process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST,
    port: parseInt(process.env.NEW_CRM_DB_PORT || '5432', 10),
    database: process.env.NEW_CRM_DB_NAME,
    username: process.env.NEW_CRM_DB_USER,
    password: process.env.NEW_CRM_DB_PASSWORD,
    ...newCrmOptsForPostgresPkg(), connect_timeout: 6, max: 1,
  })
  try {
    // created_at / Payment.created_at are UTC "timestamp without time zone".
    const fresh = await sql`
      SELECT b.name AS branch,
             ((t.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS d,
             COUNT(*)::int AS c
      FROM "Transaction" t
      LEFT JOIN "Branch" b ON b.id = t.branch_id
      WHERE t.created_at >= ${from}::date - interval '1 day'
        AND t.created_at <  ${to}::date + interval '1 day'
      GROUP BY 1, 2
    `
    const rewalk = await sql`
      SELECT b.name AS branch,
             ((f.fp AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS d,
             COUNT(*)::int AS c
      FROM "Transaction" t
      LEFT JOIN "Branch" b ON b.id = t.branch_id
      JOIN LATERAL (
        SELECT MAX(created_at) fp FROM "Payment"
        WHERE transaction_id = t.id AND status = 'COMPLETED' AND type = 'FINAL_PAYMENT'
      ) f ON true
      WHERE t.status = 'FINAL_PAYMENT_COMPLETED'
        AND f.fp >= ${from}::date - interval '1 day'
        AND f.fp <  ${to}::date + interval '1 day'
        AND ((t.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date
          < ((f.fp AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date
      GROUP BY 1, 2
    `
    return { fresh, rewalk }
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {})
  }
}

// Pure join. footfall = jarvis_footfall rows; oldRows/newRows = query results
// (or null when that source failed). Branches are matched on a letters+digits
// key of the name — Jarvis store names are the branches.name values.
export function mergeFootfallRows({ branches, footfall, oldRows, newRows, from, to, allowedRegions }) {
  const branchByKey = new Map()
  const branchByCrmId = new Map()
  for (const b of branches || []) {
    if (!b?.name) continue
    branchByKey.set(storeKey(b.name), b)
    if (b.crm_branch_id != null) branchByCrmId.set(String(b.crm_branch_id), b)
  }

  const cells = new Map()
  const cell = (date, rawName) => {
    const key = storeKey(rawName)
    const id = `${date}|${key}`
    let c = cells.get(id)
    if (!c) {
      const br = branchByKey.get(key)
      c = {
        date, branch: br?.name || String(rawName).trim(), region: br?.region || null,
        store_code: null, footfall: null, male: null, female: null, age: null,
        data_status: null, staff_status: null,
        walkins_old: 0, walkins_new: 0, rewalkins: 0,
      }
      cells.set(id, c)
    }
    return c
  }
  const inRange = (d) => d >= from && d <= to

  for (const f of footfall || []) {
    if (!inRange(f.footfall_date)) continue
    const c = cell(f.footfall_date, f.store_name)
    c.store_code = f.store_code
    c.data_status = f.data_status
    // NO_DATA = the camera sent nothing that day; footfall is unknown, not 0.
    if (f.data_status === 'NO_DATA') continue
    c.footfall = (c.footfall || 0) + (Number(f.entry_count) || 0)
    if (f.male_count != null) c.male = (c.male || 0) + Number(f.male_count)
    if (f.female_count != null) c.female = (c.female || 0) + Number(f.female_count)
    c.age = f.age_data || c.age
    c.staff_status = f.staff_reduction_status
  }
  for (const r of oldRows || []) {
    const br = branchByCrmId.get(String(r.branch_id))
    if (!br || !inRange(r.d)) continue
    cell(r.d, br.name).walkins_old += Number(r.c) || 0
  }
  for (const r of newRows?.fresh || []) {
    if (!r.branch || !inRange(r.d)) continue
    cell(r.d, aliasBranchName(r.branch)).walkins_new += Number(r.c) || 0
  }
  for (const r of newRows?.rewalk || []) {
    if (!r.branch || !inRange(r.d)) continue
    cell(r.d, aliasBranchName(r.branch)).rewalkins += Number(r.c) || 0
  }

  let rows = [...cells.values()]
  if (allowedRegions) {
    const allowed = new Set(allowedRegions)
    rows = rows.filter(r => r.region && allowed.has(r.region))
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.branch.localeCompare(b.branch)))
}
