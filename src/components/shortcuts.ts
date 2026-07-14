// Keyboard-shortcut model for the toolbar. A shortcut is stored layout-independently: `code` is the
// physical key (KeyboardEvent.code, e.g. "KeyL", "Digit1", "Minus") and `mod` folds Ctrl/Cmd into
// one flag so the same definition works on Windows/Linux (Ctrl) and macOS (Cmd).

export interface Shortcut {
  mod: boolean // Ctrl on Windows/Linux, Cmd on macOS
  alt: boolean
  shift: boolean
  code: string
}

// `native: true` means TipTap/ProseMirror already binds this shortcut internally — we only display
// it and must NOT re-fire it ourselves (that would double-toggle). `native: false` means the tool
// has no built-in binding, so our own key handler implements the default.
export interface ShortcutDefault {
  shortcut: Shortcut
  native: boolean
}

const sc = (code: string, mods: Partial<Omit<Shortcut, 'code'>> = {}): Shortcut => ({
  mod: !!mods.mod, alt: !!mods.alt, shift: !!mods.shift, code,
})

// Defaults. The `native` ones mirror TipTap's real bindings (StarterKit, Highlight, TextAlign) so
// the hover label matches what already works. The three non-native ones (task list, horizontal
// rule, link) have no built-in binding, so we implement these defaults ourselves.
export const DEFAULT_SHORTCUTS: Record<string, ShortcutDefault> = {
  undo: { shortcut: sc('KeyZ', { mod: true }), native: true },
  redo: { shortcut: sc('KeyY', { mod: true }), native: true },
  bold: { shortcut: sc('KeyB', { mod: true }), native: true },
  italic: { shortcut: sc('KeyI', { mod: true }), native: true },
  underline: { shortcut: sc('KeyU', { mod: true }), native: true },
  strike: { shortcut: sc('KeyS', { mod: true, shift: true }), native: true },
  highlight: { shortcut: sc('KeyH', { mod: true, shift: true }), native: true },
  h1: { shortcut: sc('Digit1', { mod: true, alt: true }), native: true },
  h2: { shortcut: sc('Digit2', { mod: true, alt: true }), native: true },
  h3: { shortcut: sc('Digit3', { mod: true, alt: true }), native: true },
  bulletList: { shortcut: sc('Digit8', { mod: true, shift: true }), native: true },
  orderedList: { shortcut: sc('Digit7', { mod: true, shift: true }), native: true },
  taskList: { shortcut: sc('Digit9', { mod: true, shift: true }), native: false },
  code: { shortcut: sc('KeyE', { mod: true }), native: true },
  codeBlock: { shortcut: sc('KeyC', { mod: true, alt: true }), native: true },
  blockquote: { shortcut: sc('KeyB', { mod: true, shift: true }), native: true },
  hr: { shortcut: sc('Minus', { mod: true, shift: true }), native: false },
  alignLeft: { shortcut: sc('KeyL', { mod: true, shift: true }), native: true },
  alignCenter: { shortcut: sc('KeyE', { mod: true, shift: true }), native: true },
  alignRight: { shortcut: sc('KeyR', { mod: true, shift: true }), native: true },
  link: { shortcut: sc('KeyK', { mod: true }), native: false },
  // openFile has no default — not a text-editing action — but a custom one can still be assigned.
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

const CODE_LABELS: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'Space',
}

function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return CODE_LABELS[code] ?? code
}

/** Human-readable label, e.g. "Ctrl+Shift+L" (or "⌘⇧L" on macOS). */
export function formatShortcut(s: Shortcut): string {
  const parts: string[] = []
  if (s.mod) parts.push(isMac ? '⌘' : 'Ctrl')
  if (s.alt) parts.push(isMac ? '⌥' : 'Alt')
  if (s.shift) parts.push(isMac ? '⇧' : 'Shift')
  parts.push(codeLabel(s.code))
  return parts.join(isMac ? '' : '+')
}

export function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  return (e.ctrlKey || e.metaKey) === s.mod && e.altKey === s.alt && e.shiftKey === s.shift && e.code === s.code
}

export function shortcutsEqual(a: Shortcut, b: Shortcut): boolean {
  return a.mod === b.mod && a.alt === b.alt && a.shift === b.shift && a.code === b.code
}

/** Builds a Shortcut from a keydown, or null if only a modifier key is down (keep waiting). */
export function shortcutFromEvent(e: KeyboardEvent): Shortcut | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  return { mod: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey, code: e.code }
}

/** A shortcut must carry Ctrl/Cmd or Alt — a bare or Shift-only key would clobber normal typing. */
export function isValidShortcut(s: Shortcut): boolean {
  return s.mod || s.alt
}

const CUSTOM_KEY = 'htmlr_toolbar_shortcuts'

export function loadCustomShortcuts(): Record<string, Shortcut> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, Shortcut> = {}
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v && typeof v === 'object' && typeof (v as Shortcut).code === 'string') {
        const s = v as Shortcut
        out[id] = { mod: !!s.mod, alt: !!s.alt, shift: !!s.shift, code: s.code }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveCustomShortcuts(map: Record<string, Shortcut>): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(map))
}
