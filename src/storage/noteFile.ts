import type { Note } from '../types'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

const STYLE = `
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:780px;margin:48px auto;padding:0 24px;line-height:1.7;color:#111827;background:#fff}
    h1{font-size:2em;margin:0 0 .25em}h2{font-size:1.5em}h3{font-size:1.25em}
    code{background:#f3f4f6;padding:2px 5px;border-radius:4px;font-size:.9em;font-family:monospace}
    pre{background:#f3f4f6;padding:16px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}
    blockquote{border-left:3px solid #d1d5db;margin:0;padding-left:1em;color:#6b7280}
    ul[data-type="taskList"]{list-style:none;padding:0}
    ul[data-type="taskList"] li{display:flex;gap:.5em;align-items:flex-start;margin:.25em 0}
    mark{background:#fef08a;border-radius:2px;padding:0 2px}
    a{color:#2563eb}hr{border:none;border-top:1px solid #e5e7eb;margin:2em 0}
    img{max-width:100%;border-radius:4px}
`.trim()

/** URL/filename-safe stem derived from a title. A note's id is always this — no random suffix. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'untitled'
}

export function filenameFor(id: string): string {
  return `${id}.html`
}

/** Renders a note as a self-contained HTML document — this is the exact format written to disk, so any note file is also a viewable page on its own. */
export function renderNoteHtml(note: Note): string {
  const displayTitle = escapeHtml(note.title || 'Untitled')
  const pinnedAttr = note.pinned ? ' data-htmlr-pinned="true"' : ''
  const pinOrderAttr = note.pinned && note.pinnedOrder != null ? ` data-htmlr-pin-order="${note.pinnedOrder}"` : ''
  return `<!DOCTYPE html>
<html lang="en" data-htmlr-title="${escapeHtml(note.title)}" data-htmlr-created="${note.createdAt}" data-htmlr-updated="${note.updatedAt}"${pinnedAttr}${pinOrderAttr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="htmlr">
  <title>${displayTitle}</title>
  <style>${STYLE}</style>
</head>
<body>
  <h1>${displayTitle}</h1>
  ${note.content}
</body>
</html>
`
}

/** Reconstructs a Note from a file previously written by renderNoteHtml. `id` is always the filename (sans extension) — the source of truth for identity is the file itself. */
export function parseNoteHtml(html: string, id: string): Note | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.documentElement
  const body = doc.body
  if (!body) return null

  const createdAt = root.getAttribute('data-htmlr-created') || new Date().toISOString()
  const updatedAt = root.getAttribute('data-htmlr-updated') || createdAt
  const title = root.hasAttribute('data-htmlr-title')
    ? root.getAttribute('data-htmlr-title')!
    : (doc.querySelector('title')?.textContent ?? 'Untitled')

  const titleHeading = body.querySelector('h1')
  const content = Array.from(body.children)
    .filter(el => el !== titleHeading)
    .map(el => el.outerHTML)
    .join('')

  const note: Note = { id, title, content, createdAt, updatedAt }
  if (root.getAttribute('data-htmlr-pinned') === 'true') {
    note.pinned = true
    const order = root.getAttribute('data-htmlr-pin-order')
    if (order != null && order !== '') note.pinnedOrder = Number(order)
  }
  return note
}
