import { kvStore, notesCache } from './db'
import { writeNoteFile, deleteNoteFile } from './fs'

/** Keeps the connected folder caught up with the cache, in the background.
 *
 *  Saving used to write the folder first and the cache after, inside the save itself — fine on a
 *  local disk, but on a network share every save, note switch and new note then waited on the
 *  network. Over a slow link (a NAS reached from outside the LAN) saves took longer than the gap
 *  between them, so they overlapped and could finish out of order, leaving an older version on disk
 *  while the app said "Saved". Now a save only writes the cache and records here that the folder is
 *  owed that note; this module pays the debt off one operation at a time, always writing whatever
 *  the cache holds at that moment — so a slow write can't land an older version over a newer one,
 *  and saves made while a write is in flight collapse into a single follow-up write. */

const BACKLOG_KEY = 'folderBacklog'
/** How long to wait before trying again after the folder couldn't be written (e.g. an unreachable share). */
const RETRY_MS = 30_000

/** Everything the folder is still owed. Persisted, so work cut short by closing the app — or by the
 *  folder being unreachable — is finished on the next launch rather than forgotten. */
interface Backlog {
  /** Note id → older ids of the same note (renames) whose files go once its current file is written. */
  writes: Record<string, string[]>
  /** Ids of deleted notes whose files may still be in the folder. */
  deletes: string[]
}

export interface FolderSyncState {
  /** Something saved in the cache hasn't reached the folder yet. */
  pending: boolean
  /** The last folder operation failed. Nothing is dropped — the backlog is retried. */
  error: boolean
}

let dir: FileSystemDirectoryHandle | null = null
let backlog: Backlog = { writes: {}, deletes: [] }
let loaded: Promise<void> | null = null
/** Stamped on every queued write, so a finished write can tell whether the note changed again meanwhile. */
const revisions = new Map<string, number>()
let revisionCounter = 0
let running: Promise<void> | null = null
let error = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(state: FolderSyncState) => void>()
let lastState: FolderSyncState = { pending: false, error: false }

function ensureLoaded(): Promise<void> {
  loaded ??= kvStore.get<Backlog>(BACKLOG_KEY).then(saved => { if (saved) backlog = saved })
  return loaded
}

function persist(): Promise<void> {
  return kvStore.set(BACKLOG_KEY, backlog)
}

function hasWork(): boolean {
  return backlog.deletes.length > 0 || Object.keys(backlog.writes).length > 0
}

function notify(): void {
  const state = { pending: running !== null || hasWork(), error }
  if (state.pending === lastState.pending && state.error === lastState.error) return
  lastState = state
  for (const listener of listeners) listener(state)
}

/** Starts working through the backlog, unless that's already happening. */
function kick(): void {
  if (running || !dir) return
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  running = drain(dir).then(ok => {
    running = null
    // Work queued in the moment between the last step and here would otherwise sit until the next save.
    if (ok && hasWork()) kick()
    else notify()
  })
  notify()
}

async function drain(handle: FileSystemDirectoryHandle): Promise<boolean> {
  while (dir === handle && hasWork()) {
    try {
      await step(handle)
      error = false
    } catch {
      error = true
      retryTimer ??= setTimeout(() => { retryTimer = null; kick() }, RETRY_MS)
      return false
    }
    notify()
  }
  return true
}

async function step(handle: FileSystemDirectoryHandle): Promise<void> {
  const id = Object.keys(backlog.writes)[0]
  if (id !== undefined) {
    const revision = revisions.get(id)
    const previousIds = backlog.writes[id]
    // Always the cache's copy rather than one handed over at save time: it's the newest there is.
    const note = await notesCache.get(id)
    if (note) {
      // New file first, old names after, so there's never a moment with neither on disk.
      await writeNoteFile(handle, note)
      for (const previousId of previousIds) {
        // Another note may have taken this name since — its file isn't ours to remove.
        if (!(await notesCache.has(previousId))) await deleteNoteFile(handle, previousId)
      }
    }
    if (revisions.get(id) === revision) delete backlog.writes[id]
    await persist()
    return
  }
  const deletedId = backlog.deletes[0]
  if (!(await notesCache.has(deletedId))) await deleteNoteFile(handle, deletedId)
  backlog.deletes = backlog.deletes.filter(d => d !== deletedId)
  await persist()
}

export const folderSync = {
  /** Points the sync at a folder and picks up whatever an earlier session left unfinished. Doesn't
   *  start writing — call start() once the folder has been reconciled. */
  async connect(handle: FileSystemDirectoryHandle): Promise<void> {
    await ensureLoaded()
    dir = handle
  },

  /** Drops everything owed. For switching to a different folder, which the old backlog doesn't belong to. */
  async discard(): Promise<void> {
    await ensureLoaded()
    backlog = { writes: {}, deletes: [] }
    error = false
    await persist()
    notify()
  },

  start: kick,
  retry: kick,

  /** Records that the folder needs the cached copy of `id`. Pass `previousId` for a rename, so the
   *  file under the old name is removed once the new one is written. */
  async queueWrite(id: string, previousId?: string): Promise<void> {
    await ensureLoaded()
    const { writes } = backlog
    const older = new Set(writes[id] ?? [])
    if (previousId !== undefined && previousId !== id) {
      // Renamed again before the last rename reached the folder: the new name inherits the
      // cleanup of every name still on disk.
      older.add(previousId)
      for (const p of writes[previousId] ?? []) older.add(p)
      delete writes[previousId]
    }
    // `id` belongs to a live note now, so nothing queued may remove its file.
    older.delete(id)
    for (const key of Object.keys(writes)) {
      if (writes[key].includes(id)) writes[key] = writes[key].filter(p => p !== id)
    }
    backlog.deletes = backlog.deletes.filter(d => d !== id)
    writes[id] = [...older]
    revisions.set(id, ++revisionCounter)
    await persist()
    kick()
  },

  async queueDelete(id: string): Promise<void> {
    await ensureLoaded()
    const files = [id, ...(backlog.writes[id] ?? [])]
    delete backlog.writes[id]
    backlog.deletes = [...new Set([...backlog.deletes, ...files])]
    await persist()
    kick()
  },

  /** What reconciling has to work around: notes waiting to be written (absent from disk, but not
   *  deleted) and files waiting to be removed (present on disk, but not notes to import). */
  pendingNames(): { writing: Set<string>; removing: Set<string> } {
    return {
      writing: new Set(Object.keys(backlog.writes)),
      removing: new Set([...backlog.deletes, ...Object.values(backlog.writes).flat()]),
    }
  },

  /** Resolves once the folder has caught up — true — or has stopped trying for now — false. */
  async whenIdle(): Promise<boolean> {
    kick()
    while (running) await running
    return !hasWork()
  },

  subscribe(listener: (state: FolderSyncState) => void): () => void {
    listeners.add(listener)
    listener(lastState)
    return () => { listeners.delete(listener) }
  },
}
