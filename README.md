# htmlr

A distraction-free rich-text note editor that stores everything you write as plain, self-contained HTML files — on your own device, not on a server. No account, no cloud, no subscription.

## Why

Most note apps hold your notes hostage in a proprietary database or a company's cloud. htmlr does the opposite: every note is a real `.html` file, readable in any browser, greppable, and portable by design. You choose where those files live — a local folder, an external drive, or a mapped NAS share — and htmlr just reads and writes into it. There's nothing to export "in case you leave," because you were never locked in.

## Data storage strategy

htmlr uses a two-layer storage model:

1. **Source of truth — a folder on your device.** On first launch you pick a folder via the browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API). Every note is saved as its own HTML file in that folder (e.g. `meeting-notes-a1b2c3.html`), named from its title so it stays legible outside the app. Each file is fully self-contained — title, content, and metadata (`data-htmlr-*` attributes) all live in one document, styled well enough to open directly in a browser with no app required. Renaming a note's title renames its file to match.

2. **Cache — IndexedDB.** Re-reading every file from disk on every load would be slow, so the note list and content are mirrored into IndexedDB. On startup the app shows the cached list instantly, then reconciles it against the folder in the background (picks up files added/edited/removed outside the app). Every save writes to the folder first and updates the cache alongside it — the folder is always authoritative.

**Browsers without File System Access support** (Firefox, Safari) fall back to IndexedDB-only storage, so the app still works — you just lose the on-disk files and portability until you switch to a Chromium-based browser.

**Multi-device access** works by pointing the folder picker at a mapped network share, e.g. a Synology/QNAP/TrueNAS box over SMB — no sync service or subscription needed, since it's just files on a drive.

Because permission to a folder isn't guaranteed to persist across browser restarts (a File System Access API constraint, not an htmlr limitation), the app will occasionally ask you to reconfirm access to a previously chosen folder — your notes haven't moved, the browser is just re-checking.

## Stack

- **[React 19](https://react.dev/)** + **[TypeScript](https://www.typescriptlang.org/)** — UI and app logic
- **[Vite](https://vite.dev/)** — dev server and build
- **[TipTap](https://tiptap.dev/)** (ProseMirror) — the rich-text editor: headings, lists, task lists, code blocks, blockquotes, links, images, text alignment, and more
- **[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)** — reads/writes note files directly to a user-chosen folder
- **IndexedDB** (no library — a small hand-rolled wrapper) — local cache for fast startup and the folder-permission handle
- **[lucide-react](https://lucide.dev/)** — icons
- **[Oxlint](https://oxc.rs)** — linting

No backend, no database server, no external services.

## Project structure

```
src/
  components/
    Sidebar.tsx        note list, folder/storage status, note actions
    Editor.tsx          TipTap editor setup, image paste handling
    EditorToolbar.tsx    formatting toolbar
    Welcome.tsx          onboarding screen / folder connection / permission recovery
  hooks/
    useNotes.ts          note CRUD, save debouncing, storage status
  storage/
    index.ts             orchestrates cache + folder sync, exposes the storage API
    fs.ts                File System Access API wrapper (pick/read/write/permissions)
    db.ts                IndexedDB wrapper (note cache + key-value store)
    noteFile.ts           note <-> HTML file serialization, shared by storage and "Export"
  types.ts               Note / NoteMetadata / SaveStatus types
```

## Getting started

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check and build for production
npm run lint      # run Oxlint
```

Requires a Chromium-based browser (Chrome, Edge, etc.) for on-device folder storage. Other browsers run in the IndexedDB-only fallback mode.
