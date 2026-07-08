import type { Note, NoteMetadata } from '../types'
import { kvStore, notesCache } from './db'
import {
  isFileSystemAccessSupported,
  pickDirectory,
  verifyPermission,
  readAllNoteFiles,
  writeNoteFile,
  deleteNoteFile,
  openNoteFile as openNoteFileOnDisk,
} from './fs'
import { slugify } from './noteFile'

export type StorageStatus = 'unsupported' | 'needs-setup' | 'needs-permission' | 'ready' | 'fallback'

const DIR_HANDLE_KEY = 'directoryHandle'
const FALLBACK_KEY = 'fallbackMode'

let dirHandle: FileSystemDirectoryHandle | null = null

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
 *  again. If the cache turns out to hold the newer version, it's written back to disk here to close the
 *  loop — not just kept in the cache. */
async function reconcileFromDisk(): Promise<void> {
  if (!dirHandle) return
  const rawNotes = await readAllNoteFiles(dirHandle)
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

  // Note: a cached note with no matching disk file is treated as an external deletion (the user
  // removed the file directly) and dropped — this is the same ambiguity as always, since a note
  // created entirely offline and never yet written to disk looks identical from here. Unlike the
  // same-id conflict below, there's no timestamp to disambiguate a note that doesn't exist on one
  // side at all.
  for (const note of cached) {
    if (!diskIds.has(note.id)) await notesCache.delete(note.id)
  }

  for (const diskNote of finalNotes) {
    const cachedNote = cachedById.get(diskNote.id)
    const cacheIsNewer = cachedNote && new Date(cachedNote.updatedAt).getTime() > new Date(diskNote.updatedAt).getTime()
    if (cacheIsNewer) {
      try {
        await writeNoteFile(dirHandle, cachedNote)
      } catch {
        // still unreachable — leave it for the next reconcile to retry, cache already has it
      }
      continue // keep the newer cached version; don't let the stale disk copy overwrite it
    }
    await notesCache.put(diskNote)
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
}

export const storage = {
  isFileSystemAccessSupported,

  /** Resolves the app's storage state on startup: is a folder already connected, does it need re-authorization, or has none been chosen yet. */
  async init(): Promise<StorageStatus> {
    if (!isFileSystemAccessSupported()) {
      const isFallback = (await kvStore.get<boolean>(FALLBACK_KEY)) ?? false
      if (isFallback) await migrateFallbackIds()
      return isFallback ? 'fallback' : 'unsupported'
    }
    const saved = await kvStore.get<FileSystemDirectoryHandle>(DIR_HANDLE_KEY)
    if (!saved) return 'needs-setup'

    if (!(await verifyPermission(saved, false))) {
      dirHandle = saved
      return 'needs-permission'
    }
    dirHandle = saved
    await reconcileFromDisk()
    return 'ready'
  },

  async chooseDirectory(): Promise<boolean> {
    const handle = await pickDirectory()
    if (!handle) return false
    dirHandle = handle
    await kvStore.set(DIR_HANDLE_KEY, handle)
    await kvStore.delete(FALLBACK_KEY)
    await reconcileFromDisk()
    return true
  },

  /** Re-requests permission on the previously connected folder (requires a user gesture). */
  async reconnect(): Promise<boolean> {
    if (!dirHandle) return false
    if (!(await verifyPermission(dirHandle, true))) return false
    await reconcileFromDisk()
    return true
  },

  async continueWithoutFolder(): Promise<void> {
    await kvStore.set(FALLBACK_KEY, true)
  },

  getDirectoryName(): string | null {
    return dirHandle?.name ?? null
  },

  isUsingFolder(): boolean {
    return dirHandle !== null
  },

  async listNotes(): Promise<NoteMetadata[]> {
    const notes = await notesCache.getAll()
    return notes
      .map(({ id, title, createdAt, updatedAt, pinned }) => ({ id, title, createdAt, updatedAt, pinned }))
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
  },

  async readNote(id: string): Promise<Note | null> {
    return (await notesCache.get(id)) ?? null
  },

  async hasNote(id: string): Promise<boolean> {
    return (await notesCache.get(id)) !== undefined
  },

  /** Writes a note. Pass `previousId` when the note's id is changing (a title-driven rename) so the old
   *  file/cache entry gets cleaned up — otherwise it's treated as a normal save under the same id. */
  async writeNote(note: Note, previousId?: string): Promise<void> {
    if (dirHandle) {
      try {
        await writeNoteFile(dirHandle, note, previousId)
      } catch {
        // folder write failed (e.g. permission revoked mid-session) — cache below still keeps the note safe
      }
    }
    if (previousId !== undefined && previousId !== note.id) {
      await notesCache.delete(previousId)
    }
    await notesCache.put(note)
  },

  async deleteNote(id: string): Promise<void> {
    const existing = await notesCache.get(id)
    if (dirHandle && existing) {
      try {
        await deleteNoteFile(dirHandle, existing)
      } catch {
        // ignore — file may already be gone
      }
    }
    await notesCache.delete(id)
  },

  /** Opens the note's real saved file (not a fresh copy) in a new tab. Returns false if there's no
   *  connected folder to open a real file from — the caller should fall back to a download instead. */
  async openNoteFile(id: string): Promise<boolean> {
    if (!dirHandle) return false
    try {
      await openNoteFileOnDisk(dirHandle, id)
      return true
    } catch {
      return false
    }
  },
}
