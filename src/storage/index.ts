import type { Note, NoteMetadata } from '../types'
import { kvStore, notesCache, requestPersistence } from './db'
import {
  isFileSystemAccessSupported,
  pickDirectory,
  verifyPermission,
  readAllNoteFiles,
  writeNoteFile,
  openNoteFile as openNoteFileOnDisk,
} from './fs'
import { folderSync, type FolderSyncState } from './folderSync'
import { slugify } from './noteFile'

export type StorageStatus = 'unsupported' | 'needs-setup' | 'needs-permission' | 'missing-folder' | 'ready' | 'fallback'
export type { FolderSyncState }

const DIR_HANDLE_KEY = 'directoryHandle'
const FALLBACK_KEY = 'fallbackMode'

let dirHandle: FileSystemDirectoryHandle | null = null

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

/** A folder we still hold permission for, but whose directory has since been deleted, moved, or
 *  renamed on disk — reading it throws NotFoundError. Distinct from a permission revocation, where
 *  the folder is still there but the browser wants the user to re-confirm access. */
function isFolderMissingError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError'
}

/** True if no other note in the batch already owns (or has already claimed) this id. */
function idIsFree(id: string, self: Note, all: Note[], claimed: Set<string>): boolean {
  return !claimed.has(id) && !all.some(n => n !== self && n.id === id)
}

/** Pulls the folder's .html files into the IndexedDB cache: adds/updates what's on disk, drops cache entries
 *  whose file is gone, and renames any legacy (non-slug, e.g. random-suffixed) filenames to clean ones.
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
async function reconcileFromDisk(): Promise<void> {
  if (!dirHandle) return
  const { writing, removing } = folderSync.pendingNames()
  const rawNotes = (await readAllNoteFiles(dirHandle)).filter(n => !removing.has(n.id))
  const claimed = new Set<string>()
  const finalNotes: Note[] = []

  for (const note of rawNotes) {
    const cleanId = slugify(note.title)
    if (cleanId !== note.id && idIsFree(cleanId, note, rawNotes, claimed)) {
      const renamed = { ...note, id: cleanId }
      try {
        await writeNoteFile(dirHandle, renamed, note.id)
        finalNotes.push(renamed)
        claimed.add(cleanId)
        continue
      } catch {
        // rename failed — keep the note under its existing filename
      }
    }
    finalNotes.push(note)
    claimed.add(note.id)
  }

  const diskIds = new Set(finalNotes.map(n => n.id))
  const cached = await notesCache.getAll()
  const cachedById = new Map(cached.map(n => [n.id, n]))

  // A cached note with no matching disk file was deleted outside the app (the user removed the file
  // directly) — unless the folder sync still owes the folder that note, in which case it simply
  // hasn't been written yet.
  for (const note of cached) {
    if (!diskIds.has(note.id) && !writing.has(note.id)) await notesCache.delete(note.id)
  }

  for (const diskNote of finalNotes) {
    const cachedNote = cachedById.get(diskNote.id)
    const cacheIsNewer = cachedNote && new Date(cachedNote.updatedAt).getTime() > new Date(diskNote.updatedAt).getTime()
    if (cacheIsNewer) {
      await folderSync.queueWrite(cachedNote.id)
      continue // keep the newer cached version; don't let the stale disk copy overwrite it
    }
    await notesCache.put(diskNote)
  }
  invalidateIndex()
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
    await folderSync.connect(saved)
    // Permission is granted, but the folder itself may be gone (deleted/moved/renamed since we last
    // saw it). Reading it then throws NotFoundError — surface that as its own recoverable state
    // instead of letting the rejection escape and hang the app on the loading spinner forever.
    try {
      await reconcileFromDisk()
    } catch (err) {
      if (isFolderMissingError(err)) return 'missing-folder'
      throw err
    }
    folderSync.start() // finish anything a previous session left unwritten
    return 'ready'
  },

  async chooseDirectory(): Promise<boolean> {
    const handle = await pickDirectory()
    if (!handle) return false
    // What the old folder was still owed doesn't belong in a different one. Re-picking the same
    // folder keeps it, though — dropping it would lose edits that just haven't been written yet.
    if (!dirHandle || !(await isSameFolder(dirHandle, handle))) await folderSync.discard()
    dirHandle = handle
    await folderSync.connect(handle)
    await kvStore.set(DIR_HANDLE_KEY, handle)
    await kvStore.delete(FALLBACK_KEY)
    try {
      await reconcileFromDisk()
    } catch {
      // The folder was picked but can't be read right now (a network mount that just went away,
      // for instance). The connection itself still stands — carry on with the cache and let the
      // next reconcile pick the files up, rather than rejecting and leaving the button dead.
    }
    folderSync.start()
    return true
  },

  /** Re-requests permission on the previously connected folder (requires a user gesture). Returns
   *  false if permission is refused or the folder is no longer on disk — the caller stays on the
   *  reconnect screen, where "Choose a different folder" remains available as the way out. */
  async reconnect(): Promise<boolean> {
    if (!dirHandle) return false
    if (!(await verifyPermission(dirHandle, true))) return false
    await folderSync.connect(dirHandle)
    try {
      await reconcileFromDisk()
    } catch (err) {
      if (isFolderMissingError(err)) return false
      throw err
    }
    folderSync.start()
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
