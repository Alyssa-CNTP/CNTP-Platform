import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'
import { applyCompetencyResults } from '@/lib/training/grading-server'

// POST /api/training/attempts/[id]/review — training officer sets the final score
// for an attempt that had manual-review (marker's-discretion) questions.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [caller, sessionClient] = await Promise.all([getCallerPermissions(), getSessionClient()])
  const { data: { user: authUser } } = await sessionClient.auth.getUser()

  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_manage_competencies')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const finalScore = Number(body?.final_score)
  if (isNaN(finalScore) || finalScore < 0 || finalScore > 1)
    return NextResponse.json({ error: 'final_score must be between 0 and 1' }, { status: 400 })

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')

  const { data: attempt, error: attemptErr } = await hrDb.from('training_attempts').select('*').eq('id', id).single()
  if (attemptErr || !attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

  const { data: course } = await hrDb.from('training_courses').select('id,title,pass_threshold').eq('id', attempt.course_id).single()
  const passed = finalScore >= Number(course?.pass_threshold ?? 0.8)

  const { data: updated, error: updateErr } = await hrDb.from('training_attempts').update({
    final_score: finalScore, passed,
    reviewed_by: caller.userId, reviewed_at: new Date().toISOString(),
  }).eq('id', id).select().single()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  let competenciesUpdated: any[] = []
  if (passed && course) {
    competenciesUpdated = await applyCompetencyResults({
      admin, employeeId: attempt.employee_id, courseId: attempt.course_id, courseTitle: course.title,
      finalScore, changedBy: caller.userId,
      changedByName: authUser?.email ?? authUser?.user_metadata?.full_name ?? caller.role ?? 'Training officer',
    })
  }

  await hrDb.from('training_assignments')
    .update({ status: passed ? 'completed' : 'in_progress' })
    .eq('employee_id', attempt.employee_id).eq('course_id', attempt.course_id)

  return NextResponse.json({ ok: true, attempt: updated, passed, competenciesUpdated })
}
