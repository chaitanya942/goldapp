import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
const env={}
for (const l of readFileSync('.env.local','utf8').replace(/^﻿/,'').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')}
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY)

const { data: br } = await sb.from('branches').select('id,name,region,is_active,hub_branch_name')
const KA_REGIONS = new Set(['Bangalore','Rest of Karnataka'])
const prefixed = n => /^(AP|TS|KL|KA)-/.test(n)
const targets = br.filter(b => KA_REGIONS.has(b.region) && !prefixed(b.name))
const existing = new Set(br.map(b=>b.name))

const plan = targets.map(b => ({ id:b.id, from:b.name, to:`KA-${b.name}`, region:b.region }))
const collisions = plan.filter(p => existing.has(p.to))
const safe = plan.filter(p => !existing.has(p.to))

console.log(`=== RENAME PLAN — ${plan.length} Karnataka branches → KA- prefix ===`)
for (const r of ['Bangalore','Rest of Karnataka']) {
  const g = safe.filter(p=>p.region===r)
  console.log(`\n${r} (${g.length}):`)
  g.forEach(p => console.log(`   ${p.from.padEnd(22)} → ${p.to}`))
}
if (collisions.length) {
  console.log(`\n🔴 COLLISION — target name already exists (${collisions.length}):`)
  collisions.forEach(p => console.log(`   ${p.from}  →  ${p.to}  ❌ ALREADY EXISTS`))
}

// Row counts per referencing column
const froms = safe.map(p=>p.from)
const cnt = async (table, col) => {
  let n = 0
  for (let i=0;i<froms.length;i+=40) {
    const { count } = await sb.from(table).select('*',{count:'exact',head:true}).in(col, froms.slice(i,i+40))
    n += count || 0
  }
  return n
}
console.log('\n=== ROWS TO REWRITE ===')
for (const [tbl,col] of [['purchases','branch_name'],['purchases','current_branch'],['consignments','branch_name'],['consignments','dest_branch'],['branches','hub_branch_name']]) {
  try { console.log(`  ${tbl}.${col.padEnd(16)} ${await cnt(tbl,col)}`) } catch(e) { console.log(`  ${tbl}.${col} — n/a (${e.message.slice(0,40)})`) }
}
// Probe other tables that might carry a branch name
for (const tbl of ['cal_quotas','report_schedules','holiday_calendar','branch_employees','consignment_activity_log','user_profiles']) {
  const { error } = await sb.from(tbl).select('branch_name',{head:true}).limit(1)
  if (!error) console.log(`  ⚠ ${tbl}.branch_name EXISTS — needs rewriting too`)
}

// Alias-map work
const { NEW_CRM_BRANCH_ALIASES } = { NEW_CRM_BRANCH_ALIASES: JSON.parse(readFileSync('lib/crmBranchAlias.js','utf8').match(/\{([\s\S]*?)\n\}/)[0].replace(/\/\/.*$/gm,'').replace(/'/g,'"').replace(/,(\s*\})/,'$1')) }
const renameMap = Object.fromEntries(safe.map(p=>[p.from,p.to]))
const aliasUpdates = Object.entries(NEW_CRM_BRANCH_ALIASES).filter(([,v]) => renameMap[v])
console.log(`\n=== lib/crmBranchAlias.js ===`)
console.log(`  NEW aliases needed (CRM sends bare name → new canonical): ${safe.length}`)
safe.slice(0,4).forEach(p => console.log(`     '${p.from.toLowerCase()}': '${p.to}',`))
console.log(`     … +${safe.length-4} more`)
console.log(`  EXISTING aliases whose TARGET is being renamed: ${aliasUpdates.length}`)
aliasUpdates.forEach(([k,v]) => console.log(`     '${k}': '${v}'  →  '${renameMap[v]}'`))
console.log('\n(NOTHING WRITTEN — dry run)')
