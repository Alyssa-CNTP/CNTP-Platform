'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Save, Plus, Trash2, StickyNote } from 'lucide-react'

interface Note {
  id: string
  title: string
  body: string
  created_at: string
  author: string
  pinned: boolean
}

const STORAGE_KEY = 'cntp_notes_v1'

function loadNotes(): Note[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveNotes(notes: Note[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
}

export default function NotesPage() {
  const { displayName } = useAuth()
  const [notes, setNotes]           = useState<Note[]>([])
  const [activeId, setActiveId]     = useState<string | null>(null)
  const [editTitle, setEditTitle]   = useState('')
  const [editBody, setEditBody]     = useState('')
  const [saved, setSaved]           = useState(false)

  useEffect(() => {
    const loaded = loadNotes()
    setNotes(loaded)
    if (loaded.length > 0) {
      const first = loaded[0]
      setActiveId(first.id)
      setEditTitle(first.title)
      setEditBody(first.body)
    }
  }, [])

  function selectNote(note: Note) {
    setActiveId(note.id)
    setEditTitle(note.title)
    setEditBody(note.body)
    setSaved(false)
  }

  function newNote() {
    const note: Note = {
      id:         crypto.randomUUID(),
      title:      'New note',
      body:       '',
      created_at: new Date().toISOString(),
      author:     displayName,
      pinned:     false,
    }
    const updated = [note, ...notes]
    setNotes(updated)
    saveNotes(updated)
    selectNote(note)
  }

  function saveActive() {
    if (!activeId) return
    const updated = notes.map(n =>
      n.id === activeId ? { ...n, title: editTitle, body: editBody } : n
    )
    setNotes(updated)
    saveNotes(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function deleteNote(id: string) {
    const updated = notes.filter(n => n.id !== id)
    setNotes(updated)
    saveNotes(updated)
    if (activeId === id) {
      if (updated.length > 0) selectNote(updated[0])
      else {
        setActiveId(null)
        setEditTitle('')
        setEditBody('')
      }
    }
  }

  const activeNote = notes.find(n => n.id === activeId)

  return (
    <div className="flex h-full">
      {/* Note list */}
      <div className="w-[240px] shrink-0 border-r border-surface-rule flex flex-col bg-surface-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-rule">
          <span className="font-display font-bold text-[13px] text-text uppercase tracking-wide">
            Notes
          </span>
          <button
            onClick={newNote}
            className="w-7 h-7 rounded-lg bg-brand text-white flex items-center justify-center hover:bg-brand/80 transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {notes.length === 0 && (
            <div className="px-4 py-8 text-center text-text-muted text-xs font-mono">
              No notes yet. Tap + to create one.
            </div>
          )}
          {notes.map(note => (
            <button
              key={note.id}
              onClick={() => selectNote(note)}
              className={[
                'w-full text-left px-4 py-3 border-b border-surface-rule transition-colors',
                activeId === note.id
                  ? 'bg-brand/8 border-l-2 border-l-brand'
                  : 'hover:bg-surface',
              ].join(' ')}
            >
              <div className="font-body font-semibold text-[13px] text-text truncate">
                {note.title || 'Untitled'}
              </div>
              <div className="font-mono text-[10px] text-text-muted mt-0.5">
                {format(new Date(note.created_at), 'd MMM · HH:mm')} · {note.author}
              </div>
              <div className="text-[11px] text-text-muted mt-1 line-clamp-2 leading-relaxed">
                {note.body || 'Empty note…'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeId ? (
          <>
            <div className="flex items-center gap-3 px-6 py-3 border-b border-surface-rule">
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="Note title…"
                className="flex-1 font-display font-bold text-[18px] text-text bg-transparent outline-none placeholder:text-text-muted/40"
              />
              <button
                onClick={saveActive}
                className={[
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-mono font-medium transition-colors',
                  saved
                    ? 'bg-ok/10 text-ok'
                    : 'bg-brand text-white hover:bg-brand/80',
                ].join(' ')}
              >
                <Save size={13} />
                {saved ? 'Saved' : 'Save'}
              </button>
              <button
                onClick={() => deleteNote(activeId)}
                className="w-8 h-8 rounded-lg text-text-muted hover:text-err hover:bg-err/10 flex items-center justify-center transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <textarea
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              placeholder="Start typing your note…"
              className="flex-1 px-6 py-4 font-body text-[14px] text-text bg-transparent outline-none resize-none leading-relaxed placeholder:text-text-muted/40"
            />

            {activeNote && (
              <div className="px-6 py-2 border-t border-surface-rule font-mono text-[10px] text-text-muted">
                Created {format(new Date(activeNote.created_at), 'd MMMM yyyy, HH:mm')} by {activeNote.author}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
            <StickyNote size={36} className="opacity-20" />
            <p className="font-mono text-[12px]">Select a note or create a new one</p>
          </div>
        )}
      </div>
    </div>
  )
}