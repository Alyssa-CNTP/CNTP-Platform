'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, GraduationCap, ArrowLeft, X, Check } from 'lucide-react'

interface CourseRow {
  id: string; slug: string; title: string; description: string | null
  status: string; lesson_count: number; question_count: number; sop_count: number
}

const STATUS_CLS: Record<string, string> = {
  active: 'bg-ok/15 text-ok', draft: 'bg-stone-100 text-stone-500', archived: 'bg-err/10 text-err',
}

export default function ManageTrainingPage() {
  const router = useRouter()
  const [courses, setCourses] = useState<CourseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/training/courses?all=1').then(r => r.json()).then(d => { setCourses(d.courses ?? []); setLoading(false) })
  }, [])

  return (
    <div className="px-4 py-6 max-w-[800px] mx-auto space-y-5">
      <div>
        <Link href="/training" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand mb-3">
          <ArrowLeft size={13} /> Training
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2">
            <GraduationCap size={20} className="text-brand" /> Manage courses
          </h1>
          <button onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white bg-brand rounded-xl px-3 py-2 hover:bg-brand-mid transition-colors">
            <Plus size={13} /> New course
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-stone-300" /></div>
      ) : (
        <div className="space-y-2">
          {courses.map(c => (
            <Link key={c.id} href={`/training/manage/${c.id}`}
              className="block bg-surface-card border border-surface-rule rounded-2xl p-4 hover:border-brand/40 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display font-semibold text-[14px] text-text">{c.title}</h3>
                  <p className="text-[11px] text-text-muted mt-0.5">{c.lesson_count} lessons · {c.question_count} questions · {c.sop_count} SOPs mapped</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 capitalize ${STATUS_CLS[c.status] ?? ''}`}>{c.status}</span>
              </div>
            </Link>
          ))}
          {courses.length === 0 && <p className="text-[13px] text-text-muted py-8 text-center">No courses yet — create one to get started.</p>}
        </div>
      )}

      {creating && (
        <NewCourseModal onClose={() => setCreating(false)} onCreated={id => router.push(`/training/manage/${id}`)} />
      )}
    </div>
  )
}

function NewCourseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function autoSlug(t: string) {
    setTitle(t)
    setSlug(t.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
  }

  async function create() {
    if (!title.trim() || !slug.trim()) { setError('Title and slug are required'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/training/courses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, slug, status: 'draft' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not create the course')
      onCreated(data.course.id)
    } catch (e: any) {
      setError(e?.message || 'Could not create the course'); setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[400px] p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-[15px] text-text">New course</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={15} /></button>
        </div>
        <div className="space-y-2">
          <div>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1">Title</label>
            <input value={title} onChange={e => autoSlug(e.target.value)} autoFocus
              className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] outline-none focus:border-brand" placeholder="e.g. Refining 1 — Operator Training" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1">Slug</label>
            <input value={slug} onChange={e => setSlug(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] font-mono outline-none focus:border-brand" placeholder="refining-1" />
          </div>
        </div>
        {error && <p className="text-[11px] text-err">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Cancel</button>
          <button onClick={create} disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create
          </button>
        </div>
      </div>
    </div>
  )
}
