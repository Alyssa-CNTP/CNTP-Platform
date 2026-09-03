# Capture module — Core/Feature architecture and phase plan

**This is the plan of record.** It existed only in chat until 2026-09-02, which is why
work drifted from it without anyone noticing. Audit against this file, and update the
status table in the same commit as the work.

---

## Status — 2026-09-03

| Phase | State | Outstanding |
|---|---|---|
| **0** Guardrails | **Open** | Item 7 only: `20260901_001_prod_bagging_unique_index_drift.sql` is written but applied **nowhere** |
| **1** Populate core | **Done** | `n()`, `metrics`, `serials`, mass-balance, variant identity, `lookupSerial` all extracted — see the `n()` note below |
| **1B** Serialization | **Built, not shipped** | `NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION` unset — no section is on it, so the duplicate-serial race is still live |
| **2** Typed contracts | **Done, regressed** | Duck-typing gone, `assertNever` in place. But `as any` in the capture page went **57 → 61** |
| **3** Feature boundary | **Done** | Guardrails in place and proven by tests |
| **4** Ledger foundation | Not started | `lib/core/ledger/` absent; `scan_events` unextended; `live/capture/page.tsx` still bulk-deletes the ledger |
| **5** Reconciliation | Not started | |
| **6** Adjustment page | Not started | flag `supervisorAdjustments` exists, page does not |
| **7** Flip reads | Not started | `e2e/concurrent-save.spec.ts` still `test.fixme` |

### Deviations from the plan, and why

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
