// app/api/quality/coa-signatories/route.ts
// Tells the COA Generator who the Lab Manager and Quality Manager are (read from
// the Staff Directory), and whether the logged-in caller is one of them and has
// a signature on file — so the sign-off buttons can enable/label correctly.

import { NextResponse } from 'next/server'
import { getAdminClient, getSessionClient, resolveEmployeeId } from '@/lib/auth/server-helpers'
import { resolveCoaManagers, classifyManager, COA_MANAGER_TITLES } from '@/lib/quality/coa-managers'

export async function GET() {
  const admin = getAdminClient() as any
  const { lab, qa } = await resolveCoaManagers(admin)

  let isLab = false, isQa = false, hasSignature = false, employeeId: string | null = null
  try {
    const db = await getSessionClient()
    const { data: { user } } = await db.auth.getUser()
    if (user) {
      employeeId = await resolveEmployeeId(user.id)
      if (employeeId) {
        const { data: emp } = await admin.schema('production').from('employees')
          .select('position, job_title').eq('id', employeeId).maybeSingle()
        const role = classifyManager(emp)
        isLab = role === 'lab'
        isQa  = role === 'qa'
        const { data: sig } = await admin.schema('production').from('employee_signatures')
          .select('employee_id').eq('employee_id', employeeId).maybeSingle()
        hasSignature = !!sig
      }
    }
  } catch { /* not signed in / no staff record */ }

  return NextResponse.json({
    lab: { title: COA_MANAGER_TITLES.lab, name: lab?.name ?? null },
    qa:  { title: COA_MANAGER_TITLES.qa,  name: qa?.name ?? null },
    me: { isLab, isQa, hasSignature, employeeId },
  })
}
