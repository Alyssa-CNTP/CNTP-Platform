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
  PERMISSION_MATRIX, MODULE_GRANTS, READ_KEYS_BY_MODULE, KEYS_BY_MODULE_GRANT,
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
  it('every module in the matrix has all three grant keys, and they exist', () => {
    for (const m of MODULE_GRANTS) {
      for (const key of [m.read, m.write, m.delete]) {
        expect(KNOWN.has(key as never), `matrix module '${m.module}' expects '${key}' in ALL_PERMISSION_KEYS`).toBe(true)
      }
    }
  })

  it('has no can_read_/write_/delete_ module key that no slug claims — reverse drift', () => {
    const claimed = new Set<string>(MODULE_GRANTS.flatMap(m => [m.read, m.write, m.delete]))
    // Per-RESOURCE keys share these prefixes (can_delete_records, can_write_… ),
    // so the check is the other way round: a module key must have a module.
    const moduleShaped = new Set<string>(
      MODULE_GRANTS.flatMap(m => [m.read, m.write, m.delete]),
    )
    const orphans = ALL_PERMISSION_KEYS
      .filter(k => k.startsWith('can_read_') && k !== 'can_read_all_modules')
      .filter(k => !claimed.has(k))
    expect(orphans, `these can_read_* keys match no module slug: ${orphans.join(', ')}`).toEqual([])
    expect(moduleShaped.size).toBe(MODULE_GRANTS.length * 3)
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

// ─── Write and delete grants ──────────────────────────────────────────────────

describe('module write / delete grants', () => {
  it('write grants that module’s write keys, and nothing outside them', () => {
    for (const m of MODULE_GRANTS) {
      const writes = KEYS_BY_MODULE_GRANT[m.write] ?? []
      for (const k of writes) {
        expect(resolvePermission(null, { [m.write]: true }, k), `${m.write} should grant ${k}`).toBe(true)
      }
      // Not another module's writes.
      for (const other of MODULE_GRANTS) {
        if (other.slug === m.slug) continue
        for (const k of KEYS_BY_MODULE_GRANT[other.write] ?? []) {
          if (writes.includes(k)) continue   // a key legitimately shared by two modules
          expect(resolvePermission(null, { [m.write]: true }, k), `${m.write} must not grant ${k}`).toBe(false)
        }
      }
    }
  })

  it('delete grants that module’s delete keys only', () => {
    for (const m of MODULE_GRANTS) {
      for (const k of KEYS_BY_MODULE_GRANT[m.delete] ?? []) {
        expect(resolvePermission(null, { [m.delete]: true }, k), `${m.delete} should grant ${k}`).toBe(true)
      }
    }
  })

  it('write and delete each imply READ for the same module, both the keys and the module key', () => {
    // Every guard in the app is on a read key, so without this a write grant
    // would hand out save permissions for pages the route bounces them out of.
    for (const m of MODULE_GRANTS) {
      for (const grant of [m.write, m.delete]) {
        for (const k of KEYS_BY_MODULE_GRANT[m.read] ?? []) {
          expect(resolvePermission(null, { [grant]: true }, k), `${grant} should imply read key ${k}`).toBe(true)
        }
        expect(resolvePermission(null, { [grant]: true }, m.read), `${grant} should imply ${m.read}`).toBe(true)
      }
    }
  })

  it('write does NOT imply delete, and delete does NOT imply write', () => {
    // Removing a record is not authoring one. The Quality module has both.
    expect(resolvePermission(null, { can_write_quality: true }, 'can_delete_records')).toBe(false)
    expect(resolvePermission(null, { can_delete_quality: true }, 'can_save_records')).toBe(false)
  })

  it('neither grant ever reaches a manage key', () => {
    const manage = new Set<string>()
    for (const m of PERMISSION_MATRIX) for (const r of m.resources) for (const x of r.manage ?? []) manage.add(x.key)
    for (const m of MODULE_GRANTS) {
      for (const key of manage) {
        expect(
          resolvePermission(null, { [m.write]: true, [m.delete]: true }, key as never),
          `${m.write}/${m.delete} must not grant the manage key '${key}'`,
        ).toBe(false)
      }
    }
  })

  it('there is no blanket write or delete key', () => {
    // Read is the only axis with one. "Delete anything anywhere" is
    // senior_developer by another name — see the note above MODULE_GRANTS.
    for (const k of ['can_write_all_modules', 'can_delete_all_modules']) {
      expect(ALL_PERMISSION_KEYS.includes(k as never), `${k} must not exist`).toBe(false)
    }
  })

  it('an explicit false still beats a write or delete grant', () => {
    expect(resolvePermission(null, { can_write_quality: true, can_save_records: false }, 'can_save_records')).toBe(false)
    expect(resolvePermission(null, { can_delete_quality: true, can_delete_runs: false }, 'can_delete_runs')).toBe(false)
  })
})

describe('the four slot kinds are disjoint', () => {
  // Stronger than the read-vs-write check above, and the reason the three
  // grants can never overlap: a key filed as both `write` on one resource and
  // `manage` on another would be handed out by a write grant while reading as
  // workflow authority in the UI.
  it('no key appears under two different slot kinds anywhere in the matrix', () => {
    const slots: Record<string, Set<string>> = { read: new Set(), write: new Set(), delete: new Set(), manage: new Set() }
    for (const m of PERMISSION_MATRIX) {
      for (const r of m.resources) {
        if (r.read && r.read !== 'dept') slots.read.add(r.read)
        if (r.write)  slots.write.add(r.write)
        if (r.delete) slots.delete.add(r.delete)
        for (const x of r.manage ?? []) slots.manage.add(x.key)
      }
    }
    const kinds = Object.keys(slots)
    const clashes: string[] = []
    for (const k of new Set(kinds.flatMap(s => [...slots[s]]))) {
      const inKinds = kinds.filter(s => slots[s].has(k))
      if (inKinds.length > 1) clashes.push(`${k} → ${inKinds.join(' + ')}`)
    }
    expect(clashes, `keys filed under more than one slot kind:\n  ${clashes.join('\n  ')}`).toEqual([])
  })
})

describe('no module grant key collides with a real permission key', () => {
  // The bug this caught: slug 'staff' built the grant key `can_delete_staff`,
  // which is ALREADY the Staff Directory's own per-resource delete key (the one
  // /api/staff/[id] DELETE checks). One string would have meant both "delete any
  // staff record" and "delete across the Staff Directory module", making the
  // grant its own grantee. The slug is 'staff_directory' for exactly this reason.
  it('holds for every slug', () => {
    const resourceKeys = new Set<string>()
    for (const m of PERMISSION_MATRIX) {
      for (const r of m.resources) {
        if (r.read && r.read !== 'dept') resourceKeys.add(r.read)
        if (r.write)  resourceKeys.add(r.write)
        if (r.delete) resourceKeys.add(r.delete)
        for (const x of r.manage ?? []) resourceKeys.add(x.key)
      }
    }
    const collisions = MODULE_GRANTS
      .flatMap(m => [m.read, m.write, m.delete])
      .filter(k => resourceKeys.has(k))
    expect(collisions, `module grant keys that are already resource keys: ${collisions.join(', ')}`).toEqual([])
  })
})

describe('the two misfiled deletes are now in the Delete column', () => {
  // Both sat in `manage`, so they never appeared under Delete and a module-wide
  // delete grant would have silently skipped them.
  it('can_delete_bag_tag is production.live’s delete', () => {
    expect(resolvePermission(null, { can_delete_production: true }, 'can_delete_bag_tag')).toBe(true)
  })
  it('can_delete_staff is staff.directory’s delete — the key /api/staff/[id] checks', () => {
    expect(resolvePermission(null, { can_delete_staff_directory: true }, 'can_delete_staff')).toBe(true)
  })
})
