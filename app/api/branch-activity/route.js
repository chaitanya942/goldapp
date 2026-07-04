// Per-branch purchase activity for Branch Management: last bill date per branch.
// Powers the "Upcoming" view (a branch with no bills is upcoming) and the
// active/dormant read. Cached in-module (15 min) so the page load is snappy.
import { createClient } from '@supabase/supabase-js'
import { requireAuthForPage } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

let _cache = null
let _cacheAt = 0
const TTL = 15 * 60 * 1000

export async function GET(req) {
  const auth = await requireAuthForPage(req, 'branch-management')
  if (!auth.ok) return auth.response

  const now = Date.now()
  if (_cache && now - _cacheAt < TTL) return Response.json(_cache)

  try {
    const { data: branches } = await supabase.from('branches').select('name')
    const names = (branches || []).map(b => b.name).filter(Boolean)
    const activity = {}   // branch_name → last purchase_date (absent = never billed = upcoming)
    const CONC = 12
    for (let i = 0; i < names.length; i += CONC) {
      const batch = names.slice(i, i + CONC)
      await Promise.all(batch.map(async (name) => {
        const { data } = await supabase
          .from('purchases')
          .select('purchase_date')
          .eq('branch_name', name)
          .order('purchase_date', { ascending: false })
          .limit(1)
        if (data && data.length && data[0].purchase_date) activity[name] = data[0].purchase_date
      }))
    }
    _cache = { activity, generated_at: new Date().toISOString() }
    _cacheAt = now
    return Response.json(_cache)
  } catch (err) {
    return Response.json({ error: err.message, activity: {} }, { status: 500 })
  }
}
