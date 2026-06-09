// app/api/axis/requests/route.ts
// GET: list all project_requests (IT triage board).
// POST: submit a new project_request (any authenticated user with a department).

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { ALL_DEPARTMENTS } from '@/lib/auth/permissions'

const VALID_SUBMISSION_TYPES = new Set(['feature_request', 'suggestion', 'code_contribution'])

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { data, error } = await (getAdminClient() as any)
    .schema('axis')
    .from('project_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[api/axis/requests GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.department)
    return NextResponse.json({ error: 'No department assigned — contact IT' }, { status: 400 })

  const {
    title, description, business_justification, urgency,
    submission_type, target_department,
    // Code Contribution Protocol fields (optional, only when submission_type === 'code_contribution')
    onedrive_url, schema_proposal, code_source, ai_tool_used,
    code_author, preflight_checklist,
  } = await req.json()
  if (!title?.trim())                  return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (!description?.trim())            return NextResponse.json({ error: 'Description is required' }, { status: 400 })
  if (!business_justification?.trim()) return NextResponse.json({ error: 'Business justification is required' }, { status: 400 })

  const validUrgencies = ['low', 'medium', 'high', 'critical']
  if (!validUrgencies.includes(urgency))
    return NextResponse.json({ error: 'Invalid urgency' }, { status: 400 })

  // submission_type optional — defaults to feature_request via the column default
  const subType = submission_type && VALID_SUBMISSION_TYPES.has(submission_type)
    ? submission_type
    : undefined
  if (submission_type && !subType)
    return NextResponse.json({ error: 'Invalid submission_type' }, { status: 400 })

  // target_department optional — validated against the canonical list
  const targetDept = target_department && (ALL_DEPARTMENTS as readonly string[]).includes(target_department)
    ? target_department
    : null
  if (target_department && !targetDept)
    return NextResponse.json({ error: 'Invalid target_department' }, { status: 400 })

  // Code Contribution Protocol — extra fields, only attached when relevant
  const isCode = subType === 'code_contribution'
  const codeFields = isCode ? {
    ...(onedrive_url        ? { onedrive_url:        String(onedrive_url).trim() } : {}),
    ...(schema_proposal     ? { schema_proposal                                  } : {}),
    ...(code_source         ? { code_source                                       } : {}),
    ...(ai_tool_used        ? { ai_tool_used:        String(ai_tool_used).trim() } : {}),
    ...(code_author         ? { code_author:         String(code_author).trim()  } : {}),
    ...(preflight_checklist ? { preflight_checklist                              } : {}),
  } : {}

  const { error } = await (getAdminClient() as any)
    .schema('axis')
    .from('project_requests')
    .insert({
      title:                  title.trim(),
      description:            description.trim(),
      business_justification: business_justification.trim(),
      urgency,
      requesting_dept:        caller.department,
      submitted_by:           caller.userId,
      status:                 'pending',
      ...(subType    ? { submission_type:   subType   } : {}),
      ...(targetDept ? { target_department: targetDept } : {}),
      ...codeFields,
    })

  if (error) {
    console.error('[api/axis/requests POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-create a linked ticket so every request is trackable
  try {
    const admin = getAdminClient()

    // Map urgency → ticket priority
    const priorityMap: Record<string, string> = {
      critical: 'critical', high: 'high', medium: 'medium', low: 'low',
    }

    // Map target department / submission type → ticket category
    let ticketCategory = 'general'
    if (subType === 'code_contribution') ticketCategory = 'app'
    else if (targetDept === 'IT')        ticketCategory = 'app'

    // Look up Jan to notify, Alyssa to auto-assign if app category
    const { data: users } = await (admin as any)
      .schema('shared')
      .from('app_roles')
      .select('user_id, full_name')

    const findUser = (n: string) =>
      (users ?? []).find((u: any) => u.full_name?.toLowerCase().includes(n.toLowerCase()))

    const alyssa = findUser('Alyssa')
    const jan    = findUser('Jan')

    const notifyIds: string[] = []
    let assignTo:   string | null = null
    let assignName: string | null = null

    if (ticketCategory === 'app' && alyssa) {
      assignTo = alyssa.user_id; assignName = alyssa.full_name
    }
    if (jan) notifyIds.push(jan.user_id)

    const { data: ticket } = await (admin as any)
      .schema('axis')
      .from('tickets')
      .insert({
        title:           title.trim(),
        description:     `${description.trim()}\n\nBusiness justification: ${business_justification.trim()}`,
        category:        ticketCategory,
        ticket_type:     subType === 'code_contribution' ? 'feature' : 'task',
        priority:        priorityMap[urgency] ?? 'medium',
        status:          'open',
        assigned_to:     assignTo,
        assigned_name:   assignName,
        created_by:      caller.userId,
        created_by_name: null,
        notify_user_ids: notifyIds,
        auto_routed:     true,
      })
      .select('id, ticket_number')
      .single()

    if (ticket && notifyIds.length > 0) {
      const notifications = notifyIds.map((uid: string) => ({
        ticket_id: ticket.id,
        user_id:   uid,
        message:   `${ticket.ticket_number}: ${title.trim()} — new request from ${caller.department}`,
      }))
      await (admin as any).schema('axis').from('ticket_notifications').insert(notifications)
    }

    return NextResponse.json({ ok: true, ticket_number: ticket?.ticket_number })
  } catch (ticketErr) {
    // Ticket creation failure should not block the request submission
    console.error('[api/axis/requests POST] ticket creation failed', ticketErr)
    return NextResponse.json({ ok: true })
  }
}
