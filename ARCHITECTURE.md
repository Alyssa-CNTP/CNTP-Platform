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

Run it with **`npm run lint:boundaries`**. This is the hard gate in CI.

It is a *separate* command from `npm run lint` on purpose. The build sets
`DISABLE_ESLINT_PLUGIN=true` so it catches nothing, and a full lint of this repo currently
reports ~3000 pre-existing errors — the one rule that protects the architecture would be
invisible among them. The boundary rules live in `eslint.boundaries.mjs` and are imported
by `eslint.config.mjs`, so the two entry points cannot drift.

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
- **Never duck-type the section union.** Dispatch on the section kind, and end every chain
  in `assertNever(kind)`. → `CaptureOverview.tsx`, now fixed.

  Use `sectionKindFor(sectionId)` from `lib/core/types/capture.ts`. The section is already
  known from the route and from `prod_sessions.section_id` — it never needed inferring.
  Because both dispatches end in `assertNever`, **adding a section kind without handling it
  everywhere fails the build**; that is the actual guarantee, not the runtime fallback.

  When you add a section, add it to `SECTION_KIND` *and* `SECTION_MODE`. A drift guard
  (`lib/production/section-kind-drift.test.ts`) fails if the two lists disagree — written
  after `SECTION_KIND` was first built from the original migration and missed
  `smallblender`, which had been added a month later.
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

### What CI actually enforces

| Step | Kind |
|---|---|
| `npm run lint:boundaries` | **Hard gate.** The architecture rule. No exceptions. |
| `npm run test` | **Hard gate.** Unit tests over `lib/core/**`. |
| Typecheck | **Ratchet** — fails only if the count rises above the baseline. |
| Lint (full) | **Ratchet** — same. |

The two ratchets exist because the repo has ~3000 pre-existing lint errors and 36 type
errors, and both `DISABLE_ESLINT_PLUGIN=true` and `typescript.ignoreBuildErrors: true` are
set, which is how they accumulated unnoticed. Demanding zero would put CI permanently red
and teach everyone to ignore it; demanding "no worse than today" stops the backlog growing
while it is paid down. **Lower the baselines in `.github/workflows/ci.yml` as you clear
errors — never raise them.**

**`npm run test`** — vitest over `lib/core/**`. Runs in CI on every PR. Core changes
require tests. These are characterisation tests: they pin what the code *currently* does,
so an extraction cannot silently change what a capture screen computes. A failure means
the refactor changed behaviour — that is the signal, not a test to relax.

**`npm run test:e2e`** — Playwright, against a local dev server or staging:

```bash
E2E_BASE_URL=https://cntpplatform-staging.rooibostea.co.za npm run test:e2e
```

The app signs in through Microsoft SSO, which is not automatable and must not be scripted
with stored credentials. The specs instead reuse a session you capture once yourself:

```bash
npx playwright open --save-storage=e2e/.auth/user.json http://localhost:3000
```

Sign in, reach `/home`, close the window. `e2e/.auth/` is gitignored — it holds a live
token. Without that file the specs **skip** with an explanatory message rather than fail.

This is also why E2E is **not** in the CI workflow: with no session artefact every spec
would skip, so the job would be a green tick that proved nothing. Run it locally or against
staging before merging anything that touches capture.

**`e2e/concurrent-save.spec.ts` is the acceptance test for the read-modify-write fix.** It
is marked `test.fixme` because it is expected to fail against the current save path. Remove
the `.fixme` only when per-row upsert on a stable id has replaced the delete-then-insert and
it passes for real. **Do not delete or skip it to make a run clean.**

---

## 9. Timestamps

Store UTC `timestamptz`. Display in SAST (Africa/Johannesburg, UTC+2). Compare full
date+time, never a bare `HH:MM`.
