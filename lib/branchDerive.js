// lib/branchDerive.js
//
// Derive branch-master fields for a NEW branch so that a branch which starts
// purchasing auto-appears in Branch Management with the right region / state /
// model. Data-driven: the fields are taken from the branch's same-prefix peers
// already in the table (e.g. a new "KA-FOO" inherits from existing "KA-*"
// branches; a no-prefix branch inherits from existing no-prefix = Bangalore
// branches). No hardcoded region/state lists to maintain.

const mode = (arr, key) => {
  const c = {}
  for (const b of arr) if (b && b[key]) c[b[key]] = (c[b[key]] || 0) + 1
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

export function deriveBranchFields(name, existing) {
  const m = String(name || '').toUpperCase().match(/^([A-Z]{2})-/)
  const prefix = m ? m[1] : null
  const peers = prefix
    ? (existing || []).filter(b => b.name && b.name.toUpperCase().startsWith(prefix + '-'))
    : (existing || []).filter(b => b.name && !/^[A-Z]{2}-/.test(b.name.toUpperCase()))
  // Cluster is geographic (Kerala/Bangalore split into N sub-clusters), so only
  // auto-fill it when the region has exactly ONE cluster (AP, TS, Rest of KA).
  // Multi-cluster regions (Kerala, Bangalore) are left blank for a human — the
  // right cluster depends on the branch's actual location, not its prefix.
  const clusters = [...new Set(peers.map(b => b.cluster).filter(Boolean))]
  return {
    region:     mode(peers, 'region'),
    state:      mode(peers, 'state'),
    model_type: mode(peers, 'model_type') || 'outside_bangalore',
    cluster:    clusters.length === 1 ? clusters[0] : null,
  }
}

// Short, collision-free branch code (mirrors the old sync-branch-addresses logic).
export function autoBranchCode(branchName, usedCodes) {
  const name     = String(branchName || '').toUpperCase().trim()
  const stripped = name.replace(/^(AP|KL|TS|KA|TN|MH|GJ|RJ|MP|UP|HR|PB|DL)-/, '')
  const words    = stripped.split(/[\s-]+/).filter(Boolean)
  let base
  if (words.length === 1)       base = words[0].substring(0, 5)
  else if (words.length === 2)  base = (words[0].substring(0, 3) + words[1].substring(0, 2)).toUpperCase()
  else                          base = (words[0].substring(0, 2) + words.slice(1).map(w => w[0]).join('')).substring(0, 5).toUpperCase()
  if (base && !usedCodes.has(base)) return base
  for (let i = 2; i <= 99; i++) {
    const candidate = base.substring(0, 4) + i
    if (!usedCodes.has(candidate)) return candidate
  }
  return base || name.substring(0, 5)
}
