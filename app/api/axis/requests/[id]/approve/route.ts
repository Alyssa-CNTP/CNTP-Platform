// app/api/axis/requests/[id]/approve/route.ts
// Approve a project_request:
//   1. Generate sequential project code (PRJ-005, PRJ-006, …)
//   2. Create the project + tracks
//   3. Notify the requester
//   4. Fire n8n webhook → creates OneDrive folder + uploads Word brief

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

const VALID_PRIORITY = ['high', 'mid', 'low']
const VALID_TERM     = ['short', 'long', 'ongoing']
const VALID_EFFORT   = ['S', 'M', 'L', 'XL']

// ─── Sequential project code generator ────────────────────────────────────────

async function nextProjectCode(axis: any): Promise<string> {
  // Get the highest existing code number (e.g. "PRJ-004" → 4)
  const { data } = await axis
    .from('projects')
    .select('project_code')
    .not('project_code', 'is', null)
    .order('project_code', { ascending: false })
    .limit(1)

  let next = 1
  if (data && data.length > 0 && data[0].project_code) {
    const match = String(data[0].project_code).match(/PRJ-(\d+)/)
    if (match) next = parseInt(match[1], 10) + 1
  }
  // Also ensure we're at least at 5 (PRJ-001 to PRJ-004 exist in OneDrive already)
  if (next < 5) next = 5

  return `PRJ-${String(next).padStart(3, '0')}`
}

// ─── n8n webhook trigger ───────────────────────────────────────────────────────

async function triggerN8n(payload: any) {
  const webhookUrl = process.env.N8N_AXIS_WEBHOOK_URL
  if (!webhookUrl) return // n8n not configured — skip silently

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': process.env.N8N_WEBHOOK_SECRET || '',
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('[approve] n8n webhook failed (non-fatal):', err)
    // Never block approval because n8n is down
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const body = await req.json()
  const {
    priority, term, effort_size,
    target_start, target_end,
    hard_deadline, deadline_reason,
    tracks,
    it_audit_checklist,  // Code Contribution IT audit sign-off
  } = body

  if (!VALID_PRIORITY.includes(priority))    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  if (!VALID_TERM.includes(term))            return NextResponse.json({ error: 'Invalid term' }, { status: 400 })
  if (!VALID_EFFORT.includes(effort_size))   return NextResponse.json({ error: 'Invalid effort_size' }, { status: 400 })
  if (!Array.isArray(tracks) || tracks.length === 0)
    return NextResponse.json({ error: 'At least one track is required' }, { status: 400 })

  const axis = (getAdminClient() as any).schema('axis')

  // 1. Load the request
  const { data: reqData, error: reqErr } = await axis
    .from('project_requests').select('*').eq('id', id).single()
  if (reqErr || !reqData) {
    console.error('[approve] request lookup', reqErr)
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // 2. Generate project code
  const projectCode = await nextProjectCode(axis)

  // 3. Insert the project
  const { data: project, error: projErr } = await axis
    .from('projects')
    .insert({
      request_id:      id,
      name:            reqData.title,
      description:     reqData.description,
      priority,
      term,
      effort_size,
      target_start:    target_start || null,
      target_end:      target_end || null,
      hard_deadline:   !!hard_deadline,
      deadline_reason: deadline_reason || null,
      lead_dev_id:     caller.userId,
      approved_by:     caller.userId,
      status:          'active',
      project_code:    projectCode,
    })
    .select('id')
    .single()

  if (projErr || !project) {
    console.error('[approve] project insert', projErr)
    return NextResponse.json({ error: projErr?.message ?? 'Failed to create project' }, { status: 500 })
  }

  // 4. Insert tracks
  const { error: tracksErr } = await axis.from('project_tracks').insert(
    tracks.map((t: string) => ({
      project_id:        project.id,
      track_type:        t,
      progress_pct:      0,
      current_milestone: 'Not started',
      updated_by:        caller.userId,
    }))
  )
  if (tracksErr) {
    console.error('[approve] tracks insert', tracksErr)
    return NextResponse.json({ error: tracksErr.message }, { status: 500 })
  }

  // 5. Save IT audit checklist back to the request (for Code Contributions)
  if (it_audit_checklist && Object.keys(it_audit_checklist).length > 0) {
    await axis.from('project_requests').update({ it_audit_checklist }).eq('id', id)
  }

  // 6. Mark the request approved
  const { error: updErr } = await axis
    .from('project_requests')
    .update({ status: 'approved', reviewed_by: caller.userId, reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (updErr) console.error('[approve] request update', updErr)

  // 7. Notify the submitter
  const { error: notifErr } = await axis.from('notifications').insert({
    recipient_id:    reqData.submitted_by,
    type:            'project_approved',
    title:           `Project approved — ${projectCode}`,
    body:            `Your project "${reqData.title}" has been approved as ${projectCode}. IT will begin the integration process.`,
    reference_id:    project.id,
    reference_table: 'projects',
  })
  if (notifErr) console.error('[approve] notification insert', notifErr)

  // 8. Fire n8n webhook (non-blocking)
  // n8n will:
  //   a) Create 07_Projects & Portfolios/Active/PRJ-XXX_Name/ on OneDrive
  //   b) Create subfolders: Brief/, Technical/, Changelog/, Delivery/
  //   c) Call /api/axis/projects/{id}/brief to download the Word document
  //   d) Upload the Word brief to Brief/
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || ''
  await triggerN8n({
    event:        'project_approved',
    project_id:   project.id,
    project_code: projectCode,
    project_name: reqData.title,
    // Sanitised folder name: PRJ-005_Quality-Module
    folder_name:  `${projectCode}_${reqData.title.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-')}`,
    submission_type: reqData.submission_type || 'feature_request',
    onedrive_url:    reqData.onedrive_url || null,
    brief_url:    `${appUrl}/api/axis/projects/${project.id}/brief`,
    approved_at:  new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, project_id: project.id, project_code: projectCode })
}
