'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Loader2, Plus, Trash2, Check, GripVertical, ChevronDown, ChevronUp,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { SOP_AREAS } from '@/lib/production/competency-config'
import { QUESTION_KINDS, type QuestionKind } from '@/lib/training/training-config'

interface Sop { id: string; doc_no: string; title: string; area: string; active: boolean }

interface OptionDraft { key: string; label: string; is_correct: boolean; match_key: string }
interface LessonDraft { key: string; title: string; youtube_id: string; body: string; required: boolean }
interface QuestionDraft {
  key: string; prompt: string; kind: QuestionKind; points: string; explanation: string
  manual_review: boolean; numeric_answer: string; numeric_tolerance: string; options: OptionDraft[]
}

let keySeq = 0
const newKey = () => `k${Date.now()}_${keySeq++}`

export default function CourseEditorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [area, setArea] = useState('production')
  const [status, setStatus] = useState('draft')
  const [passThreshold, setPassThreshold] = useState('0.8')

  const [lessons, setLessons] = useState<LessonDraft[]>([])
  const [questions, setQuestions] = useState<QuestionDraft[]>([])
  const [sopIds, setSopIds] = useState<string[]>([])
  const [allSops, setAllSops] = useState<Sop[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const [courseRes, sopsRes] = await Promise.all([
        fetch(`/api/training/courses/${id}?authoring=1`).then(r => r.json()),
        getDb().schema('production').from('sops').select('id,doc_no,title,area,active').eq('active', true).order('sort_order'),
      ])
      const c = courseRes.course
      setTitle(c.title); setDescription(c.description ?? ''); setArea(c.area); setStatus(c.status); setPassThreshold(String(c.pass_threshold))
      setLessons((courseRes.lessons ?? []).map((l: any): LessonDraft => ({
        key: newKey(), title: l.title, youtube_id: l.youtube_id ?? '', body: l.body ?? '', required: l.required,
      })))
      setQuestions((courseRes.questions ?? []).map((q: any): QuestionDraft => ({
        key: newKey(), prompt: q.prompt, kind: q.kind, points: String(q.points ?? 1),
        explanation: q.explanation ?? '', manual_review: q.manual_review,
        numeric_answer: q.numeric_answer != null ? String(q.numeric_answer) : '',
        numeric_tolerance: q.numeric_tolerance != null ? String(q.numeric_tolerance) : '',
        options: (q.options ?? []).map((o: any): OptionDraft => ({
          key: newKey(), label: o.label, is_correct: !!o.is_correct, match_key: o.match_key ?? '',
        })),
      })))
      setSopIds((courseRes.sops ?? []).map((s: any) => s.id))
      setAllSops((sopsRes.data ?? []) as Sop[])
      setLoading(false)
    }
    load()
  }, [id])

  function addLesson() {
    setLessons(ls => [...ls, { key: newKey(), title: '', youtube_id: '', body: '', required: true }])
  }
  function updateLesson(key: string, patch: Partial<LessonDraft>) {
    setLessons(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l))
  }
  function removeLesson(key: string) {
    setLessons(ls => ls.filter(l => l.key !== key))
  }

  function addQuestion() {
    const key = newKey()
    setQuestions(qs => [...qs, {
      key, prompt: '', kind: 'single_choice', points: '1', explanation: '', manual_review: false,
      numeric_answer: '', numeric_tolerance: '',
      options: [{ key: newKey(), label: '', is_correct: true, match_key: '' }, { key: newKey(), label: '', is_correct: false, match_key: '' }],
    }])
    setExpanded(s => new Set(s).add(key))
  }
  function updateQuestion(key: string, patch: Partial<QuestionDraft>) {
    setQuestions(qs => qs.map(q => q.key === key ? { ...q, ...patch } : q))
  }
  function removeQuestion(key: string) {
    setQuestions(qs => qs.filter(q => q.key !== key))
  }
  function addOption(qKey: string) {
    setQuestions(qs => qs.map(q => q.key === qKey ? { ...q, options: [...q.options, { key: newKey(), label: '', is_correct: false, match_key: '' }] } : q))
  }
  function updateOption(qKey: string, oKey: string, patch: Partial<OptionDraft>) {
    setQuestions(qs => qs.map(q => q.key === qKey ? { ...q, options: q.options.map(o => o.key === oKey ? { ...o, ...patch } : o) } : q))
  }
  function removeOption(qKey: string, oKey: string) {
    setQuestions(qs => qs.map(q => q.key === qKey ? { ...q, options: q.options.filter(o => o.key !== oKey) } : q))
  }
  function toggleExpanded(key: string) {
    setExpanded(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  function toggleSop(sopId: string) {
    setSopIds(ids => ids.includes(sopId) ? ids.filter(i => i !== sopId) : [...ids, sopId])
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const payload = {
        course: { title, description, area, status, pass_threshold: parseFloat(passThreshold) || 0.8 },
        lessons: lessons.map((l, i) => ({ title: l.title, youtube_id: l.youtube_id, body: l.body, required: l.required, sort_order: i })),
        questions: questions.map((q, i) => ({
          prompt: q.prompt, kind: q.kind, points: parseFloat(q.points) || 1, explanation: q.explanation || undefined,
          manual_review: q.manual_review, sort_order: i,
          numeric_answer: q.kind === 'numeric' && q.numeric_answer !== '' ? parseFloat(q.numeric_answer) : undefined,
          numeric_tolerance: q.kind === 'numeric' && q.numeric_tolerance !== '' ? parseFloat(q.numeric_tolerance) : undefined,
          options: q.options.filter(o => o.label.trim() !== '').map((o, j) => ({
            label: o.label, is_correct: o.is_correct, match_key: o.match_key || undefined, sort_order: j,
          })),
        })),
        sopIds,
      }
      const res = await fetch(`/api/training/courses/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not save the course')
      router.push('/training/manage')
    } catch (e: any) {
      setError(e?.message || 'Could not save the course')
    }
    setSaving(false)
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>

  return (
    <div className="px-4 py-6 max-w-[760px] mx-auto space-y-5 pb-16">
      <Link href="/training/manage" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
        <ArrowLeft size={13} /> Manage courses
      </Link>

      {/* Course meta */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-3">
        <div>
          <label className={LBL}>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={INP} />
        </div>
        <div>
          <label className={LBL}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={`${INP} resize-none`} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={LBL}>Area</label>
            <select value={area} onChange={e => setArea(e.target.value)} className={INP}>
              {SOP_AREAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={INP}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className={LBL}>Pass mark</label>
            <input type="number" min="0" max="1" step="0.05" value={passThreshold} onChange={e => setPassThreshold(e.target.value)} className={INP} />
          </div>
        </div>
      </div>

      {/* SOP mapping */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
        <h2 className={SECTION_TITLE}>Updates these SOP competencies</h2>
        <div className="flex flex-wrap gap-1.5">
          {allSops.map(s => {
            const on = sopIds.includes(s.id)
            return (
              <button key={s.id} type="button" onClick={() => toggleSop(s.id)}
                className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-500 border-stone-200 hover:border-stone-300'}`}>
                {s.doc_no} — {s.title}
              </button>
            )
          })}
        </div>
      </div>

      {/* Lessons */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className={SECTION_TITLE}>Lessons</h2>
          <button onClick={addLesson} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"><Plus size={13} /> Add lesson</button>
        </div>
        {lessons.map(l => (
          <div key={l.key} className="bg-surface-card border border-surface-rule rounded-2xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <GripVertical size={14} className="text-stone-300 shrink-0" />
              <input value={l.title} onChange={e => updateLesson(l.key, { title: e.target.value })} placeholder="Lesson title" className={`${INP} flex-1`} />
              <button onClick={() => removeLesson(l.key)} className="text-stone-300 hover:text-err shrink-0"><Trash2 size={14} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 pl-5">
              <input value={l.youtube_id} onChange={e => updateLesson(l.key, { youtube_id: e.target.value })} placeholder="YouTube video ID" className={`${INP} font-mono`} />
              <label className="flex items-center gap-1.5 text-[12px] text-text-muted">
                <input type="checkbox" checked={l.required} onChange={e => updateLesson(l.key, { required: e.target.checked })} className="accent-brand" /> Required before assessment
              </label>
            </div>
            <textarea value={l.body} onChange={e => updateLesson(l.key, { body: e.target.value })} placeholder="Optional written notes" rows={2} className={`${INP} pl-2 resize-none ml-5`} />
          </div>
        ))}
      </div>

      {/* Questions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className={SECTION_TITLE}>Assessment questions</h2>
          <button onClick={addQuestion} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"><Plus size={13} /> Add question</button>
        </div>
        {questions.map((q, qi) => {
          const isOpen = expanded.has(q.key)
          return (
            <div key={q.key} className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
              <button onClick={() => toggleExpanded(q.key)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors text-left">
                <span className="text-[13px] text-text truncate flex-1">{qi + 1}. {q.prompt || '(untitled question)'}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono text-stone-400 uppercase">{q.kind.replace('_', ' ')}</span>
                  {isOpen ? <ChevronUp size={14} className="text-stone-400" /> : <ChevronDown size={14} className="text-stone-400" />}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-surface-rule p-3 space-y-2">
                  <textarea value={q.prompt} onChange={e => updateQuestion(q.key, { prompt: e.target.value })} placeholder="Question prompt" rows={2} className={`${INP} resize-none`} />
                  <div className="grid grid-cols-3 gap-2">
                    <select value={q.kind} onChange={e => updateQuestion(q.key, { kind: e.target.value as QuestionKind })} className={INP}>
                      {QUESTION_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                    </select>
                    <input type="number" step="0.5" value={q.points} onChange={e => updateQuestion(q.key, { points: e.target.value })} placeholder="Points" className={INP} />
                    <label className="flex items-center gap-1.5 text-[12px] text-text-muted">
                      <input type="checkbox" checked={q.manual_review} onChange={e => updateQuestion(q.key, { manual_review: e.target.checked })} className="accent-brand" /> Manual review
                    </label>
                  </div>

                  {q.kind === 'numeric' && (
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" step="any" value={q.numeric_answer} onChange={e => updateQuestion(q.key, { numeric_answer: e.target.value })} placeholder="Correct value" className={INP} />
                      <input type="number" step="any" value={q.numeric_tolerance} onChange={e => updateQuestion(q.key, { numeric_tolerance: e.target.value })} placeholder="Tolerance (±)" className={INP} />
                    </div>
                  )}

                  {(q.kind === 'single_choice' || q.kind === 'multi_choice' || q.kind === 'true_false') && (
                    <div className="space-y-1.5">
                      {q.options.map(o => (
                        <div key={o.key} className="flex items-center gap-2">
                          <input type="checkbox" checked={o.is_correct} onChange={e => updateOption(q.key, o.key, { is_correct: e.target.checked })} className="accent-brand shrink-0" title="Correct answer" />
                          <input value={o.label} onChange={e => updateOption(q.key, o.key, { label: e.target.value })} placeholder="Option label" className={`${INP} flex-1`} />
                          <button onClick={() => removeOption(q.key, o.key)} className="text-stone-300 hover:text-err shrink-0"><Trash2 size={13} /></button>
                        </div>
                      ))}
                      <button onClick={() => addOption(q.key)} className="text-[11px] font-medium text-brand hover:underline">+ Add option</button>
                    </div>
                  )}

                  {(q.kind === 'short_text' || q.kind === 'matching') && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-stone-400">{q.kind === 'short_text' ? 'Accepted answers (case-insensitive) — leave empty if manual review only' : 'Options with their correct match key'}</p>
                      {q.options.map(o => (
                        <div key={o.key} className="flex items-center gap-2">
                          <input value={o.label} onChange={e => updateOption(q.key, o.key, { label: e.target.value })} placeholder={q.kind === 'short_text' ? 'Accepted answer' : 'Option label'} className={`${INP} flex-1`} />
                          {q.kind === 'matching' && (
                            <input value={o.match_key} onChange={e => updateOption(q.key, o.key, { match_key: e.target.value })} placeholder="Match key" className={`${INP} w-32`} />
                          )}
                          <button onClick={() => removeOption(q.key, o.key)} className="text-stone-300 hover:text-err shrink-0"><Trash2 size={13} /></button>
                        </div>
                      ))}
                      <button onClick={() => addOption(q.key)} className="text-[11px] font-medium text-brand hover:underline">+ Add</button>
                    </div>
                  )}

                  <input value={q.explanation} onChange={e => updateQuestion(q.key, { explanation: e.target.value })} placeholder="Explanation shown to reviewers (optional)" className={INP} />

                  <button onClick={() => removeQuestion(q.key)} className="text-[11px] font-medium text-err hover:underline">Delete question</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && <p className="text-[12px] text-err">{error}</p>}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-surface-rule p-3 flex justify-end">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save course
        </button>
      </div>
    </div>
  )
}

const INP = 'w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'
const LBL = 'block text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1'
const SECTION_TITLE = 'font-mono text-[10px] uppercase tracking-wide text-text-muted'
