import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChangeoverTrigger } from './ChangeoverTrigger'
import { ChangeoverDialog } from './ChangeoverDialog'
import { planChangeover } from '@/lib/core/changeover'

/**
 * The changeover UI reads one `ChangeoverPlan` and must never offer an option
 * the handler would refuse — ARCHITECTURE.md §4, "gate validation on the same
 * condition as the render", the class behind PRs #722 / #752 / #756.
 *
 * These build plans through `planChangeover()` rather than hand-writing plan
 * objects. A hand-written plan can express a state core would never produce,
 * and then the test passes while the real screen breaks. The inputs below are
 * the four states a Sieving shift actually reaches.
 */

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

const CONVENTIONAL_WITH_LEFTOVER = planChangeover({
  variant: 'Conventional', totalIn: 1000, totalOut: 850, isSupervisor: true,
})
const CONVENTIONAL_ALL_BAGGED = planChangeover({
  variant: 'Conventional', totalIn: 1000, totalOut: 1000, isSupervisor: true,
})
const ORGANIC = planChangeover({
  variant: 'Organic', totalIn: 1000, totalOut: 850, isSupervisor: true,
})
const NOT_SUPERVISOR = planChangeover({
  variant: 'Conventional', totalIn: 1000, totalOut: 850, isSupervisor: false,
})

describe('ChangeoverTrigger', () => {
  it('offers the changeover to a supervisor', () => {
    const out = html(<ChangeoverTrigger plan={CONVENTIONAL_WITH_LEFTOVER} busy={false} onOpen={() => {}} />)
    expect(out).toContain('<button')
    expect(out).toContain('switch grade/variant')
  })

  it('gives an operator the reason instead of a dead button', () => {
    const out = html(<ChangeoverTrigger plan={NOT_SUPERVISOR} busy={false} onOpen={() => {}} />)
    expect(out).not.toContain('<button')
    expect(out).toContain(NOT_SUPERVISOR.blockedReason!)
  })

  it('disables itself while a changeover is in flight', () => {
    const out = html(<ChangeoverTrigger plan={CONVENTIONAL_WITH_LEFTOVER} busy onOpen={() => {}} />)
    expect(out).toContain('disabled')
  })
})

describe('ChangeoverDialog', () => {
  const render = (plan: typeof CONVENTIONAL_WITH_LEFTOVER, busy = false) =>
    html(
      <ChangeoverDialog
        plan={plan} variantLabel="Conventional" busy={busy}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    )

  it('always offers the clean start', () => {
    for (const plan of [CONVENTIONAL_WITH_LEFTOVER, CONVENTIONAL_ALL_BAGGED, ORGANIC]) {
      expect(render(plan)).toContain('Start a clean record')
    }
  })

  it('offers the carry option, with the mass, when there is leftover to carry', () => {
    const out = render(CONVENTIONAL_WITH_LEFTOVER)
    expect(out).toContain('Continue leftover material into the new record')
    expect(out).toContain('150.0 kg')
  })

  it('does NOT offer the carry option for organic, and says why', () => {
    const out = render(ORGANIC)
    expect(out).not.toContain('Continue leftover material into the new record')
    expect(out).toContain('organic material must stay segregated')
    expect(out).toContain(ORGANIC.carryRefusalReason!)
  })

  it('does NOT offer the carry option when nothing is left over', () => {
    const out = render(CONVENTIONAL_ALL_BAGGED)
    expect(out).not.toContain('Continue leftover material into the new record')
  })

  it('stays silent about "nothing left" rather than explaining the obvious', () => {
    // The refusal reason is shown for organic and unknown variants, where the
    // supervisor came to use an option and needs to know it was refused. With
    // nothing left over there is nothing to explain, so the line is omitted.
    expect(CONVENTIONAL_ALL_BAGGED.carryRefusal).toBe('nothing-left')
    expect(render(CONVENTIONAL_ALL_BAGGED)).not.toContain(CONVENTIONAL_ALL_BAGGED.carryRefusalReason!)
  })

  it('names the variant when it refuses on organic grounds', () => {
    const out = html(
      <ChangeoverDialog
        plan={ORGANIC} variantLabel="Fairtrade Organic" busy={false}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    )
    expect(out).toContain('Fairtrade Organic')
  })

  it('shows progress and locks every button while in flight', () => {
    const out = render(CONVENTIONAL_WITH_LEFTOVER, true)
    expect(out).toContain('Opening new record')
    // Clean start, carry, and cancel — a half-locked dialog is how a changeover
    // gets fired twice. Match the ATTRIBUTE, not the substring: these buttons
    // also carry Tailwind's `disabled:opacity-60`, so a bare /disabled/ count
    // reads 8 and would pass whatever the buttons actually did.
    expect(out.match(/disabled=""/g)?.length).toBe(3)
  })
})

describe('the trigger and the dialog cannot disagree', () => {
  /**
   * The invariant the split exists to guarantee. Whatever the plan says about
   * carrying material, BOTH components must reflect it — the dialog offering an
   * option the handler refuses is the exact defect this replaced.
   */
  const cases = [CONVENTIONAL_WITH_LEFTOVER, CONVENTIONAL_ALL_BAGGED, ORGANIC, NOT_SUPERVISOR]

  it.each(cases.map((p, i) => [i, p] as const))('plan %i', (_i, plan) => {
    const dialog = html(
      <ChangeoverDialog plan={plan} variantLabel="x" busy={false} onConfirm={() => {}} onCancel={() => {}} />,
    )
    const offersCarry = dialog.includes('Continue leftover material into the new record')
    expect(offersCarry).toBe(plan.mayCarry)

    const trigger = html(<ChangeoverTrigger plan={plan} busy={false} onOpen={() => {}} />)
    expect(trigger.includes('<button')).toBe(plan.allowed)
  })
})
