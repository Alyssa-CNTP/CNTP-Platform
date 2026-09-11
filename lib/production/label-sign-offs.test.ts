import { describe, it, expect } from 'vitest'
import {
  EXTERNAL_SIGN_OFF_ROLES, SIGN_OFF_PERMISSION,
  latestByRole, outstandingPrintRoles, outstandingTemplateRoles,
  readSignOffs, splitSignOffs, toSignOff,
  type SignOffReadable, type SignOffRow,
} from './label-sign-offs'
import type { SignOffRole } from '@/lib/core/labels'

const row = (over: Partial<SignOffRow> = {}): SignOffRow => ({
  scope: 'template',
  role: 'sales',
  template_id: 'tpl-1',
  template_version: 1,
  job_card_id: null,
  actor_name: 'Sales Person',
  actor_employee_id: 'emp-1',
  signed_at: '2026-09-10T08:00:00.000Z',
  ...over,
})

describe('toSignOff', () => {
  it('carries the version, because a signature is against one version of the artwork', () => {
    expect(toSignOff(row({ template_version: 3 })).templateVersion).toBe(3)
  })

  it('survives a null actor rather than producing "null" as a name', () => {
    const s = toSignOff(row({ actor_name: null, actor_employee_id: null }))
    expect(s.actorName).toBe('')
    expect(s.actorEmployeeId).toBeNull()
  })
})

describe('latestByRole — the template scope is version-scoped', () => {
  it('a version 1 signature does not satisfy version 2', () => {
    const rows = [row({ role: 'quality', template_version: 1 })]
    expect(latestByRole(rows, 'template', { templateVersion: 2 }).size).toBe(0)
    expect(latestByRole(rows, 'template', { templateVersion: 1 }).size).toBe(1)
  })

  it('the LAST signature for a role wins, so a re-sign replaces rather than stacks', () => {
    const rows = [
      row({ role: 'sales', actor_name: 'First',  signed_at: '2026-09-10T08:00:00.000Z' }),
      row({ role: 'sales', actor_name: 'Second', signed_at: '2026-09-10T09:00:00.000Z' }),
    ]
    const got = latestByRole(rows, 'template', { templateVersion: 1 })
    expect(got.size).toBe(1)
    expect(got.get('sales')?.actor_name).toBe('Second')
  })

  it('ignores the other scope entirely', () => {
    const rows = [row({ scope: 'print', role: 'sales_lead', job_card_id: 'jc-1' })]
    expect(latestByRole(rows, 'template', { templateVersion: 1 }).size).toBe(0)
  })
})

describe('latestByRole — the print scope is job-card-scoped', () => {
  const rows: SignOffRow[] = [
    row({ scope: 'print', role: 'sales_lead',         job_card_id: 'jc-1' }),
    row({ scope: 'print', role: 'quality_supervisor', job_card_id: 'jc-2' }),
  ]

  it("another card's signature does not count towards this card", () => {
    const got = latestByRole(rows, 'print', { jobCardId: 'jc-1' })
    expect([...got.keys()]).toEqual(['sales_lead'])
  })

  it('each card sees only its own', () => {
    expect([...latestByRole(rows, 'print', { jobCardId: 'jc-2' }).keys()])
      .toEqual(['quality_supervisor'])
  })
})

describe('splitSignOffs', () => {
  const rows: SignOffRow[] = [
    row({ role: 'sales' }),
    row({ role: 'quality' }),
    row({ scope: 'print', role: 'sales_lead',         job_card_id: 'jc-1' }),
    row({ scope: 'print', role: 'quality_supervisor', job_card_id: 'other' }),
  ]

  it('separates the two gates and narrows print to one run', () => {
    const { template, print } = splitSignOffs(rows, 'jc-1')
    expect(template.map(s => s.role)).toEqual(['sales', 'quality'])
    expect(print.map(s => s.role)).toEqual(['sales_lead'])
  })

  it('without a job card it keeps every print signature — the job-card gate does not use them', () => {
    expect(splitSignOffs(rows).print).toHaveLength(2)
  })
})

describe('outstanding roles', () => {
  it('reports the three the template chain is still waiting on', () => {
    const got = outstandingTemplateRoles([row({ role: 'sales' })], 1)
    expect(got).toEqual(['quality', 'customer', 'certifier'])
  })

  it('counts nothing signed against a different version', () => {
    const rows = [
      row({ role: 'sales',     template_version: 1 }),
      row({ role: 'quality',   template_version: 1 }),
      row({ role: 'customer',  template_version: 1 }),
      row({ role: 'certifier', template_version: 1 }),
    ]
    expect(outstandingTemplateRoles(rows, 1)).toEqual([])
    expect(outstandingTemplateRoles(rows, 2))
      .toEqual(['sales', 'quality', 'customer', 'certifier'])
  })

  it('reports the outstanding half of the print pair, per card', () => {
    const rows = [row({ scope: 'print', role: 'sales_lead', job_card_id: 'jc-1' })]
    expect(outstandingPrintRoles(rows, 'jc-1')).toEqual(['quality_supervisor'])
    expect(outstandingPrintRoles(rows, 'jc-2'))
      .toEqual(['sales_lead', 'quality_supervisor'])
  })
})

describe('readSignOffs fails SHUT', () => {
  const client = (result: { data: unknown; error: unknown } | Error): SignOffReadable => ({
    from: () => ({
      select: () => ({
        eq: () => (result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result)),
      }),
    }),
  })

  it('returns the rows on success', async () => {
    expect(await readSignOffs(client({ data: [row()], error: null }), 'tpl-1')).toHaveLength(1)
  })

  it('returns nothing when the table is missing, so every role reads as outstanding', async () => {
    const missing = { data: null, error: { code: 'PGRST205', message: 'no such table' } }
    const got = await readSignOffs(client(missing), 'tpl-1')
    expect(got).toEqual([])
    // Which is the point: no signatures means the gate is shut, not open.
    expect(outstandingTemplateRoles(got, 1))
      .toEqual(['sales', 'quality', 'customer', 'certifier'])
  })

  it('returns nothing when the client throws outright', async () => {
    expect(await readSignOffs(client(new Error('offline')), 'tpl-1')).toEqual([])
  })

  it('treats a null payload as no signatures rather than crashing', async () => {
    expect(await readSignOffs(client({ data: null, error: null }), 'tpl-1')).toEqual([])
  })
})

describe('who may sign as whom', () => {
  it('Quality does NOT sign on can_approve_labels — one key for both is one pair of eyes', () => {
    expect(SIGN_OFF_PERMISSION.quality).toBe('can_quality_sign_labels')
    expect(SIGN_OFF_PERMISSION.quality).not.toBe(SIGN_OFF_PERMISSION.sales)
  })

  it('the print pair splits the same way, for the same reason', () => {
    expect(SIGN_OFF_PERMISSION.sales_lead).not.toBe(SIGN_OFF_PERMISSION.quality_supervisor)
  })

  it('covers every role, so no role is silently unsignable', () => {
    const roles: SignOffRole[] =
      ['sales', 'quality', 'customer', 'certifier', 'sales_lead', 'quality_supervisor']
    for (const r of roles) expect(SIGN_OFF_PERMISSION[r]).toBeTruthy()
  })

  it('only the customer and the certifier are outside the building', () => {
    expect([...EXTERNAL_SIGN_OFF_ROLES].sort()).toEqual(['certifier', 'customer'])
  })
})
