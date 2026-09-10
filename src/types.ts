export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  /** Manual sort position within the pinned group (smaller = higher). Absent for unpinned notes. */
  pinnedOrder?: number
  /** The `updatedAt` of the version currently published to the shared folder, or absent if the note
   *  isn't published. Publishing is a snapshot: this stays put while the note is edited, so
   *  `updatedAt !== publishedAt` is exactly "the live copy is behind". */
  publishedAt?: string
}

export type NoteMetadata = Omit<Note, 'content'>

export type SaveStatus = 'saved' | 'unsaved'
