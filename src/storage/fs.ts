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

export interface NoteFileEntry {
  /** The filename without its extension — the note's id. */
  id: string
  handle: FileSystemFileHandle
}

/** Lists the folder's note files without opening any of them — over a network share, opening and
 *  downloading every file is what makes reading the folder slow. */
export async function listNoteFiles(dir: FileSystemDirectoryHandle): Promise<NoteFileEntry[]> {
  const entries: NoteFileEntry[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.html')) continue
    entries.push({ id: name.replace(/\.html$/i, ''), handle: handle as FileSystemFileHandle })
  }
  return entries
}

/** Parses a note file that's already been opened. Null if it isn't a note. */
export async function readNoteFile(file: File, id: string): Promise<Note | null> {
  return parseNoteHtml(await file.text(), id)
}

export async function writeNoteFile(dir: FileSystemDirectoryHandle, note: Note, previousId?: string): Promise<void> {
  if (previousId !== undefined && previousId !== note.id) {
    await removeIfPresent(dir, filenameFor(previousId))
  }
  const fileHandle = await dir.getFileHandle(filenameFor(note.id), { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(renderNoteHtml(note))
  await writable.close()
}

export async function deleteNoteFile(dir: FileSystemDirectoryHandle, id: string): Promise<void> {
  await removeIfPresent(dir, filenameFor(id))
}

/** Opens the note's actual saved file (not a fresh export) in a new tab, reading it straight off disk. */
export async function openNoteFile(dir: FileSystemDirectoryHandle, id: string): Promise<void> {
  const fileHandle = await dir.getFileHandle(filenameFor(id))
  const file = await fileHandle.getFile()
  const url = URL.createObjectURL(file)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** A file that's already gone is fine; a folder that can't be reached is not — that has to surface,
 *  or the caller would count a removal that never happened as done. */
async function removeIfPresent(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name)
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err
  }
}
