// lib/production/employee-payload.ts
// Shared field mapper for production.employees writes — keeps the create (POST
// /api/staff) and update (PATCH /api/staff/[id]) payloads identical.

export function buildEmployeePayload(body: any) {
  return {
    name:          body.name?.trim(),
    display_name:  body.display_name?.trim() || null,
    department:    body.department || 'production',
    job_title:     body.job_title?.trim() || null,
    skills:        Array.isArray(body.skills) ? body.skills : [],
    phone:         body.phone?.trim() || null,
    active:        body.active ?? true,
    position:      body.position?.trim() || null,
    position_code: body.position_code?.trim() || null,
    employee_code: body.employee_code?.trim() || null,
    start_date:    body.start_date || null,
  }
}

// Columns the Staff Directory renders — return the fresh row after a write so
// the client can slot it into local state without a refetch.
export const EMPLOYEE_COLS =
  'id,name,display_name,department,job_title,skills,phone,active,position,position_code,employee_code,start_date'
