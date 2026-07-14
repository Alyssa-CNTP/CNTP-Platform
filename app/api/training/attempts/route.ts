import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'
import { gradeAttempt, type TrainingQuestion } from '@/lib/training/training-config'
import { applyCompetencyResults } from '@/lib/training/grading-server'

// GET /api/training/attempts?employeeId=xxx[&courseId=yyy]  — attempt history for one person
// GET /api/training/attempts?needsReview=1                  — the manual-review queue (gate can_manage_competencies)
export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url        = new URL(req.url)
  const employeeId = url.searchParams.get('employeeId')
  const courseId    = url.searchParams.get('courseId')
  const needsReview = url.searchParams.get('needsReview') === '1'

  if (!employeeId && !needsReview) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
  if (needsReview && !caller.can('can_manage_competencies')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')

  let query = hrDb.from('training_attempts').select('*, training_courses(title,slug)').order('created_at', { ascending: false })
  if (employeeId) query = query.eq('employee_id', employeeId)
  if (courseId) query = query.eq('course_id', courseId)
  if (needsReview) query = query.eq('needs_review', true).is('reviewed_at', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let attempts = data ?? []
  if (needsReview && attempts.length) {
    const employeeIds = [...new Set(attempts.map((a: any) => a.employee_id))]
    const { data: employees } = await (admin as any).schema('production').from('employees').select('id,name,display_name').in('id', employeeIds)
    const empById = new Map((employees ?? []).map((e: any) => [e.id, e]))
    attempts = attempts.map((a: any) => ({ ...a, employee: empById.get(a.employee_id) ?? null }))
  }

  return NextResponse.json({ attempts })
}

// POST /api/training/attempts — submit an assessment attempt. This is the grading engine:
// grades objective questions server-side, and on a pass writes straight into
// production.employee_competencies + competency_history (see lib/training/grading-server.ts).
export async function POST(req: NextRequest) {
  const [caller, sessionClient] = await Promise.all([getCallerPermissions(), getSessionClient()])
  const { data: { user: authUser } } = await sessionClient.auth.getUser()

  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const { course_id, employee_id, answers, pin } = body ?? {}
  if (!course_id || !employee_id || typeof answers !== 'object')
    return NextResponse.json({ error: 'course_id, employee_id and answers are required' }, { status: 400 })

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')
  const productionDb = (admin as any).schema('production')

  // ── Identity attestation ──────────────────────────────────────────────────
  // On a shared/kiosk tablet the signed-in browser session may not be the
  // employee taking the test, so a PIN (same identity check as the Capture
  // floor app) attests who actually sat the assessment. Self-serve office
  // logins, and supervisors/training officers administering on someone's
  // behalf, don't need a PIN.
  let pinAttested = false
  if (pin) {
    const { data: op } = await productionDb.from('operators').select('id').eq('employee_id', employee_id).eq('pin', pin).eq('active', true).maybeSingle()
    if (!op) return NextResponse.json({ error: 'PIN not recognised for this person' }, { status: 403 })
    pinAttested = true
  } else {
    const { data: ownLink } = await (sessionClient as any).schema('shared').from('app_roles').select('employee_id').eq('user_id', caller.userId).maybeSingle()
    const isSelf = ownLink?.employee_id === employee_id
    if (!isSelf && !caller.can('can_manage_competencies') && !caller.can('can_assign_training')) {
      return NextResponse.json({ error: 'PIN required to attest identity' }, { status: 403 })
    }
  }

  const { data: course, error: courseErr } = await hrDb.from('training_courses').select('id,title,pass_threshold').eq('id', course_id).single()
  if (courseErr || !course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  const { data: questionRows } = await hrDb.from('training_questions').select('*').eq('course_id', course_id)
  const questionIds = (questionRows ?? []).map((q: any) => q.id)
  const { data: optionRows } = questionIds.length
    ? await hrDb.from('training_question_options').select('*').in('question_id', questionIds)
    : { data: [] }

  const optionsByQuestion = new Map<string, any[]>()
  ;(optionRows ?? []).forEach((o: any) => {
    const arr = optionsByQuestion.get(o.question_id) ?? []
    arr.push(o)
    optionsByQuestion.set(o.question_id, arr)
  })
  const questions: TrainingQuestion[] = (questionRows ?? []).map((q: any) => ({ ...q, options: optionsByQuestion.get(q.id) ?? [] }))

  const { autoScore, needsReview } = gradeAttempt(questions, answers)
  const finalScore = needsReview ? null : autoScore
  const passed     = needsReview ? null : autoScore >= Number(course.pass_threshold)

  const { count } = await hrDb.from('training_attempts').select('id', { count: 'exact', head: true }).eq('employee_id', employee_id).eq('course_id', course_id)
  const attemptNo = (count ?? 0) + 1

  const { data: attempt, error: attemptErr } = await hrDb.from('training_attempts').insert({
    employee_id, course_id, attempt_no: attemptNo,
    submitted_at: new Date().toISOString(),
    auto_score: autoScore, final_score: finalScore, passed, needs_review: needsReview,
    answers, pin_attested: pinAttested, submitted_by: caller.userId,
  }).select().single()

  if (attemptErr) return NextResponse.json({ error: attemptErr.message }, { status: 500 })

  let competenciesUpdated: any[] = []
  if (!needsReview && passed) {
    competenciesUpdated = await applyCompetencyResults({
      admin, employeeId: employee_id, courseId: course_id, courseTitle: course.title,
      finalScore: finalScore as number, changedBy: caller.userId,
      changedByName: authUser?.email ?? authUser?.user_metadata?.full_name ?? caller.role ?? 'Training system',
    })
  }

  // Reflect the outcome on the assignment, if one exists
  await hrDb.from('training_assignments')
    .update({ status: needsReview ? 'in_progress' : (passed ? 'completed' : 'in_progress') })
    .eq('employee_id', employee_id).eq('course_id', course_id)

  return NextResponse.json({
    ok: true, attempt, autoScore, needsReview, passed, competenciesUpdated,
  })
}
