'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Save, Plus, Trash2, StickyNote } from 'lucide-react'

interface Note {
  id: string
  title: string
  body: string
  created_at: string
  pinned: boolean
}

export default function NotesPage() {
  const { displayName } = useAuth()
  const [notes, setNotes]           = useState<Note[]>([])
  const [activeId, setActiveId]     = useState<string | null>(null)
  const [editTitle, setEditTitle]   = useState('')
  const [editBody, setEditBody]     = useState('')
  const [saved, setSaved]           = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const db = getDb()
        const { data } = await db
          .from('notes')
          .select('id,title,body,created_at,pinned')
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
        const loaded = (data ?? []) as Note[]
        setNotes(loaded)
        if (loaded.length > 0) {
          setActiveId(loaded[0].id)
          setEditTitle(loaded[0].title)
          setEditBody(loaded[0].body)
        }
      } catch {}
    }
    load()
  }, [])

  function selectNote(note: Note) {
    setActiveId(note.id)
    setEditTitle(note.title)
    setEditBody(note.body)
    setSaved(false)
  }

  async function newNote() {
    try {
      const db = getDb()
      const { data, error } = await db
        .from('notes')
        .insert({ title: 'New note', body: '', pinned: false })
        .select('id,title,body,created_at,pinned')
        .single()
      if (error || !data) return
      const note = data as Note
      setNotes(prev => [note, ...prev])
      selectNote(note)
    } catch {}
  }

  async function saveActive() {
    if (!activeId) return
    try {
      const db = getDb()
      await db
        .from('notes')
        .update({ title: editTitle, body: editBody, updated_at: new Date().toISOString() })
        .eq('id', activeId)
      setNotes(prev => prev.map(n => n.id === activeId ? { ...n, title: editTitle, body: editBody } : n))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
  }

  async function deleteNote(id: string) {
    try {
      const db = getDb()
      await db.from('notes').delete().eq('id', id)
    } catch {}
    const updated = notes.filter(n => n.id !== id)
    setNotes(updated)
    if (activeId === id) {
      if (updated.length > 0) selectNote(updated[0])
      else { setActiveId(null); setEditTitle(''); setEditBody('') }
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
                {format(new Date(note.created_at), 'd MMM · HH:mm')}
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
                Created {format(new Date(activeNote.created_at), 'd MMMM yyyy, HH:mm')}
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
