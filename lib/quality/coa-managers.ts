// lib/quality/coa-managers.ts
// Who the COA's two signatories are is read from the Staff Directory
// (production.employees) — not configured on the COA page. The Lab Manager and
// Quality Manager are identified by their job title / position.

export const COA_MANAGER_TITLES = {
  lab: 'Laboratory Supervisor',
  qa:  'Quality Assurance Manager',
} as const

// Classify a Staff Directory record as the lab manager, the QA manager, or
// neither, from its position / job_title.
export function classifyManager(emp: { position?: string | null; job_title?: string | null } | null | undefined): 'lab' | 'qa' | null {
  if (!emp) return null
  const t = `${emp.position || ''} ${emp.job_title || ''}`.toLowerCase()
  if (/quality/.test(t) && (/manager|assurance|supervisor/.test(t))) return 'qa'
  if ((/\blab\b|laborator/.test(t)) && /manager|supervisor/.test(t)) return 'lab'
  return null
}

export type CoaManager = { employeeId: string; name: string } | null

// Resolve the people currently holding the Lab Manager and QA Manager positions
// (first active match of each). Used to show their names on the COA.
export async function resolveCoaManagers(admin: any): Promise<{ lab: CoaManager; qa: CoaManager }> {
  let lab: CoaManager = null, qa: CoaManager = null
  try {
    const { data } = await admin.schema('production').from('employees')
      .select('id, name, display_name, position, job_title, active')
    for (const e of (data ?? []) as any[]) {
      if (e.active === false) continue
      const role = classifyManager(e)
      const nm = e.display_name || e.name || ''
      if (role === 'lab' && !lab) lab = { employeeId: e.id, name: nm }
      if (role === 'qa'  && !qa)  qa  = { employeeId: e.id, name: nm }
    }
  } catch { /* table/columns absent → both null */ }
  return { lab, qa }
}
