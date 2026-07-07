import { useState, useCallback, useEffect } from 'react'
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react'
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
    noteList, activeNote, saveStatus, titleConflict,
    chooseDirectory, reconnect, continueWithoutFolder,
    openNote, createNote, updateNote, deleteNote, openNoteFile, importNote,
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
      if (e.key === 'Escape') toggleSidebar()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar])

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
        onChooseDirectory={chooseDirectory}
        onImport={importNote}
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
            saveStatus={saveStatus}
            titleConflict={titleConflict}
            sidebarCollapsed={sidebarCollapsed}
            onTitleChange={title => updateNote({ title }, activeNote)}
            onContentChange={content => updateNote({ content }, activeNote)}
            onOpenFile={() => openNoteFile(activeNote)}
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
  )
}
