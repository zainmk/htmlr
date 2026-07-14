import { useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough, Highlighter,
  Heading1, Heading2, Heading3,
  List, ListOrdered, ListChecks,
  Code, CodeSquare, Quote,
  AlignLeft, AlignCenter, AlignRight,
  Link2, Link2Off, Minus,
  Undo2, Redo2, ExternalLink, RotateCcw, Check,
} from 'lucide-react'
import { ShortcutMenu } from './ShortcutMenu'
import {
  DEFAULT_SHORTCUTS, matchesShortcut, shortcutsEqual,
  loadCustomShortcuts, saveCustomShortcuts, type Shortcut,
} from './shortcuts'

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
  label: string
  action: () => void
  isActive?: boolean
  disabled?: boolean
  rightAligned?: boolean
}

// Plain-language description of each tool, shown in the popup (on hover or right-click).
const TOOL_DESCRIPTIONS: Record<string, string> = {
  undo: 'Undo the last change.',
  redo: 'Redo the last undone change.',
  bold: 'Make the selected text bold.',
  italic: 'Italicize the selected text.',
  underline: 'Underline the selected text.',
  strike: 'Cross out the selected text.',
  highlight: 'Highlight the selected text.',
  h1: 'Turn the line into a large heading.',
  h2: 'Turn the line into a medium heading.',
  h3: 'Turn the line into a small heading.',
  bulletList: 'Start a bulleted list.',
  orderedList: 'Start a numbered list.',
  taskList: 'Start a checklist with tickable items.',
  code: 'Format the selection as inline code.',
  codeBlock: 'Insert a code block.',
  blockquote: 'Quote a block of text.',
  hr: 'Insert a horizontal divider line.',
  alignLeft: 'Align the text to the left.',
  alignCenter: 'Center the text.',
  alignRight: 'Align the text to the right.',
  link: 'Add, edit, or remove a link on the selection.',
  openFile: "Open this note's saved .html file in a new tab.",
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
  const [customShortcuts, setCustomShortcuts] = useState<Record<string, Shortcut>>(loadCustomShortcuts)
  // `expanded` popups (opened by right-click) also show the tool's description; hover popups stay condensed.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; expanded: boolean } | null>(null)
  const [pinned, setPinned] = useState(false)
  const [holding, setHolding] = useState(false)
  const [justReset, setJustReset] = useState(false)
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
  // The global key handler is bound once but needs the latest actions/custom shortcuts each render.
  const actionsRef = useRef<Record<string, () => void>>({})
  const customRef = useRef(customShortcuts)
  customRef.current = customShortcuts
  // Hover-card timers for the shortcut popup. `pinnedRef` mirrors `pinned` for use inside timers.
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    localStorage.setItem(QUICK_TOOLBAR_KEY, JSON.stringify(quickIds))
  }, [quickIds])

  useEffect(() => {
    saveCustomShortcuts(customShortcuts)
  }, [customShortcuts])

  // Fire toolbar shortcuts. Only while the note body is focused (mirrors TipTap's own shortcuts and
  // keeps title/sidebar typing untouched). Each tool has a single effective binding: a custom key
  // replaces the default. Runs in the capture phase, stopping propagation so ProseMirror never
  // double-handles a combo we own.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!editor.isFocused) return
      const customs = customRef.current
      // A tool's effective shortcut: its custom key, or — when uncustomized — a default TipTap
      // doesn't bind itself. (Uncustomized native defaults fall through to TipTap untouched.)
      for (const id of Object.keys(actionsRef.current)) {
        const custom = customs[id]
        if (custom) {
          if (matchesShortcut(e, custom)) { e.preventDefault(); e.stopPropagation(); actionsRef.current[id]() }
          else continue
          return
        }
        const def = DEFAULT_SHORTCUTS[id]
        if (def && !def.native && matchesShortcut(e, def.shortcut)) {
          e.preventDefault(); e.stopPropagation(); actionsRef.current[id]()
          return
        }
      }
      // A native default that a custom has replaced: swallow it so TipTap won't still fire the old
      // binding — the custom is now the only way to trigger this tool.
      for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
        if (def.native && customs[id] && matchesShortcut(e, def.shortcut)) {
          e.preventDefault(); e.stopPropagation()
          return
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [editor])

  const cancelOpen = () => { if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null } }
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }
  useEffect(() => () => {
    cancelOpen(); cancelClose()
    if (resetTimer.current) clearTimeout(resetTimer.current)
    if (resetToastTimer.current) clearTimeout(resetToastTimer.current)
    if (expandTimer.current) clearTimeout(expandTimer.current)
  }, [])

  // The master toolbar only expands after the pointer lingers on the bar a beat — a quick pass or a
  // reach for a quick-toolbar button doesn't fling it open. Collapsing on leave stays immediate.
  const HOVER_EXPAND_MS = 400
  const onShellEnter = () => {
    if (expandTimer.current) clearTimeout(expandTimer.current)
    expandTimer.current = setTimeout(() => setHover(true), HOVER_EXPAND_MS)
  }
  const onShellLeave = () => {
    if (expandTimer.current) { clearTimeout(expandTimer.current); expandTimer.current = null }
    setHover(false)
    cancelHold()
  }

  const openMenuAt = (id: string, el: HTMLElement, expanded: boolean) => {
    const rect = el.getBoundingClientRect()
    setMenu({ id, x: rect.left, y: rect.bottom + 6, expanded })
  }
  const closeMenu = () => { cancelOpen(); cancelClose(); pinnedRef.current = false; setPinned(false); setMenu(null) }
  const pinMenu = () => { pinnedRef.current = true; setPinned(true) }
  // Leave the popup open but hand it back to hover control — used after assign/reset so the change
  // stays on screen to confirm, then dismisses naturally once the pointer leaves.
  const unpinMenu = () => { pinnedRef.current = false; setPinned(false) }
  // Right-clicking the popup toggles it between condensed and expanded, in place (same instance, so
  // it animates rather than remounting). Expanding pins it; collapsing hands it back to hover.
  const expandMenu = () => {
    if (!menu) return
    if (menu.expanded) {
      unpinMenu()
      setMenu({ ...menu, expanded: false })
    } else {
      pinMenu()
      setMenu({ ...menu, expanded: true })
    }
  }

  // Hovering a tool opens its shortcut popup after a short intent delay; leaving it (and not moving
  // onto the popup) closes it. Once the user interacts with the popup it's pinned, so it stays put
  // while recording a key even if the pointer wanders off.
  const hoverOpenMenu = (id: string, el: HTMLElement) => {
    cancelClose()
    if (dragging) return
    // Already showing this tool (even pinned/expanded) — leave it be. Hovering a *different* tool
    // switches to it, dismissing whatever was open (including a pinned/expanded popup).
    if (menu && menu.id === id) return
    cancelOpen()
    openTimer.current = setTimeout(() => { unpinMenu(); openMenuAt(id, el, false) }, 140)
  }
  const hoverCloseMenu = () => {
    cancelOpen()
    if (pinnedRef.current) return
    cancelClose()
    closeTimer.current = setTimeout(() => { if (!pinnedRef.current) setMenu(null) }, 160)
  }

  // "Reset toolbar" is a press-and-hold: hold the button down and a fill climbs over RESET_HOLD_MS,
  // firing when it completes. Releasing (or leaving the button) early cancels — so a stray click
  // can't wipe the user's setup, without needing a separate confirm dialog.
  const RESET_HOLD_MS = 700
  const startHold = () => {
    setHolding(true)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(doReset, RESET_HOLD_MS)
  }
  const cancelHold = () => {
    if (resetTimer.current) { clearTimeout(resetTimer.current); resetTimer.current = null }
    setHolding(false)
  }
  const doReset = () => {
    resetTimer.current = null
    setHolding(false)
    setQuickIds([])
    setCustomShortcuts({})
    closeMenu()
    // Confirm it happened — the toolbar snapping back to defaults is otherwise easy to miss.
    setJustReset(true)
    if (resetToastTimer.current) clearTimeout(resetToastTimer.current)
    resetToastTimer.current = setTimeout(() => setJustReset(false), 1700)
  }

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
    { id: 'undo', group: 0, icon: <Undo2 size={sz} />, label: 'Undo', action: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
    { id: 'redo', group: 0, icon: <Redo2 size={sz} />, label: 'Redo', action: () => editor.chain().focus().redo().run(), disabled: !editor.can().redo() },

    { id: 'bold', group: 1, icon: <Bold size={sz} />, label: 'Bold', action: () => editor.chain().focus().toggleBold().run(), isActive: editor.isActive('bold') },
    { id: 'italic', group: 1, icon: <Italic size={sz} />, label: 'Italic', action: () => editor.chain().focus().toggleItalic().run(), isActive: editor.isActive('italic') },
    { id: 'underline', group: 1, icon: <Underline size={sz} />, label: 'Underline', action: () => editor.chain().focus().toggleUnderline().run(), isActive: editor.isActive('underline') },
    { id: 'strike', group: 1, icon: <Strikethrough size={sz} />, label: 'Strikethrough', action: () => editor.chain().focus().toggleStrike().run(), isActive: editor.isActive('strike') },
    { id: 'highlight', group: 1, icon: <Highlighter size={sz} />, label: 'Highlight', action: () => editor.chain().focus().toggleHighlight().run(), isActive: editor.isActive('highlight') },

    { id: 'h1', group: 2, icon: <Heading1 size={sz} />, label: 'Heading 1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: editor.isActive('heading', { level: 1 }) },
    { id: 'h2', group: 2, icon: <Heading2 size={sz} />, label: 'Heading 2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: editor.isActive('heading', { level: 2 }) },
    { id: 'h3', group: 2, icon: <Heading3 size={sz} />, label: 'Heading 3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: editor.isActive('heading', { level: 3 }) },

    { id: 'bulletList', group: 3, icon: <List size={sz} />, label: 'Bullet list', action: () => editor.chain().focus().toggleBulletList().run(), isActive: editor.isActive('bulletList') },
    { id: 'orderedList', group: 3, icon: <ListOrdered size={sz} />, label: 'Ordered list', action: () => editor.chain().focus().toggleOrderedList().run(), isActive: editor.isActive('orderedList') },
    { id: 'taskList', group: 3, icon: <ListChecks size={sz} />, label: 'Task list', action: () => editor.chain().focus().toggleTaskList().run(), isActive: editor.isActive('taskList') },

    { id: 'code', group: 4, icon: <Code size={sz} />, label: 'Inline code', action: () => editor.chain().focus().toggleCode().run(), isActive: editor.isActive('code') },
    { id: 'codeBlock', group: 4, icon: <CodeSquare size={sz} />, label: 'Code block', action: () => editor.chain().focus().toggleCodeBlock().run(), isActive: editor.isActive('codeBlock') },
    { id: 'blockquote', group: 4, icon: <Quote size={sz} />, label: 'Blockquote', action: () => editor.chain().focus().toggleBlockquote().run(), isActive: editor.isActive('blockquote') },
    { id: 'hr', group: 4, icon: <Minus size={sz} />, label: 'Horizontal rule', action: () => editor.chain().focus().setHorizontalRule().run() },

    { id: 'alignLeft', group: 5, icon: <AlignLeft size={sz} />, label: 'Align left', action: () => editor.chain().focus().setTextAlign('left').run(), isActive: editor.isActive({ textAlign: 'left' }) },
    { id: 'alignCenter', group: 5, icon: <AlignCenter size={sz} />, label: 'Align center', action: () => editor.chain().focus().setTextAlign('center').run(), isActive: editor.isActive({ textAlign: 'center' }) },
    { id: 'alignRight', group: 5, icon: <AlignRight size={sz} />, label: 'Align right', action: () => editor.chain().focus().setTextAlign('right').run(), isActive: editor.isActive({ textAlign: 'right' }) },

    {
      id: 'link', group: 6,
      icon: editor.isActive('link') ? <Link2Off size={sz} /> : <Link2 size={sz} />,
      label: editor.isActive('link') ? 'Remove link' : 'Add link',
      action: setLink, isActive: editor.isActive('link'),
    },

    { id: 'openFile', group: 7, icon: <ExternalLink size={sz} />, label: 'Open saved .html file', action: onOpenFile, rightAligned: true },
  ]
  const itemsById = new Map(items.map(item => [item.id, item]))
  actionsRef.current = Object.fromEntries(items.map(item => [item.id, item.action]))

  // The effective shortcut for a tool: its custom key if set, otherwise its default (if any).
  const effectiveShortcut = (id: string): Shortcut | null => customShortcuts[id] ?? DEFAULT_SHORTCUTS[id]?.shortcut ?? null

  // The name of the tool whose effective shortcut already equals `s`, or null if the combo is free.
  const findConflict = (s: Shortcut, forId: string): string | null => {
    for (const item of items) {
      if (item.id === forId) continue
      const eff = effectiveShortcut(item.id)
      if (eff && shortcutsEqual(eff, s)) return item.label
    }
    return null
  }

  const assignShortcut = (id: string, s: Shortcut) => setCustomShortcuts(prev => ({ ...prev, [id]: s }))
  const removeShortcut = (id: string) => setCustomShortcuts(prev => {
    const next = { ...prev }
    delete next[id]
    return next
  })

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
    closeMenu() // a customization drag shouldn't leave a shortcut popup hanging
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
  const active = hover || focusWithin || dragging || menu !== null
  const showMaster = quickIds.length === 0 || active
  const showQuick = quickIds.length > 0 || active
  const quickItems = quickIds.map(id => itemsById.get(id)).filter((i): i is ToolItem => i !== undefined)

  const renderBtn = (item: ToolItem, origin: DragSource['origin']) => (
    <button
      key={item.id}
      data-quick-id={origin === 'quick' ? item.id : undefined}
      className={`toolbar-btn ${item.isActive ? 'toolbar-btn--active' : ''}`}
      onClick={item.action}
      onMouseEnter={e => hoverOpenMenu(item.id, e.currentTarget)}
      onMouseLeave={hoverCloseMenu}
      onContextMenu={e => { e.preventDefault(); cancelOpen(); cancelClose(); pinMenu(); openMenuAt(item.id, e.currentTarget, true) }}
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

  const menuItem = menu ? itemsById.get(menu.id) : null

  return (
    <>
      <div
        className="toolbar-shell"
        onMouseEnter={onShellEnter}
        onMouseLeave={onShellLeave}
        onFocus={() => setFocusWithin(true)}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusWithin(false) }}
      >
        {showQuick && (
          <div
            className={`toolbar-row toolbar-row--quick ${dropActive ? 'toolbar-row--drop' : ''} ${hover ? 'toolbar-row--reset-gap' : ''}`}
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

        {/* Appears on hover, top-right. Requires a brief hover-to-arm before it will fire, so it
            can't be triggered by a careless click — it wipes every quick button and custom key. */}
        {hover && !dragging && (
          <button
            className={`toolbar-reset-btn ${holding ? 'toolbar-reset-btn--holding' : ''}`}
            onPointerDown={startHold}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
            title="Reset toolbar — press and hold"
            aria-label="Reset toolbar to defaults (press and hold)"
            type="button"
          >
            <RotateCcw size={13} />
          </button>
        )}

        {justReset && (
          <div className="toolbar-reset-toast" role="status">
            <Check size={12} />
            Toolbar reset
          </div>
        )}
      </div>

      {/* Rendered outside the shell: the shell's backdrop-filter would otherwise become the
          containing block for this fixed popup and throw off its viewport coordinates. */}
      {menu && menuItem && (
        <ShortcutMenu
          key={menu.id}
          toolName={menuItem.label}
          description={menu.expanded ? TOOL_DESCRIPTIONS[menu.id] : undefined}
          x={menu.x}
          y={menu.y}
          shortcut={effectiveShortcut(menu.id)}
          hasCustom={!!customShortcuts[menu.id]}
          hasDefault={!!DEFAULT_SHORTCUTS[menu.id]}
          findConflict={s => findConflict(s, menu.id)}
          onAssign={s => { assignShortcut(menu.id, s); unpinMenu() }}
          onReset={() => { removeShortcut(menu.id); unpinMenu() }}
          onClose={closeMenu}
          onHoverEnter={cancelClose}
          onHoverLeave={hoverCloseMenu}
          onInteract={pinMenu}
          onExpand={expandMenu}
        />
      )}
    </>
  )
}
