import { useState, useCallback, useEffect, useRef } from 'react'
import { storage, type StorageStatus } from '../storage'
import { usePlatform } from './usePlatform'
import { renderNoteHtml, parseNoteHtml, filenameFor, slugify } from '../storage/noteFile'
import type { Note, NoteMetadata, SaveStatus } from '../types'

export type AppStatus = 'checking' | 'error' | StorageStatus

/** Outcome of an .html import, so the UI can say what actually happened rather than nothing. */
export interface ImportResult {
  added: number
  updated: number
  skipped: number
  failed: number
}

/** Whether the share sheet can actually take this file. The *preference* comes from the platform
 *  (a download is close to useless on a phone; a share sheet is a worse answer on a desktop); this
 *  is the feature check that has to see the real File. */
function canShareFile(file: File): boolean {
  return typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [file] })
}

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
  const platform = usePlatform()
  const [status, setStatus] = useState<AppStatus>('checking')
  const [folderName, setFolderName] = useState<string | null>(null)
  const [noteList, setNoteList] = useState<NoteMetadata[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [titleConflict, setTitleConflict] = useState(false)
  // True when a folder is connected but the last write didn't reach it. Deliberately outlives a
  // note switch: it describes the folder, not the note, and clears itself the next time any write
  // gets through. Always false in browser-only mode, where there is no folder to fail.
  const [folderError, setFolderError] = useState(false)
  // Bumped every time a *different* note is opened — and never by a save, rename, pin or reorder.
  // The editor keys its content swap off this rather than off any field of the note itself, so
  // switching notes always reloads the body and a rename never does.
  const [openToken, setOpenToken] = useState(0)

  /** Quiet period after the last edit before a save. */
  const SAVE_DEBOUNCE_MS = 800
  /** Ceiling on how long an edit can sit unsaved. A trailing debounce on its own never fires while
   *  you keep typing, so a long uninterrupted burst would stay unwritten indefinitely. */
  const SAVE_MAX_WAIT_MS = 5_000

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Title/metadata edits, which are cheap to carry around. Content is deliberately not in here. */
  const pendingNote = useRef<Note | null>(null)
  /** Pulls the body out of the editor, and only when we're actually about to save.
   *
   *  Serialising a ProseMirror document is O(document size), and pasted images live in the document
   *  as base64 — so calling it per keystroke meant re-serialising several megabytes on every
   *  character. Storing the *getter* defers that to the debounced flush: one serialisation per save
   *  rather than one per keypress. Returns null if the editor has gone away, which means "no content
   *  change to apply" rather than "the note is now empty". */
  const pendingContent = useRef<(() => string | null) | null>(null)
  // Lets the flush reach the current note without being re-created (and re-scheduled) on every edit.
  const activeNoteRef = useRef<Note | null>(null)
  activeNoteRef.current = activeNote

  const markNoteOpened = useCallback(() => setOpenToken(t => t + 1), [])

  const loadNoteList = useCallback(async () => {
    const list = await storage.listNotes()
    setNoteList(list)
    return list
  }, [])

  // A note's id is always slugify(title) — no random suffix. Saves it under that id if the slug
  // is free; if another note already owns it, keeps the note under its previous id/filename
  // instead of colliding, and reports the conflict so the UI can warn about it.
  const commitNote = useCallback(async (note: Note): Promise<{ note: Note; conflict: boolean; folderOk: boolean }> => {
    const desiredId = slugify(note.title)
    if (desiredId === note.id) {
      return { note, conflict: false, folderOk: await storage.writeNote(note) }
    }
    if (await storage.hasNote(desiredId)) {
      return { note, conflict: true, folderOk: await storage.writeNote(note) }
    }
    const renamed = { ...note, id: desiredId }
    return { note: renamed, conflict: false, folderOk: await storage.writeNote(renamed, note.id) }
  }, [])

  // Commits whatever edit is pending (if any) right now instead of waiting for the debounce, and
  // returns the note as actually saved — its id may differ from what the caller last saw if this
  // commit happened to also resolve a pending rename.
  const clearSaveTimers = () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    if (maxWaitTimer.current) { clearTimeout(maxWaitTimer.current); maxWaitTimer.current = null }
  }

  const flushPending = useCallback(async (): Promise<Note | null> => {
    clearSaveTimers()

    const getContent = pendingContent.current
    // A content edit has no pending note of its own — the base is whatever's open.
    const base = pendingNote.current ?? (getContent ? activeNoteRef.current : null)
    if (!base) return null
    pendingNote.current = null
    pendingContent.current = null

    // The one place the document gets serialised.
    const content = getContent?.() ?? null
    const note: Note = content === null
      ? base
      : { ...base, content, updatedAt: new Date().toISOString() }

    const { note: saved, conflict, folderOk } = await commitNote(note)
    setTitleConflict(conflict)
    setFolderError(!folderOk)
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
    markNoteOpened()
    writeNoteIdToUrl(note?.id ?? null, false)
  }, [markNoteOpened])

  useEffect(() => {
    (async () => {
      try {
        const result = await storage.init()
        setStatus(result)
        setFolderName(storage.getDirectoryName())
        if (result === 'ready' || result === 'fallback') {
          await openFirstNote(await loadNoteList())
        }
      } catch (err) {
        // Storage couldn't be opened at all — IndexedDB blocked (Firefox private browsing, a
        // storage policy), or the folder read failed in a way init() doesn't classify. Without
        // this the rejection escapes unhandled and `status` stays 'checking', leaving the app on
        // its loading spinner forever with nothing on screen to explain why.
        console.error('htmlr: storage init failed', err)
        setStatus('error')
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
      markNoteOpened()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [flushPending, markNoteOpened])

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
      markNoteOpened()
      writeNoteIdToUrl(note.id, true)
    }
  }, [flushPending, markNoteOpened])

  const createNote = useCallback(async () => {
    await flushPending()
    const { id, title } = await uniqueUntitled()
    const now = new Date().toISOString()
    const note: Note = { id, title, content: '', createdAt: now, updatedAt: now }
    setFolderError(!(await storage.writeNote(note)))
    await loadNoteList()
    setActiveNote(note)
    setSaveStatus('saved')
    setTitleConflict(false)
    markNoteOpened()
    writeNoteIdToUrl(note.id, true)
  }, [flushPending, loadNoteList, markNoteOpened])

  const scheduleFlush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void flushPending() }, SAVE_DEBOUNCE_MS)
    // Started once per burst and not reset by later edits, so continuous typing still saves.
    if (!maxWaitTimer.current) {
      maxWaitTimer.current = setTimeout(() => { void flushPending() }, SAVE_MAX_WAIT_MS)
    }
  }, [flushPending])

  // The body changed. All this records is *how* to get it — see pendingContent. `saveStatus` is
  // already 'unsaved' after the first keystroke of a burst, so React bails out of re-rendering for
  // the rest of it, and a content edit costs nothing beyond scheduling.
  const updateContent = useCallback((getContent: () => string | null) => {
    pendingContent.current = getContent
    setSaveStatus('unsaved')
    scheduleFlush()
  }, [scheduleFlush])

  // The title is a controlled input, so unlike the body it does have to update state per keystroke.
  // It's a short string, so that's cheap.
  const updateTitle = useCallback((title: string, currentNote: Note) => {
    const updated: Note = { ...currentNote, title, updatedAt: new Date().toISOString() }
    setActiveNote(updated)
    setSaveStatus('unsaved')
    setTitleConflict(false)
    pendingNote.current = updated
    scheduleFlush()
  }, [scheduleFlush])

  const deleteNote = useCallback(
    async (id: string) => {
      // A pending edit on the note being deleted dies with it; a pending edit on any *other*
      // note must be committed, not discarded.
      const pendingId = pendingNote.current?.id ?? (pendingContent.current ? activeNoteRef.current?.id : undefined)
      if (pendingId === id) {
        clearSaveTimers()
        pendingNote.current = null
        pendingContent.current = null
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
        markNoteOpened()
        writeNoteIdToUrl(next?.id ?? null, false)
      }
    },
    [activeNote, loadNoteList, flushPending, markNoteOpened],
  )

  // Pinning keeps a note at the top of the list. Pin state + manual order live in the note's file
  // itself (data-htmlr-pinned / data-htmlr-pin-order), so they travel with the .html. Deliberately
  // does not touch updatedAt — pinning/reordering isn't an edit and shouldn't reshuffle recency.
  const togglePin = useCallback(async (id: string) => {
    await flushPending() // the note being pinned may itself have a pending edit — don't overwrite it with stale content
    const note = await storage.readNote(id)
    if (!note) return
    const updated: Note = note.pinned
      ? { ...note, pinned: false, pinnedOrder: undefined }
      // Newly pinned notes go to the top of the pinned group: a smaller pinnedOrder sorts higher,
      // and -Date.now() is smaller than any order a manual reorder assigns (0, 1, 2, …).
      : { ...note, pinned: true, pinnedOrder: -Date.now() }
    setFolderError(!(await storage.writeNote(updated)))
    setActiveNote(current => (current && current.id === id ? updated : current))
    await loadNoteList()
  }, [flushPending, loadNoteList])

  // Applies a new manual order to the pinned notes (drag-and-drop). Renumbers them 0,1,2,… in the
  // given order and writes each changed file. Unpinned notes are untouched — they stay sorted by
  // last-modified. Keeps updatedAt intact so reordering never counts as an edit.
  const reorderPinned = useCallback(async (orderedIds: string[]) => {
    await flushPending()
    const orderIndex = new Map(orderedIds.map((id, i) => [id, i]))

    // Optimistic: resort the list in memory right away so the sidebar snaps into the new order
    // instead of waiting on the per-note disk writes below (which lag on a network/cloud folder).
    // The pinned notes lead the list, in the given order; the unpinned tail is untouched.
    setNoteList(prev => {
      const pinned = prev
        .filter(n => orderIndex.has(n.id))
        .sort((a, b) => orderIndex.get(a.id)! - orderIndex.get(b.id)!)
        .map(n => ({ ...n, pinnedOrder: orderIndex.get(n.id)! }))
      const rest = prev.filter(n => !orderIndex.has(n.id))
      return [...pinned, ...rest]
    })
    // Keep the in-memory active note's order in sync, so a later edit doesn't write back a stale one.
    setActiveNote(current => {
      const idx = current ? orderIndex.get(current.id) ?? -1 : -1
      return idx === -1 ? current : { ...current!, pinnedOrder: idx }
    })

    // Persist in the background, in parallel — only the notes whose order actually changed.
    const results = await Promise.all(orderedIds.map(async (id, i) => {
      const note = await storage.readNote(id)
      if (note && note.pinnedOrder !== i) return storage.writeNote({ ...note, pinnedOrder: i })
      return true
    }))
    // Only ever raises the flag here: a reorder that wrote nothing at all isn't evidence the
    // folder is healthy again, so it must not clear a warning an earlier failure put up.
    if (results.some(ok => !ok)) setFolderError(true)
  }, [flushPending])

  // Re-attempts the folder write for the open note. Without this the only way out of the
  // "saved in browser only" state is to type something and trigger a fresh save, which is a poor
  // way to ask "is the folder back yet?".
  const retrySave = useCallback(async () => {
    // A pending edit flushes on its own terms, and that flush is itself the retry.
    if (await flushPending()) return
    if (!activeNote) return
    setFolderError(!(await storage.writeNote(activeNote)))
  }, [flushPending, activeNote])

  // Pulls .html files in from wherever the platform's file picker can reach — on iOS that's the
  // Files app, which is the only way notes get onto the phone without a sync backend.
  const importNotes = useCallback(async (files: File[]): Promise<ImportResult> => {
    await flushPending()
    const result: ImportResult = { added: 0, updated: 0, skipped: 0, failed: 0 }
    let lastImportedId: string | null = null

    for (const file of files) {
      try {
        const parsed = parseNoteHtml(await file.text(), slugify(file.name.replace(/\.html?$/i, '')))
        if (!parsed) { result.failed++; continue }

        // Identity comes from the title, exactly as it does everywhere else — never the filename,
        // which the platform mangles ("meeting-notes 2.html") whenever it declines to overwrite.
        const id = slugify(parsed.title)
        const existing = await storage.readNote(id)
        if (existing && new Date(parsed.updatedAt).getTime() <= new Date(existing.updatedAt).getTime()) {
          result.skipped++ // the copy already here is the same or newer; importing would be a downgrade
          continue
        }
        await storage.writeNote({ ...parsed, id })
        if (existing) result.updated++
        else result.added++
        lastImportedId = id
      } catch {
        result.failed++ // unreadable file — keep going through the rest of the selection
      }
    }

    const list = await loadNoteList()
    if (lastImportedId && list.some(n => n.id === lastImportedId)) {
      const note = await storage.readNote(lastImportedId)
      if (note) {
        setActiveNote(note)
        setSaveStatus('saved')
        setTitleConflict(false)
        markNoteOpened()
        writeNoteIdToUrl(note.id, true)
      }
    }
    return result
  }, [flushPending, loadNoteList, markNoteOpened])

  // Opens the note's real saved file in a new tab. Flushes any pending edit first so the file
  // reflects the latest content — that flush may also resolve a pending rename, so the id it
  // actually got saved under can differ from what the caller passed in. Falls back to a fresh
  // download when there's no connected folder to open a real file from (browser-only fallback).
  const openNoteFile = useCallback(async (note: Note) => {
    const saved = (await flushPending()) ?? note
    const opened = await storage.openNoteFile(saved.id)
    if (opened) return

    const html = renderNoteHtml(saved)
    const filename = filenameFor(saved.id)

    const file = new File([html], filename, { type: 'text/html' })
    if (platform.prefersShareSheet && canShareFile(file)) {
      try {
        await navigator.share({ files: [file], title: saved.title || 'Untitled' })
        return
      } catch (err) {
        // Dismissing the sheet is a decision, not a failure — don't fire a download behind it.
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Anything else (no handler, permission trouble): fall through to the download below.
      }
    }

    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Revoking straight after click() can cancel the download before the browser has read the
    // blob — this fallback path is exactly the browsers (Firefox, Safari, iOS) where that bites.
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }, [flushPending, platform.prefersShareSheet])

  return {
    status, folderName, noteList, activeNote, saveStatus, titleConflict, openToken, folderError,
    isUsingFolder: storage.isUsingFolder(),
    chooseDirectory, reconnect, continueWithoutFolder,
    openNote, createNote, updateTitle, updateContent, deleteNote, togglePin, reorderPinned, openNoteFile, retrySave,
    importNotes,
  }
}
