import { useState, useCallback, useEffect, useRef } from 'react'
import { storage, type StorageStatus } from '../storage'
import { renderNoteHtml, parseNoteHtml, filenameFor, slugify } from '../storage/noteFile'
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

// Finds a free id by appending "-2", "-3", etc. to `base` if it's already taken.
async function uniqueId(base: string): Promise<string> {
  if (!(await storage.hasNote(base))) return base
  let n = 2
  while (await storage.hasNote(`${base}-${n}`)) n++
  return `${base}-${n}`
}

// New blank notes get "Untitled", "Untitled 2", etc. so creating one never collides — titles
// typed afterward are a different matter and are blocked from colliding (see commitNote below).
async function uniqueUntitled(): Promise<{ id: string; title: string }> {
  const id = await uniqueId('untitled')
  const title = id === 'untitled' ? 'Untitled' : `Untitled ${id.slice('untitled-'.length)}`
  return { id, title }
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

  // Closing the tab, closing the installed-app window, or switching away on mobile inside the
  // 800ms debounce window would otherwise silently drop the last burst of typing — commit it the
  // moment the page stops being visible. (visibilitychange fires earlier and more reliably than
  // unload-family events, giving the async storage writes the best chance to complete.)
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPending()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [flushPending])

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
      // A pending edit on the note being deleted dies with it; a pending edit on any *other*
      // note must be committed, not discarded.
      if (pendingNote.current?.id === id) {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
        }
        pendingNote.current = null
      } else {
        await flushPending()
      }
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
    [activeNote, loadNoteList, flushPending],
  )

  // Pinning keeps a note at the top of the list. It's stored in the note's file itself
  // (data-htmlr-pinned), so it travels with the .html like everything else. Deliberately does
  // not touch updatedAt — pinning isn't an edit, and shouldn't reshuffle the recency order.
  const togglePin = useCallback(async (id: string) => {
    await flushPending() // the note being pinned may itself have a pending edit — don't overwrite it with stale content
    const note = await storage.readNote(id)
    if (!note) return
    const updated: Note = { ...note, pinned: !note.pinned }
    await storage.writeNote(updated)
    setActiveNote(current => (current && current.id === id ? updated : current))
    await loadNoteList()
  }, [flushPending, loadNoteList])

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

  // Imports an .html file (e.g. picked via a file input, which works on every browser — including
  // iOS Safari, which has no folder access at all) as a new note. Its title comes from the file
  // itself; if that title's slug collides with an existing note, the import still succeeds under
  // a disambiguated id rather than blocking, since there's no in-progress edit to warn about here.
  const importNote = useCallback(async (file: File) => {
    const html = await file.text()
    const fallbackId = slugify(file.name.replace(/\.html?$/i, ''))
    const parsed = parseNoteHtml(html, fallbackId)
    if (!parsed) {
      alert("That file doesn't look like a note htmlr can read.")
      return
    }

    await flushPending()
    const id = await uniqueId(slugify(parsed.title) || fallbackId)
    const note: Note = { ...parsed, id }
    await storage.writeNote(note)
    await loadNoteList()
    setActiveNote(note)
    setSaveStatus('saved')
    setTitleConflict(false)
    writeNoteIdToUrl(note.id, true)
  }, [flushPending, loadNoteList])

  return {
    status, folderName, noteList, activeNote, saveStatus, titleConflict,
    isUsingFolder: storage.isUsingFolder(),
    chooseDirectory, reconnect, continueWithoutFolder,
    openNote, createNote, updateNote, deleteNote, togglePin, openNoteFile, importNote,
  }
}
