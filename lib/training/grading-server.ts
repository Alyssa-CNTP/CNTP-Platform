// lib/training/grading-server.ts
// Server-only: writes a passed training attempt into production.employee_competencies
// + competency_history, mirroring the write+history+audit pattern in
// app/api/staff/competencies/route.ts. Never import this into a client component —
// it takes the admin (service-role) client.

interface ApplyParams {
  admin:        any
  employeeId:   string
  courseId:     string
  courseTitle:  string
  finalScore:   number
  changedBy:    string | null
  changedByName: string
}

export interface CompetencyUpdateResult {
  sop_id: string
  doc_no: string
  title:  string
  status: string
}

export async function applyCompetencyResults(params: ApplyParams): Promise<CompetencyUpdateResult[]> {
  const { admin, employeeId, courseId, courseTitle, finalScore, changedBy, changedByName } = params

  const hrDb = admin.schema('hr')
  const productionDb = admin.schema('production')

  const { data: courseSops } = await hrDb
    .from('course_sops')
    .select('sop_id')
    .eq('course_id', courseId)

  const sopIds: string[] = (courseSops ?? []).map((r: any) => r.sop_id)
  if (sopIds.length === 0) return []

  const { data: sops } = await productionDb
    .from('sops')
    .select('id,doc_no,title,requires_practical_signoff')
    .in('id', sopIds)

  const results: CompetencyUpdateResult[] = []
  const today = new Date().toISOString().slice(0, 10)

  for (const sop of sops ?? []) {
    const newStatus = sop.requires_practical_signoff ? 'assessed' : 'competent'

    const { data: existing } = await productionDb
      .from('employee_competencies')
      .select('id,status,score')
      .eq('employee_id', employeeId)
      .eq('sop_id', sop.id)
      .maybeSingle()

    const { data: upserted, error: upsertErr } = await productionDb
      .from('employee_competencies')
      .upsert({
        employee_id: employeeId,
        sop_id: sop.id,
        status: newStatus,
        score: finalScore,
        training_completed: true,
        date_completed: today,
        assessed_at: today,
        notes: `Completed course "${courseTitle}" — scored ${Math.round(finalScore * 100)}%`,
      }, { onConflict: 'employee_id,sop_id' })
      .select('id,status,score')
      .single()

    if (upsertErr) {
      console.error('[training/grading-server] competency upsert failed:', upsertErr)
      continue
    }

    await productionDb.from('competency_history').insert({
      competency_id:   upserted.id,
      employee_id:     employeeId,
      sop_id:          sop.id,
      action:          existing ? 'status_change' : 'assessed',
      from_status:     existing?.status ?? null,
      to_status:       newStatus,
      from_score:      existing?.score ?? null,
      to_score:        finalScore,
      changed_by:      changedBy,
      changed_by_name: changedByName,
      note:            `Completed course "${courseTitle}" — scored ${Math.round(finalScore * 100)}%`,
    })

    try {
      await admin.schema('axis').from('audit_log').insert({
        actor_id:    changedBy,
        action:      'training_competency_update',
        schema_name: 'production',
        table_name:  'employee_competencies',
        record_id:   upserted.id,
        before_state: existing ? { status: existing.status, score: existing.score } : null,
        after_state:  { status: newStatus, score: finalScore, course_id: courseId },
      })
    } catch (e) {
      console.error('[training/grading-server] audit_log insert failed:', e)
    }

    results.push({ sop_id: sop.id, doc_no: sop.doc_no, title: sop.title, status: newStatus })
  }

  return results
}
