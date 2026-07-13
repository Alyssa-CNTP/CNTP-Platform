'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Loader2, PlayCircle, CheckCircle2, Circle,
  ClipboardList, Award, AlertTriangle, Clock,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMyEmployee } from '@/lib/training/use-my-employee'
import { QuestionRunner } from '@/components/training/QuestionRunner'
import type { TrainingQuestion, SubmittedAnswer } from '@/lib/training/training-config'

interface Lesson { id: string; title: string; youtube_id: string | null; body: string | null; sort_order: number; required: boolean }
interface Course { id: string; slug: string; title: string; description: string | null; pass_threshold: number }
interface Sop { id: string; doc_no: string; title: string; requires_practical_signoff: boolean }

type Step = 'lessons' | 'assessment' | 'result'

export default function CoursePlayerPage() {
  const { slug } = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { userId } = useAuth()
  const { employeeId: myEmployeeId, employeeName: myName } = useMyEmployee(userId)

  const asEmployeeId = searchParams.get('as')
  const employeeId   = asEmployeeId || myEmployeeId

  const [course, setCourse] = useState<Course | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [questions, setQuestions] = useState<TrainingQuestion[]>([])
  const [sops, setSops] = useState<Sop[]>([])
  const [loading, setLoading] = useState(true)
  const [watched, setWatched] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<Step>('lessons')
  const [answers, setAnswers] = useState<Record<string, SubmittedAnswer>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/training/courses/${slug}`).then(r => r.json()).then(d => {
      if (cancelled) return
      setCourse(d.course); setLessons(d.lessons ?? []); setQuestions(d.questions ?? []); setSops(d.sops ?? [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    if (!employeeId) return
    fetch(`/api/training/progress?employeeId=${employeeId}`).then(r => r.json()).then(d => {
      setWatched(new Set((d.progress ?? []).map((p: any) => p.lesson_id)))
    })
  }, [employeeId])

  const requiredLessons = useMemo(() => lessons.filter(l => l.required), [lessons])
  const allRequiredWatched = requiredLessons.every(l => watched.has(l.id))

  async function markWatched(lessonId: string) {
    if (!employeeId) return
    setWatched(s => new Set(s).add(lessonId))
    await fetch('/api/training/progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId, lesson_id: lessonId }),
    }).catch(() => {})
  }

  async function submitAssessment() {
    if (!employeeId || !course) return
    setSubmitting(true); setError(null)
    let pin: string | undefined
    try { pin = sessionStorage.getItem(`training_pin_${employeeId}`) ?? undefined } catch { /* ignore */ }
    try {
      const res = await fetch('/api/training/attempts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: course.id, employee_id: employeeId, answers, pin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not submit the assessment')
      setResult(data)
      setStep('result')
    } catch (e: any) {
      setError(e?.message || 'Could not submit the assessment')
    }
    setSubmitting(false)
  }

  function retake() {
    setAnswers({}); setResult(null); setError(null); setStep('assessment')
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
  }
  if (!course) return <div className="px-4 py-6 text-[13px] text-text-muted">Course not found.</div>

  const answeredCount = Object.keys(answers).filter(k => answers[k] !== null && answers[k] !== '' && answers[k] !== undefined).length

  return (
    <div className="px-4 py-6 max-w-[700px] mx-auto space-y-5">
      <Link href="/training/my" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
        <ArrowLeft size={13} /> My Training
      </Link>

      <div>
        <h1 className="font-display font-bold text-[20px] text-text">{course.title}</h1>
        {course.description && <p className="text-[13px] text-text-muted mt-1">{course.description}</p>}
        {employeeId && employeeId !== myEmployeeId && (
          <p className="text-[11px] text-brand mt-1">Taking this as {searchParams.get('as') ? 'the switched operator' : myName}</p>
        )}
      </div>

      {!employeeId && (
        <div className="bg-warn/10 border border-warn/20 rounded-2xl p-4 text-[13px] text-warn">
          No Staff Directory profile is linked to your account — go back to Training and use "Take training as someone else" if this is a shared tablet.
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wide text-text-muted">
        <span className={step === 'lessons' ? 'text-brand font-semibold' : ''}>1. Lessons</span>
        <span>→</span>
        <span className={step === 'assessment' ? 'text-brand font-semibold' : ''}>2. Assessment</span>
        <span>→</span>
        <span className={step === 'result' ? 'text-brand font-semibold' : ''}>3. Result</span>
      </div>

      {step === 'lessons' && (
        <div className="space-y-3">
          {lessons.length === 0 ? (
            <p className="text-[13px] text-text-muted">No lessons yet — you can go straight to the assessment.</p>
          ) : lessons.map(lesson => {
            const isWatched = watched.has(lesson.id)
            const showPlaceholder = !lesson.youtube_id || lesson.youtube_id === 'REPLACE_WITH_YOUTUBE_ID'
            return (
              <div key={lesson.id} className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-medium text-text flex items-center gap-1.5">
                    {isWatched ? <CheckCircle2 size={14} className="text-ok" /> : <Circle size={14} className="text-stone-300" />}
                    {lesson.title}
                  </h3>
                  {!lesson.required && <span className="text-[10px] text-stone-400 font-mono uppercase">optional</span>}
                </div>
                {showPlaceholder ? (
                  <div className="aspect-video rounded-xl bg-stone-100 flex items-center justify-center text-[12px] text-stone-400">
                    <PlayCircle size={16} className="mr-1.5" /> Video coming soon
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl overflow-hidden">
                    <iframe
                      className="w-full h-full"
                      src={`https://www.youtube-nocookie.com/embed/${lesson.youtube_id}`}
                      title={lesson.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                )}
                {lesson.body && <p className="text-[12px] text-text-muted">{lesson.body}</p>}
                {!isWatched && (
                  <button onClick={() => markWatched(lesson.id)}
                    className="text-[12px] font-medium text-brand hover:underline">
                    Mark as watched
                  </button>
                )}
              </div>
            )
          })}

          <button onClick={() => setStep('assessment')} disabled={!allRequiredWatched || !employeeId}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
            <ClipboardList size={15} /> {allRequiredWatched ? 'Take assessment' : 'Watch all required lessons to continue'}
          </button>
        </div>
      )}

      {step === 'assessment' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[12px] text-text-muted">
            <span>{answeredCount}/{questions.length} answered</span>
            <span>Pass mark: {Math.round(course.pass_threshold * 100)}%</span>
          </div>
          {questions.map((q, i) => (
            <QuestionRunner key={q.id} question={q} index={i}
              value={answers[q.id] ?? null}
              onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))} />
          ))}
          {error && <p className="text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}
          <button onClick={submitAssessment} disabled={submitting || !employeeId}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Submit assessment
          </button>
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-3">
          <div className={`rounded-2xl p-5 text-center space-y-2 border ${
            result.needsReview ? 'bg-warn/10 border-warn/20' : result.passed ? 'bg-ok/10 border-ok/20' : 'bg-err/10 border-err/20'
          }`}>
            {result.needsReview ? <Clock size={28} className="mx-auto text-warn" />
              : result.passed ? <Award size={28} className="mx-auto text-ok" />
              : <AlertTriangle size={28} className="mx-auto text-err" />}
            <p className="font-display font-bold text-[18px] text-text">
              {result.needsReview ? 'Submitted — pending review' : result.passed ? 'Passed' : 'Not yet — try again'}
            </p>
            <p className="text-[13px] text-text-muted">
              Auto-graded score: <span className="font-semibold text-text">{Math.round(result.autoScore * 100)}%</span>
              {result.needsReview && ' (provisional — some answers need a training officer to review before this counts)'}
            </p>
          </div>

          {result.competenciesUpdated?.length > 0 && (
            <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
              <h3 className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Competency updated</h3>
              {result.competenciesUpdated.map((c: any) => (
                <div key={c.sop_id} className="flex items-center justify-between text-[12px]">
                  <span className="text-text">{c.title} <span className="text-stone-400 font-mono text-[10px]">{c.doc_no}</span></span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.status === 'competent' ? 'bg-ok/15 text-ok' : 'bg-azure/15 text-azure'}`}>
                    {c.status === 'assessed' ? 'Awaiting practical sign-off' : 'Competent'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Link href="/training/my" className="flex-1 text-center py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Back to My Training</Link>
            {!result.needsReview && !result.passed && (
              <button onClick={retake} className="flex-1 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium hover:bg-brand-mid transition-colors">Retake assessment</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
