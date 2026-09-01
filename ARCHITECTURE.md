# CNTP Platform — Architecture Rules

**Read this before adding a feature to the capture module, the ledger, or anything under `lib/core/`.**

This file exists because features kept breaking each other. Every rule below is here because
something specific went wrong in production. The incident is named next to the rule so you
can judge whether your case is really an exception.

---

## 1. The two failure modes

They are different problems. Do not treat a fix for one as a fix for the other.

### A. No boundary between core and features

Shared code has been copy-pasted rather than imported, and section types are told apart by
*guessing at their fields* instead of by a tag. So a change in one place silently lands
somewhere else.

- `const n = (v) => parseFloat(String(v).replace(',', '.')) || 0` is byte-identical in
  **12 source files**. Two of them were added recently — the duplication is still growing.
- `CaptureOverview.tsx` decides which section it is looking at with `if ('bomId' in d)` /
  `else if ('inputs' in d)` / `else if ('blends' in d)`. Add a field named `inputs` to any
  section and it silently becomes Refining. Sieving is the unguarded `else` fallback.
- `app/(app)/production/capture/[section]/page.tsx` is ~2,770 lines with ~41
  `sectionId.startsWith(...)` branches and 57 `as any` casts — the compiler is switched off
  exactly where it would have caught the above.

### B. The save path is read-modify-write

Two people saving the same session overwrite each other. This is a data problem, not a
module problem — **no amount of isolation fixes it.**

- `prod_bagging` is written as delete-then-insert scoped to the session.
- `bag_no` is allocated by reading held numbers into app memory and picking free ones.
- Serial sequences are allocated the same way: read `ilike 'prefix%'`, take a local max,
  add one. Two operators adding a bag in the same second both mint the same serial.

**What it cost:** 44% of Fine/Coarse Leaf bags lost from `prod_bagging`; Sieving Tower's
bagging rows emptied on production for a full day; 7 of 24 Sieving bags missing from
`bag_tags`. The defensive comments now wrapped around these writes are scar tissue — read
them before touching that code.

---

## 2. The Core / Feature boundary

```text
lib/
├── core/                     # IMMUTABLE CORE — pure, no React, no I/O, fully tested
│   ├── num.ts                #   n(), kg formatters
│   ├── metrics.ts            #   kgPerHour(), yieldPct()
│   ├── serials.ts            #   serial build + parse (see §5)
│   ├── mass-balance/         #   five section formulas, deliberately NOT unified
│   ├── ledger/               #   bag event append / aggregate
│   └── types/                #   discriminated capture types
├── config/flags.ts           # feature toggles
features/
└── <feature-name>/           # SELF-CONTAINED
    ├── components/  actions.ts
    └── index.ts              #   the ONLY public export surface
```

**The one-way rule — enforced by ESLint, not by review:**

> `lib/core/**` may not import from `features/**` or `app/**`.
> Features import core. Core never knows a feature exists.

Note `npm run build` sets `DISABLE_ESLINT_PLUGIN=true`, so the build will **not** catch a
violation. CI runs `npm run lint` separately for this reason. Do not remove that step.

---

## 3. Adding a feature — the checklist

1. New folder under `features/`. Everything internal stays internal; the only export is `index.ts`.
2. Add a flag to `lib/config/flags.ts`. Mount with plain conditional rendering —
   `{flags.myFeature && <MyFeature />}`. **No dynamic slot/hook registry**: it hides control
   flow from TypeScript, which is the same class of problem as the `as any` casts.
3. Wrap the mount in `<FeatureBoundary>` so a crash in the feature cannot take down the
   capture screen an operator is mid-shift on.
4. Do not edit `lib/core/**`. If you need something from core that isn't there, add it to
   core *with tests*, in its own commit, separately reviewed (`CODEOWNERS` enforces this).
5. If the feature writes bag data, it appends events — see §6.

---

## 4. Rules with an incident attached

- **Never `delete()` then `insert()` a session's rows.** Use per-row upsert on a stable id.
  → the 44% bag loss, and the day Sieving Tower's rows emptied.
- **Never blanket-delete `scan_events`.** It is an append-only audit ledger. To undo an
  event, append a reversing event. → `live/capture/page.tsx` was bulk-replacing it.
- **Never duck-type the section union.** Always `switch (d.kind)` with a `never` default.
  → `CaptureOverview.tsx`.
- **Never `as any` across a section boundary.** It is how Blender data reaches Refining code.
- **Gate validation on the same condition as the render.** If a run type hides a field, the
  check for that field must sit behind the identical condition, or the operator hits a save
  they cannot clear and cannot see. → recurring class; PRs #722 / #752 / #756.
- **The five mass-balance formulas are deliberately NOT unified.** Blender is `out − in`;
  Refining and Sieving are `in − out`; Granule is `G = C* + D + E + F`, `balance = H − G`.
  They mirror five different paper forms. Merging them looks like good deduplication and
  recreates exactly the coupling this document exists to prevent.
- **Sections are independent lines.** Shared code must not infer a section's meaning from a
  field name it happens to share with another section.

---

## 5. Serialization is core

Serial numbers are generated **only** by `lib/core/serials.ts`. Never inline in a section
component. Never by reading a max in app code — the sequence is allocated by the database
(`next_bag_serial`, mirroring the existing `next_job_card_no` RPC pattern), because app-side
allocation mints duplicates under concurrent use and reads a wrong max past `limit(4000)`.

---

## 6. Bag data is an append-only ledger

`production.scan_events` is the ledger. It already carries `action`, `session_id`,
`operator_id`, `weight_kg`, `related_serial_number`, `scanned_at`, plus `source` / `reason`
for overrides. Reporting is **event-sourced**: sum delta rows by the date they happened,
never re-derive a day's total from a bag's current (possibly since-changed) state.

Reporting sums `bagging_out` only — **never** `topped_up`, or transfers double-count.

### Adjustment tiers

The tier is decided **server-side from a fresh read of `prod_sessions.status`**, never from a
client flag — a session that submits mid-edit must be refused by the route handler, not by a
disabled button.

| | Tier 1 — Correction | Tier 2 — Stock Adjustment |
|---|---|---|
| When | `status = 'draft'` (not yet submitted) | submitted or approved |
| Who | Supervisor, on the operator's behalf | Holder of `can_post_stock_adjustment` only |
| Event | `bagging_out` + `source: 'manual_override'` | `stock_adjust` + `source: 'manual_override'` |
| Meaning | Fixing the capture record | An inventory movement — posts against Acumatica `SSTKADJ*` depot items |

Adjustments only ever **append**. They never write `prod_bagging`, so they cannot corrupt an
operator's live screen.

---

## 7. Reuse index — check here before writing a helper

| Need | Already exists in |
|---|---|
| Serial build, tolerances, weight plausibility, section metadata | `lib/production/capture-config.ts` |
| Bag transfers / half-bag top-ups, serial lookup, global scanner | `lib/production/scan-utils.ts` |
| Scan validation | `lib/production/validate-scan.ts` |
| Shift windows, SAST today | `lib/production/shifts.ts` |
| Batch normalise / compare | `lib/production/batch-key.ts` |
| BOM lookup | `lib/production/bom.ts` |
| Audit trail | `lib/audit/write.ts` — `writeAudit()` |
| Permissions | `lib/auth/permissions.ts`, `lib/auth/permission-registry.ts` |

A new page needs **four** registrations or it is unreachable or unguarded: the
`PermissionKey` union, `permission-registry.ts`, `ROUTE_GUARDS` in `app/(app)/layout.tsx`,
and `NAV` in `components/layout/Sidebar.tsx`.

---

## 8. Testing

- `npm run test` — vitest, unit tests over `lib/core/**`. Core changes require tests.
- `npm run test:e2e` — Playwright. The operator capture → submit flow is the regression
  guard; it must stay green.
- The two-tab concurrent-save spec is the acceptance test for the read-modify-write fix. It
  is expected to fail until that lands. **Do not delete it to make CI green.**

---

## 9. Timestamps

Store UTC `timestamptz`. Display in SAST (Africa/Johannesburg, UTC+2). Compare full
date+time, never a bare `HH:MM`.
