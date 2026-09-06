import { useState, useCallback, useEffect } from 'react'
import { PanelLeftOpen, PanelLeftClose, FolderOpen, RefreshCw } from 'lucide-react'
import { Analytics } from '@vercel/analytics/react'
import { useNotes } from './hooks/useNotes'
import { usePwaInstall } from './hooks/usePwaInstall'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { Welcome } from './components/Welcome'
import './App.css'

const SIDEBAR_COLLAPSED_KEY = 'htmlr_sidebar_collapsed'
// Below this width the sidebar's fixed 240px would crowd the editor into an unusably narrow
// column (toolbar wraps into a tall stack, title clips). Only affects the *default* the very
// first time someone opens the app on a given device — any explicit toggle after that is
// remembered via localStorage and wins over this, on any screen size.
const NARROW_VIEWPORT_BREAKPOINT = 768

export default function App() {
  const {
    status, folderName, isUsingFolder,
    noteList, activeNote, saveStatus, titleConflict, openToken, folderError,
    chooseDirectory, reconnect, continueWithoutFolder,
    openNote, createNote, updateNote, deleteNote, togglePin, reorderPinned, openNoteFile, retrySave,
  } = useNotes()

  const { canInstall, install } = usePwaInstall()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (stored !== null) return stored === 'true'
    return window.innerWidth < NARROW_VIEWPORT_BREAKPOINT
  })

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }, [])

  // Esc toggles the sidebar open/closed from anywhere in the app.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Deliberately NOT guarded on e.defaultPrevented: ProseMirror calls preventDefault() on
      // Escape whenever the note body has focus, so that check would swallow the toggle in the
      // one place it's used most. A popup that wants to eat an Escape stops propagation in the
      // capture phase instead (see ShortcutMenu), which keeps this listener from running at all.
      if (e.key === 'Escape') toggleSidebar()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar])

  // Resolving storage (reading IndexedDB, reconciling the folder) — keep the same spinner the
  // inline loader in index.html was already showing, so there's no blank flash across the handoff.
  if (status === 'checking') {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
      </div>
    )
  }

  // Storage itself couldn't be opened — IndexedDB is unavailable (Firefox private browsing, a
  // storage policy, a corrupted database). There is nothing to load and nothing to fall back to,
  // so say so instead of spinning forever on a loader that will never resolve.
  if (status === 'error') {
    return (
      <div className="app-loading app-loading--recover">
        <div className="app-loading-prompt">
          <button className="btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={15} />
            Try again
          </button>
          <p className="app-loading-prompt-text">
            htmlr couldn't open this browser's local storage, so it can't load your notes. This
            usually means private browsing or a setting that blocks site data.
          </p>
        </div>
      </div>
    )
  }

  // The connected folder still had permission but has since been deleted/moved/renamed on disk, so
  // there's nothing left to load. Keep the spinner up (the app is, from the user's view, still
  // trying to open their notes) and offer a way out by pointing it at a folder that exists.
  if (status === 'missing-folder') {
    return (
      <div className="app-loading app-loading--recover">
        <div className="app-loading-spinner" />
        <div className="app-loading-prompt">
          <button className="btn-primary" onClick={chooseDirectory}>
            <FolderOpen size={15} />
            Change folder
          </button>
          <p className="app-loading-prompt-text">
            {folderName ? (
              <><span className="app-loading-folder-name">{folderName}</span> couldn't be found.</>
            ) : (
              "Your notes folder couldn't be found."
            )}{' '}
            It may have been moved, renamed, or deleted.
          </p>
        </div>
      </div>
    )
  }

  if (status !== 'ready' && status !== 'fallback') {
    return (
      <Welcome
        status={status}
        folderName={folderName}
        canInstall={canInstall}
        onChooseDirectory={chooseDirectory}
        onReconnect={reconnect}
        onContinueWithoutFolder={continueWithoutFolder}
        onInstall={install}
      />
    )
  }

  return (
    <>
      <div className="app">
        <Sidebar
          notes={noteList}
          activeId={activeNote?.id ?? null}
          folderName={folderName}
          isUsingFolder={isUsingFolder}
          collapsed={sidebarCollapsed}
          onOpen={openNote}
          onCreate={createNote}
          onDelete={deleteNote}
          onTogglePin={togglePin}
          onReorderPinned={reorderPinned}
          onChooseDirectory={chooseDirectory}
        />

        <button
          className="sidebar-toggle-btn"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar (Esc)' : 'Collapse sidebar (Esc)'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        <main className="main">
          {activeNote ? (
            <Editor
              note={activeNote}
              openToken={openToken}
              saveStatus={saveStatus}
              titleConflict={titleConflict}
              folderError={folderError}
              folderName={folderName}
              sidebarCollapsed={sidebarCollapsed}
              onTitleChange={title => updateNote({ title }, activeNote)}
              onContentChange={content => updateNote({ content }, activeNote)}
              onOpenFile={() => openNoteFile(activeNote)}
              onRetrySave={retrySave}
            />
          ) : (
            <div className="empty-state">
              <p>No notes yet.</p>
              <button className="btn-primary" onClick={createNote}>
                Create your first note
              </button>
            </div>
          )}
        </main>
      </div>
      <Analytics />
    </>
  )
}
