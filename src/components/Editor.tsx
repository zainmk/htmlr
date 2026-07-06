import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { EditorToolbar } from './EditorToolbar'
import type { Note, SaveStatus } from '../types'

interface Props {
  note: Note
  saveStatus: SaveStatus
  titleConflict: boolean
  sidebarCollapsed: boolean
  onTitleChange: (title: string) => void
  onContentChange: (content: string) => void
  onOpenFile: () => void
}

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
  }),
  Image.configure({ allowBase64: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Underline,
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
      const tr = view.state.tr.replaceSelectionWith(node)
      // replaceSelectionWith leaves the image node-selected, so typing right after a paste
      // would replace it. Land a real text cursor after the image instead: if the image is
      // now the last thing in the doc, give it a paragraph to type into; otherwise step into
      // whatever paragraph already follows.
      let afterImage = tr.selection.to
      if (afterImage === tr.doc.content.size) {
        tr.insert(afterImage, view.state.schema.nodes.paragraph.create())
      }
      afterImage += 1
      tr.setSelection(TextSelection.near(tr.doc.resolve(afterImage)))
      view.dispatch(tr)
    })
  }
  return true
}

export function Editor({ note, saveStatus, titleConflict, sidebarCollapsed, onTitleChange, onContentChange, onOpenFile }: Props) {
  // Identifies a note across renames — unlike note.id (now the slugified title), this never
  // changes, so a successful rename doesn't get mistaken for switching to a different note.
  const lastNoteKey = useRef<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const wasSidebarCollapsed = useRef(sidebarCollapsed)

  const editor = useEditor({
    extensions,
    content: note.content,
    onUpdate: ({ editor }) => {
      onContentChange(editor.getHTML())
    },
    editorProps: {
      attributes: { class: 'prose-editor' },
      handlePaste: (view, event) => handleImagePaste(view, event),
    },
  })

  // Swap content when active note changes
  useEffect(() => {
    if (!editor) return
    if (lastNoteKey.current !== note.createdAt) {
      lastNoteKey.current = note.createdAt
      editor.commands.setContent(note.content, { emitUpdate: false })
    }
  }, [editor, note.createdAt, note.content])

  // Closing the sidebar (Esc, or the toggle button) hands focus back to the note body.
  useEffect(() => {
    const justClosed = !wasSidebarCollapsed.current && sidebarCollapsed
    wasSidebarCollapsed.current = sidebarCollapsed
    if (justClosed) editor?.commands.focus()
  }, [editor, sidebarCollapsed])

  const wordCount = editor?.storage.characterCount?.words() ?? 0
  const charCount = editor?.storage.characterCount?.characters() ?? 0

  const statusLabel =
    saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Unsaved changes'

  return (
    <div className="editor-pane">
      {editor && <EditorToolbar editor={editor} onOpenFile={onOpenFile} />}

      <div className="editor-title-row">
        <input
          ref={titleRef}
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
        <span className={`save-status save-status--${saveStatus}`}>{statusLabel}</span>
        <span className="status-bar-counts">
          {wordCount} word{wordCount !== 1 ? 's' : ''} · {charCount} char{charCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
