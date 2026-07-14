import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { toLearnerQuestion } from '@/lib/training/training-config'

// GET /api/training/courses/[id]                — learner-safe (no correct answers)
// GET /api/training/courses/[id]?authoring=1    — full data incl. correct answers (author only)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(req.url)
  // Reviewers (can_manage_competencies) also need to see correct answers to
  // judge manual-review questions, even without authoring rights.
  const authoring = url.searchParams.get('authoring') === '1' &&
    (caller.can('can_author_training') || caller.can('can_manage_competencies'))

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')

  // Accept either the course id (uuid) or its slug — the course player links by slug.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const courseRes = isUuid
    ? await hrDb.from('training_courses').select('*').eq('id', id).single()
    : await hrDb.from('training_courses').select('*').eq('slug', id).single()

  if (courseRes.error || !courseRes.data) return NextResponse.json({ error: 'Course not found' }, { status: 404 })
  const courseId = courseRes.data.id

  const [lessonsRes, questionsRes, sopsRes] = await Promise.all([
    hrDb.from('training_lessons').select('*').eq('course_id', courseId).order('sort_order'),
    hrDb.from('training_questions').select('*').eq('course_id', courseId).order('sort_order'),
    hrDb.from('course_sops').select('sop_id').eq('course_id', courseId),
  ])

  const questionIds = (questionsRes.data ?? []).map((q: any) => q.id)
  const { data: options } = questionIds.length
    ? await hrDb.from('training_question_options').select('*').in('question_id', questionIds).order('sort_order')
    : { data: [] }

  const optionsByQuestion = new Map<string, any[]>()
  ;(options ?? []).forEach((o: any) => {
    const arr = optionsByQuestion.get(o.question_id) ?? []
    arr.push(o)
    optionsByQuestion.set(o.question_id, arr)
  })

  let questions = (questionsRes.data ?? []).map((q: any) => ({ ...q, options: optionsByQuestion.get(q.id) ?? [] }))
  if (!authoring) questions = questions.map(toLearnerQuestion)

  const sopIds = (sopsRes.data ?? []).map((r: any) => r.sop_id)
  let sops: any[] = []
  if (sopIds.length) {
    const { data } = await (admin as any).schema('production').from('sops').select('id,doc_no,title,requires_practical_signoff').in('id', sopIds)
    sops = data ?? []
  }

  return NextResponse.json({
    course: courseRes.data,
    lessons: lessonsRes.data ?? [],
    questions,
    sops,
  })
}

// PATCH /api/training/courses/[id] — full replace of course + lessons + questions + sop map (author only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_author_training')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')

  const { course, lessons, questions, sopIds } = body as {
    course: { title: string; description?: string; area?: string; status?: string; pass_threshold?: number; sort_order?: number }
    lessons: Array<{ title: string; youtube_id?: string; body?: string; duration_seconds?: number; sort_order: number; required?: boolean }>
    questions: Array<{
      prompt: string; kind: string; points?: number; explanation?: string; image_url?: string
      numeric_answer?: number; numeric_tolerance?: number; manual_review?: boolean; sort_order: number
      options?: Array<{ label: string; is_correct?: boolean; match_key?: string; sort_order: number }>
    }>
    sopIds: string[]
  }

  if (course) {
    const { error } = await hrDb.from('training_courses').update({
      title: course.title, description: course.description ?? null, area: course.area,
      status: course.status, pass_threshold: course.pass_threshold, sort_order: course.sort_order ?? 0,
    }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (Array.isArray(lessons)) {
    await hrDb.from('training_lessons').delete().eq('course_id', id)
    if (lessons.length) {
      const { error } = await hrDb.from('training_lessons').insert(
        lessons.map(l => ({ course_id: id, title: l.title, youtube_id: l.youtube_id ?? null, body: l.body ?? null, duration_seconds: l.duration_seconds ?? null, sort_order: l.sort_order, required: l.required ?? true }))
      )
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  if (Array.isArray(questions)) {
    await hrDb.from('training_questions').delete().eq('course_id', id) // cascades to options
    for (const q of questions) {
      const { data: inserted, error } = await hrDb.from('training_questions').insert({
        course_id: id, sort_order: q.sort_order, prompt: q.prompt, kind: q.kind,
        points: q.points ?? 1, explanation: q.explanation ?? null, image_url: q.image_url ?? null,
        numeric_answer: q.numeric_answer ?? null, numeric_tolerance: q.numeric_tolerance ?? null,
        manual_review: q.manual_review ?? false,
      }).select('id').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      if (q.options?.length) {
        const { error: optErr } = await hrDb.from('training_question_options').insert(
          q.options.map(o => ({ question_id: inserted.id, label: o.label, is_correct: o.is_correct ?? false, match_key: o.match_key ?? null, sort_order: o.sort_order }))
        )
        if (optErr) return NextResponse.json({ error: optErr.message }, { status: 500 })
      }
    }
  }

  if (Array.isArray(sopIds)) {
    await hrDb.from('course_sops').delete().eq('course_id', id)
    if (sopIds.length) {
      const { error } = await hrDb.from('course_sops').insert(sopIds.map(sopId => ({ course_id: id, sop_id: sopId })))
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
