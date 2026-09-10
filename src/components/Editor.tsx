import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { ResizableImage } from './ResizableImage'
import { EditorToolbar } from './EditorToolbar'
import type { Note, SaveStatus } from '../types'

interface Props {
  note: Note
  /** Changes only when a different note is opened — never on save, rename, pin or reorder. */
  openToken: number
  saveStatus: SaveStatus
  titleConflict: boolean
  /** A folder is connected but the last write didn't reach it — the note lives only in the cache. */
  folderError: boolean
  folderName: string | null
  sidebarCollapsed: boolean
  onTitleChange: (title: string) => void
  /** Called with a getter rather than the content itself, so the caller decides when to pay for
   *  serialising the document. Returns null if the editor is gone — meaning "nothing to apply". */
  onContentChange: (getContent: () => string | null) => void
  onOpenFile: () => void
  onRetrySave: () => void
}

const extensions = [
  // StarterKit already bundles Link and Underline — configuring them here (rather than importing
  // them separately) avoids registering duplicate extensions.
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  // Inline so images flow with text — you can sit two side by side or put text beside one.
  ResizableImage.configure({ inline: true, allowBase64: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight,
  Placeholder.configure({ placeholder: 'Start writing…' }),
  CharacterCount,
]

// Embed pasted images as data URLs, in keeping with notes being self-contained HTML files.
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(reader.error))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function handleImagePaste(view: EditorView, event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items
  if (!items) return false
  const imageFiles = Array.from(items)
    .filter(item => item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  if (imageFiles.length === 0) return false

  event.preventDefault()
  for (const file of imageFiles) {
    readImageAsDataUrl(file).then(src => {
      if (view.isDestroyed) return
      const node = view.state.schema.nodes.image.create({ src, alt: file.name })
      // Images are inline, so this drops the image in at the cursor and leaves the cursor right
      // after it — pasting two in a row lands them side by side, and you can type beside them.
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
    })
  }
  return true
}

export function Editor({ note, openToken, saveStatus, titleConflict, folderError, folderName, sidebarCollapsed, onTitleChange, onContentChange, onOpenFile, onRetrySave }: Props) {
  // Which note the editor's document currently holds. Tracked by openToken rather than by any
  // field of the note: note.id changes on rename (a rename isn't a note switch), and note.createdAt
  // is not unique — files copied into the folder without a data-htmlr-created attribute are all
  // stamped at parse time and can collide, which used to leave the previous note's body on screen.
  const lastNoteKey = useRef<number | null>(null)
  const wasSidebarCollapsed = useRef(sidebarCollapsed)

  const editor = useEditor({
    extensions,
    content: note.content,
    onUpdate: ({ editor }) => {
      // Hands up a *getter*, not the HTML. Serialising the document is O(its size), and pasted
      // images sit in it as base64 — so doing it here would re-serialise megabytes on every
      // keystroke. The save is already debounced; this lets the serialisation be debounced with it.
      onContentChange(() => (editor.isDestroyed ? null : editor.getHTML()))
    },
    editorProps: {
      attributes: { class: 'prose-editor' },
      handlePaste: (view, event) => handleImagePaste(view, event),
    },
  })

  // Swap content when the active note changes
  useEffect(() => {
    if (!editor) return
    if (lastNoteKey.current !== openToken) {
      lastNoteKey.current = openToken
      editor.commands.setContent(note.content, { emitUpdate: false })
    }
  }, [editor, openToken, note.content])

  // Closing the sidebar (Esc, or the toggle button) hands focus back to the note body.
  useEffect(() => {
    const justClosed = !wasSidebarCollapsed.current && sidebarCollapsed
    wasSidebarCollapsed.current = sidebarCollapsed
    if (justClosed) editor?.commands.focus()
  }, [editor, sidebarCollapsed])

  const wordCount = editor?.storage.characterCount?.words() ?? 0
  const charCount = editor?.storage.characterCount?.characters() ?? 0

  // Three states, in priority order: an edit still in the debounce window, then a save that
  // reached the cache but not the folder, then a clean save. The middle one is the one that used
  // to be invisible — the write failed, was swallowed, and the bar still read "Saved".
  const status = saveStatus === 'unsaved'
    ? { kind: 'unsaved', label: 'Unsaved changes', title: "This edit hasn't been written yet." }
    : folderError
      ? {
          kind: 'folder-error',
          label: 'Saved in browser only',
          title: `htmlr couldn't write this note to ${folderName ?? 'your notes folder'}, so the file there is out of date. `
            + "The note is safe in this browser's storage. Check the folder is reachable, then retry.",
        }
      : { kind: 'saved', label: 'Saved', title: '' }

  return (
    <div className="editor-pane">
      {editor && (
        <div className="toolbar-dock">
          <EditorToolbar editor={editor} onOpenFile={onOpenFile} />
        </div>
      )}

      <div className="editor-title-row">
        <input
          className="editor-title"
          value={note.title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="Untitled"
          spellCheck={false}
        />
        {titleConflict && (
          <div className="editor-title-warning">
            Another note already has this name — kept under its previous name until you change it.
          </div>
        )}
      </div>

      <div className="editor-scroll">
        <EditorContent editor={editor} className="editor-content" />
      </div>

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
        <span className="status-bar-counts">
          {wordCount} word{wordCount !== 1 ? 's' : ''} · {charCount} char{charCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
