export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  /** Manual sort position within the pinned group (smaller = higher). Absent for unpinned notes. */
  pinnedOrder?: number
}

export type NoteMetadata = Omit<Note, 'content'>

export type SaveStatus = 'saved' | 'unsaved'
