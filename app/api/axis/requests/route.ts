// app/api/axis/requests/route.ts
// GET: list project_requests routed to the Consideration board (major_project /
//      code_contribution only — IT triage board).
// POST: submit a new request. Four types:
//   feature_change    — "Changes to current/new feature", routes to Tickets
//   major_project     — formal project proposal, routes to Consideration board
//   code_contribution — code submission for IT audit, routes to Consideration board
//   suggestion        — anonymous idea/problem/question, routes to Tickets

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { getTicketManagerIds, resolveRecipients } from '@/lib/notifications/recipients'

const VALID_SUBMISSION_TYPES = new Set(['feature_change', 'major_project', 'code_contribution', 'suggestion'])
const VALID_SUGGESTION_CATEGORIES = new Set(['improvement', 'problem', 'question', 'general'])
const PRIORITY_MAP: Record<string, string> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' }

// The Consideration board only ever shows major_project / code_contribution
// requests — feature_change and suggestion route straight to Tickets instead
// (see POST below), so they never need IT triage on this board.
const BOARD_SUBMISSION_TYPES = ['major_project', 'code_contribution']

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { data, error } = await (getAdminClient() as any)
    .schema('axis')
    .from('project_requests')
    .select('*')
    .in('submission_type', BOARD_SUBMISSION_TYPES)
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
    submission_type, page_module,
    category, // suggestion only: improvement | problem | question | general
    // Code Contribution Protocol fields (optional, only when submission_type === 'code_contribution')
    onedrive_url, schema_proposal, code_source, ai_tool_used,
    code_author, preflight_checklist,
  } = await req.json()

  const subType = VALID_SUBMISSION_TYPES.has(submission_type) ? submission_type : null
  if (!subType) return NextResponse.json({ error: 'Invalid submission_type' }, { status: 400 })

  const isSuggestion    = subType === 'suggestion'
  const isFeatureChange = subType === 'feature_change'
  const isCode          = subType === 'code_contribution'

  if (!title?.trim())       return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (!description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 })

  // business_justification ("why necessary") is required for major_project,
  // code_contribution, and feature_change. Suggestions don't have a separate
  // justification field.
  if (!isSuggestion && !business_justification?.trim())
    return NextResponse.json({ error: 'Business justification is required' }, { status: 400 })

  if (isFeatureChange && !page_module?.trim())
    return NextResponse.json({ error: 'Page/module is required' }, { status: 400 })

  const suggestionCategory = isSuggestion && VALID_SUGGESTION_CATEGORIES.has(category) ? category : 'general'
  if (isSuggestion && category && suggestionCategory !== category)
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })

  // Suggestions derive urgency from category (problem → high) rather than an
  // explicit picker in the UI, matching how the tab has always worked.
  const resolvedUrgency = isSuggestion ? (suggestionCategory === 'problem' ? 'high' : 'medium') : urgency
  const validUrgencies = ['low', 'medium', 'high', 'critical']
  if (!validUrgencies.includes(resolvedUrgency))
    return NextResponse.json({ error: 'Invalid urgency' }, { status: 400 })

  // Code Contribution Protocol — extra fields, only attached when relevant
  const codeFields = isCode ? {
    ...(onedrive_url        ? { onedrive_url:        String(onedrive_url).trim() } : {}),
    ...(schema_proposal     ? { schema_proposal                                  } : {}),
    ...(code_source         ? { code_source                                       } : {}),
    ...(ai_tool_used        ? { ai_tool_used:        String(ai_tool_used).trim() } : {}),
    ...(code_author         ? { code_author:         String(code_author).trim()  } : {}),
    ...(preflight_checklist ? { preflight_checklist                              } : {}),
  } : {}

  const admin = getAdminClient()
  const axis  = (admin as any).schema('axis')

  const { data: created, error } = await axis
    .from('project_requests')
    .insert({
      title:                  title.trim(),
      description:            description.trim(),
      business_justification: isSuggestion ? null : business_justification.trim(),
      urgency:                resolvedUrgency,
      requesting_dept:        caller.department,
      // True anonymity for suggestions — submitted_by is never stored, not just hidden in the UI.
      submitted_by:           isSuggestion ? null : caller.userId,
      is_anonymous:           isSuggestion,
      status:                 'pending',
      submission_type:        subType,
      ...(isFeatureChange ? { page_module: String(page_module).trim() } : {}),
      ...codeFields,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[api/axis/requests POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // major_project / code_contribution go to the Consideration board only —
  // no linked ticket (that used to duplicate every submission into a ticket
  // AND a request; the board is now the sole tracking surface for these two).
  if (!isFeatureChange && !isSuggestion) {
    return NextResponse.json({ ok: true, request_id: created?.id })
  }

  // feature_change / suggestion: Tickets is their tracking surface. Created
  // unassigned — no auto-routing — and every eligible ticket manager is
  // notified so it doesn't sit unnoticed.
  try {
    const ticketDescription = isFeatureChange
      ? `${description.trim()}\n\nPage/module: ${page_module}\n\nWhy necessary: ${business_justification.trim()}`
      : `Category: ${suggestionCategory}\n\n${description.trim()}`

    const { data: ticket, error: ticketErr } = await axis
      .from('tickets')
      .insert({
        title:                 title.trim(),
        description:           ticketDescription,
        category:              isFeatureChange ? 'app' : 'general',
        ticket_type:           isFeatureChange ? 'feature' : 'task',
        priority:              PRIORITY_MAP[resolvedUrgency] ?? 'medium',
        status:                'open',
        assigned_to:           null,
        assigned_name:         null,
        created_by:            isSuggestion ? null : caller.userId,
        created_by_name:       null,
        submitter_department:  caller.department,
        is_anonymous:          isSuggestion,
        request_id:            created?.id ?? null,
      })
      .select('id, ticket_number')
      .single()

    if (ticketErr) throw ticketErr

    if (ticket) {
      const managerIds = await getTicketManagerIds()
      const recipients  = await resolveRecipients(managerIds)
      if (recipients.length > 0) {
        await notify({
          recipients,
          kind:     'ticket_created',
          title:    `New ticket ${ticket.ticket_number}`,
          body:     title.trim(),
          url:      '/axis/tickets',
          channels: ['inApp'],
        })
      }
    }

    return NextResponse.json({ ok: true, ticket_number: ticket?.ticket_number })
  } catch (ticketErr) {
    // Ticket creation failure should not block the request submission
    console.error('[api/axis/requests POST] ticket creation failed', ticketErr)
    return NextResponse.json({ ok: true })
  }
}
