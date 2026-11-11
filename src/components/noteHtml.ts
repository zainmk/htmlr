import { DOMSerializer, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'

/** Turns the note into HTML for saving, converting only what changed since the last save.
 *
 *  TipTap's getHTML() rebuilds the HTML of the entire note on every call, and pasted screenshots sit
 *  in the note as base64 — so in an image-heavy note each save spent most of its time re-encoding
 *  images nobody had touched, long enough to stall the first keystrokes after a pause. But
 *  ProseMirror never edits a document in place: each change produces a new document that reuses
 *  every block it didn't touch as the very same object. So a block's HTML can be kept, keyed by the
 *  block itself, for as long as that block exists, and a save only converts the blocks that are new.
 *  Images get the same treatment one level down: they're inline, so typing beside one makes a new
 *  paragraph, but the image inside it is still the same node.
 *
 *  The output is identical to getHTML(), which is simply every top-level block's HTML, joined. */

interface Serializers {
  plain: DOMSerializer
  /** Like `plain`, but writes a placeholder for each image, swapped for its cached HTML afterwards. */
  slotted: DOMSerializer
  /** The images the last slotted conversion met, in placeholder order. */
  slots: ProseMirrorNode[]
}

interface Converted {
  html: string
  /** UTF-8 size of `html` — what it adds to the file on disk. */
  bytes: number
}

const serializersBySchema = new WeakMap<Schema, Serializers>()
const blocks = new WeakMap<ProseMirrorNode, Converted>()
const images = new WeakMap<ProseMirrorNode, Converted>()
const SLOT = /<img data-htmlr-slot="(\d+)">/g
const encoder = new TextEncoder()
const utf8Bytes = (s: string) => encoder.encode(s).byteLength

function serializersFor(schema: Schema): Serializers {
  let found = serializersBySchema.get(schema)
  if (!found) {
    const plain = DOMSerializer.fromSchema(schema)
    const slots: ProseMirrorNode[] = []
    const slotted = new DOMSerializer({
      ...plain.nodes,
      image: node => {
        slots.push(node)
        return ['img', { 'data-htmlr-slot': String(slots.length - 1) }]
      },
    }, plain.marks)
    found = { plain, slotted, slots }
    serializersBySchema.set(schema, found)
  }
  return found
}

function outerHtml(dom: Node): string {
  if (dom instanceof Element) return dom.outerHTML
  const box = document.createElement('div')
  box.appendChild(dom)
  return box.innerHTML
}

function convertImage(node: ProseMirrorNode, { plain }: Serializers): Converted {
  let found = images.get(node)
  if (!found) {
    // Exactly what serializing the node would produce, minus its marks — those wrap the
    // placeholder, and so end up around this.
    const { dom } = DOMSerializer.renderSpec(document, plain.nodes[node.type.name](node))
    const html = outerHtml(dom)
    found = { html, bytes: utf8Bytes(html) }
    images.set(node, found)
  }
  return found
}

function convertBlock(block: ProseMirrorNode, s: Serializers): Converted {
  let found = blocks.get(block)
  if (!found) {
    s.slots.length = 0
    const slotted = outerHtml(s.slotted.serializeNode(block))
    const met = s.slots.slice()
    let bytes = utf8Bytes(slotted)
    const html = met.length === 0 ? slotted : slotted.replace(SLOT, (placeholder, i: string) => {
      const image = convertImage(met[Number(i)], s)
      bytes += image.bytes - placeholder.length
      return image.html
    })
    found = { html, bytes }
    blocks.set(block, found)
  }
  return found
}

/** The note body as HTML — what's saved, and identical to TipTap's getHTML(). */
export function noteHtml(doc: ProseMirrorNode): string {
  const s = serializersFor(doc.type.schema)
  let html = ''
  doc.forEach(block => { html += convertBlock(block, s).html })
  return html
}

/** UTF-8 size of noteHtml(doc), from the same cache. Measuring a freshly opened note converts it
 *  once — which the status bar does shortly after it opens, so the first save then finds every
 *  block already converted instead of being the one that pays for it. */
export function noteHtmlBytes(doc: ProseMirrorNode): number {
  const s = serializersFor(doc.type.schema)
  let bytes = 0
  doc.forEach(block => { bytes += convertBlock(block, s).bytes })
  return bytes
}
