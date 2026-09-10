/**
 * The roster and the capture screens name the same things differently.
 *
 * The shift roster talks about ROLES a person is put on for a week
 * (`production.roster_entries.role_key` — 'sieving_tower', 'refining_1'), on a
 * shift called 'day' or 'night'. Capture talks about SECTIONS ('sieving',
 * 'refining1') on a shift called 'morning' or 'afternoon'. Neither vocabulary
 * is wrong; they belong to different parts of the business and were built
 * years apart.
 *
 * This module is the one translation between them. It was already written once
 * as a local `SECTION_ROLES` const inside the Assign Sections screen, and the
 * moment a second screen needed "which section is this person on today?" that
 * const was about to be copied — which is how `n()` ended up in twelve files
 * (ARCHITECTURE.md §1A). Pure, so it can be tested without a roster.
 *
 * ── Things that look like omissions and are not ──────────────────────────────
 *
 * `smallblender` has NO roster role. Checked against `production.roster_roles`:
 * the production category holds sieving_tower, refining_1, refining_2,
 * granule_operator, granule, blender, pasteuriser_op — and no small blender.
 * The Small Blender is a separate WORK CENTRE for serials (§5) but is not
 * rostered separately; the `blender` role covers whoever runs it. Inventing a
 * key here would map a section onto a role that matches no row, which reads as
 * "nobody is ever assigned" rather than as the missing mapping it would be.
 *
 * `granule` has TWO keys because the roster genuinely carries both
 * 'granule_operator' and 'granule' as active roles.
 */

/** Roster role keys that feed each capture section. */
export const SECTION_ROLE_KEYS: Readonly<Record<string, readonly string[]>> = {
  sieving:     ['sieving_tower'],
  refining1:   ['refining_1'],
  refining2:   ['refining_2'],
  granule:     ['granule_operator', 'granule'],
  blender:     ['blender'],
  pasteuriser: ['pasteuriser_op'],
}

/** Every role key that maps to some capture section. */
export const ALL_SECTION_ROLE_KEYS: readonly string[] =
  Object.values(SECTION_ROLE_KEYS).flat()

/** The roster roles that put someone on this section, or [] if none do. */
export function roleKeysForSection(sectionId: string): readonly string[] {
  return SECTION_ROLE_KEYS[sectionId] ?? []
}

/**
 * The capture section a roster role puts someone on, or null.
 *
 * Null is a real answer, not a failure: most roster roles — QC, store,
 * maintenance, cleaning, Rooibos Supervisor — are not capture sections at all.
 * A caller that treats null as an error will report the QC supervisor as
 * broken rather than as someone who does not run a line.
 */
export function sectionForRoleKey(roleKey: string): string | null {
  for (const [sectionId, keys] of Object.entries(SECTION_ROLE_KEYS)) {
    if (keys.includes(roleKey)) return sectionId
  }
  return null
}

/**
 * Roster shift ('day' | 'night') → capture shift ('morning' | 'afternoon').
 *
 * The roster's CHECK constraint allows exactly 'day' and 'night'. Capture
 * stores 'morning' and 'afternoon', and 'night' survives there only as a
 * legacy alias for 'afternoon' — the afternoon shift runs 16h00–01h00, so it
 * IS the night shift under a different name. Anything unrecognised falls to
 * 'morning', which is the same default the capture screens use.
 */
export function captureShiftForRosterShift(rosterShift: string): 'morning' | 'afternoon' {
  return String(rosterShift).toLowerCase() === 'night' ? 'afternoon' : 'morning'
}

/** The inverse, for asking the roster who is on a capture shift. */
export function rosterShiftForCaptureShift(captureShift: string): 'day' | 'night' {
  const s = String(captureShift).toLowerCase()
  return s === 'afternoon' || s === 'night' ? 'night' : 'day'
}

/**
 * Which section to open for someone, given the roster rows that are theirs.
 *
 * Returns the section for the shift being asked about when they are on one,
 * otherwise any section they are rostered to that day, otherwise null. The
 * two-step matters because an operator opening the page mid-morning should
 * land on the line they are on NOW, but one opening it before their shift
 * starts should still land on the line they are on today rather than on
 * nothing.
 *
 * Ties — someone rostered to two lines on one shift, which the roster does
 * allow — resolve in SECTION_ROLE_KEYS order rather than in whatever order
 * the rows came back, so the page does not open on a different line each
 * time it loads.
 */
export interface RosterAssignment {
  roleKey: string
  /** 'day' | 'night' as the roster stores it. */
  shift: string
}

export function pinnedSectionFor(
  assignments: readonly RosterAssignment[],
  captureShift: string,
): string | null {
  const order = Object.keys(SECTION_ROLE_KEYS)
  const sections = (want: string | null) => {
    const found = new Set<string>()
    for (const a of assignments) {
      if (!a) continue
      if (want !== null && String(a.shift).toLowerCase() !== want) continue
      const s = sectionForRoleKey(a.roleKey)
      if (s) found.add(s)
    }
    return order.filter(s => found.has(s))
  }
  const thisShift = sections(rosterShiftForCaptureShift(captureShift))
  if (thisShift.length) return thisShift[0]
  const anyShift = sections(null)
  return anyShift.length ? anyShift[0] : null
}
