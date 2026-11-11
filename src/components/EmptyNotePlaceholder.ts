import { Extension } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** "Start writing…" in an empty note, and nothing else.
 *
 *  Stands in for TipTap's Placeholder extension, which also follows which part of the note is on
 *  screen — measuring the page layout after nearly every keystroke, about a fifth of the main
 *  thread's time while typing in a long note — to support placeholders on empty lines anywhere in a
 *  note, which this app never shows. Marks the first paragraph the same way it did
 *  (`is-editor-empty` + `data-placeholder`), so the existing styles apply unchanged. */
export const EmptyNotePlaceholder = Extension.create<{ placeholder: string }>({
  name: 'emptyNotePlaceholder',

  addOptions() {
    return { placeholder: '' }
  },

  addProseMirrorPlugins() {
    const { placeholder } = this.options
    return [
      new Plugin({
        props: {
          decorations: ({ doc }) => {
            const first = doc.firstChild
            if (doc.childCount !== 1 || !first?.isTextblock || first.content.size > 0) return null
            return DecorationSet.create(doc, [
              Decoration.node(0, first.nodeSize, { class: 'is-editor-empty', 'data-placeholder': placeholder }),
            ])
          },
        },
      }),
    ]
  },
})
