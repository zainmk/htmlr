import { useState, useCallback, useEffect } from 'react'
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react'
import { useNotes } from './hooks/useNotes'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { Welcome } from './components/Welcome'
import './App.css'

const SIDEBAR_COLLAPSED_KEY = 'htmlr_sidebar_collapsed'

export default function App() {
  const {
    status, folderName, isUsingFolder,
    noteList, activeNote, saveStatus, titleConflict,
    chooseDirectory, reconnect, continueWithoutFolder,
    openNote, createNote, updateNote, deleteNote, openNoteFile,
  } = useNotes()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true')

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
        onChooseDirectory={chooseDirectory}
        onReconnect={reconnect}
        onContinueWithoutFolder={continueWithoutFolder}
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
