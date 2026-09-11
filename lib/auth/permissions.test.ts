// Integrity checks over the permission tables themselves.
//
// This is not testing behaviour so much as testing DATA — every one of these
// would have caught a real gap before it shipped:
//   - bis_manager / it_management held real staff and appeared nowhere in
//     ROLE_PERMISSION_DEFAULTS, so resolvePermission() silently returned false
//     for every key. There was no error, no warning — just an IT person who
//     could do nothing until someone noticed and asked.
//   - A typo'd key in a role's defaults (`can_approve_run` instead of
//     `can_approve_runs`) type-checks fine — Permissions is a Partial<Record>,
//     so an extra unknown string key is invisible to tsc unless it's spread
//     through `as Permissions` the way ALL_ON and co_developer's defaults are,
//     which erases the check entirely.
import { describe, it, expect } from 'vitest'
import {
  ALL_PERMISSION_KEYS, ROLE_PERMISSION_DEFAULTS, DEPARTMENT_ROLES,
  resolvePermission, PERMISSION_GROUPS,
} from './permissions'

const KNOWN = new Set(ALL_PERMISSION_KEYS)

describe('ALL_PERMISSION_KEYS', () => {
  it('has no duplicate entries', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length)
  })
})

describe('ROLE_PERMISSION_DEFAULTS', () => {
  it('never sets a key that is not in ALL_PERMISSION_KEYS', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSION_DEFAULTS)) {
      for (const key of Object.keys(perms)) {
        expect(KNOWN.has(key as never), `role '${role}' sets unknown key '${key}'`).toBe(true)
      }
    }
  })

  // The gap this file exists to catch: a role string that real people hold
  // (per DEPARTMENT_ROLES, the Users & Roles picker) but that has no defaults
  // at all, so it silently grants nothing. Not every listed role NEEDS
  // defaults (the *_default roles are deliberately blank-slate — see the
  // comment above ROLE_PERMISSION_DEFAULTS), so this only flags roles whose
  // own label doesn't say "all permissions off".
  it('every non-blank-slate role in the picker has at least one default permission', () => {
    const blankSlateHints = ['all permissions off', 'no system permissions', 'no system login']
    // floor_operator is PIN-only and deliberately has no system permissions —
    // the comment above ROLE_PERMISSION_DEFAULTS says so explicitly ("Blank-
    // slate roles (_default) and floor_operator start at zero"), but its own
    // desc string doesn't use any of the hint phrases above, so it needs its
    // own exemption rather than a fourth hint that might match something else.
    const explicitlyExempt = new Set(['floor_operator'])
    for (const roles of Object.values(DEPARTMENT_ROLES)) {
      for (const { role, desc } of roles) {
        if (explicitlyExempt.has(role)) continue
        const isBlankSlate = blankSlateHints.some(h => desc.toLowerCase().includes(h))
        if (isBlankSlate) continue
        const perms = ROLE_PERMISSION_DEFAULTS[role]
        expect(perms && Object.values(perms).some(v => v === true),
          `role '${role}' ("${desc}") has no ROLE_PERMISSION_DEFAULTS entry with anything true`
        ).toBe(true)
      }
    }
  })
})

describe('PERMISSION_GROUPS', () => {
  it('never lists a key that is not in ALL_PERMISSION_KEYS', () => {
    for (const g of PERMISSION_GROUPS) {
      for (const { key } of g.permissions) {
        expect(KNOWN.has(key), `group '${g.group}' lists unknown key '${key}'`).toBe(true)
      }
    }
  })
})

describe('the two previously-orphaned IT roles now resolve can_generate_coa', () => {
  it('bis_manager', () => {
    expect(resolvePermission('bis_manager', {}, 'can_generate_coa')).toBe(true)
  })
  it('it_management (production spelling)', () => {
    expect(resolvePermission('it_management', {}, 'can_generate_coa')).toBe(true)
  })
  it('it-management (staging spelling, hyphenated)', () => {
    expect(resolvePermission('it-management', {}, 'can_generate_coa')).toBe(true)
  })
  it('grants nothing else by default — this was a scoped fix, not a blanket one', () => {
    expect(resolvePermission('bis_manager', {}, 'can_view_history')).toBe(false)
    expect(resolvePermission('bis_manager', {}, 'can_save_lab_results')).toBe(false)
  })
})

describe('the four new Quality read keys default to false for an unrecognised role', () => {
  it('can_view_lab_results / can_view_specs / can_view_runs / can_view_sieving', () => {
    expect(resolvePermission('nonexistent_role', {}, 'can_view_lab_results')).toBe(false)
    expect(resolvePermission('nonexistent_role', {}, 'can_view_specs')).toBe(false)
    expect(resolvePermission('nonexistent_role', {}, 'can_view_runs')).toBe(false)
    expect(resolvePermission('nonexistent_role', {}, 'can_view_sieving')).toBe(false)
  })
  it('an explicit override still wins, same as any other key', () => {
    expect(resolvePermission('nonexistent_role', { can_view_specs: true }, 'can_view_specs')).toBe(true)
  })
})

describe('co_developer inherits the new keys automatically', () => {
  // co_developer's defaults are ALL_PERMISSION_KEYS minus a fixed denylist
  // (can_run_migrations, can_manage_integrations, can_manage_users) — so every
  // new key added to ALL_PERMISSION_KEYS reaches co_developer with no edit to
  // its own entry, which is the point of building it that way. This test
  // exists so that shape stays true on purpose, not by accident.
  it('gets all four new view keys and can_generate_coa', () => {
    for (const key of ['can_view_lab_results','can_view_specs','can_view_runs','can_view_sieving','can_generate_coa'] as const) {
      expect(resolvePermission('co_developer', {}, key)).toBe(true)
    }
  })
})
