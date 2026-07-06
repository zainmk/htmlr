export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export type NoteMetadata = Omit<Note, 'content'>

export type SaveStatus = 'saved' | 'saving' | 'unsaved'
