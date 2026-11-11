import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { useStore, type Store } from '../hooks/store'
import { noteHtmlBytes } from './noteHtml'
import { noteFileBytes } from '../storage/noteFile'
import type { Note, SaveStatus } from '../types'

interface Props {
  editor: Editor
  note: Note
  /** Read here rather than passed down as a value, so the flip to "unsaved" on the first keystroke
   *  after each save re-renders just this bar — not the editor and toolbar along with it. */
  saveStatus: Store<SaveStatus>
  /** The folder can't be reached — the note lives only in the cache. */
  folderError: boolean
  /** Saved in the cache, and the folder has been catching up for a noticeable while (a slow or remote share). */
  folderSyncing: boolean
  folderName: string | null
  onRetrySave: () => void
}

/** How long typing has to pause before the counts and size are brought up to date. */
const MEASURE_DELAY_MS = 300
/** From here up, the size is shown as a caution. Measured: on a slow laptop each save starts to
 *  stall typing for a moment and the note takes a couple of seconds to open — and every save sends
 *  the whole file, around 7 s of upload per save to a folder reached at 1.5 MB/s. */
const LARGE_NOTE_BYTES = 10 * 1024 * 1024
/** From here up, as a warning: on a slow laptop saves stall typing for a noticeable moment and
 *  opening takes several seconds, and at 1.5 MB/s each save takes upwards of 15 s to upload. */
const VERY_LARGE_NOTE_BYTES = 25 * 1024 * 1024

interface Measured {
  words: number
  chars: number
  /** Size of the note's .html file. */
  bytes: number
}

function measure(editor: Editor, note: Note): Measured {
  const counter = editor.storage.characterCount
  return { words: counter.words(), chars: counter.characters(), bytes: noteFileBytes(note, noteHtmlBytes(editor.state.doc)) }
}

// Binary units, as Windows Explorer shows file sizes, so the two agree.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const StatusBar = memo(function StatusBar({ editor, note, saveStatus, folderError, folderSyncing, folderName, onRetrySave }: Props) {
  const save = useStore(saveStatus)
  const [measured, setMeasured] = useState<Measured | null>(null)

  // Counts and size trail typing slightly: worked out once it pauses, never per keystroke. Reads the
  // latest editor and note when it runs — a note switch's new content arrives after this renders.
  const latest = useRef({ editor, note })
  latest.current = { editor, note }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleMeasure = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const { editor, note } = latest.current
      if (!editor.isDestroyed) setMeasured(measure(editor, note))
    }, MEASURE_DELAY_MS)
  }, [])
  useEffect(() => {
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) scheduleMeasure()
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [editor, scheduleMeasure])
  // The title is written into the file too, so it counts toward the size. Also takes the first measurement.
  useEffect(scheduleMeasure, [scheduleMeasure, note.title, note.pinned, note.pinnedOrder])

  // Four states, in priority order: an edit still in the debounce window, then a save that reached
  // the cache but couldn't reach the folder, then one the folder is still catching up on, then a
  // clean save. The folder error is the one that used to be invisible — the write failed, was
  // swallowed, and the bar still read "Saved".
  const folderLabel = folderName ?? 'your notes folder'
  const status = save === 'unsaved'
    ? { kind: 'unsaved', label: 'Unsaved changes', title: "This edit hasn't been written yet." }
    : folderError
      ? {
          kind: 'folder-error',
          label: 'Saved in browser only',
          title: `htmlr can't reach ${folderLabel} right now, so the files there may be out of date. `
            + "Your notes are safe in this browser's storage, and htmlr keeps retrying. Check the folder is reachable, or retry now.",
        }
      : folderSyncing
        ? {
            kind: 'syncing',
            label: 'Saving to folder…',
            title: `Saved in this browser; still writing to ${folderLabel}. A remote folder can take a while. `
              + 'Closing htmlr now is safe — it finishes the next time it opens.',
          }
        : { kind: 'saved', label: 'Saved', title: '' }

  const size = measured === null ? null
    : measured.bytes >= VERY_LARGE_NOTE_BYTES ? 'very-large'
      : measured.bytes >= LARGE_NOTE_BYTES ? 'large'
        : null

  return (
    <div className="status-bar">
      <span className="status-bar-save">
        <span className={`save-status save-status--${status.kind}`} title={status.title || undefined}>
          {status.kind === 'folder-error' && <AlertTriangle size={11} />}
          {status.label}
        </span>
        {status.kind === 'folder-error' && (
          <button className="save-status-retry" onClick={onRetrySave} type="button">
            Retry
          </button>
        )}
      </span>
      {measured && (
        <span className="status-bar-counts">
          {measured.words} word{measured.words !== 1 ? 's' : ''} · {measured.chars} char{measured.chars !== 1 ? 's' : ''} ·{' '}
          <span
            className={size ? `status-bar-size status-bar-size--${size}` : 'status-bar-size'}
            title={size
              ? `This note's .html file is ${measured.bytes.toLocaleString()} bytes — ${size === 'very-large' ? 'very ' : ''}large, `
                + 'almost certainly from pasted images. Every save rewrites the whole file, so a remote folder takes a while to receive '
                + 'each one, and the note is slower to open and to save, especially on a slower device. Splitting it up, or using '
                + 'smaller screenshots, keeps it quick.'
              : `This note's .html file: ${measured.bytes.toLocaleString()} bytes`}
          >
            {formatBytes(measured.bytes)}
          </span>
        </span>
      )}
    </div>
  )
})
