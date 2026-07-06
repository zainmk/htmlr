import { useState, useCallback, useEffect, useRef } from 'react'
import { storage, type StorageStatus } from '../storage'
import { renderNoteHtml, filenameFor, slugify } from '../storage/noteFile'
import type { Note, NoteMetadata, SaveStatus } from '../types'

export type AppStatus = 'checking' | StorageStatus

// Keep the open note reflected in `?note=<id>`, so it's bookmarkable and back/forward work.
// This only resolves within the current browser + connected folder — it's not a shareable link.
function readNoteIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('note')
}

function writeNoteIdToUrl(id: string | null, push: boolean): void {
  if (readNoteIdFromUrl() === id) return
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('note', id)
  else url.searchParams.delete('note')
  window.history[push ? 'pushState' : 'replaceState'](null, '', url.toString())
}

// New notes get "Untitled", "Untitled 2", etc. so creating one never collides — titles typed
// afterward are a different matter and are blocked from colliding (see commitNote below).
async function uniqueUntitled(): Promise<{ id: string; title: string }> {
  if (!(await storage.hasNote('untitled'))) return { id: 'untitled', title: 'Untitled' }
  let n = 2
  while (await storage.hasNote(`untitled-${n}`)) n++
  return { id: `untitled-${n}`, title: `Untitled ${n}` }
}

export function useNotes() {
  const [status, setStatus] = useState<AppStatus>('checking')
  const [folderName, setFolderName] = useState<string | null>(null)
  const [noteList, setNoteList] = useState<NoteMetadata[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [titleConflict, setTitleConflict] = useState(false)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingNote = useRef<Note | null>(null)

  const loadNoteList = useCallback(async () => {
    const list = await storage.listNotes()
    setNoteList(list)
    return list
  }, [])

  // A note's id is always slugify(title) — no random suffix. Saves it under that id if the slug
  // is free; if another note already owns it, keeps the note under its previous id/filename
  // instead of colliding, and reports the conflict so the UI can warn about it.
  const commitNote = useCallback(async (note: Note): Promise<{ note: Note; conflict: boolean }> => {
    const desiredId = slugify(note.title)
    if (desiredId === note.id) {
      await storage.writeNote(note)
      return { note, conflict: false }
    }
    if (await storage.hasNote(desiredId)) {
      await storage.writeNote(note)
      return { note, conflict: true }
    }
    const renamed = { ...note, id: desiredId }
    await storage.writeNote(renamed, note.id)
    return { note: renamed, conflict: false }
  }, [])

  // Commits whatever edit is pending (if any) right now instead of waiting for the debounce, and
  // returns the note as actually saved — its id may differ from what the caller last saw if this
  // commit happened to also resolve a pending rename.
  const flushPending = useCallback(async (): Promise<Note | null> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const note = pendingNote.current
    if (!note) return null
    pendingNote.current = null

    const { note: saved, conflict } = await commitNote(note)
    setTitleConflict(conflict)
    setActiveNote(current => (current && current.id === note.id ? saved : current))
    if (saved.id !== note.id) writeNoteIdToUrl(saved.id, false)
    setSaveStatus('saved')
    await loadNoteList()
    return saved
  }, [commitNote, loadNoteList])

  // Opens the note named in the URL if it exists in the given list, otherwise the most recent note.
  const openFirstNote = useCallback(async (list: NoteMetadata[]) => {
    const urlId = readNoteIdFromUrl()
    const targetId = urlId && list.some(n => n.id === urlId) ? urlId : list[0]?.id
    const note = targetId ? await storage.readNote(targetId) : null
    setActiveNote(note)
    setTitleConflict(false)
    writeNoteIdToUrl(note?.id ?? null, false)
  }, [])

  useEffect(() => {
    (async () => {
      const result = await storage.init()
      setStatus(result)
      setFolderName(storage.getDirectoryName())
      if (result === 'ready' || result === 'fallback') {
        await openFirstNote(await loadNoteList())
      }
    })()
  }, [loadNoteList, openFirstNote])

  // Browser back/forward: re-sync activeNote from whatever the URL now points at.
  useEffect(() => {
    const onPopState = async () => {
      await flushPending()
      const id = readNoteIdFromUrl()
      const note = id ? await storage.readNote(id) : null
      setActiveNote(note)
      setTitleConflict(false)
      setSaveStatus('saved')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [flushPending])

  const chooseDirectory = useCallback(async () => {
    const ok = await storage.chooseDirectory()
    if (ok) {
      setStatus('ready')
      setFolderName(storage.getDirectoryName())
      await openFirstNote(await loadNoteList())
    }
    return ok
  }, [loadNoteList, openFirstNote])

  const reconnect = useCallback(async () => {
    const ok = await storage.reconnect()
    if (ok) {
      setStatus('ready')
      await openFirstNote(await loadNoteList())
    }
    return ok
  }, [loadNoteList, openFirstNote])

  const continueWithoutFolder = useCallback(async () => {
    await storage.continueWithoutFolder()
    setStatus('fallback')
    await openFirstNote(await loadNoteList())
  }, [loadNoteList, openFirstNote])

  const openNote = useCallback(async (id: string) => {
    await flushPending()
    const note = await storage.readNote(id)
    if (note) {
      setActiveNote(note)
      setSaveStatus('saved')
      setTitleConflict(false)
      writeNoteIdToUrl(note.id, true)
    }
  }, [flushPending])

  const createNote = useCallback(async () => {
    await flushPending()
    const { id, title } = await uniqueUntitled()
    const now = new Date().toISOString()
    const note: Note = { id, title, content: '', createdAt: now, updatedAt: now }
    await storage.writeNote(note)
    await loadNoteList()
    setActiveNote(note)
    setSaveStatus('saved')
    setTitleConflict(false)
    writeNoteIdToUrl(note.id, true)
  }, [flushPending, loadNoteList])

  const updateNote = useCallback(
    (patch: Partial<Pick<Note, 'title' | 'content'>>, currentNote: Note) => {
      const updated: Note = { ...currentNote, ...patch, updatedAt: new Date().toISOString() }
      setActiveNote(updated)
      setSaveStatus('unsaved')
      if (patch.title !== undefined) setTitleConflict(false)
      pendingNote.current = updated

      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        flushPending()
      }, 800)
    },
    [flushPending],
  )

  const deleteNote = useCallback(
    async (id: string) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      pendingNote.current = null
      await storage.deleteNote(id)
      const list = await loadNoteList()
      if (activeNote?.id === id) {
        const next = list[0] ? await storage.readNote(list[0].id) : null
        setActiveNote(next)
        setSaveStatus('saved')
        setTitleConflict(false)
        writeNoteIdToUrl(next?.id ?? null, false)
      }
    },
    [activeNote, loadNoteList],
  )

  // Opens the note's real saved file in a new tab. Flushes any pending edit first so the file
  // reflects the latest content — that flush may also resolve a pending rename, so the id it
  // actually got saved under can differ from what the caller passed in. Falls back to a fresh
  // download when there's no connected folder to open a real file from (browser-only fallback).
  const openNoteFile = useCallback(async (note: Note) => {
    const saved = (await flushPending()) ?? note
    const opened = await storage.openNoteFile(saved.id)
    if (opened) return

    const blob = new Blob([renderNoteHtml(saved)], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filenameFor(saved.id)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [flushPending])

  return {
    status, folderName, noteList, activeNote, saveStatus, titleConflict,
    isUsingFolder: storage.isUsingFolder(),
    chooseDirectory, reconnect, continueWithoutFolder,
    openNote, createNote, updateNote, deleteNote, openNoteFile,
  }
}
