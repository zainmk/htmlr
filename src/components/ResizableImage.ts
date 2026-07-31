import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ResizableImageView } from './ResizableImageView'

// Extends the stock image node with a `width` attribute (serialized as `<img width="…">`, so the
// chosen size persists into the saved .html and renders anywhere) and a NodeView with a drag handle.
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: attrs => (attrs.width ? { width: attrs.width } : {}),
        parseHTML: el => {
          const n = parseInt(el.getAttribute('width') ?? '', 10)
          return Number.isNaN(n) ? null : n
        },
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
