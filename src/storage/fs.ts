import type { Note } from '../types'
import { renderNoteHtml, parseNoteHtml, filenameFor } from './noteFile'

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ id: 'htmlr-notes', mode: 'readwrite' })
  } catch {
    return null // user cancelled the picker
  }
}

export async function verifyPermission(handle: FileSystemDirectoryHandle, requestIfNeeded: boolean): Promise<boolean> {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
  if ((await handle.queryPermission(descriptor)) === 'granted') return true
  if (!requestIfNeeded) return false
  return (await handle.requestPermission(descriptor)) === 'granted'
}

export async function readAllNoteFiles(dir: FileSystemDirectoryHandle): Promise<Note[]> {
  const notes: Note[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.html')) continue
    try {
      const file = await (handle as FileSystemFileHandle).getFile()
      const note = parseNoteHtml(await file.text(), name.replace(/\.html$/i, ''))
      if (note) notes.push(note)
    } catch {
      // skip unreadable file rather than failing the whole sync
    }
  }
  return notes
}

export async function writeNoteFile(dir: FileSystemDirectoryHandle, note: Note, previousId?: string): Promise<void> {
  if (previousId !== undefined && previousId !== note.id) {
    await removeEntrySafe(dir, filenameFor(previousId))
  }
  const fileHandle = await dir.getFileHandle(filenameFor(note.id), { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(renderNoteHtml(note))
  await writable.close()
}

export async function deleteNoteFile(dir: FileSystemDirectoryHandle, note: Pick<Note, 'id'>): Promise<void> {
  await removeEntrySafe(dir, filenameFor(note.id))
}

/** Opens the note's actual saved file (not a fresh export) in a new tab, reading it straight off disk. */
export async function openNoteFile(dir: FileSystemDirectoryHandle, id: string): Promise<void> {
  const fileHandle = await dir.getFileHandle(filenameFor(id))
  const file = await fileHandle.getFile()
  const url = URL.createObjectURL(file)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Subfolder of the notes folder holding published copies. Point a web server at this one directory
 *  and every file in it is a live page — each note is already a complete, self-contained document,
 *  images included, so there is nothing to build and no assets to resolve.
 *
 *  `readAllNoteFiles` above skips anything that isn't a file, so this directory is invisible to the
 *  reconcile and published copies never come back as duplicate notes. */
const SHARED_DIR = 'shared'

/** Writes the note's rendered HTML into the shared folder — the published snapshot. */
export async function writeSharedCopy(dir: FileSystemDirectoryHandle, note: Note): Promise<void> {
  const shared = await dir.getDirectoryHandle(SHARED_DIR, { create: true })
  const fileHandle = await shared.getFileHandle(filenameFor(note.id), { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(renderNoteHtml(note))
  await writable.close()
}

export async function removeSharedCopy(dir: FileSystemDirectoryHandle, id: string): Promise<void> {
  try {
    const shared = await dir.getDirectoryHandle(SHARED_DIR)
    await removeEntrySafe(shared, filenameFor(id))
  } catch {
    // no shared folder yet, so nothing published to remove
  }
}

/** Moves a published copy when a rename changes the note's id. Copies the existing bytes rather than
 *  re-rendering, so a rename doesn't quietly push unpublished edits live — the snapshot stays the
 *  snapshot, it just answers on a new URL. */
export async function renameSharedCopy(dir: FileSystemDirectoryHandle, oldId: string, newId: string): Promise<void> {
  try {
    const shared = await dir.getDirectoryHandle(SHARED_DIR)
    const existing = await shared.getFileHandle(filenameFor(oldId))
    const html = await (await existing.getFile()).text()
    const target = await shared.getFileHandle(filenameFor(newId), { create: true })
    const writable = await target.createWritable()
    await writable.write(html)
    await writable.close()
    await removeEntrySafe(shared, filenameFor(oldId))
  } catch {
    // nothing published under the old name — nothing to move
  }
}

async function removeEntrySafe(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name)
  } catch {
    // already gone
  }
}
