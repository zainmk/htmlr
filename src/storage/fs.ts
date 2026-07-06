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

async function removeEntrySafe(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name)
  } catch {
    // already gone
  }
}
