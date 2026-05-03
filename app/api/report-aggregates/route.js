import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/apiAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const TOD_META = {
  morning:   { label: 'Morning',   range: '9 AM – 12 PM' },
  afternoon: { label: 'Afternoon', range: '12 PM – 5 PM' },
  evening:   { label: 'Evening',   range: '5 PM – close' },
  unknown:   { label: 'Unknown',   range: 'No time data' },
}

export async function GET(request) {
  // Aggregations include branch revenue + daily transaction counts. Any
  // authenticated user can view, since the reports module is gated by role
  // already in the UI.
  const auth = await requireAuth(request, { requiredRoles: null })
  if (!auth.ok) return auth.response

  const url            = new URL(request.url)
  const fromDate       = url.searchParams.get('from')             || ''
  const toDate         = url.searchParams.get('to')               || ''
  const branch         = url.searchParams.get('branch')           || null
  const txnType        = url.searchParams.get('txn_type')         || null
  const regionBranches = url.searchParams.get('region_branches')
  const singleDay      = url.searchParams.get('single_day') === 'true'

  const regionBranchArr = regionBranches ? regionBranches.split(',') : null

  try {
    const { data, error } = await supabaseAdmin.rpc('get_purchase_aggregates', {
      p_from_date:       fromDate,
      p_to_date:         toDate,
      p_branch:          branch,
      p_txn_type:        txnType,
      p_region_branches: regionBranchArr,
      p_single_day:      singleDay,
    })

    if (error) throw new Error(error.message)
    if (!data) return Response.json({ empty: true })

    const kpis = data.kpis || null
    if (!kpis || !kpis.total_count) return Response.json({ empty: true })

    // monthly: add month_label
    const monthly = (data.monthly || []).map(m => ({
      ...m,
      month_label: new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    }))

    // timeOfDay: transform raw sums → full shape with pct, avg fields
    const todRaw   = data.time_of_day || []
    const todTotal = todRaw.reduce((s, sl) => s + (sl.cnt || 0), 0)
    const timeOfDay = ['morning', 'afternoon', 'evening', 'unknown']
      .map(key => {
        const sl = todRaw.find(r => r.slot_key === key)
        if (!sl || !sl.cnt) return null
        const meta = TOD_META[key]
        const nw   = Number(sl.nw || 0)
        const pw   = Number(sl.pw || 0)
        return {
          key,
          label:              meta.label,
          range:              meta.range,
          txn_count:          sl.cnt,
          total_net:          parseFloat(nw.toFixed(3)),
          total_val:          Math.round(sl.val || 0),
          avg_net:            sl.cnt > 0 ? parseFloat((nw / sl.cnt).toFixed(2)) : 0,
          avg_purity:         nw > 0 ? parseFloat((pw / nw).toFixed(2)) : 0,
          avg_service_charge: sl.cnt > 0 ? parseFloat((Number(sl.svc) / sl.cnt).toFixed(2)) : 0,
          pct:                todTotal > 0 ? parseFloat(((sl.cnt / todTotal) * 100).toFixed(1)) : 0,
        }
      })
      .filter(Boolean)

    // hourlyTrend: int hour → label string, fill gaps minH→maxH
    const hourlyRaw  = data.hourly_trend || []
    let   hourlyTrend = []
    if (singleDay && hourlyRaw.length > 0) {
      const hours = hourlyRaw.map(h => h.hour)
      const maxH  = Math.max(...hours)
      const hmap  = {}
      hourlyRaw.forEach(h => { hmap[h.hour] = h })
      for (let h = 10; h <= maxH; h++) {
        const label = h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
        hourlyTrend.push({
          day:        label,
          net_wt:     parseFloat(Number(hmap[h]?.net_wt  || 0).toFixed(3)),
          value:      Math.round(hmap[h]?.value     || 0),
          txn_count:  hmap[h]?.txn_count || 0,
          avg_purity: 0,
        })
      }
    }

    return Response.json({
      kpis,
      trend:         data.trend          || [],
      monthly,
      branchData:    data.branches       || [],
      dowData:       data.dow            || [],
      purityDist:    data.purity_dist    || [],
      weightBuckets: data.weight_buckets || [],
      regionSplit:   data.region_split   || [],
      monthHalf:     data.month_half     || [],
      timeOfDay,
      topBills:      data.top_bills      || [],
      hourlyTrend,
    })
  } catch (err) {
    console.error('report-aggregates error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
