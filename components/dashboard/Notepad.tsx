'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { format } from 'date-fns'
import { StickyNote, Save, Trash2, Pin } from 'lucide-react'

interface Props {
  userId: string
}

const STORAGE_KEY = (userId: string) => `cntp_notepad_${userId}`

const PLACEHOLDERS = [
  'What needs your attention today?\n\n— Press / for quick formatting…',
  'Notes, reminders, follow-ups…\n\n',
  'What are your priorities today?\n\n',
]

export default function Notepad({ userId }: Props) {
  const [content,     setContent]     = useState('')
  const [savedAt,     setSavedAt]     = useState<Date | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [charCount,   setCharCount]   = useState(0)
  const [placeholder] = useState(() => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)])
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef   = useRef<HTMLTextAreaElement>(null)

  // Load from localStorage on mount
  useEffect(() => {
    if (!userId) return
    const stored = localStorage.getItem(STORAGE_KEY(userId))
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setContent(parsed.content ?? '')
        setCharCount((parsed.content ?? '').length)
        if (parsed.savedAt) setSavedAt(new Date(parsed.savedAt))
      } catch {
        setContent(stored)
        setCharCount(stored.length)
      }
    }
  }, [userId])

  // Auto-save with debounce
  const save = useCallback((value: string) => {
    if (!userId) return
    setSaving(true)
    const data = { content: value, savedAt: new Date().toISOString() }
    localStorage.setItem(STORAGE_KEY(userId), JSON.stringify(data))
    setSavedAt(new Date())
    // Small tick delay so "Saving…" flashes visibly
    setTimeout(() => setSaving(false), 400)
  }, [userId])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setContent(val)
    setCharCount(val.length)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => save(val), 800)
  }

  const handleClear = () => {
    if (!content.trim()) return
    if (!confirm('Clear your notepad?')) return
    setContent('')
    setCharCount(0)
    save('')
  }

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden flex flex-col h-full min-h-[280px]">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-surface-rule flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <StickyNote size={14} className="text-amber-500" />
          <span className="font-display font-bold text-[14px] text-text">My Notepad</span>
          <span className="font-mono text-[10px] text-text-faint">· private</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Save indicator */}
          <span className={`font-mono text-[10px] transition-colors ${
            saving ? 'text-info animate-pulse' : savedAt ? 'text-text-faint' : 'opacity-0'
          }`}>
            {saving ? 'Saving…' : savedAt ? `Saved ${format(savedAt, 'HH:mm')}` : ''}
          </span>
          <button
            onClick={handleClear}
            className="p-1.5 rounded-lg hover:bg-surface text-text-faint hover:text-err transition-colors"
            title="Clear notepad"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Textarea */}
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          placeholder={placeholder}
          className={`
            w-full h-full min-h-[200px] resize-none px-5 py-4
            font-body text-[13px] text-text leading-relaxed
            bg-transparent outline-none
            placeholder:text-text-faint placeholder:italic
          `}
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 border-t border-surface-rule flex items-center justify-between shrink-0">
        <span className="font-mono text-[10px] text-text-faint">
          {charCount > 0 ? `${charCount.toLocaleString()} characters` : 'Start typing…'}
        </span>
        <div className="flex items-center gap-1.5">
          <Save size={10} className="text-text-faint" />
          <span className="font-mono text-[10px] text-text-faint">Auto-saved per device</span>
        </div>
      </div>
    </div>
  )
}
