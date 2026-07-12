'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, Loader2, ClipboardCheck, ChevronDown, ChevronUp, Check } from 'lucide-react'
import { gradeQuestion, type TrainingQuestion, type SubmittedAnswer } from '@/lib/training/training-config'

interface Attempt {
  id: string; employee_id: string; course_id: string; attempt_no: number; auto_score: number
  answers: Record<string, SubmittedAnswer>; created_at: string
  training_courses?: { title: string; slug: string } | null
  employee?: { name: string; display_name: string | null } | null
}

export default function ReviewQueuePage() {
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => { load() }, [])
  async function load() {
    const res = await fetch('/api/training/attempts?needsReview=1')
    const data = await res.json()
    setAttempts(data.attempts ?? [])
    setLoading(false)
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>

  return (
    <div className="px-4 py-6 max-w-[760px] mx-auto space-y-5">
      <Link href="/training" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
        <ArrowLeft size={13} /> Training
      </Link>
      <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2"><ClipboardCheck size={20} className="text-brand" /> Review queue</h1>

      {attempts.length === 0 ? (
        <p className="text-[13px] text-text-muted py-8 text-center">Nothing pending review.</p>
      ) : (
        <div className="space-y-2">
          {attempts.map(a => (
            <ReviewRow key={a.id} attempt={a} open={openId === a.id}
              onToggle={() => setOpenId(openId === a.id ? null : a.id)}
              onReviewed={() => { setAttempts(as => as.filter(x => x.id !== a.id)); setOpenId(null) }} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewRow({ attempt, open, onToggle, onReviewed }: {
  attempt: Attempt; open: boolean; onToggle: () => void; onReviewed: () => void
}) {
  const [questions, setQuestions] = useState<TrainingQuestion[]>([])
  const [manualPoints, setManualPoints] = useState<Record<string, string>>({})
  const [loadingQ, setLoadingQ] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || questions.length > 0) return
    setLoadingQ(true)
    fetch(`/api/training/courses/${attempt.course_id}?authoring=1`).then(r => r.json()).then(d => {
      setQuestions(d.questions ?? [])
      setLoadingQ(false)
    })
  }, [open])

  const totalPoints = questions.reduce((s, q) => s + (q.points ?? 1), 0)
  const autoEarned = questions.filter(q => !q.manual_review).reduce((s, q) => {
    const r = gradeQuestion(q, attempt.answers[q.id] ?? null)
    return s + r.earned
  }, 0)
  const manualEarned = questions.filter(q => q.manual_review).reduce((s, q) => {
    const v = parseFloat(manualPoints[q.id] ?? '0')
    return s + (isNaN(v) ? 0 : Math.min(v, q.points ?? 1))
  }, 0)
  const suggestedScore = totalPoints > 0 ? (autoEarned + manualEarned) / totalPoints : 0

  async function submitReview() {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/training/attempts/${attempt.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_score: Math.min(1, Math.max(0, suggestedScore)) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not submit the review')
      onReviewed()
    } catch (e: any) {
      setError(e?.message || 'Could not submit the review')
    }
    setSaving(false)
  }

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors text-left">
        <div>
          <p className="text-[13px] text-text">{attempt.employee?.display_name || attempt.employee?.name || '—'} — {attempt.training_courses?.title ?? '—'}</p>
          <p className="text-[11px] text-text-muted mt-0.5">Attempt {attempt.attempt_no} · {format(parseISO(attempt.created_at), 'd MMM yyyy, HH:mm')} · Auto-graded {Math.round(attempt.auto_score * 100)}%</p>
        </div>
        {open ? <ChevronUp size={14} className="text-stone-400 shrink-0" /> : <ChevronDown size={14} className="text-stone-400 shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-surface-rule p-4 space-y-3">
          {loadingQ ? (
            <Loader2 size={16} className="animate-spin text-stone-300" />
          ) : (
            <>
              {questions.map(q => {
                const submitted = attempt.answers[q.id]
                return (
                  <div key={q.id} className="text-[13px] space-y-1">
                    <p className="text-text font-medium">{q.prompt}</p>
                    <p className="text-text-muted">Submitted: <span className="text-text">{formatAnswer(submitted, q)}</span></p>
                    {q.manual_review ? (
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-text-muted">Award points (max {q.points}):</label>
                        <input type="number" min="0" max={q.points} step="0.5"
                          value={manualPoints[q.id] ?? ''}
                          onChange={e => setManualPoints(m => ({ ...m, [q.id]: e.target.value }))}
                          className="w-20 px-2 py-1 rounded border border-stone-200 text-[12px]" />
                        {q.explanation && <span className="text-[11px] text-stone-400">({q.explanation})</span>}
                      </div>
                    ) : (
                      <p className="text-[11px] text-stone-400">Auto-graded — {gradeQuestion(q, submitted).correct ? 'correct' : 'incorrect'}</p>
                    )}
                  </div>
                )
              })}

              <div className="flex items-center justify-between pt-2 border-t border-surface-rule">
                <p className="text-[12px] text-text-muted">Suggested final score: <span className="font-semibold text-text">{Math.round(suggestedScore * 100)}%</span></p>
                <button onClick={submitReview} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand text-white text-[12px] font-medium disabled:opacity-40">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirm score
                </button>
              </div>
              {error && <p className="text-[11px] text-err">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatAnswer(a: SubmittedAnswer, q: TrainingQuestion): string {
  const labelFor = (optionId: string) => q.options?.find(o => o.id === optionId)?.label ?? optionId
  if (a == null || a === '') return '—'
  if (Array.isArray(a)) return a.map(labelFor).join(', ')
  if (q.kind === 'single_choice' || q.kind === 'true_false') return labelFor(String(a))
  if (typeof a === 'object') return Object.entries(a).map(([k, v]) => `${labelFor(k)}: ${v}`).join(', ')
  return String(a)
}
