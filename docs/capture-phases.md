# Capture module — Core/Feature architecture and phase plan

**This is the plan of record.** It existed only in chat until 2026-09-02, which is why
work drifted from it without anyone noticing. Audit against this file, and update the
status table in the same commit as the work.

---

## Status — 2026-09-04

| Phase | State | Outstanding |
|---|---|---|
| **0** Guardrails | **Effectively closed** | Item 7: both index migrations verified 2026-09-04 against staging *and* production — the indexes already exist, matching their files exactly, so running them is a confirmed no-op that only closes the repo/live gap. Neither file has been run yet. |
| **1** Populate core | **Done** | `n()`, `metrics`, `serials`, mass-balance, variant identity, `lookupSerial` all extracted — see the `n()` note below |
| **1B** Serialization | **Built, not shipped** | `NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION` unset — no section is on it, so the duplicate-serial race is still live |
| **2** Typed contracts | **Done, still regressing** | Duck-typing gone, `assertNever` in place. But `as any` in `[section]/page.tsx` is **62** as of 2026-09-04, measured — the "61" written here on 09-02 was already wrong. Trend: 58 on 08-25, 59 on 08-26, 62 now. It has gone **up** through the whole clean-up. Also unfinished: the five section data types still live in component files; Phase 2 only moved `SectionKind` and `assertNever`. |
| **3** Feature boundary | **Done** | Guardrails in place, proven by tests, **and now actually mounted** — see below |
| **4** Ledger foundation | Not started | `lib/core/ledger/` absent; `scan_events` unextended; `live/capture/page.tsx` still bulk-deletes the ledger |
| **5** Reconciliation | Not started | |
| **6** Adjustment page | Not started | flag `supervisorAdjustments` exists, page does not |
| **7** Flip reads | Not started | `e2e/concurrent-save.spec.ts` still `test.fixme` |

### The safety net — 2026-09-04

Added before any further extraction, because the module had almost no cover: one
test file across 144 component files, and both E2E specs skipping in CI.

| | State |
|---|---|
| `lint:hooks` gated | **Done, by another route** — the PAT has no `workflow` scope, so `ci.yml` still cannot be edited from here. Instead `package.json` runs it as a `posttest` hook, so `npm run test` exits non-zero on a hooks violation and the existing Unit tests step fails. Verified both ways by planting a hook below an early return. Adding the four named `ci.yml` lines is now cosmetic — it reads better in the Actions log, nothing more. |
| `<FeatureBoundary>` mounted | **Done** — it had **zero usages** since Phase 3. The five sections rendered bare in a ternary, so one throwing blanked the whole route. Now wrapping the section mount and `CaptureOverview`. |
| E2E skip made honest | **Done** — `requireAuthState()` throws when `CI` is set, so wiring the suite in before a session artefact exists gives a red build instead of a false pass. |
| Row builders characterised | **Done** — 42 tests over `buildDebagRows`/`buildBagRows`, all five sections. The extraction has already paid for itself: a blank-serial collision that fails the whole save was reproduced by *calling the builders*, where before it would have needed a live save on the floor. |
| Render smoke tests | **Done** — 22 tests. Every section rendered empty, populated and locked, plus `CaptureOverview` against all five section shapes and both shifts. |

**The "no runtime cover" gap is now partly closed.** `renderToStaticMarkup` runs the
render pass in plain node — no jsdom, no new dependency, no auth, about two seconds in
CI on every PR. Proven to work by planting a throw in `GranuleCapture`: exactly the three
Granule cases fail, and the failure names the section.

What it still does **not** cover: `useEffect` does not run in a server render, so effects,
event handlers, the scanner and anything browser-only are untested. This is a crash
detector for the render pass, not an integration test, and it does not replace the
Playwright suite — which still cannot run in CI, because the app signs in through
Microsoft SSO and that must not be scripted with stored credentials.

### The changeover — decided 2026-09-04

`main` removed the mid-shift changeover button and `staging` kept it, which read like a
product disagreement. It was not. **It was removed from production because it was
broken, not because the feature is unwanted** — Alyssa did not want operators using it
in that state.

So the fork resolves in staging's direction, with one condition: the changeover is a
**core function**, not something living inside each capture page. Supervisor-gated,
single-fire, clean slate by default, and the organic rule a property of the ledger it
writes to (§5).

**Half of that is now done.** `lib/core/changeover.ts` owns the *rules*: `planChangeover()`
returns one plan — may this actor do it, how much is left, may that material be carried —
and the trigger, the dialog and the save handler all read the same plan instead of each
re-deciding. Two decisions that used to be tangled are now separate axes, which is what
the earlier code kept getting wrong:

- `blockedReason` answers **who** — a non-supervisor cannot open the changeover at all.
- `carryRefusal` answers **what material** — organic never pools, an unrecognised variant
  fails closed, and there is nothing to carry when the leftover is zero.

`isPastShiftChangeover()` and `isEarlyChangeoverLikely()` take `now` as an argument rather
than reading the clock, so both are testable and neither can drift from
`productionDayFor()`.

**What is left is the UI.** Roughly 150 lines of dialog JSX still sit in
`[section]/page.tsx`. Moving them to `features/changeover/` is the next feature-shaped
piece of work, and it must happen before the promotion, not after — see below.


### Promotion to production — measured 2026-09-04

The goal is staging and `main` aligned, on a system that is more robust than either, not
one that breaks when a feature is added. Before planning that, here is what the two
branches actually are. Every number below is measured, not estimated.

**`main` and `staging` are a fork, not a lead and a lag.** They last shared a commit on
**2026-08-05** (`7fe884b`). Since then: **325 commits on `main` only**, **278 on
`staging` only**. Both are still moving — those numbers were 310 and 273 two days ago, so
the gap is widening, not closing. Within the capture module alone the split is **75
commits on `main` only** against **79 on `staging` only**. Neither branch is a superset
of the other, and neither can be fast-forwarded onto the other.

**None of the architecture work exists on `main`.** This is the part that had not been
stated plainly, and it changes what "promote" means:

| | `main` | `staging` |
|---|---|---|
| `lib/core/**` | **absent** | 29 files |
| `features/**` | **absent** | 6 files |
| `ARCHITECTURE.md` | **absent** | present |
| `eslint.boundaries.mjs` / `eslint.hooks.mjs` | **absent** | present |
| `vitest.config.mts` | **absent** | present |
| `.github/workflows/ci.yml` | **absent** | present |
| npm scripts | `dev`, `build`, `start`, `lint` | those plus `test`, `posttest`, `lint:boundaries`, `lint:hooks`, `test:e2e` |

So production today runs with **no unit tests, no boundary rule, no hooks gate and no CI
workflow at all**. The 526 tests and the four gates are a staging-only safety net. That is
the strongest argument for promoting, and also the reason promoting cannot be done as one
merge: the guardrails and the code they guard would land together, on a branch that has
had 325 commits of independent production hotfixes since the split.

**Two concerns have genuinely diverged and must be decided before any cherry-pick.** These
are not merge conflicts to resolve mechanically; each is two working implementations of
the same idea and only one can survive:

| Concern | `main` | `staging` | Decision |
|---|---|---|---|
| #867 reconcile | `lib/production/self-heal-reconcile.ts` | `lib/production/debag-reconcile.ts` (+ tests) | **Staging.** Decided 2026-09-04. The 2026-08-31 incident is the evidence: a session-scoped self-heal against batch-scoped writes doubled rows on every page load. |
| Top-up accounting | `lib/production/order-detail.ts`, **845 lines**, no `transferInKg` | `order-detail.ts` **492 lines**, with `transferInKg` in `lib/core/mass-balance/` | **Staging.** Decided 2026-09-04. Bag-to-bag transfers are subtracted in core, where the rule is tested and has one owner, rather than absorbed in the order detail. |

**Both resolved in staging's direction — the healthier long-term route.** Neither is a
merge to perform mechanically: `self-heal-reconcile.ts` must be *deleted* from `main` as
part of the cherry-pick, not left alongside `debag-reconcile.ts`, or production runs two
reconciles with opposite scoping assumptions. That is the row-doubling mechanism again.

### What can move to `main` safely — probed, not assumed, 2026-09-04

The worry is legitimate: `lib/core` was extracted *from* capture pages that `main` does
not have. The capture page differs by **1,187 lines** across the two branches (2,808 on
main, 2,783 on staging) and all five section components are contested. So the question of
whether core can travel without them was tested, by checking out `main`'s tree, dropping
staging's `lib/core` and the three lint/test configs on top, and running the gates.

| Probe | Result |
|---|---|
| `lint:boundaries` | **Passes**, exit 0 |
| `npm run test` (lib/core only) | **413/413 pass**, unchanged, against `main`'s tree |
| `tsc` over `lib/core` | **0 errors** |
| Source type errors on `main` | **36** — identical to staging's ratchet baseline, so it transplants as-is |
| `lint:hooks` | **FAILS — 1 error**, and it is a live production crash (below) |

Two structural facts make this work, and both should be re-checked before the cherry-pick
rather than assumed to hold:

- **Nothing on `main` imports `@/lib/core`.** Not one file. So the module lands as dead
  code with zero runtime effect — which is what "additive" has to mean to be worth
  claiming. `main` keeps its own inline `buildDebag`/`buildBag` at `[section]/page.tsx`
  lines 1052 and 1146 until the page is deliberately switched over, which is separate work.
- **`main` already exports the five section data types** — `SievingData`, `RefiningData`,
  `GranuleData`, `BlenderData`, `PasteuriserData` — with shapes compatible enough that
  `lib/core/capture-rows` typechecks against them unmodified.

That second point is also the **one hole in the boundary rule**. `lib/core/capture-rows/
index.ts` imports those types from `@/components/production/capture/*`, and
`eslint.boundaries.mjs` forbids `features/`, `app/`, React/Next and `lib/supabase/` — but
not `components/`. So core reaching into components is currently legal, against the spirit
of ARCHITECTURE.md §2. It works today only because the types happen to match on both
branches. **This is the Phase 2 unfinished half wearing a different hat**: the five
section data types still live in component files instead of `lib/core/types/`. Move them,
then add `components/` to `CORE_FORBIDDEN`.

#### The probe found a live crash on production

    app/(app)/admin/inventory-import/page.tsx:129
    error  React Hook "useCallback" is called conditionally  react-hooks/rules-of-hooks

`const { role } = useAuth()` at line 91, `if (role !== 'admin') return <...>` at line 102,
`useCallback` at line 129. `role` starts unresolved and then resolves, so the hook count
changes between renders — React error #310, and the page comes down **for admins only**,
which is to say for exactly the people the page is for. Same class as HOTFIX #901.

**Staging already fixed it** (the hook moved above the gate, with a comment explaining
why). This is the whole argument for the guardrails-first order in one example: the gate
found a live production bug in under a minute, and the fix already exists.

#### Production also has the blank-serial collision

`main`'s inline `buildBag` writes `bag_serial_no: b.serial` raw on **six of its seven**
output paths — only one carries `|| null`. That is the same fault PR #912 fixed on
staging: two blank serials in one session are not distinct under
`prod_bagging_session_serial_uniq`, so the whole insert is rejected. Latent until two
blanks coincide.

**Order of work.** Steps 1 and 2 are decided and probed; the risk rises sharply at step 5.

1. **The admin-page hook crash** — one file, thirteen lines, the fix already proven on
   staging, and it is live on production now. Nothing to weigh.
2. **The guardrails** — `vitest.config.mts`, `eslint.boundaries.mjs`, `eslint.hooks.mjs`,
   `ci.yml`, `CODEOWNERS`, `ARCHITECTURE.md`, the npm scripts, the two devDependencies
   (`vitest`, `@playwright/test`), and `lib/core/**`. Probed inert: nothing on `main`
   imports core, 413 tests pass, 0 type errors, baseline already 36. Land this **before**
   any feature, so every later cherry-pick arrives with the net under it.
3. **The blank-serial fix** — but as a patch to `main`'s own inline `buildBag`, *not* by
   switching the page to `lib/core/capture-rows`. Same one-line coercion, none of the
   rewiring.
4. **The changeover** — extract the dialog to `features/changeover/` on staging first
   (the rules are already core), then cherry-pick the whole feature.
5. **The capture module itself** — the 1,187 differing lines, all five section
   components, the reconcile deletion and the top-up accounting. **This is where the care
   goes.** Not one PR: one concern at a time, each with the E2E capture spec run against
   staging beforehand, because unit tests do not cover the components and
   `renderToStaticMarkup` catches only crashes, not wrong numbers.
6. Apply pending Supabase migrations to production only **after** the code that needs
   them is deployed there.

**Steps 1–3 cannot change production behaviour** and are worth doing on their own merit
regardless of whether the full promotion ever happens. Step 5 is the actual promotion and
should not begin until 1–4 are on `main` and a shift has run against them.

**Do not merge `staging` into `main`.** With 325 commits of divergence and no common
recent ancestor, the conflict surface is the whole capture module, and a mis-resolution
there is a silent data fault, not a build error.

### Deviations from the plan, and why

- **Splitting the capture page by SECTION was considered and rejected.** Five routes,
  one per work centre, is the intuitive read of "split the page" and it is the wrong
  axis. Measured on 2026-09-03: only 2 `sectionId.startsWith()` branches remain (from
  41), the section-specific UI is already five separate components, and what is left in
  the page is almost entirely section-agnostic — session lifecycle, PIN and signature
  gates, production-order linking, changeover, row building, persistence, the tab
  shell. Five routes would fork all of that five ways and make every future fix a
  five-place edit. **Split by concern; the directory follows from that.**
- **No runtime plug-in / slot registry, restated.** It keeps being proposed as the way
  to add features safely. It resolves features after the compiler has stopped looking,
  which is the same class of defect as the `as any` casts — see "Architecture
  decisions" above. Plain conditional rendering behind a flag stays.
- **No client state store (Zustand or similar) for now.** The state problem here is not
  re-renders, it is two operators overwriting each other in the database. A shared
  mutable store on top of a delete-then-insert save path makes that harder to reason
  about, not easier. Revisit after Phase 7, if at all.

- **`n()` is finished; the two remaining numeric helpers are NOT copies of it, and must
  not be merged into it.** The status line used to say "down from 11 files to 7", which
  was counting every local `const n = ...`. Only two still match on the comma-decimal
  parse, and both differ where it matters:
  `granule-quality.ts`'s `num()` returns `number | null` so a missing QC reading stays
  distinguishable from a genuine 0 — folding it into `n()` would average "no moisture
  reading" as 0%; `shift-report-builder.ts`'s `num()` is null-safe and finite-checked,
  which `n()` deliberately is not (see the pinned quirk in `num.ts`). Three numeric
  parsers that answer different questions is not the duplication ARCHITECTURE §1A
  describes.
- **`lookupSerial` was deduplicated to `scan-utils.lookupBagForAutofill()`, not migrated
  onto `validateBagScan()`.** The Phase 1 checklist says migrate. That would be a
  behaviour change on the floor — `validateBagScan` additionally refuses a consumed bag,
  a cross-variant bag and a finished product, and Refining and Granule run none of those
  checks today. It is worth doing (ARCHITECTURE §5: a pick list and a scan of the same
  bag must agree) but it belongs in its own change, not folded into a deduplication.

- **`lib/core/variants.ts` changed behaviour, where Phase 1 says "verbatim".** Phase 1 is
  specified as a mechanical move pinned by characterisation tests. Variant identity could
  not be moved that way: there were four copies (`capture-config.isOrganicVariant`,
  `bucket-elevator.variantFamily`, `scan-utils.variantFamily`, and a private one in
  `validate-scan`) and they returned **opposite answers** for `ORG`, `RA-ORG`, `O`, `RO`
  and `FO` — the short codes and id suffixes the app itself produces. There was no single
  current behaviour to characterise. Separately, `manufacturing.ts` mapped `FC` to
  `FT-ORG`, putting Fairtrade *Conventional* into the *organic* pool, against every other
  map in the repo. Unified on the normalising version, made fail-closed (unknown returns
  `null`, never `'conventional'`), and pinned by `lib/core/variants.test.ts`.

- **`features/acumatica-items` was built out of sequence.** Phase 3 says "No feature
  moved yet"; Phase 6 designates `supervisor-adjustments` as the first feature module.
  This one resolves Acumatica item codes against the synced master inventory instead of
  building them from templates, and it fixed live defects (ids that do not exist, a
  variant filter that hid Blocks from Organic runs). It is flagged off. **Do not invest
  further in it until the plan catches up.**
- **CI does not run `test:e2e`.** Deliberate, documented in ARCHITECTURE.md §8: without a
  stored session artefact every spec skips, so the job would be a green tick proving
  nothing. Run it locally or against staging before merging capture changes.
- **The DB allocator is `next_bag_seq(p_scope text)`, not `next_bag_serial(prefix text)`.**
  Scope is not always a prefix: on the Granule Line the counting scope is the LOT, which
  runs across several days, so a date-bearing prefix would restart the sequence mid-lot.
  See ARCHITECTURE.md §5.
- **Phase 1B rollout order is unsettled.** The plan says Granule first; Sieving was
  proposed instead because it feeds the Quality queue and is the best-observed line.
  Nothing has rolled out either way.

---

## Context

Adding a feature to one capture section keeps breaking another. There are **two
independent causes**, and only one of them is an architecture problem. Both need fixing;
conflating them is how this gets half-solved.

### Cause 1 — no boundary between core and features (an architecture problem)

The union type was duck-typed, so sections read each other's data. `CaptureOverview.tsx`
dispatched on *property presence* — `if ('bomId' in d)` for Blender, `'inputs' in d` for
Refining, and a silent `else` fallback to Sieving. `data` was a loose union of five
section types with no discriminant: add a field named `inputs` to any section and it
silently became Refining. The capture page carried ~41 `sectionId.startsWith(...)`
branches and 57 `as any` casts — the compiler switched off exactly where it would have
caught this.

Logic was copy-pasted, so fixes landed in one copy. `n()` was byte-identical in 11
files, `kgPerHour` in 4, `yieldPct` in 3. Two bespoke `lookupSerial` copies bypassed the
shared `validateBagScan` that three other sections already used.

### Cause 2 — the save path is read-modify-write (a data problem)

Delete-then-insert on `prod_debagging` and `prod_bagging`; `bag_no` allocated by reading
held numbers into app memory; and a bulk replace on `scan_events` — **the audit ledger
itself**. The in-code comments record the cost: "exactly how 44% of Fine/Coarse Leaf bags
went missing from prod_bagging", "emptied Sieving Tower's bagging rows on production for
a full day", "7 of 24 Sieving bags absent from bag_tags".

**No amount of module isolation fixes this.** It is two writers overwriting each other.
It needs an append-only write path.

### Cause 3 — no safety net

Zero tests, no runner installed. Nothing would have caught either cause.

### The finding that shrinks the ledger work

**Do not create a `bag_logs` table.** `production.scan_events` already exists with `id`,
`action`, `session_id`, `operator_id`, `weight_kg`, `related_serial_number` and
`scanned_at` — and `20260818_004` already wrote event-sourcing into its header. It needs
`source` and `reason` columns, and one call site stopped from bulk-deleting it. Half-bag
top-ups are likewise already external, in `lib/production/scan-utils.ts`.

---

## Architecture decisions

The **Pragmatic Middle Ground**, not a runtime plugin registry. A hook/slot registry
resolves features at *runtime*, which hides control flow from TypeScript — the same class
of defect as the `as any` casts. Plain flags keep the React tree readable and the
compiler in charge.

| Concern | Decision |
|---|---|
| Boundary | `lib/core/**` (pure, immutable) vs `features/**` (self-contained), enforced by ESLint — no `src/` move |
| Feature wiring | Plain conditional rendering behind flags in `lib/config/flags.ts`; no dynamic slot injection |
| Feature crash containment | `components/shared/FeatureBoundary.tsx` wrapping each feature mount |
| Core protection | Pure functions + unit tests + `CODEOWNERS` on `lib/core/**` |
| Regression guard | Playwright E2E of operator capture to submit |
| Ledger | Extend existing `production.scan_events`; dual-write shadow period |
| Serialization | Core module, standalone — `lib/core/serials.ts`, allocation moved into the DB |
| Adjustment UI | Dedicated page, two tiers gated on session status (Phase 6) |
| Live updates | Realtime subscription + 30 s poll backstop |

**Hard constraint: the operator save path (`persist()` in `[section]/page.tsx`) is not
altered until Phase 7, and only after Phase 5 proves the ledger matches it row-for-row.**
Everything before that is additive or read-side.

**Rule: `lib/core/**` may not import from `features/**` or `app/**`.** Features import
core; core never knows a feature exists. Enforced by `npm run lint:boundaries` in CI.

---

## Phases

Each phase is independently shippable and independently revertible.

### Phase 0 — Guardrails first (no behaviour change)

1. vitest dev dependency, `vitest.config.mts`, `test` / `test:watch` scripts.
2. Characterisation tests pinning the *current* output of every function about to move.
   They assert what the code does today, right or wrong. This is the rollback detector.
3. Playwright E2E: operator opens a section, adds bags, saves, submits. Plus a two-tab
   concurrent-save spec that **is expected to fail now** and becomes the Phase 7 gate.
4. ESLint boundary rule + `CODEOWNERS` on `lib/core/**`.
5. GitHub Actions running lint + test on PRs to `staging`.
6. `ARCHITECTURE.md` plus the `@ARCHITECTURE.md` line in `CLAUDE.md`.
7. Migration capturing schema drift: `prod_bagging_session_bag_uidx` exists in the live
   DB but in no migration file. `IF NOT EXISTS`, so repo, staging and prod agree.

### Phase 1 — Populate `lib/core/` (mechanical, no behaviour change)

`num.ts`, `metrics.ts`, `serials.ts` and
`mass-balance/{sieving,refining,granule,blender,pasteuriser}.ts` moved **verbatim**. Then
delete the inline granule duplicate, and migrate the two bespoke `lookupSerial` copies
onto `validate-scan.ts`. One file per commit, tests green either side.

### Phase 1B — Serialization as a standalone core module, and made correct

**The sequence was allocated by a read-modify-write and was not safe.** Granule and
Sieving both seeded the next number by querying `bag_tags` with `ilike 'prefix%'`,
`limit 4000`, then taking a local max — two operators adding a bag in the same moment
both mint the same serial, and the limit returns a wrong max past 4,000 bags.

1. `lib/core/serials.ts` owns every format, plus a parser (there was none).
2. Atomic allocation in the database, mirroring the existing `next_job_card_no` RPC.
3. Roll out **one section at a time**, with the app-side seeding kept behind a flag.

**Ships alone, on its own day, separately revertible** — the only pre-ledger phase that
changes operator-visible behaviour, at bag-add time rather than at save time.

### Phase 2 — Typed contracts (the fix for cross-section breakage)

Add `kind` to each section type; move all five into `lib/core/types/capture.ts`. Replace
duck-typing with exhaustive `switch` plus a `never` default. Remove `as any` from every
path touched. After this, a field added to one section **cannot compile** into another's
branch, and a sixth section fails the build until every switch handles it.

### Phase 3 — Feature boundary goes live

`lib/config/flags.ts`, `components/shared/FeatureBoundary.tsx`, ESLint rule switched from
warn to error, `features/` created. **No feature moved yet** — this phase only proves the
guardrails hold on a green build.

Both guardrails are proven by tests rather than by inspection:

- `lib/config/boundary-rule.test.ts` runs ESLint programmatically over fixture source and
  asserts a core-to-feature import is reported as an **error**. A rule nobody has seen
  fail is a rule nobody knows works.
- `components/shared/FeatureBoundary.test.tsx` renders a throwing child and asserts the
  page survives, the fallback appears, `silent` renders nothing, and the crash is logged.

**A feature reached through a hook cannot be protected by `<FeatureBoundary>.**` An error
boundary catches a throw from a child *component* during render, not one from a hook the
page itself called. Where a feature is consumed as a hook or a plain function, the
adapter must be total instead: catch, log, and fall back to the pre-feature behaviour.
See `lib/production/use-item-codes.ts`.

### Phase 4 — Ledger foundation (additive; nothing reads it)

`ALTER TABLE production.scan_events` add `source`, `reason`, `actor_id` and
`reverses_event_id`; widen the `action` CHECK to include `stock_adjust`; add `bag_uid`
for untagged bags; **drop `ON DELETE CASCADE` on `serial_number`** in favour of
`SET NULL` plus a preserved `serial_text`, because cascading deletes on an audit ledger
destroy the evidence; indexes on `(session_id, scanned_at)` and `(source)`.

`lib/core/ledger/bag-events.ts` — the only module touching the ledger.

**Dual-write:** existing paths additionally append an event, each in `try/catch` so a
ledger failure can never block an operator save. `prod_bagging` stays authoritative. Also
fix `live/capture/page.tsx` — the one place actively corrupting the ledger.

### Phase 5 — Reconciliation (read-only proof)

Supervisor panel comparing ledger-derived totals against `prod_bagging` and `bag_tags`
per session. **Exit criterion: zero unexplained variances for 5 consecutive production
days.**

### Phase 6 — Adjustment page (the first real feature module)

`features/supervisor-adjustments/`, behind its flag and a `<FeatureBoundary>`. Two tiers,
gated **server-side** on `prod_sessions.status`:

| | Tier 1 — Correction | Tier 2 — Stock Adjustment |
|---|---|---|
| When | `status = 'draft'` | submitted or approved |
| Who | Supervisor | Holder of `can_post_stock_adjustment` only |
| Event | `bagging_out` + `source: 'manual_override'` | `stock_adjust` + `source: 'manual_override'` |

The tier is decided from a fresh server-side read, never a client flag. Four
registrations, or the page is unreachable or unguarded: the `PermissionKey` union,
`permission-registry.ts`, `ROUTE_GUARDS`, and `NAV`. **The page only appends events — it
never writes `prod_bagging`, so it cannot corrupt an operator's live screen.**

Open question for this phase: whether a Tier 2 adjustment posts to Acumatica
automatically or lands in a queue. Acumatica is read-only sync today, so a queue is the
safer default.

### Phase 7 — Flip reads, retire the races

Behind the flag: summaries read `aggregateBagEvents()`; delete-then-insert becomes
per-row upsert on a stable id, removing the `bag_no` allocation race; retire the
`bag_tags` self-heal backfill.

**Acceptance: the Phase 0 two-tab concurrent-save spec goes from red to green.**

---

## Verification

- `npm run test` green at every commit; characterisation tests pass **unchanged** either
  side of each extraction
- `npm run lint:boundaries` fails on any core-to-feature import
- `npm run build` — Phase 2 is proven by the compiler
- Manual on staging after Phases 4 and 6: the same session in two browsers, adding bags
  in both, confirming nothing is lost — the scenario that produced the 44% loss
- Migrations to the **staging** Supabase project (`qjqkpockmujecjgmdple`) first;
  production separately on promotion
- Branch off `staging`; deploy is merge to `staging`; update `CHANGELOG.md` each session

## Sequencing note

Phases 1, 2 and 3 are the "features stop breaking each other" fix and carry no data risk.
Phases 4 to 7 are the concurrency fix and can proceed on their own track.

**Phase 1B is the exception and should be scheduled deliberately.** It fixes a
duplicate-serial bug that exists today, so it is worth doing early — but it ships alone,
section by section, with the old seeding behind a fallback flag.
