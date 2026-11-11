import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type UseEditorOptions } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import { EditorState } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import CharacterCount from '@tiptap/extension-character-count'
import { ResizableImage } from './ResizableImage'
import { EditorToolbar } from './EditorToolbar'
import { EmptyNotePlaceholder } from './EmptyNotePlaceholder'
import { StatusBar } from './StatusBar'
import { noteHtml } from './noteHtml'
import type { Store } from '../hooks/store'
import type { Note, SaveStatus } from '../types'

interface Props {
  note: Note
  /** Changes only when a different note is opened — never on save, rename, pin or reorder. */
  openToken: number
  saveStatus: Store<SaveStatus>
  titleConflict: boolean
  /** A folder is connected but can't be reached — the note lives only in the cache. */
  folderError: boolean
  /** Saved in the cache, and the folder has been catching up for a noticeable while (a slow or remote share). */
  folderSyncing: boolean
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
  EmptyNotePlaceholder.configure({ placeholder: 'Start writing…' }),
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

// Defined once, not inline: TipTap compares its options by reference on every render, and a fresh
// object here made it reapply all of them to the live editor each time the component re-rendered.
const editorProps: UseEditorOptions['editorProps'] = {
  attributes: { class: 'prose-editor' },
  handlePaste: handleImagePaste,
}

export function Editor({ note, openToken, saveStatus, titleConflict, folderError, folderSyncing, folderName, sidebarCollapsed, onTitleChange, onContentChange, onOpenFile, onRetrySave }: Props) {
  // Which note the editor's document currently holds. Tracked by openToken rather than by any
  // field of the note: note.id changes on rename (a rename isn't a note switch), and note.createdAt
  // is not unique — files copied into the folder without a data-htmlr-created attribute are all
  // stamped at parse time and can collide, which used to leave the previous note's body on screen.
  const lastNoteKey = useRef<number | null>(null)
  const wasSidebarCollapsed = useRef(sidebarCollapsed)
  // Only the first note's content: later ones are loaded by the swap below. Passing note.content
  // itself would count as a changed option after every save (see editorProps).
  const [initialContent] = useState(note.content)

  const editor = useEditor({
    extensions,
    content: initialContent,
    onUpdate: ({ editor }) => {
      // Hands up a *getter*, not the HTML, so converting the note happens once per save rather than
      // per keystroke — and noteHtml only converts the blocks edited since the last save.
      onContentChange(() => (editor.isDestroyed ? null : noteHtml(editor.state.doc)))
    },
    editorProps,
  })

  // Swap content when the active note changes
  useEffect(() => {
    if (!editor) return
    if (lastNoteKey.current !== openToken) {
      lastNoteKey.current = openToken
      editor.commands.setContent(note.content, { emitUpdate: false })
      // A note switch isn't an edit, so each note starts with an empty undo history. Otherwise the
      // first Ctrl+Z after switching brought the previous note's content back into this one — and
      // the next save wrote it over this note's file — while the history kept every note opened so
      // far in memory. A fresh state is how ProseMirror clears it; the empty transaction after it
      // lets the toolbar see there's nothing to undo (and, changing nothing, saves nothing).
      const { doc, plugins } = editor.state
      editor.view.updateState(EditorState.create({ doc, plugins }))
      editor.view.dispatch(editor.state.tr)
    }
  }, [editor, openToken, note.content])

  // Closing the sidebar (Esc, or the toggle button) hands focus back to the note body.
  useEffect(() => {
    const justClosed = !wasSidebarCollapsed.current && sidebarCollapsed
    wasSidebarCollapsed.current = sidebarCollapsed
    if (justClosed) editor?.commands.focus()
  }, [editor, sidebarCollapsed])

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

      {editor && (
        <StatusBar
          editor={editor}
          note={note}
          saveStatus={saveStatus}
          folderError={folderError}
          folderSyncing={folderSyncing}
          folderName={folderName}
          onRetrySave={onRetrySave}
        />
      )}
    </div>
  )
}
