import { Fragment, useEffect, useRef, useState } from 'react'
import { Plus, FileUp, FileText, Trash2, FolderOpen, HardDrive, Pin, PinOff, Globe } from 'lucide-react'
import type { NoteMetadata } from '../types'
import type { ImportResult } from '../hooks/useNotes'
import { usePlatform } from '../hooks/usePlatform'

interface Props {
  notes: NoteMetadata[]
  activeId: string | null
  folderName: string | null
  isUsingFolder: boolean
  collapsed: boolean
  onOpen: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  onReorderPinned: (orderedIds: string[]) => void
  onChooseDirectory: () => void
  onImport: (files: File[]) => Promise<ImportResult>
  /** Publishing writes a real file, so it needs a connected folder — hidden without one. */
  canPublish: boolean
  onTogglePublish: (id: string) => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Matches the sidebar's width transition — focusing before it finishes can land on a
// zero-width (not yet reliably focusable) element in some browsers.
const SIDEBAR_TRANSITION_MS = 200

export function Sidebar({ notes, activeId, folderName, isUsingFolder, collapsed, onOpen, onCreate, onDelete, onTogglePin, onReorderPinned, onChooseDirectory, onImport, canPublish, onTogglePublish }: Props) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const createBtnRef = useRef<HTMLButtonElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasCollapsed = useRef(collapsed)
  const armedDeleteRef = useRef<HTMLButtonElement | null>(null)
  // Set to the deleted note's index by a keyboard-driven delete, consumed once the list re-renders
  // to move focus back into it (see the effect below).
  const refocusAfterDeleteRef = useRef<number | null>(null)

  // Drag-to-reorder, pinned notes only — unpinned notes stay sorted by last-modified.
  //
  // Built on pointer events rather than HTML5 drag-and-drop, because that API never fires for touch:
  // `draggable` + dragstart/dragover/drop simply does nothing on a phone. Pointer events are the one
  // input model every device shares, so this is a single gesture with no platform branch and no
  // button fallback. Mouse and finger differ only in how the drag is *claimed*: a mouse starts as
  // soon as it moves a few pixels, a finger has to hold still for a moment first — so an ordinary
  // swipe still scrolls the list and an ordinary tap still opens the note.
  const MOUSE_DRAG_THRESHOLD = 4
  const TOUCH_HOLD_MS = 380
  const TOUCH_CANCEL_THRESHOLD = 10

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  // Mirrors draggingId for the event handlers, which would otherwise read a stale closure in the
  // gap between the state update and the next render.
  const activeDragId = useRef<string | null>(null)
  const pendingDrag = useRef<{ id: string; x: number; y: number; pointerId: number; el: HTMLElement } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A drag ends with a pointerup on the note, which the browser follows with a click — swallow it
  // so reordering doesn't also open the note you just moved.
  const suppressClick = useRef(false)

  const platform = usePlatform()
  const pinnedIds = notes.filter(n => n.pinned).map(n => n.id)

  // Importing can legitimately do nothing visible — every file already present and current — so it
  // reports what happened rather than leaving the user wondering whether the picker worked.
  const [importStatus, setImportStatus] = useState<string | null>(null)
  useEffect(() => () => { if (importStatusTimer.current) clearTimeout(importStatusTimer.current) }, [])

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // so picking the same file twice in a row still fires a change event
    if (files.length === 0) return

    const r = await onImport(files)
    const parts: string[] = []
    if (r.added) parts.push(`${r.added} imported`)
    if (r.updated) parts.push(`${r.updated} updated`)
    if (r.skipped) parts.push(`${r.skipped} already current`)
    if (r.failed) parts.push(`${r.failed} unreadable`)
    setImportStatus(parts.join(' · ') || 'Nothing to import')
    if (importStatusTimer.current) clearTimeout(importStatusTimer.current)
    importStatusTimer.current = setTimeout(() => setImportStatus(null), 6000)
  }

  const clearPendingDrag = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
    pendingDrag.current = null
  }
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current) }, [])

  // While a drag is live, stop the browser scrolling the list out from under it. Has to be a
  // non-passive listener: touchmove is passive by default, where preventDefault does nothing.
  useEffect(() => {
    if (!draggingId) return
    const block = (e: TouchEvent) => e.preventDefault()
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [draggingId])

  /** Which pinned row the pointer is over, by row midpoints. Rows never move during a drag — the
   *  dragged one dims and an insertion line marks the target — so the rects stay stable. */
  const targetIndexAt = (clientY: number): number => {
    let idx = 0
    for (let i = 0; i < pinnedIds.length; i++) {
      const el = itemRefs.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientY > r.top + r.height / 2) idx = i + 1
    }
    return Math.max(0, Math.min(idx, pinnedIds.length - 1))
  }

  const beginDrag = () => {
    const p = pendingDrag.current
    if (!p) return
    // Capture keeps move/up coming to this element once the pointer leaves it, so the drag survives
    // travelling across the other rows. Best-effort: without it the events still bubble.
    try { p.el.setPointerCapture(p.pointerId) } catch { /* not fatal */ }
    activeDragId.current = p.id
    suppressClick.current = true
    setDraggingId(p.id)
    setDragOverId(p.id)
  }

  const onItemPointerDown = (note: NoteMetadata, e: React.PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false
    if (!note.pinned) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    clearPendingDrag()
    pendingDrag.current = { id: note.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, el: e.currentTarget }
    if (e.pointerType !== 'mouse') holdTimer.current = setTimeout(beginDrag, TOUCH_HOLD_MS)
  }

  const onItemPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pendingDrag.current
    if (!p) return

    if (!activeDragId.current) {
      const dx = Math.abs(e.clientX - p.x)
      const dy = Math.abs(e.clientY - p.y)
      if (e.pointerType === 'mouse') {
        if (dx > MOUSE_DRAG_THRESHOLD || dy > MOUSE_DRAG_THRESHOLD) beginDrag()
      } else if (dx > TOUCH_CANCEL_THRESHOLD || dy > TOUCH_CANCEL_THRESHOLD) {
        clearPendingDrag() // moved before the hold completed — that's a scroll, not a drag
      }
      return
    }
    setDragOverId(pinnedIds[targetIndexAt(e.clientY)] ?? null)
  }

  const endDrag = (commit: boolean) => {
    const id = activeDragId.current
    if (commit && id && dragOverId) {
      const from = pinnedIds.indexOf(id)
      const to = pinnedIds.indexOf(dragOverId)
      if (from !== -1 && to !== -1 && from !== to) {
        const reordered = [...pinnedIds]
        reordered.splice(from, 1)
        reordered.splice(to, 0, id)
        onReorderPinned(reordered)
      }
    }
    activeDragId.current = null
    clearPendingDrag()
    setDraggingId(null)
    setDragOverId(null)
  }

  // Two-step delete: first click arms the button (it stays highlighted even if the mouse moves
  // away), a second click on it confirms. It stays armed until then — the only thing that cancels
  // it is a click anywhere else. (pointerdown fires before the button's click; when the target is
  // the armed button itself we leave it alone so its own onClick can confirm.)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  useEffect(() => {
    if (confirmingDelete === null) return
    const onPointerDown = (e: PointerEvent) => {
      if (!armedDeleteRef.current?.contains(e.target as Node)) setConfirmingDelete(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [confirmingDelete])

  // After a keyboard-initiated delete, the trash button that had focus unmounts with its note,
  // dropping focus to <body> and killing arrow-key navigation. Once the list has re-rendered, move
  // focus to the note that slid into the deleted slot (or the new last note) so the user can keep
  // navigating up/down without reaching for the mouse.
  useEffect(() => {
    const deletedIndex = refocusAfterDeleteRef.current
    if (deletedIndex === null) return
    refocusAfterDeleteRef.current = null
    if (notes.length === 0) return
    itemRefs.current[Math.min(deletedIndex, notes.length - 1)]?.focus()
  }, [notes])

  // Move focus into the note list whenever the sidebar opens, so arrow keys work immediately.
  useEffect(() => {
    const justOpened = wasCollapsed.current && !collapsed
    wasCollapsed.current = collapsed
    if (!justOpened) return

    const targetIndex = Math.max(0, notes.findIndex(n => n.id === activeId))
    const timer = setTimeout(() => {
      // With no notes there's nothing in the list to land on, so focus the New-note button instead.
      if (notes.length === 0) createBtnRef.current?.focus()
      else itemRefs.current[targetIndex]?.focus()
    }, SIDEBAR_TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [collapsed, notes, activeId])

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = itemRefs.current.findIndex(el => el === document.activeElement)
    switch (e.key) {
      case 'ArrowDown':
        // The New-note button sits above the list as the top of the loop: past the last note,
        // ArrowDown wraps up to it rather than jumping straight back to the first note.
        e.preventDefault()
        if (currentIndex < notes.length - 1) itemRefs.current[currentIndex + 1]?.focus()
        else createBtnRef.current?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        if (currentIndex > 0) itemRefs.current[currentIndex - 1]?.focus()
        else createBtnRef.current?.focus()
        break
      case 'Home':
        e.preventDefault()
        itemRefs.current[0]?.focus()
        break
      case 'End':
        e.preventDefault()
        itemRefs.current[notes.length - 1]?.focus()
        break
      case 'Enter':
        if (currentIndex >= 0) {
          e.preventDefault()
          onOpen(notes[currentIndex].id)
        }
        break
      case 'n':
      case 'N':
        // Create a new note. Scoped to when a note item has focus (i.e. after Esc opens the
        // sidebar), so it never hijacks the letter typed in the editor or title. Guarded against
        // Ctrl/Cmd+N so the browser's own "new window" shortcut still works.
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          onCreate()
        }
        break
    }
  }

  // Arrow keys move between the New-note button and the list, so it's part of the same loop: down
  // enters at the first note, up wraps to the last. (Enter/Space still create, via the button.)
  const handleCreateKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      itemRefs.current[0]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      itemRefs.current[notes.length - 1]?.focus()
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src="/logo.svg" alt="htmlr" className="sidebar-logo" />
        </div>
        <div className="sidebar-header-actions">
          {/* Only where there's no folder to read from; the desktop header is left as it was. */}
          {platform.canImportFiles && (
            <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title="Import .html notes">
              <FileUp size={16} />
            </button>
          )}
          <button className="icon-btn" ref={createBtnRef} onClick={onCreate} onKeyDown={handleCreateKeyDown} title="New note">
            <Plus size={18} />
          </button>
          {/* On iOS this opens the Files app, which is how notes get onto (and off) the phone. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm,text/html"
            multiple
            hidden
            onChange={handleImport}
          />
        </div>
      </div>

      {importStatus && <div className="sidebar-import-status" role="status">{importStatus}</div>}

      <div className="note-list" role="listbox" aria-label="Notes" onKeyDown={handleListKeyDown}>
        {notes.length === 0 && (
          <div className="note-list-empty">No notes yet. Click + to create one.</div>
        )}
        {notes.map((note, index) => {
          // Notes arrive pinned-first; drop a divider at the boundary so pinned notes read as
          // a distinct group. Only shows when there are pinned notes AND unpinned ones below.
          const showPinnedDivider = !note.pinned && index > 0 && !!notes[index - 1].pinned
          const itemClass = [
            'note-item',
            note.pinned ? 'note-item--reorderable' : '',
            note.id === activeId ? 'note-item--active' : '',
            draggingId === note.id ? 'note-item--dragging' : '',
            // Not on the dragged row itself — an insertion line above the row you're holding just
            // reads as noise until you've actually moved somewhere.
            dragOverId === note.id && draggingId !== note.id ? 'note-item--drag-over' : '',
          ].filter(Boolean).join(' ')
          return (
            <Fragment key={note.id}>
              {showPinnedDivider && <div className="note-list-divider" role="separator" />}
              <div
                ref={el => { itemRefs.current[index] = el }}
                className={itemClass}
                onClick={() => {
                  if (suppressClick.current) { suppressClick.current = false; return }
                  onOpen(note.id)
                }}
                role="option"
                aria-selected={note.id === activeId}
                tabIndex={note.id === activeId ? 0 : -1}
                onPointerDown={e => onItemPointerDown(note, e)}
                onPointerMove={onItemPointerMove}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
              >
                <div className="note-item-main">
                  <FileText size={14} className="note-item-icon" />
                  <span className="note-item-title">{note.title || 'Untitled'}</span>
                  {note.pinned && <Pin size={11} className="note-item-pinned-badge" aria-label="Pinned" />}
                  {/* At-a-glance: which notes are public, and which have drifted from what's live.
                      The action buttons only appear on the active/focused row, so the badge is what
                      makes this readable across the whole list. */}
                  {note.publishedAt && (
                    <Globe
                      size={11}
                      className={`note-item-published-badge ${note.updatedAt !== note.publishedAt ? 'note-item-published-badge--stale' : ''}`}
                      aria-label={note.updatedAt !== note.publishedAt ? 'Published, with unpublished changes' : 'Published'}
                    />
                  )}
                </div>
                <div className="note-item-meta">
                  <span className="note-item-date">{formatDate(note.updatedAt)}</span>
                  <span className="note-item-actions">
                    {canPublish && (
                      <button
                        className={`icon-btn note-item-action ${note.publishedAt ? 'note-item-action--on' : ''}`}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); onTogglePublish(note.id) }}
                        title={note.publishedAt ? 'Unpublish' : 'Publish to your shared folder'}
                        aria-label={note.publishedAt ? 'Unpublish' : 'Publish'}
                      >
                        <Globe size={13} />
                      </button>
                    )}
                    <button
                      className="icon-btn note-item-action"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => {
                        e.stopPropagation()
                        onTogglePin(note.id)
                      }}
                      title={note.pinned ? 'Unpin' : 'Pin to top'}
                    >
                      {note.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                    <button
                      ref={confirmingDelete === note.id ? armedDeleteRef : undefined}
                      className={`icon-btn icon-btn--danger note-item-action ${confirmingDelete === note.id ? 'note-item-delete--armed' : ''}`}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => {
                        e.stopPropagation()
                        if (confirmingDelete === note.id) {
                          setConfirmingDelete(null)
                          // detail === 0 means the button was activated by keyboard (Enter/Space),
                          // not a mouse click — only then pull focus back into the list, so a mouse
                          // user's focus isn't yanked around.
                          if (e.detail === 0) refocusAfterDeleteRef.current = index
                          onDelete(note.id)
                        } else {
                          setConfirmingDelete(note.id)
                        }
                      }}
                      title={confirmingDelete === note.id ? 'Click again to delete' : 'Delete note'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>

      <button
        className="sidebar-footer"
        onClick={onChooseDirectory}
        title={isUsingFolder ? 'Change notes folder' : 'Connect a folder to store notes on your device'}
      >
        {isUsingFolder ? <FolderOpen size={13} /> : <HardDrive size={13} />}
        <span className="sidebar-footer-label">{isUsingFolder ? folderName : 'Browser storage'}</span>
      </button>
    </aside>
  )
}
