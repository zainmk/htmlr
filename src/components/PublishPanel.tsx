import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Globe, RefreshCw, Trash2 } from 'lucide-react'
import { filenameFor } from '../storage/noteFile'

interface Props {
  x: number
  y: number
  noteId: string
  /** The `updatedAt` of the version currently live. Always set — the panel only opens when published. */
  publishedAt: string
  /** The note's current `updatedAt`. Differs from publishedAt exactly when the live copy is behind. */
  updatedAt: string
  baseUrl: string
  onSaveBaseUrl: (url: string) => void
  onUpdate: () => void
  onUnpublish: () => void
  onClose: () => void
}

const PANEL_W = 300

/** Joins the configured base with the note's filename, tolerating a missing or doubled slash. */
function publicUrl(baseUrl: string, noteId: string): string {
  return baseUrl.replace(/\/+$/, '') + '/' + filenameFor(noteId)
}

export function PublishPanel({ x, y, noteId, publishedAt, updatedAt, baseUrl, onSaveBaseUrl, onUpdate, onUnpublish, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [copied, setCopied] = useState(false)
  const [baseDraft, setBaseDraft] = useState(baseUrl)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isStale = updatedAt !== publishedAt

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  // Same dismissal contract as the shortcut card: press outside, or Escape. Capture phase and
  // stopPropagation so Escape doesn't also collapse the sidebar behind the panel.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl(baseUrl, noteId))
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard blocked (insecure context, permission) — the URL is on screen to copy by hand
    }
  }

  const left = Math.max(8, Math.min(x, window.innerWidth - PANEL_W - 8))
  const top = Math.min(y, window.innerHeight - 200)

  return (
    <div ref={ref} className="publish-panel" style={{ left, top }} role="dialog" aria-label="Publishing">
      <div className="publish-panel-header">
        <Globe size={13} />
        <span>{isStale ? 'Published — live copy is behind' : 'Published'}</span>
      </div>

      {baseUrl ? (
        <div className="publish-panel-url">
          <span className="publish-panel-url-text" title={publicUrl(baseUrl, noteId)}>
            {publicUrl(baseUrl, noteId)}
          </span>
          <button className="publish-panel-copy" onClick={copy} title="Copy link" aria-label="Copy link" type="button">
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      ) : (
        <div className="publish-panel-setup">
          <p className="publish-panel-hint">
            Where is your shared folder served from? Set it once and htmlr can show you the link.
          </p>
          <input
            className="publish-panel-input"
            value={baseDraft}
            onChange={e => setBaseDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveBaseUrl(baseDraft) }}
            placeholder="https://notes.example.com/"
            spellCheck={false}
            autoFocus
          />
          <button className="publish-panel-btn" onClick={() => onSaveBaseUrl(baseDraft)} type="button">
            Save
          </button>
        </div>
      )}

      {isStale && (
        <p className="publish-panel-hint">
          This note has changed since it was published. The live copy stays as it was until you update it.
        </p>
      )}

      <div className="publish-panel-actions">
        <button
          className={`publish-panel-btn ${isStale ? 'publish-panel-btn--primary' : ''}`}
          onClick={onUpdate}
          type="button"
        >
          <RefreshCw size={12} />
          {isStale ? 'Update published version' : 'Republish'}
        </button>
        <button className="publish-panel-btn publish-panel-btn--danger" onClick={onUnpublish} type="button">
          <Trash2 size={12} />
          Unpublish
        </button>
      </div>

      <p className="publish-panel-note">
        Anyone with the link can read this note. Renaming it changes the link.
      </p>
    </div>
  )
}
