// Reads every row of a Supabase query by paging. CHUNK must equal the
// project's PostgREST max_rows (1000): a larger chunk gets silently capped and
// the "short page = last page" break below would stop early.
const CHUNK = 1000

export async function selectAllRows(buildQuery) {
  let out = []
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await buildQuery().range(from, from + CHUNK - 1)
    if (error) throw error
    out = out.concat(data || [])
    if (!data || data.length < CHUNK) break
  }
  return out
}
