import { describe, it, expect } from 'vitest'
import {
  STOPPAGE_KINDS, RETIRED_STOPPAGE_KINDS, ALL_STOPPAGE_KINDS,
  STOPPAGE_META, DOWNTIME_KINDS, isStoppageKind, isRetiredKind, notifyTeamFor,
  isLive, isOpen, stoppageMinutes, mergeIntervals, stoppageMinutesInWindow,
  workedMinutes, downtimeMinutes, scheduledStoppages, deepCleanDue,
  toSnapshotBreaks, validateStoppages,
  needsAttestation, pendingAttestations, pendingNotifications, attestationState,
  type Attestation, type Stoppage, type StoppageKind,
} from './stoppages'

// ── helpers ──────────────────────────────────────────────────────────────────

/** A stoppage on 2026-09-08 (a Tuesday), times given as UTC "HH:mm". */
function st(
  kind: StoppageKind,
  start: string,
  end: string | null,
  extra: Partial<Stoppage> = {},
): Stoppage {
  return {
    id: `${kind}-${start}`,
    kind,
    startedAt: `2026-09-08T${start}:00.000Z`,
    endedAt: end ? `2026-09-08T${end}:00.000Z` : null,
    notes: STOPPAGE_META[kind].needsNotes ? 'because' : null,
    machine: null, area: null, jobCardId: null,
    source: 'operator', voidedAt: null,
    attestation: null, notifiedAt: null,
    supervisorRequestedAt: null, supervisorRequestCount: 0,
    ...extra,
  }
}
const iso = (hhmm: string) => `2026-09-08T${hhmm}:00.000Z`
const at  = (hhmm: string) => new Date(iso(hhmm)).getTime()

const signed = (verdict: 'confirmed' | 'disputed'): Attestation => ({
  verdict, supervisorName: 'Gustav', employeeId: 'E-42',
  signedAt: iso('11:00'), note: null,
})

// ── kinds ────────────────────────────────────────────────────────────────────

describe('stoppage kinds', () => {
  it('covers the mechanical causes the old union was missing', () => {
    // Deep clean and breakdown were both absent from the old BreakType union;
    // an operator had to file them as 'other' with a free-text note, which is
    // why neither could ever reach a KPI.
    expect(STOPPAGE_KINDS).toContain('deep_clean')
    expect(STOPPAGE_KINDS).toContain('breakdown')
    expect(STOPPAGE_KINDS).toContain('maintenance')
  })

  it('covers the NON-mechanical causes too', () => {
    // A line stopped by the system being down produced exactly as little as one
    // stopped by a bearing. Leaving these off does not shorten the list — it
    // routes every one of them into 'other', where nothing can analyse them.
    expect(STOPPAGE_KINDS).toContain('it_system')
    expect(STOPPAGE_KINDS).toContain('power')
    expect(STOPPAGE_KINDS).toContain('no_material')
    expect(STOPPAGE_KINDS).toContain('quality_hold')
  })

  it('no longer offers changeover, but still renders it', () => {
    // Retired pending a rebuild. Rows already carry it (historic breaks, and
    // anything the backfill imports), so dropping it from the type would leave
    // STOPPAGE_META[kind] undefined on a live capture screen.
    expect(STOPPAGE_KINDS).not.toContain('changeover')
    expect(RETIRED_STOPPAGE_KINDS).toContain('changeover')
    expect(ALL_STOPPAGE_KINDS).toContain('changeover')
    expect(STOPPAGE_META.changeover).toBeDefined()
    expect(isRetiredKind('changeover')).toBe(true)
    expect(isRetiredKind('breakdown')).toBe(false)
  })

  it('has metadata for every kind — no unhandled kind can be added silently', () => {
    for (const k of ALL_STOPPAGE_KINDS) {
      expect(STOPPAGE_META[k], k).toBeDefined()
      expect(STOPPAGE_META[k].label.length).toBeGreaterThan(0)
    }
    expect(Object.keys(STOPPAGE_META).sort()).toEqual([...ALL_STOPPAGE_KINDS].sort())
  })

  it('counts every unplanned production stop as downtime, and no break', () => {
    expect([...DOWNTIME_KINDS].sort()).toEqual([
      'breakdown', 'it_system', 'maintenance', 'no_material', 'power', 'quality_hold',
    ])
    // Breaks are what the shift is designed around; counting them would make
    // every shift look 10% broken.
    expect(STOPPAGE_META.tea.downtime).toBe(false)
    expect(STOPPAGE_META.lunch.downtime).toBe(false)
    // A Tuesday deep clean is not a fault.
    expect(STOPPAGE_META.deep_clean.downtime).toBe(false)
    // Planned maintenance IS planned AND IS downtime — two different questions,
    // and this is the case that proves they are not the same field.
    expect(STOPPAGE_META.maintenance.planned).toBe(true)
    expect(STOPPAGE_META.maintenance.downtime).toBe(true)
  })

  it('does not treat the catch-all as downtime', () => {
    // 'other' is the bucket for whatever the list failed to anticipate, so it
    // cannot be trusted to mean the line was down. A recurring 'other' in the
    // shift reports is the signal to add a kind, not to reclassify this one.
    expect(STOPPAGE_META.other.downtime).toBe(false)
    expect(STOPPAGE_META.other.notify).toBeNull()
  })

  it('requires a description exactly where one is meaningful', () => {
    const needs = ['breakdown', 'maintenance', 'power', 'it_system',
                   'no_material', 'quality_hold', 'other'] as const
    for (const k of needs) expect(STOPPAGE_META[k].needsNotes, k).toBe(true)
    // Tea, lunch and the deep clean are scheduled and pre-filled — demanding a
    // note there is the hidden-field validation trap that blocks a sign-off
    // nobody can clear.
    expect(STOPPAGE_META.tea.needsNotes).toBe(false)
    expect(STOPPAGE_META.lunch.needsNotes).toBe(false)
    expect(STOPPAGE_META.deep_clean.needsNotes).toBe(false)
  })

  it('routes each notification to the team that can actually act', () => {
    expect(STOPPAGE_META.breakdown.notify).toBe('maintenance')
    expect(STOPPAGE_META.power.notify).toBe('maintenance')
    // IT, not maintenance: paging a fitter for a network outage wastes the one
    // person who could have fixed it.
    expect(STOPPAGE_META.it_system.notify).toBe('it')
    // Nothing to fix — an upstream line or the store has to move.
    expect(STOPPAGE_META.no_material.notify).toBe('supervisor')
    expect(STOPPAGE_META.quality_hold.notify).toBe('supervisor')
    // Breaks are not news. Notifying on them is how the notifications that
    // matter get ignored.
    expect(STOPPAGE_META.tea.notify).toBeNull()
    expect(STOPPAGE_META.lunch.notify).toBeNull()
    expect(STOPPAGE_META.deep_clean.notify).toBeNull()
  })

  it('asks a supervisor to sign a breakdown, and only a breakdown', () => {
    for (const k of ALL_STOPPAGE_KINDS) {
      expect(STOPPAGE_META[k].attested, k).toBe(k === 'breakdown')
    }
  })

  it('guards the kind at a boundary', () => {
    expect(isStoppageKind('breakdown')).toBe(true)
    expect(isStoppageKind('it_system')).toBe(true)
    expect(isStoppageKind('changeover')).toBe(true)   // retired, but real
    expect(isStoppageKind('deep clean')).toBe(false)
    expect(isStoppageKind(undefined)).toBe(false)
    expect(isStoppageKind(7)).toBe(false)
  })
})

// ── one stoppage ─────────────────────────────────────────────────────────────

describe('stoppageMinutes', () => {
  it('measures a closed stoppage', () => {
    expect(stoppageMinutes(st('lunch', '13:00', '13:30'))).toBe(30)
  })

  it('measures an OPEN stoppage up to now, not as zero', () => {
    // The tracker is live: a breakdown has to show what it is costing while it
    // is still running.
    const open = st('breakdown', '09:00', null)
    expect(stoppageMinutes(open, at('09:45'))).toBe(45)
    expect(isOpen(open)).toBe(true)
  })

  it('reads a voided stoppage as zero but keeps it on the record', () => {
    const voided = st('breakdown', '09:00', '10:00', { voidedAt: iso('10:05') })
    expect(stoppageMinutes(voided)).toBe(0)
    expect(isLive(voided)).toBe(false)
  })

  it('never returns negative time for an end before the start', () => {
    expect(stoppageMinutes(st('other', '13:00', '12:00'))).toBe(0)
  })

  it('reads an unparseable timestamp as zero rather than NaN', () => {
    expect(stoppageMinutes({ ...st('other', '13:00', null), startedAt: 'not-a-date' })).toBe(0)
    expect(stoppageMinutes({ ...st('other', '13:00', '13:30'), endedAt: 'nope' })).toBe(0)
  })
})

// ── merging ──────────────────────────────────────────────────────────────────

describe('mergeIntervals', () => {
  it('leaves disjoint intervals alone', () => {
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 20, end: 30 }]))
      .toEqual([{ start: 0, end: 10 }, { start: 20, end: 30 }])
  })

  it('merges overlapping intervals', () => {
    expect(mergeIntervals([{ start: 0, end: 20 }, { start: 10, end: 30 }]))
      .toEqual([{ start: 0, end: 30 }])
  })

  it('merges intervals that merely touch', () => {
    // Lunch 13:00–13:30 then a breakdown 13:30–14:00 is one continuous absence.
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 10, end: 20 }]))
      .toEqual([{ start: 0, end: 20 }])
  })

  it('swallows a fully contained interval', () => {
    expect(mergeIntervals([{ start: 0, end: 100 }, { start: 10, end: 20 }]))
      .toEqual([{ start: 0, end: 100 }])
  })

  it('sorts before merging, so input order does not matter', () => {
    expect(mergeIntervals([{ start: 20, end: 30 }, { start: 0, end: 25 }]))
      .toEqual([{ start: 0, end: 30 }])
  })

  it('drops zero-length and invalid intervals', () => {
    expect(mergeIntervals([{ start: 5, end: 5 }, { start: 10, end: 4 }, { start: NaN, end: 9 }]))
      .toEqual([])
  })
})

// ── the window ───────────────────────────────────────────────────────────────

describe('stoppageMinutesInWindow', () => {
  it('sums disjoint stoppages', () => {
    const s = [st('tea', '10:30', '11:00'), st('lunch', '13:00', '13:30')]
    expect(stoppageMinutesInWindow(s, iso('07:00'), iso('16:00'))).toBe(60)
  })

  it('counts overlapping stoppages ONCE', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. A breakdown running 12:30–14:00
    // straight through a 13:00–13:30 lunch is 90 minutes off the line, not 120.
    // Summing each overlap independently — what the previous implementation
    // did — subtracted the lunch twice.
    const s = [st('lunch', '13:00', '13:30'), st('breakdown', '12:30', '14:00')]
    expect(stoppageMinutesInWindow(s, iso('07:00'), iso('16:00'))).toBe(90)
  })

  it('cannot subtract more than the shift itself', () => {
    // Three long overlapping stoppages on a 1-hour shift still cap at 60.
    const s = [
      st('breakdown', '07:00', '16:00'),
      st('maintenance', '08:00', '15:00'),
      st('lunch', '13:00', '13:30'),
    ]
    expect(stoppageMinutesInWindow(s, iso('07:00'), iso('08:00'))).toBe(60)
  })

  it('clips a stoppage to the shift window', () => {
    // A scheduled lunch at 13:00 must not subtract from someone who left 12:30.
    const s = [st('lunch', '13:00', '13:30')]
    expect(stoppageMinutesInWindow(s, iso('07:00'), iso('12:30'))).toBe(0)
    // Half of a lunch that straddles the end.
    expect(stoppageMinutesInWindow(s, iso('07:00'), iso('13:15'))).toBe(15)
  })

  it('measures an open stoppage to now, clipped to the window', () => {
    const s = [st('breakdown', '09:00', null)]
    expect(stoppageMinutesInWindow(s, iso('07:00'), iso('16:00'), at('09:30'))).toBe(30)
  })

  it('ignores voided stoppages', () => {
    const s = [st('lunch', '13:00', '13:30', { voidedAt: iso('14:00') })]
    expect(stoppageMinutesInWindow(s, iso('07:00'), iso('16:00'))).toBe(0)
  })

  it('returns 0 for a missing or inverted window', () => {
    const s = [st('lunch', '13:00', '13:30')]
    expect(stoppageMinutesInWindow(s, null, iso('16:00'))).toBe(0)
    expect(stoppageMinutesInWindow(s, iso('16:00'), iso('07:00'))).toBe(0)
  })
})

// ── worked ───────────────────────────────────────────────────────────────────

describe('workedMinutes', () => {
  it('is the span minus the stoppages inside it', () => {
    // 07:00–16:00 = 540 min, less tea 30 and lunch 30 = 480 (8h).
    const s = [st('tea', '10:30', '11:00'), st('lunch', '13:00', '13:30')]
    expect(workedMinutes(iso('07:00'), iso('16:00'), s)).toBe(480)
  })

  it('does not double-subtract an overlap', () => {
    const s = [st('lunch', '13:00', '13:30'), st('breakdown', '12:30', '14:00')]
    // 540 − 90 = 450. The old arithmetic gave 420 and shorted the operator.
    expect(workedMinutes(iso('07:00'), iso('16:00'), s)).toBe(450)
  })

  it('never goes negative', () => {
    const s = [st('breakdown', '00:00', '23:00')]
    expect(workedMinutes(iso('07:00'), iso('16:00'), s)).toBe(0)
  })

  it('is 0 without both ends of the shift', () => {
    expect(workedMinutes(null, iso('16:00'), [])).toBe(0)
    expect(workedMinutes(iso('07:00'), null, [])).toBe(0)
  })

  it('is 0 for a zero-length or inverted shift', () => {
    expect(workedMinutes(iso('07:00'), iso('07:00'), [])).toBe(0)
    expect(workedMinutes(iso('16:00'), iso('07:00'), [])).toBe(0)
  })

  it('rounds once at the end, not per stoppage', () => {
    const s: Stoppage[] = [
      { ...st('other', '08:00', null), endedAt: '2026-09-08T08:00:20.000Z' },
      { ...st('other', '09:00', null), endedAt: '2026-09-08T09:00:20.000Z' },
      { ...st('other', '10:00', null), endedAt: '2026-09-08T10:00:20.000Z' },
    ]
    // Three 20-second stoppages = 1 minute total. Rounding each to 0 first
    // would give 60; rounding each up to 1 would give 57.
    expect(workedMinutes(iso('08:00'), iso('09:00'), s.slice(0, 1))).toBe(60)
    expect(workedMinutes(iso('08:00'), iso('11:00'), s)).toBe(179)
  })
})

describe('downtimeMinutes', () => {
  it('counts every downtime kind and no break', () => {
    const s = [
      st('breakdown', '09:00', '10:00'),    // 60
      st('maintenance', '11:00', '11:30'),  // 30
      st('it_system', '11:30', '11:45'),    // 15
      st('power', '12:00', '12:30'),        // 30
      st('no_material', '14:00', '14:20'),  // 20
      st('quality_hold', '15:00', '15:10'), // 10
      st('deep_clean', '07:00', '08:00'),   // planned clean — not downtime
      st('lunch', '13:00', '13:30'),        // break
      st('other', '15:30', '15:40'),        // unclassified — not downtime
      st('changeover', '15:45', '15:50'),   // retired — not downtime
    ]
    expect(downtimeMinutes(s)).toBe(165)
  })

  it('includes an open breakdown up to now', () => {
    expect(downtimeMinutes([st('breakdown', '09:00', null)], at('10:00'))).toBe(60)
  })

  it('ignores a voided breakdown', () => {
    expect(downtimeMinutes([st('breakdown', '09:00', '10:00', { voidedAt: iso('10:01') })])).toBe(0)
  })

  it('excludes a breakdown a supervisor DISPUTED', () => {
    // A signature saying the line was not down has to move the number, or it
    // is decorative.
    expect(downtimeMinutes([
      st('breakdown', '09:00', '10:00', { attestation: signed('disputed') }),
    ])).toBe(0)
  })

  it('includes a breakdown nobody has signed yet', () => {
    // Downtime is real until someone says otherwise. Suppressing it until a
    // signature arrives would let the KPI be improved by nobody doing the
    // paperwork.
    expect(downtimeMinutes([st('breakdown', '09:00', '10:00')])).toBe(60)
  })

  it('includes a confirmed breakdown', () => {
    expect(downtimeMinutes([
      st('breakdown', '09:00', '10:00', { attestation: signed('confirmed') }),
    ])).toBe(60)
  })
})

// ── attestation ──────────────────────────────────────────────────────────────

describe('needsAttestation', () => {
  it('is true for an unsigned breakdown', () => {
    expect(needsAttestation(st('breakdown', '09:00', '10:00'))).toBe(true)
  })

  it('is false once a supervisor has signed either way', () => {
    expect(needsAttestation(st('breakdown', '09:00', '10:00', { attestation: signed('confirmed') }))).toBe(false)
    expect(needsAttestation(st('breakdown', '09:00', '10:00', { attestation: signed('disputed') }))).toBe(false)
  })

  it('is false for every other kind', () => {
    // Making a supervisor sign for a tea break turns the signature into a
    // rubber stamp, and the one that matters gets signed as reflexively.
    for (const k of ALL_STOPPAGE_KINDS) {
      if (k === 'breakdown') continue
      expect(needsAttestation(st(k, '09:00', '10:00')), k).toBe(false)
    }
  })

  it('is false for a voided breakdown — it is off the sheet', () => {
    expect(needsAttestation(st('breakdown', '09:00', '10:00', { voidedAt: iso('10:01') }))).toBe(false)
  })

  it('is true for a breakdown that is still running', () => {
    // A supervisor can confirm the line is down before it comes back up.
    expect(needsAttestation(st('breakdown', '09:00', null))).toBe(true)
  })
})

describe('pendingAttestations', () => {
  it('returns unsigned breakdowns oldest first', () => {
    const rows = [
      st('breakdown', '14:00', '14:30'),
      st('lunch', '13:00', '13:30'),
      st('breakdown', '09:00', '10:00'),
      st('breakdown', '11:00', '11:30', { attestation: signed('confirmed') }),
    ]
    expect(pendingAttestations(rows).map(s => s.startedAt)).toEqual([iso('09:00'), iso('14:00')])
  })

  it('is empty when there is nothing to sign', () => {
    expect(pendingAttestations([st('tea', '10:30', '11:00')])).toEqual([])
  })

  it('does not mutate its input', () => {
    const rows = [st('breakdown', '14:00', '14:30'), st('breakdown', '09:00', '10:00')]
    pendingAttestations(rows)
    expect(rows.map(s => s.startedAt)).toEqual([iso('14:00'), iso('09:00')])
  })
})

describe('attestationState', () => {
  it('tells a breakdown nobody called about apart from one that was ignored', () => {
    // The distinction the supervisor-call column exists for. Both render as
    // "awaiting supervisor" if you only look at the verdict, and a report that
    // conflates them blames the operator every time — they are the one whose
    // sheet is incomplete.
    expect(attestationState(st('breakdown', '09:00', '10:00'))).toBe('not_called')
    expect(attestationState(st('breakdown', '09:00', '10:00', {
      supervisorRequestedAt: iso('10:05'), supervisorRequestCount: 3,
    }))).toBe('ignored')
  })

  it('is signed once a verdict exists, called or not', () => {
    expect(attestationState(st('breakdown', '09:00', '10:00', {
      attestation: signed('confirmed'),
    }))).toBe('signed')
    // Disputed is still signed — somebody looked and made a decision.
    expect(attestationState(st('breakdown', '09:00', '10:00', {
      attestation: signed('disputed'), supervisorRequestedAt: iso('10:05'),
    }))).toBe('signed')
  })

  it('is n/a for every kind that needs no signature', () => {
    for (const k of ALL_STOPPAGE_KINDS) {
      if (k === 'breakdown') continue
      expect(attestationState(st(k, '09:00', '10:00')), k).toBe('n/a')
    }
  })

  it('is n/a for a voided breakdown — it is off the sheet', () => {
    expect(attestationState(st('breakdown', '09:00', '10:00', {
      voidedAt: iso('10:01'),
    }))).toBe('n/a')
  })
})

describe('pendingNotifications', () => {
  it('returns the stoppages whose team has not been told', () => {
    const rows = [
      st('breakdown', '09:00', '10:00'),
      st('breakdown', '11:00', '11:30', { notifiedAt: iso('11:01') }),  // already sent
      st('tea', '12:00', '12:30'),      // nobody to page
      st('other', '13:00', '13:30'),    // a cause nobody named is not a page
      st('it_system', '14:00', null),
    ]
    expect(pendingNotifications(rows).map(s => s.startedAt)).toEqual([iso('09:00'), iso('14:00')])
  })

  it('routes by kind', () => {
    expect(notifyTeamFor(st('breakdown', '09:00', null))).toBe('maintenance')
    expect(notifyTeamFor(st('it_system', '09:00', null))).toBe('it')
    expect(notifyTeamFor(st('no_material', '09:00', null))).toBe('supervisor')
    expect(notifyTeamFor(st('tea', '09:00', null))).toBeNull()
  })

  it('stops returning one once notifiedAt is set, so a reload cannot re-send', () => {
    const s = st('breakdown', '09:00', null)
    expect(pendingNotifications([s])).toHaveLength(1)
    expect(pendingNotifications([{ ...s, notifiedAt: iso('09:01') }])).toHaveLength(0)
  })

  it('ignores a voided breakdown', () => {
    expect(pendingNotifications([
      st('breakdown', '09:00', '10:00', { voidedAt: iso('09:05') }),
    ])).toEqual([])
  })
})

// ── scheduled breaks ─────────────────────────────────────────────────────────

describe('scheduledStoppages', () => {
  let n = 0
  const mkId = () => `id-${n++}`
  // Treat the local wall-clock string as SAST (UTC+2), which is what the
  // browser does on a factory tablet.
  const toIso = (local: string) => `${local}:00+02:00`

  it('pre-fills tea and lunch for a morning shift', () => {
    n = 0
    const s = scheduledStoppages('morning', '2026-09-08', mkId, toIso)
    expect(s.map(x => x.kind)).toEqual(['tea', 'lunch'])
    expect(s.every(x => x.source === 'standard')).toBe(true)
    expect(stoppageMinutes(s[0])).toBe(30)
    expect(stoppageMinutes(s[1])).toBe(30)
  })

  it('uses the afternoon schedule for the afternoon shift', () => {
    n = 0
    const s = scheduledStoppages('afternoon', '2026-09-08', mkId, toIso)
    expect(stoppageMinutes(s[0])).toBe(15)  // tea
    expect(stoppageMinutes(s[1])).toBe(60)  // meal
  })

  it("keeps resolving the legacy 'night' alias to the afternoon schedule", () => {
    n = 0
    const night = scheduledStoppages('night', '2026-09-08', mkId, toIso)
    n = 0
    const aft = scheduledStoppages('afternoon', '2026-09-08', mkId, toIso)
    expect(night.map(s => ({ ...s, id: '' }))).toEqual(aft.map(s => ({ ...s, id: '' })))
  })

  it('returns nothing without a shift, a date, or for an unknown shift', () => {
    expect(scheduledStoppages(undefined, '2026-09-08', mkId, toIso)).toEqual([])
    expect(scheduledStoppages('morning', undefined, mkId, toIso)).toEqual([])
    expect(scheduledStoppages('graveyard', '2026-09-08', mkId, toIso)).toEqual([])
  })

  it('skips a break whose time will not convert rather than emitting NaN', () => {
    expect(scheduledStoppages('morning', '2026-09-08', mkId, () => null)).toEqual([])
  })
})

// ── deep clean ───────────────────────────────────────────────────────────────

describe('deepCleanDue', () => {
  it('is due on the Tuesday morning shift', () => {
    expect(deepCleanDue('2026-09-08', 'morning')).toBe(true)  // a Tuesday
  })

  it('is not due on the Tuesday afternoon shift', () => {
    expect(deepCleanDue('2026-09-08', 'afternoon')).toBe(false)
  })

  it('is not due on other mornings', () => {
    expect(deepCleanDue('2026-09-07', 'morning')).toBe(false)  // Monday
    expect(deepCleanDue('2026-09-09', 'morning')).toBe(false)  // Wednesday
  })

  it('parses the date as a calendar date, not through the local timezone', () => {
    // new Date('2026-09-08') is UTC midnight — west of UTC that is Monday, and
    // the prompt would appear a day early.
    expect(deepCleanDue('2026-09-08', 'morning')).toBe(true)
    expect(deepCleanDue('2026-09-15', 'morning')).toBe(true)  // next Tuesday
  })

  it('is not due on junk input', () => {
    expect(deepCleanDue(undefined, 'morning')).toBe(false)
    expect(deepCleanDue('08/09/2026', 'morning')).toBe(false)
    expect(deepCleanDue('2026-13-45', 'morning')).toBe(false)
  })
})

// ── snapshot ─────────────────────────────────────────────────────────────────

describe('toSnapshotBreaks', () => {
  it('projects the ledger into the legacy jsonb shape, oldest first', () => {
    const s = [st('lunch', '13:00', '13:30'), st('tea', '10:30', '11:00')]
    const snap = toSnapshotBreaks(s, iso('16:00'))
    expect(snap.map(b => b.type)).toEqual(['tea', 'lunch'])
    expect(snap[0]).toEqual({ type: 'tea', start: iso('10:30'), end: iso('11:00') })
  })

  it('closes an open stoppage at the sign-off time', () => {
    // The snapshot cannot express "still running", and start === end would
    // record the stoppage as costing nothing.
    const snap = toSnapshotBreaks([st('breakdown', '14:00', null)], iso('16:00'))
    expect(snap[0].end).toBe(iso('16:00'))
  })

  it('drops voided stoppages', () => {
    const s = [st('tea', '10:30', '11:00'), st('breakdown', '09:00', '10:00', { voidedAt: iso('10:01') })]
    expect(toSnapshotBreaks(s, iso('16:00')).map(b => b.type)).toEqual(['tea'])
  })

  it('carries notes, machine and job card through, and omits them when absent', () => {
    const s = [st('breakdown', '09:00', '10:00', {
      notes: '  feed belt snapped  ', machine: 'Diamond Blender', jobCardId: 4210,
    })]
    expect(toSnapshotBreaks(s, iso('16:00'))[0]).toEqual({
      type: 'breakdown', start: iso('09:00'), end: iso('10:00'),
      notes: 'feed belt snapped', machine: 'Diamond Blender', jobCardId: 4210,
    })
    const plain = toSnapshotBreaks([st('tea', '10:30', '11:00')], iso('16:00'))[0]
    expect('notes' in plain).toBe(false)
    expect('machine' in plain).toBe(false)
    expect('jobCardId' in plain).toBe(false)
  })

  it('records who signed a breakdown, so the shift report can show it', () => {
    const snap = toSnapshotBreaks([
      st('breakdown', '09:00', '10:00', { attestation: signed('confirmed') }),
    ], iso('16:00'))[0]
    expect(snap.attestedBy).toBe('Gustav')
    expect(snap.verdict).toBe('confirmed')
  })

  it('records a dispute too — an unsigned and a disputed breakdown must differ', () => {
    const snap = toSnapshotBreaks([
      st('breakdown', '09:00', '10:00', { attestation: signed('disputed') }),
    ], iso('16:00'))[0]
    expect(snap.verdict).toBe('disputed')
    const unsigned = toSnapshotBreaks([st('breakdown', '09:00', '10:00')], iso('16:00'))[0]
    expect('verdict' in unsigned).toBe(false)
  })
})

// ── validation ───────────────────────────────────────────────────────────────

describe('validateStoppages', () => {
  it('passes the scheduled breaks with no notes', () => {
    expect(validateStoppages([st('tea', '10:30', '11:00'), st('lunch', '13:00', '13:30')])).toEqual([])
  })

  it('requires a description on a breakdown', () => {
    const s = [st('breakdown', '09:00', '10:00', { notes: null })]
    const problems = validateStoppages(s)
    expect(problems).toHaveLength(1)
    expect(problems[0].id).toBe(s[0].id)
    expect(problems[0].message).toMatch(/description/i)
  })

  it('treats whitespace as no description', () => {
    expect(validateStoppages([st('maintenance', '09:00', '10:00', { notes: '   ' })])).toHaveLength(1)
  })

  it('does NOT block on an open stoppage — sign-off closes it', () => {
    expect(validateStoppages([st('breakdown', '09:00', null, { notes: 'jammed' })])).toEqual([])
  })

  it('flags an end before the start', () => {
    const problems = validateStoppages([st('other', '13:00', '12:00')])
    expect(problems.some(p => /ends before/i.test(p.message))).toBe(true)
  })

  it('ignores voided stoppages, so a bad row can always be voided away', () => {
    // Otherwise a mis-logged breakdown with no notes would permanently block
    // sign-off with no way for the operator to clear it.
    expect(validateStoppages([
      st('breakdown', '09:00', '10:00', { notes: null, voidedAt: iso('10:01') }),
    ])).toEqual([])
  })

  it('survives an unknown kind from the database without throwing', () => {
    const rogue = { ...st('other', '09:00', '10:00'), kind: 'sabbatical' as StoppageKind }
    expect(() => validateStoppages([rogue])).not.toThrow()
  })
})
