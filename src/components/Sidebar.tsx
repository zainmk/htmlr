import { Fragment, useEffect, useRef, useState } from 'react'
import { Plus, FileText, Trash2, FolderOpen, HardDrive, Pin, PinOff } from 'lucide-react'
import type { NoteMetadata } from '../types'

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

export function Sidebar({ notes, activeId, folderName, isUsingFolder, collapsed, onOpen, onCreate, onDelete, onTogglePin, onReorderPinned, onChooseDirectory }: Props) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const createBtnRef = useRef<HTMLButtonElement | null>(null)
  const wasCollapsed = useRef(collapsed)
  const armedDeleteRef = useRef<HTMLButtonElement | null>(null)
  // Set to the deleted note's index by a keyboard-driven delete, consumed once the list re-renders
  // to move focus back into it (see the effect below).
  const refocusAfterDeleteRef = useRef<number | null>(null)

  // Drag-to-reorder, pinned notes only. Unpinned notes stay sorted by last-modified and aren't
  // draggable. `draggingId` is the note being dragged; `dragOverId` is the pinned note it's
  // currently hovering, used to draw an insertion indicator.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const commitReorder = (targetId: string) => {
    const pinnedIds = notes.filter(n => n.pinned).map(n => n.id)
    const from = pinnedIds.indexOf(draggingId ?? '')
    const to = pinnedIds.indexOf(targetId)
    if (from !== -1 && to !== -1 && from !== to) {
      const reordered = [...pinnedIds]
      reordered.splice(from, 1)
      reordered.splice(to, 0, pinnedIds[from])
      onReorderPinned(reordered)
    }
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
          <button className="icon-btn" ref={createBtnRef} onClick={onCreate} onKeyDown={handleCreateKeyDown} title="New note">
            <Plus size={18} />
          </button>
        </div>
      </div>

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
            note.id === activeId ? 'note-item--active' : '',
            draggingId === note.id ? 'note-item--dragging' : '',
            dragOverId === note.id ? 'note-item--drag-over' : '',
          ].filter(Boolean).join(' ')
          return (
            <Fragment key={note.id}>
              {showPinnedDivider && <div className="note-list-divider" role="separator" />}
              <div
                ref={el => { itemRefs.current[index] = el }}
                className={itemClass}
                onClick={() => onOpen(note.id)}
                role="option"
                aria-selected={note.id === activeId}
                tabIndex={note.id === activeId ? 0 : -1}
                draggable={note.pinned}
                onDragStart={note.pinned ? e => {
                  setDraggingId(note.id)
                  e.dataTransfer.effectAllowed = 'move'
                } : undefined}
                onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
                onDragOver={note.pinned ? e => {
                  if (draggingId && draggingId !== note.id) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDragOverId(note.id)
                  }
                } : undefined}
                onDragLeave={() => { if (dragOverId === note.id) setDragOverId(null) }}
                onDrop={note.pinned ? e => {
                  e.preventDefault()
                  commitReorder(note.id)
                } : undefined}
              >
                <div className="note-item-main">
                  <FileText size={14} className="note-item-icon" />
                  <span className="note-item-title">{note.title || 'Untitled'}</span>
                  {note.pinned && <Pin size={11} className="note-item-pinned-badge" aria-label="Pinned" />}
                </div>
                <div className="note-item-meta">
                  <span className="note-item-date">{formatDate(note.updatedAt)}</span>
                  <span className="note-item-actions">
                    <button
                      className="icon-btn note-item-action"
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
