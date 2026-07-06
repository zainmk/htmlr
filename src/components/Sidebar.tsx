import { useEffect, useRef } from 'react'
import { Plus, FileText, Trash2, FolderOpen, HardDrive } from 'lucide-react'
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

export function Sidebar({ notes, activeId, folderName, isUsingFolder, collapsed, onOpen, onCreate, onDelete, onChooseDirectory }: Props) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const wasCollapsed = useRef(collapsed)

  // Move focus into the note list whenever the sidebar opens, so arrow keys work immediately.
  useEffect(() => {
    const justOpened = wasCollapsed.current && !collapsed
    wasCollapsed.current = collapsed
    if (!justOpened) return

    const targetIndex = Math.max(0, notes.findIndex(n => n.id === activeId))
    const timer = setTimeout(() => itemRefs.current[targetIndex]?.focus(), SIDEBAR_TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [collapsed, notes, activeId])

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = itemRefs.current.findIndex(el => el === document.activeElement)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        itemRefs.current[currentIndex < notes.length - 1 ? currentIndex + 1 : 0]?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        itemRefs.current[currentIndex > 0 ? currentIndex - 1 : notes.length - 1]?.focus()
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
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src="/logo.svg" alt="htmlr" className="sidebar-logo" />
        </div>
        <button className="icon-btn" onClick={onCreate} title="New note">
          <Plus size={18} />
        </button>
      </div>

      <div className="note-list" role="listbox" aria-label="Notes" onKeyDown={handleListKeyDown}>
        {notes.length === 0 && (
          <div className="note-list-empty">No notes yet. Click + to create one.</div>
        )}
        {notes.map((note, index) => (
          <div
            key={note.id}
            ref={el => { itemRefs.current[index] = el }}
            className={`note-item ${note.id === activeId ? 'note-item--active' : ''}`}
            onClick={() => onOpen(note.id)}
            role="option"
            aria-selected={note.id === activeId}
            tabIndex={note.id === activeId ? 0 : -1}
          >
            <div className="note-item-main">
              <FileText size={14} className="note-item-icon" />
              <span className="note-item-title">{note.title || 'Untitled'}</span>
            </div>
            <div className="note-item-meta">
              <span className="note-item-date">{formatDate(note.updatedAt)}</span>
              <button
                className="icon-btn icon-btn--danger note-item-delete"
                onClick={e => {
                  e.stopPropagation()
                  if (confirm(`Delete "${note.title || 'Untitled'}"?`)) onDelete(note.id)
                }}
                title="Delete note"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
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
