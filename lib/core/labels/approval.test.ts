import { describe, it, expect } from 'vitest'
import {
  jobCardGate, printGate, signOffState, signOffsForVersion, approvalSummary,
  TEMPLATE_SIGN_OFFS, PRINT_SIGN_OFFS,
  type SignOff, type SignOffRole, type JobCardGateInput, type PrintGateInput,
} from './approval'

const ALYSSA = 'b72f70cb-a721-4652-9c63-05f6b3ac1e7e'
const SHAUN  = '11111111-2222-3333-4444-555555555555'

const sig = (
  role: SignOffRole,
  p: Partial<SignOff> = {},
): SignOff => ({
  role,
  actorName: 'Someone',
  actorEmployeeId: null,
  signedAt: '2026-09-09T08:00:00Z',
  templateVersion: 1,
  ...p,
})

/** All four template sign-offs, version 1. */
const fullTemplate = (): SignOff[] => TEMPLATE_SIGN_OFFS.map(r => sig(r))

const base = (p: Partial<JobCardGateInput> = {}): JobCardGateInput => ({
  status: 'approved',
  templateVersion: 1,
  signOffs: fullTemplate(),
  poAssigned: true,
  ...p,
})

const printBase = (p: Partial<PrintGateInput> = {}): PrintGateInput => ({
  ...base(),
  printSignOffs: [
    sig('sales_lead',         { actorEmployeeId: ALYSSA, actorName: 'Alyssa Krishna' }),
    sig('quality_supervisor', { actorEmployeeId: SHAUN,  actorName: 'Shaun De Beer' }),
  ],
  ...p,
})

describe('signOffState', () => {
  it('reports what is outstanding, in the order the chain happens', () => {
    const s = signOffState(TEMPLATE_SIGN_OFFS, [sig('sales'), sig('quality')])
    expect(s.complete).toBe(false)
    expect(s.outstanding).toEqual(['customer', 'certifier'])
  })

  it('the latest signature for a role wins, so a re-sign replaces the old one', () => {
    const s = signOffState(['sales'] as const, [
      sig('sales', { actorName: 'First',  signedAt: '2026-09-01T00:00:00Z' }),
      sig('sales', { actorName: 'Second', signedAt: '2026-09-08T00:00:00Z' }),
    ])
    expect(s.signed).toHaveLength(1)
    expect(s.signed[0].actorName).toBe('Second')
  })

  it('ignores a signature for a role that is not required here', () => {
    const s = signOffState(PRINT_SIGN_OFFS, [sig('certifier'), sig('sales_lead'), sig('quality_supervisor')])
    expect(s.complete).toBe(true)
    expect(s.signed.map(x => x.role)).toEqual(['sales_lead', 'quality_supervisor'])
  })
})

describe('signOffsForVersion', () => {
  it('drops signatures given against an earlier version of the artwork', () => {
    // Editing an approved label supersedes it. A v1 signature says nothing
    // about v2, and carrying it forward is how a label reaches the floor with
    // an approval nobody gave.
    const kept = signOffsForVersion([sig('sales', { templateVersion: 1 }), sig('quality', { templateVersion: 2 })], 2)
    expect(kept.map(s => s.role)).toEqual(['quality'])
  })
})

describe('jobCardGate', () => {
  it('opens when the template is approved, fully signed, and has a PO', () => {
    expect(jobCardGate(base()).open).toBe(true)
  })

  it('names Quality when Quality has not signed', () => {
    const g = jobCardGate(base({ signOffs: fullTemplate().filter(s => s.role !== 'quality') }))
    expect(g.open).toBe(false)
    expect(g.blockedBy.map(b => b.key)).toContain('unsigned:quality')
    expect(g.blockedBy.find(b => b.key === 'unsigned:quality')!.reason)
      .toBe('Quality department has not signed off version 1.')
  })

  it('is shut without a customer PO even when everything is signed', () => {
    const g = jobCardGate(base({ poAssigned: false }))
    expect(g.open).toBe(false)
    expect(g.blockedBy.map(b => b.key)).toEqual(['no_po'])
  })

  it('is shut on a superseded version, and says so rather than listing signatures', () => {
    const g = jobCardGate(base({ status: 'superseded' }))
    expect(g.blockedBy[0].key).toBe('superseded')
  })

  it('treats a bumped version as unsigned — v1 approvals do not carry to v2', () => {
    const g = jobCardGate(base({ templateVersion: 2 }))
    expect(g.open).toBe(false)
    expect(g.blockedBy.map(b => b.key)).toEqual([
      'unsigned:sales', 'unsigned:quality', 'unsigned:customer', 'unsigned:certifier',
    ])
  })

  it('lists every reason at once, not just the first', () => {
    // A screen that reveals one blocker per attempt makes four round trips
    // out of one conversation.
    const g = jobCardGate({ status: 'draft', templateVersion: 1, signOffs: [], poAssigned: false })
    expect(g.blockedBy.length).toBe(6)   // not approved + 4 unsigned + no PO
  })
})

describe('printGate', () => {
  it('opens when the job card gate is open and both names have signed', () => {
    expect(printGate(printBase()).open).toBe(true)
  })

  it('refuses when the same person signs both halves', () => {
    // One pair of eyes wearing two hats is the thing a second signature exists
    // to prevent.
    const g = printGate(printBase({
      printSignOffs: [
        sig('sales_lead',         { actorEmployeeId: ALYSSA, actorName: 'Alyssa Krishna' }),
        sig('quality_supervisor', { actorEmployeeId: ALYSSA, actorName: 'Alyssa Krishna' }),
      ],
    }))
    expect(g.open).toBe(false)
    expect(g.blockedBy.map(b => b.key)).toContain('same_signer')
  })

  it('catches the same person by NAME when neither is linked to the Staff Directory', () => {
    const g = printGate(printBase({
      printSignOffs: [
        sig('sales_lead',         { actorEmployeeId: null, actorName: ' Rene Wolfaardt ' }),
        sig('quality_supervisor', { actorEmployeeId: null, actorName: 'rene wolfaardt' }),
      ],
    }))
    expect(g.blockedBy.map(b => b.key)).toContain('same_signer')
  })

  it('allows two different people with no Staff Directory link', () => {
    const g = printGate(printBase({
      printSignOffs: [
        sig('sales_lead',         { actorEmployeeId: null, actorName: 'Rene Wolfaardt' }),
        sig('quality_supervisor', { actorEmployeeId: null, actorName: 'Sibusiso Magqujana' }),
      ],
    }))
    expect(g.open).toBe(true)
  })

  it('names the missing half when only one has signed', () => {
    const g = printGate(printBase({
      printSignOffs: [sig('sales_lead', { actorEmployeeId: ALYSSA })],
    }))
    expect(g.blockedBy.map(b => b.key)).toEqual(['unsigned:quality_supervisor'])
    expect(g.blockedBy[0].reason).toBe('Quality supervisor has not signed the test label.')
  })

  it('never opens on an unapproved template, however well signed the test label is', () => {
    const g = printGate(printBase({ status: 'draft', signOffs: [] }))
    expect(g.open).toBe(false)
    expect(g.blockedBy.map(b => b.key)).toContain('not_approved')
  })

  it('does not report same_signer while a half is still outstanding', () => {
    // Otherwise a one-signature card reads as two faults, and the second one
    // is not true yet.
    const g = printGate(printBase({ printSignOffs: [sig('sales_lead', { actorEmployeeId: ALYSSA })] }))
    expect(g.blockedBy.map(b => b.key)).not.toContain('same_signer')
  })
})

describe('approvalSummary', () => {
  it('answers both gates from one call, so three screens cannot disagree', () => {
    const s = approvalSummary(printBase())
    expect(s.jobCard.open).toBe(true)
    expect(s.print_.open).toBe(true)
    expect(s.template.complete).toBe(true)
    expect(s.print.complete).toBe(true)
  })

  it('a job card can be raised before the test label is signed — that is the point of two gates', () => {
    const s = approvalSummary(printBase({ printSignOffs: [] }))
    expect(s.jobCard.open).toBe(true)
    expect(s.print_.open).toBe(false)
  })
})
