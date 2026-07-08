# <img width="36" height="36" src="https://github.com/user-attachments/assets/708ac722-64a4-44ad-9ad8-6aaede2da1db" /> [htmlr](https://htmlr.vercel.app/?note=new-note)

A WYSIWYG .html note editor that stores everything you write as plain, self-contained HTML files — on your own device, not on a server. No account, no cloud, no subscription.

<img width="678" height="887" alt="image" src="https://github.com/user-attachments/assets/c81846bf-82b3-4ad6-9922-b0a8a1fdc493" />

## Purpose

Most note apps hold your notes hostage in a proprietary database or a company's cloud. htmlr does the opposite: every note is a real `.html` file, readable in any browser, greppable, and portable by design. You choose where those files live — a local folder, an external drive, or a mapped NAS share — and htmlr just reads and writes into it. There's nothing to export "in case you leave," because you were never locked in.

## Features

- **WYSIWYG editing** — headings, lists, task lists, code blocks, blockquotes, links, text alignment, highlighting
- **Paste images directly** — embedded into the note as data URLs, so each file stays fully self-contained
- **Pin notes** — keep important notes at the top of the list (stored in the note's file itself, so pins travel with it)
- **Import / export** — pull any `.html` note file in via the sidebar (works on every browser, including iOS Safari), or open/download the real saved file from the toolbar
- **Deep links** — `?note=<name>` in the URL opens that note directly; browser back/forward move between notes
- **Keyboard-friendly** — `Esc` toggles the sidebar, arrow keys navigate the note list, `Enter` opens
- **Installable PWA** — install from the welcome screen (Chrome/Edge) and it runs in its own window, fully offline


## Data storage strategy

htmlr uses a two-layer storage model:

1. **Source of truth — a folder on your device.** On first launch you pick a folder via the browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API). Every note is saved as its own HTML file in that folder (e.g. `meeting-notes.html`), named from its title so it stays legible outside the app — titles are kept unique so names never collide. Each file is fully self-contained — title, content, and metadata (`data-htmlr-*` attributes) all live in one document, styled well enough to open directly in a browser with no app required. Renaming a note's title renames its file to match.

2. **Cache — IndexedDB.** Re-reading every file from disk on every load would be slow, so the note list and content are mirrored into IndexedDB. On startup the app shows the cached list instantly, then reconciles it against the folder in the background (picks up files added/edited/removed outside the app).

**Conflict handling:** when the same note differs between the cache and the folder, the version with the newer `updatedAt` wins. This matters when the folder is a network mount (NAS, a cloud-sync client's drive) that was briefly unreachable — an edit made during the outage is kept and written back to the folder once it's reachable again, instead of being silently overwritten by the stale on-disk copy.

**Browsers without File System Access support** (Firefox, Safari — including all of iOS) fall back to IndexedDB-only storage, so the app still works: full editing, import, and download-as-file remain available; you just don't get the live on-disk folder until you switch to a Chromium-based browser.

**Multi-device access** works by pointing the folder picker at a mapped network share (e.g. a Synology/QNAP/TrueNAS box over SMB) or a locally-mounted cloud-sync folder (Google Drive for desktop in Mirror mode, Dropbox, OneDrive) — no sync service integration needed, since it's just files on a drive.

Because permission to a folder isn't guaranteed to persist across browser restarts (a File System Access API constraint, not an htmlr limitation), the app will occasionally ask you to reconfirm access to a previously chosen folder — your notes haven't moved, the browser is just re-checking.

## Offline & PWA

The app is an installable PWA: a service worker (via `vite-plugin-pwa`) precaches the app shell, so once installed it launches and works with zero connectivity. Note data never needed the network in the first place — folder writes and the IndexedDB cache are both local — so offline the only thing that changes is nothing.

On iOS, use Share → Add to Home Screen: the app runs standalone (no browser chrome) and gets its own more-durable storage bucket. Note that iOS can never connect a folder (no File System Access API in WebKit), so it always runs in IndexedDB fallback mode — use import/download to move notes between an iPhone and a folder-connected desktop.

## Stack

- **[React 19](https://react.dev/)** + **[TypeScript](https://www.typescriptlang.org/)** — UI and app logic
- **[Vite](https://vite.dev/)** — dev server and build, with **[vite-plugin-pwa](https://vite-pwa-org.netlify.app/)** for the service worker
- **[TipTap](https://tiptap.dev/)** (ProseMirror) — the rich-text editor
- **[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)** — reads/writes note files directly to a user-chosen folder
- **IndexedDB** (no library — a small hand-rolled wrapper) — local cache for fast startup and the folder-permission handle
- **[lucide-react](https://lucide.dev/)** — icons
- **[Oxlint](https://oxc.rs)** — linting

No backend, no database server, no external services.

## Project structure

```
src/
  components/
    Sidebar.tsx          note list, pin/delete actions, import, folder/storage status
    Editor.tsx           TipTap editor setup, image paste handling
    EditorToolbar.tsx    formatting toolbar, open-saved-file action
    Welcome.tsx          onboarding screen / folder connection / permission recovery / PWA install
  hooks/
    useNotes.ts          note CRUD, save debouncing, URL sync, pinning, import/export
    usePwaInstall.ts     captures the browser install prompt for the welcome screen
  storage/
    index.ts             orchestrates cache + folder sync (timestamp-based reconcile)
    fs.ts                File System Access API wrapper (pick/read/write/permissions)
    db.ts                IndexedDB wrapper (note cache + key-value store)
    noteFile.ts          note <-> HTML file serialization, shared by storage and import/export
  types.ts               Note / NoteMetadata / SaveStatus types
```

## Getting started

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check and build for production (includes the service worker)
npm run preview   # serve the production build locally (needed to test the PWA/offline behavior)
npm run lint      # run Oxlint
```

Requires a Chromium-based browser (Chrome, Edge, etc.) for on-device folder storage and PWA install. Other browsers run in the IndexedDB-only fallback mode.
