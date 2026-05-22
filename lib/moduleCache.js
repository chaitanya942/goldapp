// In-memory stale-while-revalidate cache.
//
// Survives SPA navigation (a component can unmount and remount and still
// read its last data) but is wiped on a full browser reload — so it never
// serves data from a previous day/session. Used by the Purchase module so
// re-opening a sub-module paints instantly while a fresh fetch runs in the
// background.

const store = new Map()

export function getCache(key) {
  return store.has(key) ? store.get(key) : undefined
}

export function setCache(key, value) {
  store.set(key, value)
}

export function hasCache(key) {
  return store.has(key)
}
