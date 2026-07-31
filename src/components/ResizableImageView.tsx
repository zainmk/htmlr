import { useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

// The image node's NodeView: the <img> plus a bottom-right handle you drag to resize. Resizing is
// previewed live via local state (no editor transactions), then committed once on release — so the
// undo history gets a single clean step rather than one entry per pixel.
export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation() // don't let ProseMirror start a node drag/selection from the handle
    const img = imgRef.current
    if (!img) return

    const startX = e.clientX
    const startW = img.offsetWidth
    // Don't let an image grow wider than the writing column.
    const maxW = (img.closest('.prose-editor') as HTMLElement | null)?.clientWidth ?? Infinity
    let latest = startW

    const onMove = (m: PointerEvent) => {
      latest = Math.round(Math.min(maxW, Math.max(48, startW + (m.clientX - startX))))
      setDragWidth(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      updateAttributes({ width: latest }) // single committing transaction
      setDragWidth(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const width = dragWidth ?? node.attrs.width ?? null

  return (
    <NodeViewWrapper
      as="span"
      className={`img-wrap ${selected ? 'is-selected' : ''} ${dragWidth != null ? 'is-resizing' : ''}`}
      style={width ? { width: `${width}px` } : undefined}
    >
      {/* data-drag-handle + draggable lets you drag the image to move it within the note; the resize
          handle below stops propagation so dragging *it* resizes instead of moving. */}
      <img ref={imgRef} src={node.attrs.src} alt={node.attrs.alt ?? ''} title={node.attrs.title ?? undefined} data-drag-handle draggable />
      <span className="img-resize-handle" onPointerDown={startResize} aria-hidden />
    </NodeViewWrapper>
  )
}
