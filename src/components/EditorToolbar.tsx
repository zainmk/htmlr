import { useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough, Highlighter,
  Heading1, Heading2, Heading3,
  List, ListOrdered, ListChecks,
  Code, CodeSquare, Quote,
  AlignLeft, AlignCenter, AlignRight,
  Link2, Link2Off, Minus,
  Undo2, Redo2, ExternalLink,
} from 'lucide-react'

interface Props {
  editor: Editor
  onOpenFile: () => void
}

// A single toolbar button. `group` drives where dividers fall in the master toolbar; `rightAligned`
// marks the one button (open-file) that sits after a spacer, pushed to the far edge.
interface ToolItem {
  id: string
  group: number
  icon: React.ReactNode
  title: string
  action: () => void
  isActive?: boolean
  disabled?: boolean
  rightAligned?: boolean
}

// The quick toolbar is a per-device customization, not per-note — one set of favorites for the app.
const QUICK_TOOLBAR_KEY = 'htmlr_quick_toolbar'

function loadQuickIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUICK_TOOLBAR_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// Where a drag started, so a drop (or a drop that misses) knows whether it's adding a master button
// to the quick toolbar, reordering within it, or pulling a quick button back out.
type DragSource = { origin: 'master' | 'quick'; id: string }

// The gap the pointer is closest to among the quick buttons — the index a drop would land at.
function insertIndexAt(rowEl: HTMLElement, clientX: number): number {
  const btns = Array.from(rowEl.querySelectorAll<HTMLElement>('[data-quick-id]'))
  for (let i = 0; i < btns.length; i++) {
    const r = btns[i].getBoundingClientRect()
    if (clientX < r.left + r.width / 2) return i
  }
  return btns.length
}

export function EditorToolbar({ editor, onOpenFile }: Props) {
  const [quickIds, setQuickIds] = useState<string[]>(loadQuickIds)
  const [hover, setHover] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  // Which gap in the quick row a drop would land at right now, for the insertion indicator.
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const dragRef = useRef<DragSource | null>(null)
  // Set true the moment a drag is dropped onto the quick row, read in dragEnd to tell a real removal
  // (quick button dragged out into the void) apart from a drag that landed back inside.
  const droppedInQuick = useRef(false)

  useEffect(() => {
    localStorage.setItem(QUICK_TOOLBAR_KEY, JSON.stringify(quickIds))
  }, [quickIds])

  const setLink = () => {
    const prev = editor.getAttributes('link').href ?? ''
    const url = window.prompt('URL', prev)
    if (url === null) return
    if (url === '') editor.chain().focus().unsetLink().run()
    else editor.chain().focus().setLink({ href: url }).run()
  }

  const sz = 15
  // Rebuilt every render so isActive/disabled always reflect the current selection.
  const items: ToolItem[] = [
    { id: 'undo', group: 0, icon: <Undo2 size={sz} />, title: 'Undo (Ctrl+Z)', action: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
    { id: 'redo', group: 0, icon: <Redo2 size={sz} />, title: 'Redo (Ctrl+Y)', action: () => editor.chain().focus().redo().run(), disabled: !editor.can().redo() },

    { id: 'bold', group: 1, icon: <Bold size={sz} />, title: 'Bold (Ctrl+B)', action: () => editor.chain().focus().toggleBold().run(), isActive: editor.isActive('bold') },
    { id: 'italic', group: 1, icon: <Italic size={sz} />, title: 'Italic (Ctrl+I)', action: () => editor.chain().focus().toggleItalic().run(), isActive: editor.isActive('italic') },
    { id: 'underline', group: 1, icon: <Underline size={sz} />, title: 'Underline (Ctrl+U)', action: () => editor.chain().focus().toggleUnderline().run(), isActive: editor.isActive('underline') },
    { id: 'strike', group: 1, icon: <Strikethrough size={sz} />, title: 'Strikethrough', action: () => editor.chain().focus().toggleStrike().run(), isActive: editor.isActive('strike') },
    { id: 'highlight', group: 1, icon: <Highlighter size={sz} />, title: 'Highlight', action: () => editor.chain().focus().toggleHighlight().run(), isActive: editor.isActive('highlight') },

    { id: 'h1', group: 2, icon: <Heading1 size={sz} />, title: 'Heading 1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: editor.isActive('heading', { level: 1 }) },
    { id: 'h2', group: 2, icon: <Heading2 size={sz} />, title: 'Heading 2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: editor.isActive('heading', { level: 2 }) },
    { id: 'h3', group: 2, icon: <Heading3 size={sz} />, title: 'Heading 3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: editor.isActive('heading', { level: 3 }) },

    { id: 'bulletList', group: 3, icon: <List size={sz} />, title: 'Bullet list', action: () => editor.chain().focus().toggleBulletList().run(), isActive: editor.isActive('bulletList') },
    { id: 'orderedList', group: 3, icon: <ListOrdered size={sz} />, title: 'Ordered list', action: () => editor.chain().focus().toggleOrderedList().run(), isActive: editor.isActive('orderedList') },
    { id: 'taskList', group: 3, icon: <ListChecks size={sz} />, title: 'Task list', action: () => editor.chain().focus().toggleTaskList().run(), isActive: editor.isActive('taskList') },

    { id: 'code', group: 4, icon: <Code size={sz} />, title: 'Inline code', action: () => editor.chain().focus().toggleCode().run(), isActive: editor.isActive('code') },
    { id: 'codeBlock', group: 4, icon: <CodeSquare size={sz} />, title: 'Code block', action: () => editor.chain().focus().toggleCodeBlock().run(), isActive: editor.isActive('codeBlock') },
    { id: 'blockquote', group: 4, icon: <Quote size={sz} />, title: 'Blockquote', action: () => editor.chain().focus().toggleBlockquote().run(), isActive: editor.isActive('blockquote') },
    { id: 'hr', group: 4, icon: <Minus size={sz} />, title: 'Horizontal rule', action: () => editor.chain().focus().setHorizontalRule().run() },

    { id: 'alignLeft', group: 5, icon: <AlignLeft size={sz} />, title: 'Align left', action: () => editor.chain().focus().setTextAlign('left').run(), isActive: editor.isActive({ textAlign: 'left' }) },
    { id: 'alignCenter', group: 5, icon: <AlignCenter size={sz} />, title: 'Align center', action: () => editor.chain().focus().setTextAlign('center').run(), isActive: editor.isActive({ textAlign: 'center' }) },
    { id: 'alignRight', group: 5, icon: <AlignRight size={sz} />, title: 'Align right', action: () => editor.chain().focus().setTextAlign('right').run(), isActive: editor.isActive({ textAlign: 'right' }) },

    {
      id: 'link', group: 6,
      icon: editor.isActive('link') ? <Link2Off size={sz} /> : <Link2 size={sz} />,
      title: editor.isActive('link') ? 'Remove link' : 'Add link',
      action: setLink, isActive: editor.isActive('link'),
    },

    { id: 'openFile', group: 7, icon: <ExternalLink size={sz} />, title: 'Open saved .html file', action: onOpenFile, rightAligned: true },
  ]
  const itemsById = new Map(items.map(item => [item.id, item]))

  const removeFromQuick = (id: string) => setQuickIds(prev => prev.filter(x => x !== id))

  // Places `id` at `insertIndex` (measured against the current row, which still includes a dragged
  // item). Works for both adding a fresh master button and reordering one already in the quick row.
  const placeInQuick = (id: string, insertIndex: number) =>
    setQuickIds(prev => {
      const from = prev.indexOf(id)
      const list = prev.filter(x => x !== id)
      let idx = from !== -1 && from < insertIndex ? insertIndex - 1 : insertIndex
      idx = Math.max(0, Math.min(idx, list.length))
      return [...list.slice(0, idx), id, ...list.slice(idx)]
    })

  const onDragStart = (e: React.DragEvent, source: DragSource) => {
    dragRef.current = source
    droppedInQuick.current = false
    setDragging(true)
    e.dataTransfer.effectAllowed = source.origin === 'master' ? 'copy' : 'move'
    e.dataTransfer.setData('text/plain', source.id) // required for the drag to fire in Firefox
  }

  const onDragEnd = () => {
    // A quick button dragged out and released anywhere but the quick row is a removal.
    const source = dragRef.current
    if (source?.origin === 'quick' && !droppedInQuick.current) removeFromQuick(source.id)
    dragRef.current = null
    setDragging(false)
    setDropActive(false)
    setDropIndex(null)
  }

  const onQuickDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    e.preventDefault() // allow the drop
    e.dataTransfer.dropEffect = dragRef.current.origin === 'master' ? 'copy' : 'move'
    setDropActive(true)
    setDropIndex(insertIndexAt(e.currentTarget, e.clientX))
  }

  const onQuickDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Ignore leave events fired while moving between buttons inside the row.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDropActive(false)
    setDropIndex(null)
  }

  const onQuickDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    droppedInQuick.current = true
    const source = dragRef.current
    if (source) placeInQuick(source.id, insertIndexAt(e.currentTarget, e.clientX))
    setDropActive(false)
    setDropIndex(null)
  }

  // The master toolbar always shows when nothing's been favorited yet (nothing else to fall back to)
  // or while the bar is engaged; the quick toolbar shows once it has items, or while engaged so it
  // can be dropped into. "Engaged" = hovered, keyboard-focused, or mid-drag.
  const active = hover || focusWithin || dragging
  const showMaster = quickIds.length === 0 || active
  const showQuick = quickIds.length > 0 || active
  const quickItems = quickIds.map(id => itemsById.get(id)).filter((i): i is ToolItem => i !== undefined)

  const renderBtn = (item: ToolItem, origin: DragSource['origin']) => (
    <button
      key={item.id}
      data-quick-id={origin === 'quick' ? item.id : undefined}
      className={`toolbar-btn ${item.isActive ? 'toolbar-btn--active' : ''}`}
      onClick={item.action}
      title={item.title}
      disabled={item.disabled}
      type="button"
      draggable={!item.disabled}
      onDragStart={e => onDragStart(e, { origin, id: item.id })}
      onDragEnd={onDragEnd}
    >
      {item.icon}
    </button>
  )

  const insertMarker = (key: string) => <span key={key} className="toolbar-quick-insert" aria-hidden />

  // Quick row content: the favorited buttons with an insertion bar at the current drop gap.
  const quickChildren: React.ReactNode[] = []
  quickItems.forEach((item, i) => {
    if (dropIndex === i) quickChildren.push(insertMarker(`ins-${i}`))
    quickChildren.push(renderBtn(item, 'quick'))
  })
  if (dropIndex === quickItems.length) quickChildren.push(insertMarker('ins-end'))

  // Master row content: every button, with group dividers and a spacer before the right-aligned one.
  const masterNodes: React.ReactNode[] = []
  let prevGroup: number | null = null
  for (const item of items) {
    if (item.rightAligned) masterNodes.push(<div className="toolbar-spacer" key={`spacer-${item.id}`} />)
    else if (prevGroup !== null && item.group !== prevGroup) masterNodes.push(<div className="toolbar-divider" key={`div-${item.id}`} />)
    prevGroup = item.group
    masterNodes.push(renderBtn(item, 'master'))
  }

  return (
    <div
      className="toolbar-shell"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusWithin(false) }}
    >
      {showQuick && (
        <div
          className={`toolbar-row toolbar-row--quick ${dropActive ? 'toolbar-row--drop' : ''}`}
          onDragOver={onQuickDragOver}
          onDragLeave={onQuickDragLeave}
          onDrop={onQuickDrop}
          aria-label="Quick access toolbar"
        >
          {quickItems.length === 0 && !dragging
            ? <span className="toolbar-quick-hint">Drag tools here for quick access</span>
            : quickChildren}
        </div>
      )}

      {showQuick && showMaster && <div className="toolbar-quick-divider" />}

      {showMaster && <div className="toolbar-row toolbar-row--master">{masterNodes}</div>}
    </div>
  )
}
