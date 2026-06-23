# Production Capture — Onboarding / Handoff

State of the digital production-capture system (replacing paper floor forms). Staging is live and tested; Sieving Tower is the proven end-to-end slice. This doc lets a fresh session continue without re-discovery.

## Goal
Phase 1: operators capture on tablets exactly as on paper, but smarter — headers autofill from the supervisor's roster, totals auto-calc, typos caught, and **each output bag generates a barcode** (manual serial now; scanning is Phase 2). Phase 2: flip a section's mode to barcode scanning — same data model, so it's a config change not a rewrite.

## What's built & live (staging)
- **Operator login** — floor operators sign in at `/floor` with name + 4‑digit PIN (no Microsoft email). Backed by a hidden Supabase auth user (synthetic email; PIN-derived password) + a `shared.app_roles` row (Production / `floor_operator`). Provisioned via `app/api/production/operators` (service role). They're sandboxed to `/production/capture`.
- **Operators admin** — `/production/operators` (supervisor/IT): add/edit/deactivate operators, PIN, allowed sections.
- **Production roles** (`shared.app_roles`, Production dept): `production_supervisor` (factory floor — capture/sign-off + Supervisor Hub, NO stock count), `warehouse_supervisor` + `stock_controller` (the two independent stock counters — land on `/count`), `operator`/`section_operator`, `floor_operator` (PIN). Legacy `supervisor` = alias for production_supervisor. Stock Count's own DB role values stay `'supervisor'`/`'admin'` but are LABELLED **Warehouse Supervisor** / **Stock** in the UI (`countRoleLabel`).
- **Supervisor roster** — `/production/capture/assign`: roster operators per section/shift/date, set variant + **destination** + **production orders** (selected from the phantom/PO‑target items in the master inventory, by variant). Save is disabled until an operator is selected.
- **Capture landing** — `/production/capture`: operator dashboard (greeting, today's assigned sections, status); supervisors also get an "Operators" + "Assign sections" button and a **"Needs your sign‑off" approvals queue**.
- **Section capture** — `/production/capture/[section]` (Sieving built; others show "coming soon"): autofilled header, **mass-balance meter**, one **variant · destination · lot** row, Debagging / Bagging / Cleaning / Sign‑off tabs.
  - Outputs picked from the **master inventory** filtered by variant + destination (exact Acumatica codes/names). **Leaf = operator batch number (with type‑ahead chips); sticks/dust/etc. = barcode-only** (no batch). Each output upserts `bag_tags`, writes a `bagging_out` `scan_events` row, and prints a label.
  - **Reliable save**: persists ~2.5s after each change, on visibilitychange/pagehide, + 20s backstop; session row created on open. Survives the 60‑min inactivity sign-out (restores from `prod_sessions.draft_data`).
  - **Multiple batch records per shift**: after Approve & lock, "Create new batch record" starts a fresh session (loads latest).
  - Sign-off split: **operator signs + submits**; **supervisor approves & locks from the queue** (signatures → `session_signatures`).
- **Cleaning** — exception-based (assume done, flag what wasn't + reason), PIN re-auth sign, append-only `cleaning_logs` audit trail.
- **Bag Tracking** — `/tags`: reads the live `bag_tags` schema, brand-styled, **interactive KPI tiles** (filter), **section filter pills**, row detail = barcode + genealogy chain + scan-event timeline.
- **Live KPIs** — Production Control (`/production/operations`) "Live Capture" tab: per-section status/kg/variance/bags from the structured tables, rows click into capture.

## Key files
- `app/(app)/production/capture/[section]/page.tsx` — capture orchestrator (session lifecycle, persist, sign-off, builders)
- `components/production/capture/` — `SievingCapture`, `OutputPicker`, `CleaningPanel`, `BatchInput`, `SignaturePad`, `PinGate`
- `lib/production/capture-config.ts` — section meta, variant options, `PRODUCTION_ORDER_PREFIXES`, `SECTION_OUTPUT_GROUPS`, `leafFamily`, serial gen
- `lib/production/inventory.ts` — master-inventory helpers: `loadAllInventory`, `sectionOutputItems`, `productionOrderItems`, `recentBatches`, `suggestOutputs`, `nextStepNudge`
- `lib/production/cleaning-config.ts`, `components/production/LiveCaptureKPIs.tsx`, `app/(app)/tags/page.tsx`, `app/floor/page.tsx`, `app/(app)/production/operators/page.tsx`, `app/(app)/production/capture/assign/page.tsx`

## Data model (Supabase `production` schema) — migrations in `supabase/migrations/`
Run order on a clean DB: `001` capture tables · `002` shift_assignments · `004` operators · `005` grants · `006` cleaning · `007` inventory (630 Acumatica items). (003 superseded by 004.)
- `prod_sessions` (one per section/shift, can be multiple after locking; `draft_data` jsonb = `{productions:[{variant,grade,lot,data}]}`)
- `prod_debagging` / `prod_bagging` (structured rows; variant per row) · `prod_mass_balance` (`balance_kg` is GENERATED) · `bag_tags` (PK = serial_number) · `scan_events` (append-only) · `session_signatures` · `shift_assignments` · `operators` (user_id/auth_email link) · `cleaning_stations`/`cleaning_records`/`cleaning_logs` (logs immutable) · `inventory_items` (master)
- Variants stored as full Acumatica words: `Conventional`, `Organic`, `RA-Conventional`, `RA-Organic`, `FT-ORG`.

## Outstanding (next sessions)
1. ~~**Timesheets** — auto-derive from capture activity~~ ✅ **DONE** (2026-06-13). `capture_activity` heartbeat (throttled 1/60s on real edits, written from the autosave debounce in `capture/[section]/page.tsx`) → `lib/production/timesheet.ts` `deriveTimesheet` (first action = start; 5–30 min gap = tea; >30 min = lunch; last = end) → `TimesheetConfirm` card in the Sign-off tab (light-edit + confirm; Submit gated on confirm + signature). Confirmed result stored in `prod_timesheets`. Migration `20260613_001_timesheets.sql` applied to staging. **Next:** a supervisor/reporting view of confirmed timesheets (data exists now); heartbeat-only, so pre-2026-06-13 sessions have none.
2. **Other 5 sections** — Refining 1/2, Granule, Blender, Pasteuriser. Each is a sibling of `SievingCapture` + entries in `SECTION_OUTPUT_GROUPS` / `PRODUCTION_ORDER_PREFIXES`. Set `built:true` in `sectionMeta` (`capture-config`) when ready. Refining outputs have B/C/D groups; Granule PO is on final granule items; Pasteuriser has temp logs (15-min) + process timesheet + re-bagging.
5. **Supervisor Hub** (`/supervisor`, gated Production/Management/IT) — Phase 1 DONE (2026-06-14): Overview (today snapshot + tech-on-duty), Timesheets dashboard (hours from `prod_timesheets`, ranges, by-operator/flat, CSV), Productions overview (`prod_sessions` + handover notes, CSV). Foundation: nav group + route guard, `HubTabs`, `lib/utils/csv-export.ts`, `lib/production/shifts.ts`. Phase 2 DONE (2026-06-14): **Shift Calendar** (`/supervisor/calendar`) — week (sections × 7 days, shift chips + operator initials, tech-on-duty in day headers) and day (sections × 3 shifts, full names) views from `shift_assignments` + `operators` + maintenance `duty_roster`; cells deep-link to the assign editor (which now reads `?date`/`?shift`). Phase 3 DONE (2026-06-14): **Messages** (`/supervisor/messages`) — per-line channels (All lines + per section) on new `production.line_messages` (migration `20260614_001`, text-only, soft-delete); two-pane chat, 15s polling, localStorage unread dots; `lib/production/messages.ts`. Supervisor-side only so far. Phase 3b + 4a DONE (2026-06-14): capture screen gained a **Messages** tab (operator reads/posts to their line's channel via shared `LineChat`), a **handover note** field at sign-off (→ `prod_sessions.comments`), and a **previous-shift handover banner** at the top of capture. Phase 4b DONE (2026-06-14): **Analytics** (`/supervisor/analytics`) — recharts trends (hours/day, kg/day, hours by operator, kg by section) + summary tiles over a date range. Hub roadmap complete: Overview · Timesheets · Productions · Calendar · Messages · Analytics. **Optional future:** wire line messages into `NotificationBell`; deep-link tag lookup (would need `/tags` to read a `?serial` query param).
3. **Floor-plan highlight** (`WarehouseMap`) — highlight sections by today's session status (left for Alyssa's alternative plans; confirm before building).
4. **Bag Tracking side-by-side layout** — approved mockup has list + persistent detail panel; currently a modal (content matches). Cosmetic, do with the user watching.

## Deploy (staging) — IMPORTANT
VPS `cntpdev@154.65.97.200:2022`, app `/home/cntpdev/apps/staging/app/cntp-ops`, pm2 `cntp-staging`, token on VPS at `~/.claude_github_token`. Branch from `staging`, squash-merge PR to `staging`, then deploy.
- **Serialize builds** to avoid a `.next` race that errors pm2: `pkill -f "[n]ext build"`, ONE detached build (`nohup npm run build &`), wait until the build process is gone AND `.next/BUILD_ID` exists, *then* `pm2 restart cntp-staging`. If it lands errored with `.next` intact, a plain restart recovers.
- Build detached (SSH drops kill foreground builds). Use `pgrep -f "[n]ext build"` (bracket trick) to avoid self-match. `next.config` has `ignoreBuildErrors:true`.
- After squash-merge, branch FRESH from `origin/staging` and cherry-pick (continuing a merged branch causes PR conflicts).
- Worth doing: a zero-downtime deploy (build to temp, swap, restart) to end the brief mid-build flicker.

## Conventions
- Match the app's clean/restrained UI standard; brand green `#1A3A0E`; section colours from `SECTION_CONFIG`. KPIs/tables should be interactive.
- Update `CHANGELOG.md` every change (date · developer Alyssa · files · what/why).
