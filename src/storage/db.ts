import type { Note } from '../types'

const DB_NAME = 'htmlr'
const DB_VERSION = 1
const NOTES_STORE = 'notes'
const KV_STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      // Reading `indexedDB` at all can throw where storage is blocked outright (Firefox private
      // browsing, enterprise policy) — inside the executor that surfaces as a rejection, not a
      // synchronous crash on whichever call site happened to be first.
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(NOTES_STORE)) db.createObjectStore(NOTES_STORE, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      // Another tab holding an older version open blocks the upgrade indefinitely; fail loudly
      // rather than leaving every caller hanging on a promise that never settles.
      req.onblocked = () => reject(new DOMException('Another htmlr tab is blocking a database upgrade.', 'InvalidStateError'))
    }).catch(err => {
      dbPromise = null // a failed open must not be cached forever — let the next attempt retry
      throw err
    })
  }
  return dbPromise
}

async function run<T>(store: string, mode: IDBTransactionMode, exec: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = exec(tx.objectStore(store))
    let result: T | undefined
    req.onsuccess = () => { result = req.result as T }
    req.onerror = () => reject(req.error)
    // Resolve on the *transaction*, not the request: a write request can report success and the
    // transaction still abort afterwards (quota exceeded, disk error), which would otherwise be
    // reported to the user as a completed save.
    tx.oncomplete = () => resolve(result as T)
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}

export const kvStore = {
  get<T>(key: string): Promise<T | undefined> {
    return run<T | undefined>(KV_STORE, 'readonly', s => s.get(key))
  },
  set(key: string, value: unknown): Promise<void> {
    return run(KV_STORE, 'readwrite', s => s.put(value, key))
  },
  delete(key: string): Promise<void> {
    return run(KV_STORE, 'readwrite', s => s.delete(key))
  },
}

export const notesCache = {
  getAll(): Promise<Note[]> {
    return run<Note[]>(NOTES_STORE, 'readonly', s => s.getAll())
  },
  get(id: string): Promise<Note | undefined> {
    return run<Note | undefined>(NOTES_STORE, 'readonly', s => s.get(id))
  },
  put(note: Note): Promise<void> {
    return run(NOTES_STORE, 'readwrite', s => s.put(note))
  },
  delete(id: string): Promise<void> {
    return run(NOTES_STORE, 'readwrite', s => s.delete(id))
  },
}
