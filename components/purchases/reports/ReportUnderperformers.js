'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmt } from './reportUtils'
import { istDaysAgo as daysBack, istStr } from '../../../lib/dateIst'

// Aggregate purchases over the last N days, group by branch, return worst-N branches.
// "Underperformer" = active branches (≥1 bill in window) sorted by lowest net weight,
// then by lowest bill count. Inactive branches (0 bills) are flagged separately.
export default function ReportUnderperformers({ t, isMobile, filterRegion, branches }) {
  const [windowDays, setWindowDays] = useState(7)
  const [loading,    setLoading]    = useState(true)
  const [active,     setActive]     = useState([])
  const [inactive,   setInactive]   = useState([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const from = daysBack(windowDays - 1)
      const to   = istStr()

      // Branch master (filtered by region if set)
      let bq = supabase.from('branches').select('name, region, state, cluster').eq('is_active', true)
      if (filterRegion) bq = bq.eq('region', filterRegion)
      const { data: bRows } = await bq
      if (cancelled) return
      const branchList = (bRows || []).map(b => b.name)
      const byName = Object.fromEntries((bRows || []).map(b => [b.name, b]))

      // Aggregate purchases (paginate to avoid 1000-row default cap)
      const buckets = {}
      const CHUNK   = 1000
      let offset    = 0
      while (true) {
        let q = supabase.from('purchases')
          .select('branch_name, net_weight, total_amount')
          .eq('crm_status', 'approved').eq('is_deleted', false)
          .gte('purchase_date', from).lte('purchase_date', to)
          .range(offset, offset + CHUNK - 1)
        if (filterRegion) q = q.in('branch_name', branchList)
        const { data, error } = await q
        if (error || !data || data.length === 0) break
        for (const r of data) {
          const k = r.branch_name; if (!k) continue
          if (!buckets[k]) buckets[k] = { branch: k, txn_count: 0, net_wt: 0, value: 0 }
          buckets[k].txn_count += 1
          buckets[k].net_wt    += parseFloat(r.net_weight   || 0)
          buckets[k].value     += parseFloat(r.total_amount || 0)
        }
        if (data.length < CHUNK) break
        offset += CHUNK
      }
      if (cancelled) return

      const enriched = branchList.map(name => {
        const b = buckets[name] || { branch: name, txn_count: 0, net_wt: 0, value: 0 }
        return { ...b, region: byName[name]?.region || 'Unknown' }
      })
      const inactives = enriched.filter(b => b.txn_count === 0)
      const actives   = enriched.filter(b => b.txn_count > 0)
        .sort((a, b) => a.net_wt - b.net_wt || a.txn_count - b.txn_count)
        .slice(0, 10)

      setActive(actives); setInactive(inactives); setLoading(false)
    }
    run().catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [windowDays, filterRegion])

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: '12px', padding: isMobile ? '16px 14px' : '20px 22px' }
  const pillBase = { padding: '5px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', border: `1px solid ${t.border2}`, background: 'transparent', color: t.text3 }
  const maxNet = Math.max(...active.map(b => b.net_wt), 1)

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '.6rem', color: t.text4, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 600 }}>Underperformers</div>
          <div style={{ fontSize: '14px', fontWeight: 500, color: t.text1 }}>
            Worst 10 branches{filterRegion ? ` · ${filterRegion}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '5px' }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setWindowDays(d)}
              style={{
                ...pillBase,
                background: windowDays === d ? t.red : 'transparent',
                color: windowDays === d ? '#fff' : t.text3,
                borderColor: windowDays === d ? t.red : t.border2,
              }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[0,1,2,3,4,5,6,7,8,9].map(i => (
            <div key={i} style={{ height: '32px', background: `linear-gradient(90deg,${t.border},${t.border2},${t.border})`, backgroundSize: '200% 100%', borderRadius: '6px', animation: 'shimmer 1.5s infinite' }} />
          ))}
        </div>
      ) : active.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: t.text4, fontSize: '12px' }}>No active branches in this window</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '20px 1fr 60px 50px' : '24px 1fr 100px 80px 80px', gap: '8px', padding: '4px 8px', fontSize: '9px', color: t.text4, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>
              <span>#</span>
              <span>Branch</span>
              <span style={{ textAlign: 'right' }}>Net Wt</span>
              <span style={{ textAlign: 'right' }}>Bills</span>
              {!isMobile && <span style={{ textAlign: 'right' }}>Region</span>}
            </div>
            {active.map((b, i) => {
              const pct = (b.net_wt / maxNet) * 100
              return (
                <div key={b.branch} style={{ display: 'grid', gridTemplateColumns: isMobile ? '20px 1fr 60px 50px' : '24px 1fr 100px 80px 80px', gap: '8px', padding: '8px', borderRadius: '6px', alignItems: 'center', background: i % 2 === 0 ? 'transparent' : `${t.card2}80`, position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${t.red}10 ${pct}%, transparent ${pct}%)`, borderRadius: '6px', pointerEvents: 'none' }} />
                  <span style={{ fontSize: '11px', color: t.red, fontWeight: 700, textAlign: 'center', position: 'relative' }}>{i + 1}</span>
                  <span style={{ fontSize: '12px', color: t.text1, fontWeight: 500, position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.branch}</span>
                  <span style={{ fontSize: '11px', color: t.gold, fontFamily: 'monospace', textAlign: 'right', position: 'relative' }}>{fmt(b.net_wt)}g</span>
                  <span style={{ fontSize: '11px', color: t.blue, fontFamily: 'monospace', textAlign: 'right', position: 'relative' }}>{b.txn_count}</span>
                  {!isMobile && <span style={{ fontSize: '10px', color: t.text3, textAlign: 'right', position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.region}</span>}
                </div>
              )
            })}
          </div>

          {inactive.length > 0 && (
            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '10px', color: t.text4 }}>
                <strong style={{ color: t.red, fontWeight: 700 }}>{inactive.length}</strong> branch{inactive.length !== 1 ? 'es' : ''} with zero bills in last {windowDays}d
              </div>
              <div style={{ fontSize: '10px', color: t.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                {inactive.slice(0, 6).map(b => b.branch).join(' · ')}{inactive.length > 6 ? ` · +${inactive.length - 6} more` : ''}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
