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
| **1B** Serialization | **Built and provisioned; one env var from live** | Code wired in all four output sections (Sieving, Refining, Granule, Blender — Pasteuriser is out of the scheme by design, §5). **The migration IS applied on staging** — verified read-only 2026-09-04: `production.bag_serial_counters` returns `42501 permission denied`, which only an EXISTING table raises; a missing one gives `42P01`. So the only thing left is `NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION=sieving` in staging's env. Until then the race is still live. |
| **2** Typed contracts | **Done, still regressing** | Duck-typing gone, `assertNever` in place. But `as any` in `[section]/page.tsx` is **62** as of 2026-09-04, measured — the "61" written here on 09-02 was already wrong. Trend: 58 on 08-25, 59 on 08-26, 62 now. It has gone **up** through the whole clean-up. The five section data types still live in component files — deliberately, now: core declares the shapes it reads instead (see the boundary note below), so this is no longer blocking anything. |
| **3** Feature boundary | **Done** | Guardrails in place, proven by tests, mounted, **and the first capture feature actually moved** — `features/changeover/` (2026-09-04). `features/acumatica-items` was built out of sequence; the changeover is the first one done to the plan. |
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
| Row builders characterised | **Done** — 42 tests over `buildDebagRows`/`buildBagRows`, all five sections. They now also guarantee no output path emits `''` for a serial, locally, rather than depending on a cleanup pass in `persist()` 300 lines away. (An earlier version of this row called that a live bug the extraction had caught. It was not — see the correction below.) |
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

**Done — 2026-09-04.** The UI is now `features/changeover/`, behind `flags.changeover`
and wrapped in `<FeatureBoundary>`. The page went 2,783 → 2,728 lines and the type-error
count fell 36 → 32.

The three-way split, which is the shape every later feature should copy:

| Layer | Owns | Lives in |
|---|---|---|
| core | the **rules** | `lib/core/changeover.ts` |
| feature | the **presentation** | `features/changeover/` |
| page | the **session lifecycle** | `capture/[section]/page.tsx` |

**The handler deliberately stayed on the page.** It flushes unsaved edits, snapshots the
closing balance, appends to the bucket-elevator ledger and opens a new session — all
session lifecycle. Pulling it into the feature would mean threading six callbacks through
and would make the feature a second owner of the save path, which §4's hard constraint
forbids until Phase 7. What moved is the JSX; what stayed is what the page is for.

**14 tests**, built through `planChangeover()` rather than hand-written plan objects — a
hand-written plan can express a state core would never produce, and then the test passes
while the screen breaks. The last one is the invariant the whole split exists for: for
every plan, the dialog offers the carry option **iff** `plan.mayCarry`, and the trigger
renders a button **iff** `plan.allowed`. Proven to bite by planting the exact defect
(`{plan.mayCarry ? (` → `{true ? (`): 5 tests fail, naming the organic case.

Two things sharing the word `changeover` were **left alone**, because they are shift
*handover*, not grade/variant, and neither reads a `ChangeoverPlan`: `ChangeoverModal`
(the 16h00 PIN gate) and `ChangeoverSubmitModal` (the early-submit prompt). Folding them
in because the name matches is the §1A duck-typing mistake applied to names.

**`flags.changeover` defaults to `true`, unlike every other flag.** It is shipped, working
behaviour here — a `false` default would silently remove a supervisor control on merge,
which is the silent-latch class, not a safe default. The flag exists for the promotion:
production must receive `NEXT_PUBLIC_FF_CHANGEOVER=false` **in the same change that ships
the feature**, since `main` removed this button for being broken.


### The boundary rule had a hole, and core was through it — closed 2026-09-04

`eslint.boundaries.mjs` forbade `features/`, `app/`, React/Next and `lib/supabase/` —
**but not `components/`**. So `lib/core/capture-rows` importing its five section data
types from the capture components was legal by the letter of the rule and against every
word of §2.

**Fixed the way core already answers this question.** `lib/core/mass-balance/sieving.ts`
declares `SievingBalanceData` as "only the fields the balance needs".
`lib/core/types/capture-data.ts` now does the same for the row builders. **`lib/core`
imports nothing outside `lib/core`.**

**Why structural, rather than moving the components' types into core** — which is the
textbook answer and gives one declaration with no possible drift. It edits all five
section components, and those are the most contested files in the fork. Deepening the
fork to tidy a type import makes the promotion harder in exactly the place it is already
hardest. Revisit after step 5, when those files stop being contested.

The cost of a structural copy is drift, so it is pinned:
`components/production/capture/core-conformance.ts` asserts at compile time that each
component's real type is assignable to core's shape. It cannot live in core (core may not
import components); components importing core is the allowed direction. It emits nothing —
`tsc` enforces it, vitest could not, because vitest strips types without checking them.

**The guard earned its place before it was even committed**, rejecting two errors in the
first draft: `RefiningData` types its output groups `RefiningOutputGroup | null` and they
had been written optional-only; and `dustKey` is passed straight to
`dustProductType(key: string)`, so it is required, not optional. Both were mistakes in the
new core types, caught by the compiler rather than by a NULL column in `prod_bagging`.

`components/` is now in `CORE_FORBIDDEN`, **`import type` included** — an erased import
still makes core's contract depend on a `'use client'` component parsing, and it is what
stopped `lib/core` being liftable to another branch on its own.

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

#### CORRECTION — the blank-serial collision was never live, on either branch

An earlier version of this section said `main` carried the blank-serial collision PR #912
fixed on staging, because its inline `buildBag` writes `bag_serial_no: b.serial` raw on six
of seven paths. **That was wrong, and so was the #912 claim it rested on.**

`persist()` normalises blanks before it inserts anything, on both branches:

```ts
const blankSerialToNull = (r: any) => {
  if (!r.bag_serial_no || !String(r.bag_serial_no).trim()) r.bag_serial_no = null
}
debag.forEach(blankSerialToNull)
bag.forEach(blankSerialToNull)
```

Staging line 1193, `prod_bagging` insert at 1345 — **before**, not after. It predates #912
(present at `a8b5337`). And `buildBag` has exactly **one** call site on each branch, inside
`persist()`, so nothing reaches the database around it. `''` never got to Postgres.

**The lesson worth keeping**, since this is the second time a comment has been misread as a
live symptom: the comment above that guard describes the bug it was *written to fix*. Scar
tissue reads like an open wound (ARCHITECTURE.md §1B says as much about the defensive
comments around the save path). Proving a function returns a bad value is not proving the
system is broken — trace the value to the write before writing it up.

The `serialOrNull()` change stays: the builders are pure and independently callable now, so
the guarantee belongs in them, not in a caller three hundred lines away. But it is defence
in depth, not a fix.

**Order of work.** Steps 1 and 2 are decided and probed; the risk rises sharply at step 5.

1. **The admin-page hook crash** — one file, thirteen lines, the fix already proven on
   staging, and it is live on production now. Nothing to weigh.
2. **The guardrails** — `vitest.config.mts`, `eslint.boundaries.mjs`, `eslint.hooks.mjs`,
   `ci.yml`, `CODEOWNERS`, `ARCHITECTURE.md`, the npm scripts, the two devDependencies
   (`vitest` only — Playwright is excluded), and `lib/core/**`. Probed inert: nothing on `main`
   imports core, 413 tests pass, 0 type errors, baseline already 36. Land this **before**
   any feature, so every later cherry-pick arrives with the net under it.
3. ~~**The blank-serial fix**~~ — **withdrawn.** There is nothing to fix; `main` has the
   same `blankSerialToNull` guard in the same place. See the correction above.
4. **The changeover** — ✅ extracted on staging (`features/changeover/`, 14 tests). What
   remains is the cherry-pick, and it **must** carry `NEXT_PUBLIC_FF_CHANGEOVER=false`
   into production's environment in the same change. `main` removed this button because
   it was broken; it must arrive switched off and be turned on once a shift has run.
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

#### Does `lib/core` have to go to `main`?

Asked directly, 2026-09-04. **Not for `main` to work — but yes, and first.**

*Not for correctness.* Nothing on `main` imports `@/lib/core`; `main` mints its serials and
builds its rows with its own inline code. Withhold core entirely and production behaves
exactly as it does today. It is not a dependency of anything on that branch.

*Yes, because it is the carrier for everything else.* Every later cherry-pick — the
changeover, the reconcile, the top-up accounting — imports core. Landing it separately and
first means each of those arrives as a small diff against a branch that already has the
foundation, instead of one enormous change that mixes new architecture with new behaviour.
It also brings the tests and the boundary rule with it, so the later steps land with a net
under them rather than after them.

*And the risk is measured, not assumed.* Probed against `main`'s actual tree: boundary lint
passes, 413/413 core tests pass, `tsc` reports 0 errors in `lib/core` and 36 overall, which
is already `main`'s number. It lands as dead code.

**The restructure above made this strictly better.** Before it, `lib/core/capture-rows`
imported types from the five capture components, so core would only compile on `main` if
`main`'s components happened to export those names with compatible shapes. They did — but
by luck, and the luck would have run out the first time either branch touched a component.
Core is now self-contained, so it lifts to any branch without caring what that branch's
components look like. That is the practical reason this was worth doing before the
promotion rather than after.

PR #916 carries `lib/core` to `main` and must be **updated to include this restructure**
before it merges, or it ships the version with the components dependency.

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
