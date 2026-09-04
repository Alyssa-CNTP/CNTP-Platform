import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SievingCapture, emptySievingData } from './SievingCapture'
import { RefiningCapture, emptyRefiningData } from './RefiningCapture'
import { GranuleCapture, emptyGranuleData } from './GranuleCapture'
import { BlenderCapture, emptyBlenderData } from './BlenderCapture'
import { PasteuriserCapture, emptyPasteuriserData } from './PasteuriserCapture'
import CaptureOverview from './CaptureOverview'
import type { ShiftAssignment } from '@/lib/supabase/database.types'

/**
 * Props differ per section, so the table below is heterogeneous by nature.
 * `unknown` rather than `any` keeps the lint ratchet where it is; the cast
 * happens once, in render(), instead of five times in the fixtures.
 */
type AnyCaptureComponent = (props: Record<string, unknown>) => React.ReactNode

/**
 * Render smoke test — the regression net for "a change in one section takes
 * another section's screen down".
 *
 * ── Why server rendering, and not jsdom ─────────────────────────────────────
 *
 * `vitest.config.mts` used to say component tests belong in Playwright. That was
 * written on the assumption that Playwright could run them. It cannot: the app
 * signs in through Microsoft SSO, which is not scriptable and must not be
 * scripted with stored credentials, so every spec skips in CI and the job proves
 * nothing (ARCHITECTURE.md §8). The premise changed; this is the consequence.
 *
 * `renderToStaticMarkup` runs the render pass in plain node — no DOM, no new
 * dependency, no auth, ~2 s in CI on every PR. What it catches is exactly the
 * failure this module's rework exists to prevent: a component that THROWS while
 * rendering, because a field it reads moved, changed shape, or went away.
 *
 * ── What it deliberately does not cover ─────────────────────────────────────
 *
 * `useEffect` does not run during a server render, so nothing here touches the
 * database, the scanner, or localStorage — which is why no mocking is needed.
 * The flip side is that effects, event handlers and anything browser-only are
 * NOT exercised. This is a crash detector for the render pass, not an
 * integration test, and it is not a substitute for the Playwright suite once
 * that has a way to authenticate.
 *
 * ── Keep the fixtures realistic ─────────────────────────────────────────────
 *
 * The first draft of this passed `assignment={null}` and "found" a crash in
 * SievingCapture. It was not a crash: the capture page guards with
 * `if (!assignment) return` well above the render, so a null never reaches the
 * component. A fixture that is not a state the app can actually be in produces
 * false alarms, which is worse than no test. Every fixture below is a state the
 * capture page can genuinely hand these components.
 */

const assignment: ShiftAssignment = {
  id: 'a1', date: '2026-09-04', shift: 'morning', section_id: 'sieving',
  operator_ids: [], lot_number: 'GS-0299', variant: 'Organic',
  production_orders: null, notes: null, assigned_by: null,
  created_at: '2026-09-04T05:00:00Z', updated_at: '2026-09-04T05:00:00Z',
}

const common = {
  assignment,
  variantWord: 'Organic',
  locked: false,
  onChange: () => {},
  genSerial: () => 'X-001',
  operatorId: null,
  date: '2026-09-04',
}

/** Populated shapes — a shift that has actually captured something. */
const sievingFull = {
  ...emptySievingData(),
  spillage: [{ id: 's0', kg: '120' }, { id: 's1', kg: '8.5' }],
  debag: [{ id: 'd1', bag_no: '17', lot: 'GS-0299', gross: '505', nett: '500',
            delivery_date: '2026-09-01', grade: 'Export', secured: true,
            logged_at: '2026-09-04T09:30:00Z' }],
  outputs: [{ id: 'o1', serial: 'STFL-04092026-001', productType: 'Fine Leaf',
              code: '10LGEF-O', description: 'Fine Leaf Export', weight: '25',
              batch: 'GS-0299', destination: 'A', printed: true, secured: true,
              logged_at: '2026-09-04T10:00:00Z' }],
}

const refiningFull = {
  ...emptyRefiningData(),
  inputs: [{ id: 'i1', serial: 'STFL-04092026-001', productType: 'Fine Leaf',
             variant: 'Organic', lot: 'GS-0299', weight: '25', inputMode: 'scan',
             deliveryDate: '2026-09-04', secured: true, logged_at: '2026-09-04T11:00:00Z' }],
}

const granuleFull = {
  ...emptyGranuleData(),
  blends: [{ id: 'bl1', blendNo: 1, done: false, rows: [
    { id: 'r1', dustKey: 'sgd', serial: 'GLSGD-04092026-001', variant: 'Organic',
      lot: '', weight: '40', inputMode: 'scan', secured: true,
      logged_at: '2026-09-04T12:00:00Z' },
  ] }],
}

const blenderFull = {
  ...emptyBlenderData(),
  inputs: [{ id: 'i1', serial: 'STFL-04092026-001', productType: 'Fine Leaf',
             variant: 'Organic', lot: 'GS-0299', weight: '30', inputMode: 'scan',
             destination: 'A', secured: true, logged_at: '2026-09-04T13:00:00Z' }],
}

const pasteuriserFull = {
  ...emptyPasteuriserData(),
  batchNo: 'PB-0912',
  debag: [{ id: 'i1', serial: 'BL-SFCKUN25-04092026-1-001', productType: 'Blend SFCKUN25',
            variant: 'Organic', lot: '', weight: '200', inputMode: 'scan',
            stream: 'main', secured: true, logged_at: '2026-09-04T14:00:00Z' }],
}

type Case = [
  name: string,
  Comp: AnyCaptureComponent,
  empty: unknown,
  full: unknown,
  extra: Record<string, unknown>,
]

const SECTIONS: Case[] = ([
  ['Sieving Tower', SievingCapture,     emptySievingData(),     sievingFull,
    { sectionId: 'sieving', gradeLetter: 'A', shift: 'morning', sessionId: null }],
  ['Refining 1',    RefiningCapture,    emptyRefiningData(),    refiningFull,
    { sectionId: 'refining1' }],
  ['Granule Line',  GranuleCapture,     emptyGranuleData(),     granuleFull,
    { sectionId: 'granule', shift: 'morning', sessionId: null }],
  ['Blender',       BlenderCapture,     emptyBlenderData(),     blenderFull,
    { sectionId: 'blender' }],
  ['Pasteuriser',   PasteuriserCapture, emptyPasteuriserData(), pasteuriserFull,
    { sectionId: 'pasteuriser' }],
] as unknown) as Case[]

function render(Comp: unknown, props: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(Comp as never, props))
}

describe('every section renders on an empty shift', () => {
  it.each(SECTIONS)('%s', (_name, Comp, empty, _full, extra) => {
    expect(render(Comp, { ...common, ...extra, value: empty }).length).toBeGreaterThan(0)
  })
})

describe('every section renders with material captured', () => {
  // The empty case passes trivially — a component that reads a field off the
  // first bag only crashes once there IS a first bag.
  it.each(SECTIONS)('%s', (_name, Comp, _empty, full, extra) => {
    expect(render(Comp, { ...common, ...extra, value: full }).length).toBeGreaterThan(0)
  })
})

describe('every section renders locked, as it does after sign-off', () => {
  it.each(SECTIONS)('%s', (_name, Comp, _empty, full, extra) => {
    expect(render(Comp, { ...common, ...extra, value: full, locked: true }).length).toBeGreaterThan(0)
  })
})

describe('Overview survives every section shape', () => {
  /**
   * Overview reads EVERY section's data, including the other shift's, which
   * makes it the component most exposed to a change in a section it does not
   * own — and it is where the duck-typing bug lived (ARCHITECTURE.md §1A). One
   * test per shape, so a failure names the section that broke it.
   */
  const shapes: Array<[string, string, unknown]> = [
    ['sieving',     'Sieving Tower', sievingFull],
    ['refining1',   'Refining 1',    refiningFull],
    ['granule',     'Granule Line',  granuleFull],
    ['blender',     'Blender',       blenderFull],
    ['pasteuriser', 'Pasteuriser',   pasteuriserFull],
  ]

  it.each(shapes)('%s', (sectionId, sectionName, data) => {
    const html = render(CaptureOverview, {
      productions: [{ id: 'p1', variant: 'Organic', grade: 'A', lot: 'GS-0299',
                      data, shift: 'morning' }],
      sectionId, sectionName, sectionColor: '#1A3A0E',
      date: '2026-09-04', shift: 'morning',
      showSerials: false, productionOrders: null, locked: false,
    })
    expect(html.length).toBeGreaterThan(0)
  })

  it('handles both shifts at once, which is how a full production day reads', () => {
    const html = render(CaptureOverview, {
      productions: [
        { id: 'p1', variant: 'Organic', grade: 'A', lot: 'GS-0299', data: sievingFull, shift: 'morning' },
        { id: 'p2', variant: 'Organic', grade: 'A', lot: 'GS-0299', data: sievingFull, shift: 'afternoon' },
      ],
      sectionId: 'sieving', sectionName: 'Sieving Tower', sectionColor: '#1A3A0E',
      date: '2026-09-04', shift: 'afternoon',
      showSerials: true, productionOrders: null, locked: false,
    })
    expect(html.length).toBeGreaterThan(0)
  })

  it('renders with nothing captured at all', () => {
    const html = render(CaptureOverview, {
      productions: [], sectionId: 'sieving', sectionName: 'Sieving Tower',
      sectionColor: '#1A3A0E', date: '2026-09-04', shift: 'morning',
      showSerials: false, productionOrders: null, locked: false,
    })
    expect(typeof html).toBe('string')
  })
})
