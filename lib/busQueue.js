// lib/busQueue.js
// Offline queue for bus-audit submissions.
//
// Field teams work rural depots (Pavagada, Sakaleshpura, Gangavathi…) where
// signal drops out. Before this, a failed submit lost the work entirely — the
// photos only existed in page memory. Now a submission that can't reach the
// server is parked here and retried when connectivity returns.
//
// IndexedDB rather than localStorage because the payload is image Blobs;
// localStorage is string-only (and ~5MB). IndexedDB stores Blobs natively via
// structured clone, so no base64 round-trip.

const DB_NAME = 'wg-bus-audit'
const STORE = 'queue'
const VERSION = 1

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'))
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const out = fn(store)
    t.oncomplete = () => resolve(out?.result ?? out)
    t.onerror = () => reject(t.error)
  })
}

/** Park one submission. `blobs` are the already-stamped image Blobs. */
export async function enqueue({ reg_norm, reg_number, meta, blobs }) {
  const db = await openDb()
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reg_norm, reg_number, meta, blobs,
    queued_at: new Date().toISOString(),
    attempts: 0,
  }
  await tx(db, 'readwrite', s => s.put(item))
  db.close()
  return item.id
}

export async function listQueued() {
  try {
    const db = await openDb()
    const items = await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly')
      const req = t.objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return items
  } catch { return [] }
}

export async function removeQueued(id) {
  try {
    const db = await openDb()
    await tx(db, 'readwrite', s => s.delete(id))
    db.close()
  } catch {}
}

export async function bumpAttempts(id) {
  try {
    const db = await openDb()
    const item = await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly')
      const req = t.objectStore(STORE).get(id)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (item) { item.attempts = (item.attempts || 0) + 1; await tx(db, 'readwrite', s => s.put(item)) }
    db.close()
  } catch {}
}

export async function queuedCount() {
  return (await listQueued()).length
}
