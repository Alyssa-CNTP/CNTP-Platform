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

## 5. Serialization and mass balance are core

### Serialization

Serial numbers are generated **only** by `lib/core/serials.ts`. Never inline in a section
component. Never by reading a max in app code — the sequence is allocated by the database
(`next_bag_serial`, mirroring the existing `next_job_card_no` RPC pattern), because app-side
allocation mints duplicates under concurrent use and reads a wrong max past `limit(4000)`.

#### What a serial is for

A serial has to satisfy four things at once, and they pull against each other:

1. **Legible on the floor.** An operator reads it off a bag and knows the line, the product
   and roughly when. Barcode scanning is the goal, not the excuse — a serial nobody can read
   aloud is a serial nobody can correct.
2. **Countable.** The trailing number tells you how many bags of that product came off that
   line for that counting scope. Half-bag top-ups are excluded: they are handled separately
   and never mint a serial (see §6).
3. **Traceable through every hop.** Every work centre can scan, type, or search for a bag
   and consume it, and the consumed serial stays attached to what was made from it.
4. **Matched to the production order.** Orders are raised against what the work centre
   *outputs*, so the serial's product code and the order's Acumatica item must come from one
   map, never two.

#### The format

```
{WC}{TYPE}-{DDMMYYYY}-{QUALIFIER}-{NNN}
 │    │         │           │        └── sequence within the counting scope
 │    │         │           └── lot (Granule) or blend + number (Blender); absent elsewhere
 │    │         └── the PRODUCTION RUN date, never the device clock
 │    └── output/product type, 2–4 letters
 └── work centre, always exactly 2 characters
```

**Parse it anchored from both ends, never by splitting on `-`.** Work centre is the first two
characters; type is the letters up to the first hyphen; the sequence is the trailing digits;
everything in between is the qualifier and *may itself contain hyphens* — Granule lots like
`RSGG-05626` do. A `split('-')` here silently mis-reads every Granule serial.

The type code is 2–4 characters, not two. `CHSF` and `EXP` do not fit in two, and forcing
them to would collide `EXP` with something else later. Length is not what makes it
unambiguous; the fixed 2-character work centre and the anchored parse are.

| Section | Format | Example |
|---|---|---|
| Sieving | `ST{TT}-{DDMMYYYY}-{NNN}` | `STRB-01092026-001` |
| Refining 1 | `R1{TT}-{DDMMYYYY}-{NNN}` | `R1WD-01092026-001` |
| Refining 2 | `R2{TTTT}-{DDMMYYYY}-{NNN}` | `R2CHSF-01092026-001` |
| Granule | `GL{TT}-{LOT}-{DDMMYYYY}-{NNN}` | `GLSG-RSGG-05626-01092026-001` |
| Blender | `BL-{BLEND}-{DDMMYYYY}-{n}-{NNN}` | `BL-SFCKUN25-01092026-1-001` |
| Small Blender | `SB-{BLEND}-{DDMMYYYY}-{n}-{NNN}` | `SB-SFCKUN25-01092026-1-001` |

Type codes — Sieving `FL CL RB BD PD IS HS BE`; Refining 1 `ID WD PD`; Refining 2 `CHSF CHSC
WD PD HS`; Granule `SG SF EXP` for granules plus `SGD SFD BD WD ID LD AD DE` for the dusts the
line also bags.

Two of those are not in the original product list and were added because the lines bag them:
Sieving's **`BE`** (bucket-elevator spillage) and Granule's **dust codes**. The Granule dust
codes are `SGD`/`SFD`, not `SG`/`SF`, because dust and granules of the same lot must not share
a counter or an indistinguishable serial — and the matcher must test dust BEFORE granules,
since "SG Dust" contains the token that identifies SG granules.

A product that reaches a capture screen without a mapping — routine, since the picker searches
the Acumatica master inventory — still bags. `typeCodeFor()` returns null for callers that need
certainty; `resolveTypeCode()` derives a code from the product name and reports
`configured: false`, and the capture screen says so, because a guessed code is
indistinguishable from a real one once it is printed on a bag.

**Blender carries no type code.** It is identified by blend type and blend number, because
that is what the Pasteuriser consumes and what the order is raised against — a product-type
code there would be a second name for the same thing.

**No serial contains a `/`.** An earlier draft of this section wrote the Blender's run
separator as `{DDMMYYYY}/{n}`. That was wrong: a serial is used as a URL path segment at
`/api/production/live/bag/[serial]` and in the Bag Tracking deep links, and a slash splits
the route param. The Blender's previous format had already chosen `-` for this reason and
said so in a comment. A test asserts no builder emits a slash.

**The Small Blender is its own work centre (`SB`), not an alias of the Blender.** It shares
`SectionKind 'blender'` because the capture shape is the same, but it is a different
physical line — one counter for both would interleave two lines' bags in one sequence.

**Granule puts the lot before the date, and it is the only section that does.** Everywhere
else the date is the counting scope, so it sits immediately after the type and
`{WC}{TYPE}-{DDMMYYYY}-` prefix-scans one product on one run day. On the Granule Line the
**lot** is the counting scope: the same lot routinely runs across several days and must read
as one continuous sequence, so the stem is `GL{TT}-{LOT}-` and the count continues past
midnight and past the end of the run. Do not "harmonise" this with the others — it is the
same class of deliberate per-section difference as the five mass-balance formulas (§4).

#### The production run day

The date stem is the **production run** date: one run is 07h00 → 01h00, spanning the morning
(07h00–16h00) and afternoon (16h00–01h00) shifts. `productionDayFor()` maps 00h00–06h59 back
to the previous day, so a bag tagged at 00h30 keeps the run's date and the sequence does not
restart mid-run. Always pass the **session** date into a serial, never `new Date()`.

A session stays open until **01h30** for the supervisor's final adjustments. That is a safety
margin on top of the 01h00 run end, not a change to the run window — the run day boundary
stays 07h00–01h00 and nothing about the date stem moves. Adjustments after that point are
not lost, they go through the tiered adjustment path in §6 instead.

Date and time formatting is **core**, alongside the rest of the app's shared functionality:
one `DDMMYYYY` builder for serials, SAST for display, UTC `timestamptz` in storage (§9). Four
copies of a date format is how two screens end up disagreeing about which day a bag belongs
to.

#### Allocation, and why deleting a bag is still allowed

The sequence comes from the database. That is not negotiable — app-side `max + 1` is the
documented cause of 44% of Fine/Coarse Leaf bags lost from `prod_bagging` and 7 of 24 Sieving
bags missing from `bag_tags` (§1B). Sequencing **per product type** rather than per section
makes this worse, not better: it turns one counter per line into six or eight, so there are
more independent races, each one thinner.

**Operators must still be able to add and delete bags as freely as the screen allows today.**
A database sequence must not become a one-way ratchet that makes a mis-typed bag
unrecoverable — the operator deletes it and adds the right one, exactly as now.

The consequence, stated plainly so nobody treats it as a bug: **a deleted bag leaves a gap.**
Numbers are not re-packed, because re-packing would renumber bags that are already printed,
already scanned into the next section, and already on a production order. So the trailing
number is the *allocation order*, and after a deletion the highest number can exceed the bag
count. Where a true count is needed, count `bag_tags` rows — that is the ledger, and it is
what reporting already reads (§6). The serial answers "which bag", the ledger answers "how
many".

#### Product naming across the three layers

A product has up to three names and they are not interchangeable:

| Layer | Sieving example | Where it lives |
|---|---|---|
| Floor / display | Heavy Sticks | capture screens, labels, reports |
| Serial code | `HS` | `lib/core/serials.ts` |
| Acumatica item | `15IGST-C` · "Sticks - Conventional" | `lib/production/acumatica-codes.ts` |

**Heavy Sticks, Rolsiev Sticks, `RS` and Sticks are all the same material** — on Refining 2 as
well as Sieving. The platform says Heavy Sticks; the Acumatica import must still send
`15IGST` / "Sticks". Renaming the display without following it through
`acumatica-codes.ts` — which matches on the exact string `'Rolsiev Sticks'` — makes every one
of those bags lose its Acumatica code *silently*, with no error, just a blank field.

Existing rows carry `product_type = 'Rolsiev Sticks'` and serials carry `STRS-`. Accept both
on input, write the new form going forward, and **do not rewrite history** — a serial already
printed on a bag in the warehouse is the bag's identity.

#### Input paths are the same everywhere

Every section accepts a bag three ways — **scan, type manually, or search the inventory** —
and that does not vary by section. A section that offers only two of the three sends the
operator looking for a supervisor. The one exception is Sieving's *input* side, which debags
farm bags at the head of the line and has no upstream serial to scan.

Two consequences that have already bitten:

- A pick list and a scan of the same bag must agree. The Pasteuriser pick list offered
  cross-variant bags that `validateBagScan` refused as `wrong_variant`; two paths to the same
  bag disagreeing is how a mixed-variant bag gets in.
- A bag not found in `bag_tags` is registered on the row and counts at its typed weight. That
  is legitimate — Refining 2 routinely runs bought-in material. What it needs is a `bag_tags`
  record so the material is traceable from the point it entered, not a different balance.
  Creating those bags properly is Phase 3, built alongside the bag-to-bag transfer component
  (§6); manual entry is the interim.

The Pasteuriser is deliberately **out of this scheme for now**. Its final product carries its
own serial and label conventions, and it is sequenced last, once the upstream sections are
released.

### Mass balance

Lives in `lib/core/mass-balance/`, one module per section — they stay separate (see §4). The
shared part is the vocabulary in `types.ts` and the single dispatch `productionTotals(kind,
data, ctx)`. **Everything goes through it**: the capture screen, the persisted
`prod_mass_balance` row, and the production-order summaries. Before that they disagreed — the
screen ignored half-bag top-ups entirely while the persisted row counted them, and only for
Sieving; Blender reached the persisted row through `sievingTotals` and was right by accident.

**Total Output means finished product.**

- It **includes** half-bag top-ups made from this shift's own loose production — the
  increment only, never the whole bag, since the bag may have been created on an earlier day.
  Pass only `mode === 'production'` events. A `mode === 'existing'` bag-to-bag transfer moves
  mass already counted when the source bag was bagged; counting it again double-counts.
- It **excludes** material left in the bucket elevator for tomorrow. That is work in progress.
  It is reported as `carryOverOut` and gets its own column in `MassBalanceTable`, so the
  variance stays honest instead of showing a shortfall every afternoon shift.

**Total Input includes carry-over consumed from a previous day**, matched on **variant
family** — conventional and organic are separate physical pools and never mix. Read it from
`production.bucket_elevator_log` via `outstandingBucketElevator()`; the figure typed on the
capture screen is only the fallback.

So `balance = totalIn − totalOut − carryOverOut`. That is arithmetically identical to the
older `totalIn − (product + leftover)` — what changed is that the leftover is no longer
disguised as output.

Top-ups are session-scoped, so they are applied **once** after summing, via
`withSessionAdjustments()`. Never inside a section's own totals, or a path can count them
twice. It also knows which way each section's balance sign runs — Blender and Pasteuriser
read `out − in`, so more output moves their balance *up*, the opposite of the other three.

**The tolerance is ±1% of Total Input, on every section.** `massBalanceToleranceKg(totalIn)`
in `tolerance.ts` is the only source; there is no per-section variant. It replaced a flat
`MASS_BALANCE_TOLERANCE_KG = 15` with a 100 kg special case for `refining2` — 15 kg is ~7% of
a 200 kg trial and ~0.4% of a 4 t shift, so one never flagged and the other always did, and
the `refining2` exception existed only because that line runs bigger volumes, which is what a
percentage handles without an exception. It is a percentage of **input**, not output, so a
shift that under-produces cannot widen its own goalposts.

`production.v_session_yield` derives the same figure in SQL rather than reading
`prod_mass_balance.tolerance_kg` — every row written before this carries the old 15, and
trusting the stored value would leave two tolerance regimes side by side on one screen.

### The four other sections, in their own words

Each section's Total Output and Total Input are specified separately. They are *not* variants
of one rule; the shared part is only the ±1%.

- **Refining 1 / 2** — Output includes the half-bag top-up increment and bags created here for
  material arriving from outside the line. An input bag whose serial is not in `bag_tags` is
  registered on the row and counts at its typed weight like any other; what it needs is a
  `bag_tags` record, not a different formula.
- **Granule Line** — Output **excludes** leftover dust that tomorrow will consume, per product
  type: a PO run under SG Granules leaves SG dust, one under SF Granules leaves SF dust, and
  the two are different physical pools. Input **includes** the previous day's leftover in its
  designated product-type column, same variant only. The ledger is
  `production.dust_carryover_log`, keyed on `(section_id, item_key, variant_family)` — never
  aggregated across any of the three.
- **Blender** — Output includes top-up increments per product type, **and allows a new
  half-bag to be generated by drawing from an existing bag**. That new bag is captured as
  output like any other, but its mass was already counted when the source bag was bagged, so
  it is subtracted via `BalanceContext.transferInKg`. Only transfers whose *target* is one of
  this session's own output bags qualify. Left in, the shift and its production order both
  report the same material twice — this is the case flagged as drastically affecting POs.
  The Blend Ratio breakdown (`byItem`) is untouched and stays.
- **Pasteuriser** — Output counts every pallet-line kind: Final Product, High Moisture and
  Refill. `pasteuriserTotals` sums the lines *without* filtering on `kind`, which is what
  makes all three count — adding a filter there would silently drop rework and refills. Input
  counts blend bags and High Moisture rework (stream `main`), plus bags from other lines
  (stream `postsieve`, the Granule Line), plus leftover part-bags at their actual weight. The
  system pick list is variant-family filtered, because a scan already refuses a cross-family
  bag (`validateBagScan` → `wrong_variant`) and the two paths must not disagree.

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

The two ratchets exist because the repo has ~3000 pre-existing lint errors and 34 type
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

Date and time formatting is **core**, not a per-screen helper — see §5. The formats that
matter are one place each: the `DDMMYYYY` serial stem, SAST for display, UTC in storage.

**A production day is 07h00 → 01h00**, spanning the morning (07h00–16h00) and afternoon
(16h00–01h00) shifts, with the session left open until **01h30** for the supervisor's final
adjustments. That grace window does not move the day boundary: a bag tagged at 01h20 still
belongs to the run that started the previous 07h00. Anything derived from "what day is it" —
serial stems, shift totals, mass balance, roster — goes through `productionDayFor()`, never
`new Date()`. Using the live clock rolls the date over mid-shift and restarts a sequence
inside one continuous run.
