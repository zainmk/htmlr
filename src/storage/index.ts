import type { Note, NoteMetadata } from '../types'
import { kvStore, notesCache, requestPersistence } from './db'
import {
  isFileSystemAccessSupported,
  pickDirectory,
  verifyPermission,
  listNoteFiles,
  readNoteFile,
  writeNoteFile,
  openNoteFile as openNoteFileOnDisk,
} from './fs'
import { folderSync, type FolderSyncState } from './folderSync'
import { slugify } from './noteFile'

export type StorageStatus = 'unsupported' | 'needs-setup' | 'needs-permission' | 'ready' | 'fallback'
export type { FolderSyncState }

export interface FolderReadResult {
  /** False when the folder couldn't be read — an unreachable share, a moved folder, revoked access. */
  ok: boolean
  /** Ids of notes the read added, replaced or removed in the cache. */
  changed: Set<string>
}

const DIR_HANDLE_KEY = 'directoryHandle'
const FALLBACK_KEY = 'fallbackMode'
/** Size and last-modified time of each note file, as of the last time the folder was read. */
const FILE_STAMPS_KEY = 'folderFileStamps'
/** Files opened at once while reading the folder. A network share answers each request slowly, but
 *  answers several at a time just as quickly. */
const READ_CONCURRENCY = 8

interface FileStamp {
  size: number
  lastModified: number
}

let dirHandle: FileSystemDirectoryHandle | null = null
/** The folder read in progress, if any — so overlapping requests share one read. */
let reading: { dir: FileSystemDirectoryHandle; promise: Promise<FolderReadResult> } | null = null

// Explicit projection: it drops `content` (the point of NoteMetadata), so every new field the
// sidebar needs has to be listed here or it silently never arrives.
function toMetadata({ id, title, createdAt, updatedAt, pinned, pinnedOrder }: Note): NoteMetadata {
  return { id, title, createdAt, updatedAt, pinned, pinnedOrder }
}

/** Metadata for every cached note, kept in memory. The list is rebuilt after every save, and reading
 *  it from IndexedDB meant deserializing every note in full — pasted images included — just to get
 *  the titles; with a few image-heavy notes that froze typing for ~50ms on each save. */
let indexPromise: Promise<Map<string, NoteMetadata>> | null = null

function getIndex(): Promise<Map<string, NoteMetadata>> {
  indexPromise ??= notesCache.getAll().then(notes => new Map(notes.map(n => [n.id, toMetadata(n)])))
  return indexPromise
}

/** For bulk cache changes (reconciling, migrations): rebuild from IndexedDB on next use. */
function invalidateIndex(): void {
  indexPromise = null
}

async function isSameFolder(a: FileSystemDirectoryHandle, b: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return await a.isSameEntry(b)
  } catch {
    return false
  }
}

/** True if no other note in the batch already owns (or has already claimed) this id. */
function idIsFree(id: string, self: Note, all: Note[], claimed: Set<string>): boolean {
  return !claimed.has(id) && !all.some(n => n !== self && n.id === id)
}

const time = (iso: string) => new Date(iso).getTime()

function sameNote(a: Note, b: Note): boolean {
  return a.title === b.title && a.content === b.content && a.createdAt === b.createdAt
    && a.updatedAt === b.updatedAt && !!a.pinned === !!b.pinned && a.pinnedOrder === b.pinnedOrder
}

async function forEachConcurrently<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Pulls the folder's .html files into the IndexedDB cache: adds/updates what's on disk, drops cache entries
 *  whose file is gone, and renames any legacy (non-slug, e.g. random-suffixed) filenames to clean ones.
 *
 *  This runs while the app is already in use (see syncFromFolder), and over a remote share every file
 *  is slow to open and slower to download — so only files whose size or modified time changed since
 *  the last read are downloaded at all, several are opened at once, and the cache is only written
 *  where something actually differs.
 *
 *  For a note that exists on both sides with different content, the newer `updatedAt` wins rather than
 *  disk always winning — this matters when the folder is a network mount (NAS, a cloud-sync client's
 *  virtual drive) that was briefly unreachable: an edit made during that window still lands in the cache
 *  (see `writeNote` below), but never reached the actual file. Without this check, the next reconcile
 *  would silently overwrite that edit with the stale on-disk copy the moment the folder became reachable
 *  again. If the cache turns out to hold the newer version, it's queued to be written back to disk to
 *  close the loop — not just kept in the cache.
 *
 *  Work the folder sync hasn't finished yet is respected too: a note still waiting to be written
 *  isn't mistaken for one deleted outside the app, and a file still waiting to be removed (a rename's
 *  old name, a deleted note) isn't imported back as a note. */
async function reconcileFromDisk(dir: FileSystemDirectoryHandle): Promise<FolderReadResult> {
  const changed = new Set<string>()
  // Hold folder writes for the duration, so the files listed below can't change underneath it.
  await folderSync.pause()
  try {
    const index = await getIndex()
    // What the cache held going in. Only these can be judged deleted outside the app — a note
    // created while the folder was being read is missing from the listing because it's newer.
    const before = new Map(index)
    const stamps = (await kvStore.get<Record<string, FileStamp>>(FILE_STAMPS_KEY)) ?? {}
    const entries = await listNoteFiles(dir)
    const diskIds = new Set(entries.map(e => e.id))
    const nextStamps: Record<string, FileStamp> = {}
    const fromDisk: Note[] = []

    // Opening a file only fetches its size and modified time; the download is reading it, which is
    // skipped for every file unchanged since the last read — normally all but a few.
    await forEachConcurrently(entries, READ_CONCURRENCY, async ({ id, handle }) => {
      try {
        const file = await handle.getFile()
        const stamp = { size: file.size, lastModified: file.lastModified }
        const seen = stamps[id]
        if (seen && seen.size === stamp.size && seen.lastModified === stamp.lastModified && before.has(id)) {
          nextStamps[id] = stamp
          return
        }
        const note = await readNoteFile(file, id)
        if (note) fromDisk.push(note)
        nextStamps[id] = stamp
      } catch {
        // Unreadable right now — leave the cached copy (if any) alone and try again next time.
      }
    })
    if (dirHandle !== dir) return { ok: true, changed } // switched folders mid-read; nothing here applies

    // Taken now rather than up front: nothing has been written since (writes are held), and it
    // includes anything saved while the folder was being read.
    const { writing, removing } = folderSync.pendingNames()

    const taken = new Set([...diskIds, ...index.keys()])
    for (let i = 0; i < fromDisk.length; i++) {
      const note = fromDisk[i]
      const cleanId = slugify(note.title)
      if (cleanId === note.id || taken.has(cleanId) || removing.has(note.id)) continue
      const renamed = { ...note, id: cleanId }
      try {
        await writeNoteFile(dir, renamed, note.id)
        fromDisk[i] = renamed
        taken.add(cleanId)
        diskIds.delete(note.id)
        diskIds.add(cleanId)
        delete nextStamps[note.id]
      } catch {
        // rename failed — keep the note under its existing filename
      }
    }

    // A cached note with no matching disk file was deleted outside the app (the user removed the file
    // directly) — unless the folder sync still owes the folder that note, in which case it simply
    // hasn't been written yet, or it was saved while the folder was being read.
    for (const [id, meta] of before) {
      if (diskIds.has(id) || writing.has(id) || index.get(id) !== meta) continue
      if (await notesCache.updateIf(id, stored => stored?.updatedAt === meta.updatedAt, null)) {
        index.delete(id)
        changed.add(id)
      }
    }

    for (const diskNote of fromDisk) {
      if (removing.has(diskNote.id)) continue // a rename's old name or a deleted note, waiting to go
      const cached = index.has(diskNote.id) ? await notesCache.get(diskNote.id) : undefined
      if (cached && time(cached.updatedAt) > time(diskNote.updatedAt)) {
        await folderSync.queueWrite(cached.id)
        continue // keep the newer cached version; don't let the stale disk copy overwrite it
      }
      if (cached && sameNote(cached, diskNote)) continue
      // In one transaction with the check, so a save made in the meantime isn't overwritten.
      const applied = await notesCache.updateIf(
        diskNote.id,
        stored => !stored || time(stored.updatedAt) <= time(diskNote.updatedAt),
        diskNote,
      )
      if (applied) {
        index.set(diskNote.id, toMetadata(diskNote))
        changed.add(diskNote.id)
      }
    }

    await kvStore.set(FILE_STAMPS_KEY, nextStamps)
    return { ok: true, changed }
  } catch {
    // The folder couldn't be listed at all — unreachable, moved, or access revoked. The cache carries
    // on as it is; the caller reports it and tries again later.
    return { ok: false, changed }
  } finally {
    if (dirHandle === dir) folderSync.resume()
  }
}

/** Same legacy-id cleanup as reconcileFromDisk, for the no-folder (IndexedDB-only) fallback path. */
async function migrateFallbackIds(): Promise<void> {
  const notes = await notesCache.getAll()
  const claimed = new Set<string>()
  for (const note of notes) {
    const cleanId = slugify(note.title)
    if (cleanId !== note.id && idIsFree(cleanId, note, notes, claimed)) {
      await notesCache.delete(note.id)
      await notesCache.put({ ...note, id: cleanId })
      claimed.add(cleanId)
    } else {
      claimed.add(note.id)
    }
  }
  invalidateIndex()
}

export const storage = {
  isFileSystemAccessSupported,

  /** Resolves the app's storage state on startup: is a folder already connected, does it need re-authorization, or has none been chosen yet. */
  async init(): Promise<StorageStatus> {
    if (!isFileSystemAccessSupported()) {
      const isFallback = (await kvStore.get<boolean>(FALLBACK_KEY)) ?? false
      if (isFallback) {
        // Only in browser-only mode is IndexedDB the single copy of a note, so only there does
        // eviction mean data loss and only there is it worth asking. With a folder connected the
        // cache is just a cache. Fire-and-forget — it must not delay first paint.
        void requestPersistence()
        await migrateFallbackIds()
      }
      return isFallback ? 'fallback' : 'unsupported'
    }
    const saved = await kvStore.get<FileSystemDirectoryHandle>(DIR_HANDLE_KEY)
    if (!saved) return 'needs-setup'

    if (!(await verifyPermission(saved, false))) {
      dirHandle = saved
      return 'needs-permission'
    }
    dirHandle = saved
    // Opens straight from the cache. Reading the folder — slow over a remote share, and unable to
    // finish at all while it's unreachable — happens afterwards, in the background: syncFromFolder.
    await folderSync.connect(saved)
    return 'ready'
  },

  /** Brings the cache up to date with the folder, picking up notes added, edited or removed outside
   *  the app (or on another device). The app keeps working from the cache meanwhile, so this never
   *  holds up opening a note or typing in one. Never rejects: a folder that can't be read comes back
   *  as `ok: false`, with the cache left as it was. */
  syncFromFolder(): Promise<FolderReadResult> {
    const dir = dirHandle
    if (!dir) return Promise.resolve({ ok: true, changed: new Set<string>() })
    if (reading?.dir === dir) return reading.promise
    const earlier = reading?.promise
    const promise = (async () => {
      await earlier
      return reconcileFromDisk(dir)
    })()
    reading = { dir, promise }
    void promise.then(() => { if (reading?.promise === promise) reading = null })
    return promise
  },

  async chooseDirectory(): Promise<boolean> {
    const handle = await pickDirectory()
    if (!handle) return false
    // What the old folder was still owed, and what was known about its files, doesn't belong to a
    // different one. Re-picking the same folder keeps both, though — dropping the backlog would lose
    // edits that just haven't been written yet.
    if (!dirHandle || !(await isSameFolder(dirHandle, handle))) {
      await folderSync.discard()
      await kvStore.delete(FILE_STAMPS_KEY)
    }
    dirHandle = handle
    await folderSync.connect(handle)
    await kvStore.set(DIR_HANDLE_KEY, handle)
    await kvStore.delete(FALLBACK_KEY)
    return true
  },

  /** Re-requests permission on the previously connected folder (requires a user gesture). Returns
   *  false if permission is refused — the caller stays on the reconnect screen, where "Choose a
   *  different folder" remains available as the way out. Like startup, doesn't wait to read the
   *  folder; the caller follows up with syncFromFolder. */
  async reconnect(): Promise<boolean> {
    if (!dirHandle) return false
    if (!(await verifyPermission(dirHandle, true))) return false
    await folderSync.connect(dirHandle)
    return true
  },

  async continueWithoutFolder(): Promise<void> {
    await kvStore.set(FALLBACK_KEY, true)
    void requestPersistence() // the moment the cache becomes the only copy of anything
  },

  getDirectoryName(): string | null {
    return dirHandle?.name ?? null
  },

  isUsingFolder(): boolean {
    return dirHandle !== null
  },

  async listNotes(): Promise<NoteMetadata[]> {
    const notes = [...(await getIndex()).values()]
    const byRecency = (a: NoteMetadata, b: NoteMetadata) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    return notes
      .sort((a, b) => {
        // Pinned notes first, in their manual order (pinnedOrder ascending). Everything else —
        // including pinned notes that predate manual ordering — falls back to last-modified.
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        if (a.pinned && b.pinned) {
          const ao = a.pinnedOrder, bo = b.pinnedOrder
          if (ao != null && bo != null && ao !== bo) return ao - bo
          if (ao != null && bo == null) return -1
          if (ao == null && bo != null) return 1
        }
        return byRecency(a, b)
      })
  },

  async readNote(id: string): Promise<Note | null> {
    return (await notesCache.get(id)) ?? null
  },

  async hasNote(id: string): Promise<boolean> {
    return (await getIndex()).has(id)
  },

  /** Saves a note. Pass `previousId` when the note's id is changing (a title-driven rename) so the old
   *  file/cache entry gets cleaned up — otherwise it's treated as a normal save under the same id.
   *
   *  Only the cache is written before this returns. The folder copy is queued (see folderSync) and
   *  catches up in the background — at network speed, on a remote share — so a save never waits on
   *  the folder. How the folder is doing is reported through onFolderSync. */
  async writeNote(note: Note, previousId?: string): Promise<void> {
    const renamed = previousId !== undefined && previousId !== note.id
    await notesCache.put(note)
    if (renamed) await notesCache.delete(previousId)
    const index = await getIndex()
    if (renamed) index.delete(previousId)
    index.set(note.id, toMetadata(note))
    if (dirHandle) await folderSync.queueWrite(note.id, previousId)
  },

  async deleteNote(id: string): Promise<void> {
    await notesCache.delete(id)
    ;(await getIndex()).delete(id)
    if (dirHandle) await folderSync.queueDelete(id)
  },

  /** Follows whether the folder has caught up with the cache, and whether writing to it is failing.
   *  Returns the unsubscribe function. */
  onFolderSync(listener: (state: FolderSyncState) => void): () => void {
    return folderSync.subscribe(listener)
  },

  /** Retries the folder now, rather than at the next automatic attempt. */
  retryFolderSync(): void {
    folderSync.retry()
  },

  /** Opens the note's real saved file (not a fresh copy) in a new tab. Returns false if there's no
   *  connected folder to open a real file from, or the file can't be brought up to date right now —
   *  the caller should fall back to a download of the current version instead. */
  async openNoteFile(id: string): Promise<boolean> {
    if (!dirHandle) return false
    if (!(await folderSync.whenIdle())) return false
    try {
      await openNoteFileOnDisk(dirHandle, id)
      return true
    } catch {
      return false
    }
  },
}
