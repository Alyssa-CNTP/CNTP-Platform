import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

// GET /api/training/courses            — active courses, lesson/question counts
// GET /api/training/courses?all=1      — includes draft/archived (author-only)
// GET /api/training/courses?employeeId=xxx — attach that employee's assignment/attempt state
export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url        = new URL(req.url)
  const all        = url.searchParams.get('all') === '1'
  const employeeId = url.searchParams.get('employeeId')

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')

  let query = hrDb.from('training_courses').select('id,slug,title,description,area,status,pass_threshold,sort_order,active').eq('active', true).order('sort_order')
  if (!(all && caller.can('can_author_training'))) query = query.eq('status', 'active')

  const { data: courses, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const courseIds = (courses ?? []).map((c: any) => c.id)
  if (courseIds.length === 0) return NextResponse.json({ courses: [] })

  const [lessonsRes, questionsRes, sopsRes] = await Promise.all([
    hrDb.from('training_lessons').select('id,course_id').in('course_id', courseIds),
    hrDb.from('training_questions').select('id,course_id,points').in('course_id', courseIds),
    hrDb.from('course_sops').select('course_id,sop_id').in('course_id', courseIds),
  ])

  const lessonCount = new Map<string, number>()
  ;(lessonsRes.data ?? []).forEach((l: any) => lessonCount.set(l.course_id, (lessonCount.get(l.course_id) ?? 0) + 1))
  const questionCount = new Map<string, number>()
  ;(questionsRes.data ?? []).forEach((q: any) => questionCount.set(q.course_id, (questionCount.get(q.course_id) ?? 0) + 1))
  const sopCount = new Map<string, number>()
  ;(sopsRes.data ?? []).forEach((s: any) => sopCount.set(s.course_id, (sopCount.get(s.course_id) ?? 0) + 1))

  let assignmentByCourseCourse: Map<string, any> | null = null
  let attemptByCourse: Map<string, any> | null = null
  let progressByCourse: Map<string, number> | null = null

  if (employeeId) {
    const [assignRes, attemptsRes, lessonsFullRes] = await Promise.all([
      hrDb.from('training_assignments').select('course_id,due_date,status,reason').eq('employee_id', employeeId).in('course_id', courseIds),
      hrDb.from('training_attempts').select('course_id,final_score,auto_score,passed,needs_review,attempt_no,submitted_at').eq('employee_id', employeeId).in('course_id', courseIds).order('attempt_no', { ascending: false }),
      hrDb.from('lesson_progress').select('lesson_id').eq('employee_id', employeeId).eq('watched', true),
    ])
    assignmentByCourseCourse = new Map((assignRes.data ?? []).map((a: any) => [a.course_id, a]))
    attemptByCourse = new Map()
    ;(attemptsRes.data ?? []).forEach((a: any) => { if (!attemptByCourse!.has(a.course_id)) attemptByCourse!.set(a.course_id, a) })

    const watchedLessonIds = new Set((lessonsFullRes.data ?? []).map((l: any) => l.lesson_id))
    progressByCourse = new Map()
    ;(lessonsRes.data ?? []).forEach((l: any) => {
      if (watchedLessonIds.has(l.id)) progressByCourse!.set(l.course_id, (progressByCourse!.get(l.course_id) ?? 0) + 1)
    })
  }

  const result = (courses ?? []).map((c: any) => ({
    ...c,
    lesson_count: lessonCount.get(c.id) ?? 0,
    question_count: questionCount.get(c.id) ?? 0,
    sop_count: sopCount.get(c.id) ?? 0,
    ...(employeeId ? {
      assignment: assignmentByCourseCourse!.get(c.id) ?? null,
      latest_attempt: attemptByCourse!.get(c.id) ?? null,
      lessons_watched: progressByCourse!.get(c.id) ?? 0,
    } : {}),
  }))

  return NextResponse.json({ courses: result })
}

// POST /api/training/courses — create a new course (author only)
export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_author_training')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.slug || !body?.title) return NextResponse.json({ error: 'slug and title are required' }, { status: 400 })

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')

  const { data, error } = await hrDb.from('training_courses').insert({
    slug: body.slug,
    title: body.title,
    description: body.description ?? null,
    area: body.area ?? 'production',
    status: body.status ?? 'draft',
    pass_threshold: body.pass_threshold ?? 0.80,
    sort_order: body.sort_order ?? 0,
    created_by: caller.userId,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, course: data })
}
