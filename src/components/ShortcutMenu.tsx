import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { formatShortcut, shortcutFromEvent, isValidShortcut, type Shortcut } from './shortcuts'

interface Props {
  toolName: string
  description?: string
  x: number
  y: number
  shortcut: Shortcut | null // the effective binding (custom if set, else default)
  hasCustom: boolean
  hasDefault: boolean
  // Returns the name of the tool already using `s`, or null if free.
  findConflict: (s: Shortcut) => string | null
  onAssign: (s: Shortcut) => void
  onReset: () => void
  onClose: () => void
  // Hover-card plumbing: keep the popup alive while the pointer is over it, and pin it (opting out
  // of hover-dismiss) once the user actually interacts.
  onHoverEnter?: () => void
  onHoverLeave?: () => void
  onInteract?: () => void
  onExpand?: () => void
}

const MENU_W = 208

export function ShortcutMenu({ toolName, description, x, y, shortcut, hasCustom, hasDefault, findConflict, onAssign, onReset, onClose, onHoverEnter, onHoverLeave, onInteract, onExpand }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Close on click outside or Escape (Escape cancels recording first if it's active).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return // only a left-click outside dismisses; right-click is for expanding
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !recording) { e.preventDefault(); onClose() } }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [recording, onClose])

  // While recording, capture the next real key combo and validate it.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(false); return }
      const s = shortcutFromEvent(e)
      if (!s) return // a lone modifier — keep waiting for the actual key
      if (!isValidShortcut(s)) { setError('Include Ctrl or Alt.'); return }
      const conflict = findConflict(s)
      if (conflict) { setError(`In use by ${conflict}.`); return }
      onAssign(s)
      setRecording(false)
      setError(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [recording, findConflict, onAssign])

  const left = Math.min(x, window.innerWidth - MENU_W - 8)
  const top = Math.min(y, window.innerHeight - 120)

  return (
    <div
      ref={ref}
      className="shortcut-menu"
      style={{ left, top }}
      role="menu"
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      onPointerDown={onInteract}
      onContextMenu={e => { e.preventDefault(); onExpand?.() }}
    >
      <div className="shortcut-menu-header">
        <span className="shortcut-menu-title">{toolName}</span>
        {hasCustom && (
          <button
            className="shortcut-menu-reset-btn"
            onClick={() => { onReset(); setError(null) }}
            title={hasDefault ? 'Reset to default' : 'Clear shortcut'}
            aria-label={hasDefault ? 'Reset to default' : 'Clear shortcut'}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      {description && <p className="shortcut-menu-desc">{description}</p>}

      <button className="shortcut-menu-capture" onClick={() => { setError(null); setRecording(true) }}>
        {recording
          ? <span className="shortcut-menu-recording">Press keys…</span>
          : shortcut
            ? <kbd>{formatShortcut(shortcut)}</kbd>
            : <span className="shortcut-menu-none">Set shortcut</span>}
      </button>

      {error && <div className="shortcut-menu-error">{error}</div>}
    </div>
  )
}
