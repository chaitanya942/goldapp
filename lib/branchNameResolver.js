// Resolves a free-text store / branch name (Jarvis camera stores, CRM branch
// names) onto the branches master, so every surface shows one canonical
// format: UPPERCASE with the state prefix (KA-, KL-, AP-, TS-).
//
// Nothing is hardcoded — the state prefixes are learned from the master's own
// names (e.g. Karnataka branches are named KA-…), and matching goes through:
//   1. exact name (letters + digits)          'KA-K R PURAM' == 'KA-KR PURAM'
//   2. core name (no WG-/state prefix/-NEW)   'Angamaly'     -> KL-ANGAMALY
//   3. closest spelling (edit distance ≤ 2)   'Mavelikkara'  -> KL-MAVELIKARA
// A name that still doesn't match is shown uppercased, with the state prefix
// when every similarly-named branch is in one state ('CHERTHALA - NEW' ->
// KL-CHERTHALA-NEW, since both Cherthala branches are Kerala).

import { aliasBranchName } from './crmBranchAlias'

const key = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

export function buildBranchResolver(branches) {
  const list = (branches || []).filter(b => b?.name)

  // State → prefix, learned from names that already carry one ('KA-HEBBAL').
  // The prefix set itself comes from the names alone (a prefix used by 3+
  // branches), so matching still works if a caller didn't select `state`.
  const votes = {}, seen = {}
  for (const b of list) {
    const p = String(b.name).trim().toUpperCase().match(/^([A-Z]{2})-/)?.[1]
    if (!p) continue
    seen[p] = (seen[p] || 0) + 1
    if (b.state) ((votes[b.state] ||= {})[p] = (votes[b.state][p] || 0) + 1)
  }
  const prefixOfState = {}
  for (const [st, v] of Object.entries(votes)) prefixOfState[st] = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]
  const prefixes = new Set(Object.entries(seen).filter(([, n]) => n >= 3).map(([p]) => p))

  const tidy = (s) => String(s || '').trim().toUpperCase()
    .replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ')
  const stripPrefix = (s) => {
    let n = tidy(s).replace(/^WG[- ]+/, '')
    const p = n.match(/^([A-Z]{2})[- ]+/)?.[1]
    return p && prefixes.has(p) ? { prefix: p, rest: n.slice(3).trim() } : { prefix: null, rest: n }
  }
  const coreKey = (s) => key(stripPrefix(s).rest.replace(/-NEW$/, ''))

  // Canonical display for a master branch: its own name, plus the state
  // prefix when the master name lacks one (HSR-LAYOUT -> KA-HSR-LAYOUT).
  const display = (b) => {
    const n = tidy(b.name)
    if (stripPrefix(n).prefix) return n
    const p = prefixOfState[b.state]
    return p ? `${p}-${n}` : n
  }

  const byKey = new Map(), byCore = new Map()
  for (const b of list) {
    byKey.set(key(b.name), b)
    const c = coreKey(b.name)
    byCore.set(c, byCore.has(c) ? null : b) // null = ambiguous
  }
  const cores = [...byCore.keys()]

  const cache = new Map()
  return function resolve(raw) {
    const rawStr = String(raw || '').trim()
    if (cache.has(rawStr)) return cache.get(rawStr)
    const aliased = aliasBranchName(rawStr) || rawStr
    const core = coreKey(aliased)

    let b = byKey.get(key(aliased)) || byCore.get(core) || null
    if (!b && core.length >= 6) {
      // Closest spelling wins only when it's strictly closer than the runner-up
      // ('DARWAD': DHARWAD at 1 beats KARWAR at 2).
      const close = cores.filter(c => c.length >= 6)
        .map(c => [c, editDistance(core, c)]).filter(([, d]) => d <= 2)
        .sort((x, y) => x[1] - y[1])
      if (close.length && (close.length === 1 || close[0][1] < close[1][1])) b = byCore.get(close[0][0]) || null
    }

    let out
    if (b) {
      out = { name: display(b), region: b.region || null, branch: b }
    } else {
      // Unmatched: keep the store's own name, add the prefix if similarly
      // named branches all sit in one state.
      const { prefix, rest } = stripPrefix(aliased)
      const similar = core.length >= 4 ? list.filter(x => { const c = coreKey(x.name); return c.startsWith(core) || core.startsWith(c) }) : []
      const states = new Set(similar.map(x => x.state).filter(Boolean))
      const regions = new Set(similar.map(x => x.region).filter(Boolean))
      const p = prefix || (states.size === 1 ? prefixOfState[[...states][0]] : null)
      out = { name: p ? `${p}-${rest}` : rest, region: regions.size === 1 ? [...regions][0] : null, branch: null }
    }
    cache.set(rawStr, out)
    return out
  }
}
