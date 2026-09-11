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
import {
  PERMISSION_MATRIX, READ_GRANT_MODULES, READ_KEYS_BY_MODULE,
} from './permission-registry'

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

// ─── Read-only access ─────────────────────────────────────────────────────────
//
// The grant is derived from PERMISSION_MATRIX rather than hand-listed, so most
// of what can go wrong here is DRIFT between the two files, plus one genuine
// hazard: a key that is a `read` slot in the matrix AND the thing some route
// checks before allowing a write. That combination turns "view everything" into
// "write something", silently. The last describe block below is that guard.

describe('read-only grant', () => {
  it('every module in the matrix has a can_read_<slug> key that exists', () => {
    for (const m of READ_GRANT_MODULES) {
      expect(KNOWN.has(m.key as never), `matrix module '${m.module}' expects '${m.key}' in ALL_PERMISSION_KEYS`).toBe(true)
    }
  })

  it('has no can_read_* key that no module claims — the reverse drift', () => {
    const claimed = new Set<string>(READ_GRANT_MODULES.map(m => m.key))
    const orphans = ALL_PERMISSION_KEYS
      .filter(k => k.startsWith('can_read_') && k !== 'can_read_all_modules')
      .filter(k => !claimed.has(k))
    expect(orphans, `these can_read_* keys match no module slug: ${orphans.join(', ')}`).toEqual([])
  })

  it('can_read_all_modules grants every read key in every participating module', () => {
    for (const [, readKeys] of Object.entries(READ_KEYS_BY_MODULE)) {
      for (const rk of readKeys) {
        expect(resolvePermission(null, { can_read_all_modules: true }, rk), `can_read_all_modules should grant ${rk}`).toBe(true)
      }
    }
  })

  it('a single module key grants that module and nothing outside it', () => {
    expect(resolvePermission(null, { can_read_quality: true }, 'can_view_lab_results')).toBe(true)
    expect(resolvePermission(null, { can_read_quality: true }, 'can_view_sieving')).toBe(true)
    // Production is a different module — not granted.
    expect(resolvePermission(null, { can_read_quality: true }, 'can_view_live_history')).toBe(false)
  })

  it('grants no write, delete or manage key anywhere', () => {
    const writeish = new Set<string>()
    for (const m of PERMISSION_MATRIX) {
      for (const r of m.resources) {
        if (r.write)  writeish.add(r.write)
        if (r.delete) writeish.add(r.delete)
        for (const x of r.manage ?? []) writeish.add(x.key)
      }
    }
    for (const key of writeish) {
      expect(
        resolvePermission(null, { can_read_all_modules: true }, key as never),
        `can_read_all_modules must not grant '${key}'`,
      ).toBe(false)
    }
  })

  it('never grants an Administration key — audit log, migrations, dev tools, user admin', () => {
    for (const key of ['can_view_audit_log','can_run_migrations','can_access_dev_tools',
                       'can_manage_integrations','can_manage_users','can_edit_permissions'] as const) {
      expect(resolvePermission(null, { can_read_all_modules: true }, key)).toBe(false)
    }
  })

  it('an explicit false override beats the blanket grant', () => {
    // Grant everything, then take one module's key back. The deny has to win, or
    // "read-only everywhere except X" is not expressible.
    const perms = { can_read_all_modules: true, can_view_lab_results: false } as const
    expect(resolvePermission(null, perms, 'can_view_lab_results')).toBe(false)
    expect(resolvePermission(null, perms, 'can_view_sieving')).toBe(true)
  })

  it('adds only — a role write survives alongside the grant', () => {
    expect(resolvePermission('quality_manager', { can_read_all_modules: true }, 'can_delete_records')).toBe(true)
  })

  it('read_only_viewer resolves reads and refuses writes', () => {
    expect(resolvePermission('read_only_viewer', {}, 'can_view_history')).toBe(true)
    expect(resolvePermission('read_only_viewer', {}, 'can_view_live_history')).toBe(true)
    expect(resolvePermission('read_only_viewer', {}, 'can_access_maintenance')).toBe(true)
    expect(resolvePermission('read_only_viewer', {}, 'can_save_records')).toBe(false)
    expect(resolvePermission('read_only_viewer', {}, 'can_delete_session')).toBe(false)
    expect(resolvePermission('read_only_viewer', {}, 'can_manage_users')).toBe(false)
  })

  it('reaches the five routes that had no permission at all', () => {
    // /supervisor, /stock-control, /production/{operations,dashboard,floor-plan}
    // were department-only, so no amount of ticking could open them. They now
    // list can_read_production — see ROUTE_GUARDS in app/(app)/layout.tsx.
    expect(resolvePermission('read_only_viewer', {}, 'can_read_production')).toBe(true)
  })
})

describe('no key is both a read grant and a write gate', () => {
  // The one way this feature could hand out a write. A key used as the matrix's
  // `read` for one resource and as `write`/`delete`/`manage` for another would
  // be granted by can_read_* and then accepted by whatever guards that write.
  // can_access_research / can_access_intelligence / can_access_marketing were
  // exactly this until they were split from can_view_* — the modules they open
  // create accounts, save reports and import trade data.
  it('holds across the whole matrix', () => {
    const reads = new Set<string>()
    const writes = new Set<string>()
    for (const m of PERMISSION_MATRIX) {
      for (const r of m.resources) {
        if (r.read && r.read !== 'dept') reads.add(r.read)
        if (r.write)  writes.add(r.write)
        if (r.delete) writes.add(r.delete)
        for (const x of r.manage ?? []) writes.add(x.key)
      }
    }
    const both = [...reads].filter(k => writes.has(k))
    expect(both, `these keys are both a read and a write/delete/manage: ${both.join(', ')}`).toEqual([])
  })
})
