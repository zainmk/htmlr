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

interface ToolbarBtn {
  icon: React.ReactNode
  title: string
  action: () => void
  isActive?: boolean
  disabled?: boolean
}

function Divider() {
  return <div className="toolbar-divider" />
}

function Btn({ icon, title, action, isActive, disabled }: ToolbarBtn) {
  return (
    <button
      className={`toolbar-btn ${isActive ? 'toolbar-btn--active' : ''}`}
      onClick={action}
      title={title}
      disabled={disabled}
      type="button"
    >
      {icon}
    </button>
  )
}

export function EditorToolbar({ editor, onOpenFile }: Props) {
  const setLink = () => {
    const prev = editor.getAttributes('link').href ?? ''
    const url = window.prompt('URL', prev)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().setLink({ href: url }).run()
    }
  }

  const sz = 15

  return (
    <div className="toolbar">
      <Btn icon={<Undo2 size={sz} />} title="Undo (Ctrl+Z)" action={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
      <Btn icon={<Redo2 size={sz} />} title="Redo (Ctrl+Y)" action={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />

      <Divider />

      <Btn icon={<Bold size={sz} />} title="Bold (Ctrl+B)" action={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} />
      <Btn icon={<Italic size={sz} />} title="Italic (Ctrl+I)" action={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} />
      <Btn icon={<Underline size={sz} />} title="Underline (Ctrl+U)" action={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} />
      <Btn icon={<Strikethrough size={sz} />} title="Strikethrough" action={() => editor.chain().focus().toggleStrike().run()} isActive={editor.isActive('strike')} />
      <Btn icon={<Highlighter size={sz} />} title="Highlight" action={() => editor.chain().focus().toggleHighlight().run()} isActive={editor.isActive('highlight')} />

      <Divider />

      <Btn icon={<Heading1 size={sz} />} title="Heading 1" action={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} isActive={editor.isActive('heading', { level: 1 })} />
      <Btn icon={<Heading2 size={sz} />} title="Heading 2" action={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} isActive={editor.isActive('heading', { level: 2 })} />
      <Btn icon={<Heading3 size={sz} />} title="Heading 3" action={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} isActive={editor.isActive('heading', { level: 3 })} />

      <Divider />

      <Btn icon={<List size={sz} />} title="Bullet list" action={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} />
      <Btn icon={<ListOrdered size={sz} />} title="Ordered list" action={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} />
      <Btn icon={<ListChecks size={sz} />} title="Task list" action={() => editor.chain().focus().toggleTaskList().run()} isActive={editor.isActive('taskList')} />

      <Divider />

      <Btn icon={<Code size={sz} />} title="Inline code" action={() => editor.chain().focus().toggleCode().run()} isActive={editor.isActive('code')} />
      <Btn icon={<CodeSquare size={sz} />} title="Code block" action={() => editor.chain().focus().toggleCodeBlock().run()} isActive={editor.isActive('codeBlock')} />
      <Btn icon={<Quote size={sz} />} title="Blockquote" action={() => editor.chain().focus().toggleBlockquote().run()} isActive={editor.isActive('blockquote')} />
      <Btn icon={<Minus size={sz} />} title="Horizontal rule" action={() => editor.chain().focus().setHorizontalRule().run()} />

      <Divider />

      <Btn icon={<AlignLeft size={sz} />} title="Align left" action={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })} />
      <Btn icon={<AlignCenter size={sz} />} title="Align center" action={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })} />
      <Btn icon={<AlignRight size={sz} />} title="Align right" action={() => editor.chain().focus().setTextAlign('right').run()} isActive={editor.isActive({ textAlign: 'right' })} />

      <Divider />

      <Btn
        icon={editor.isActive('link') ? <Link2Off size={sz} /> : <Link2 size={sz} />}
        title={editor.isActive('link') ? 'Remove link' : 'Add link'}
        action={setLink}
        isActive={editor.isActive('link')}
      />

      <div className="toolbar-spacer" />

      <Btn icon={<ExternalLink size={sz} />} title="Open saved .html file" action={onOpenFile} />
    </div>
  )
}
