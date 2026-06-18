# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

---

## 2026-06-18 — Alyssa (smart checks engine: machine verification, AI, quality + maintenance links)

**Files changed:**
- `supabase/migrations/20260618_002_checks_engine.sql` (new)
- `lib/production/checks-config.ts` (new)
- `lib/production/check-specs.ts` (new)
- `lib/production/checks-db.ts` (new)
- `components/production/capture/ChecksPanel.tsx` (new)
- `components/production/capture/ChecksStatusStrip.tsx` (new)
- `app/api/production/read-value/route.ts` (new)
- `app/api/production/check-summary/route.ts` (new)
- `app/(app)/production/capture/[section]/page.tsx`

**Changes:**
- New **Checks** tab on the capture screen — a config-driven machine-verification engine (sieving authored first as the template; other sections inherit by config). Phases: Start-up / Running / Shut-down. Confirm-style checks are exception-based (assumed OK, flag only what isn't); identity + timestamps recorded automatically.
- **Smart "due now" strip** on the Production tab pulls the operator to the right check at the right time (start-up pending, hourly VSD reading due, shut-down near shift end) and deep-links into the Checks tab. Afternoon-only checks (rotex clean, shut-down mass balance) auto show/hide for the Afternoon/Night block.
- **Photo-read readings (Gemini vision):** `read-value` endpoint extracts a number from a photo of the VSD/scale/gauge so operators don't mistype; keypad entry remains. Out-of-range values soft-flag against the spec.
- **One source of truth for ranges:** machine params (VSD 10–20, scale tolerance, screen speed/angle) from new `production.check_specs`; QC sieve targets pulled live from `qms.customer_specs` as guidance on the sieving-configuration check.
- **Failure → maintenance:** a failed/out-of-tolerance check offers one-tap "Raise to maintenance" (operator picks breakdown vs planned) via `POST /api/maintenance/job-cards`; the job links back into the check event for traceability.
- **Auto mass balance:** closing mass balance is snapshotted automatically at each grade/variant change-over and at shut-down — no typing.
- **PIN sign-off + AI summary:** operator signs the checks (mirrors cleaning); a concise Gemini shift-audit summary is generated and stored on the record for supervisor review. Everything writes to the append-only `production.check_events` audit trail.
- **Grade help:** info popover next to the destination dropdown — A = Export, B = Export Blend, C = Domestic/Local.

---

## 2026-06-18 — Alyssa (operators admin: search, filters, cleaner section labels)

**Files changed:**
- `app/(app)/production/operators/page.tsx`

**Changes:**
- After importing the full 77-name roster the operators list was an unsearchable wall of ~85 rows. Added a **search box** (name / display name / operator code), an **Active only** toggle (on by default, so deactivated test rows hide), and a matched/total count. Operators rostered to every section now show **"All sections"** instead of six section codes, removing the per-row chip noise.

---

## 2026-06-18 — Alyssa (production capture: kiosk, bulk-bag, secure, roster dropdown)

**Files changed:**
- `public/manifest.json`
- `components/production/capture/SievingCapture.tsx`
- `components/production/capture/OutputPicker.tsx`
- `components/production/capture/OperatorPicker.tsx` (new)
- `app/(app)/production/capture/[section]/page.tsx`
- `app/(app)/production/capture/assign/page.tsx`
- `supabase/migrations/20260618_001_operators_seed_employees.sql` (new)

**Changes:**
- **PWA / kiosk:** manifest now installs the app fullscreen (`display: fullscreen`, landscape) starting at `/production/capture`, with the CNTP logo as the app icon — so an Android kiosk launcher (e.g. Fully Kiosk Browser) or Screen Pinning can lock the tablet to the app. (Tablet lock itself is an OS-level setting, documented separately.)
- **Bulk bag:** renamed "Farm bag" → "Bulk bag" in the Sieving capture UI; removed the Gross (kg) and Delivery date fields (and the now-unused nett-vs-gross overfill check). Remaining fields: Bag no., Lot/serial (with suggestions), Nett (kg), Local/export. Stored `product_type` value `'500kg Farm Bag'` is unchanged for data/Acumatica consistency.
- **Batch consistency:** removed the duplicate top-of-form "Lot / batch" input on the capture screen. The batch is now captured per bulk bag (type-or-pick suggestion box); the output picker pre-suggests the most recent bulk-bag lot.
- **Secure a bag:** each bulk bag and each output bag can be "Secured" — it collapses to a read-only summary with a lock badge; "Edit"/"Unlock" reopens it. Persisted with the draft so it survives reload. Layered under the existing whole-session sign-off lock.
- **Bagging picker:** the default list now shows only the curated sieving families — Fine Leaf, Coarse Leaf, RB Blocks, Rolsiev Sticks, Indent Sticks, Brown Dust, Powder Dust — sourced from the canonical `getAcumaticaCode` map (via `suggestOutputs`), conventional-first for the run's variant/destination. Previously it pulled every item in the Leaf/Dust/Sticks product groups (white/SG/SF/indent dust, etc.), which was overwhelming. Full master search stays available as the secondary path. Picking an item prefills the standard full-bag weight — Fine/Coarse Leaf 300 kg, Indent Sticks 252 kg (editable for end-of-shift half bags). Acumatica codes (`…-C`) are unchanged.
- **Supervisor roster:** the assign screen now uses a searchable name dropdown (new `OperatorPicker`) listing all active operators, instead of section-filtered chips. Migration imports the full 77-name employee roster into `production.operators` and makes `pin` nullable (PINs assigned later in the operators admin; sign-on still requires a PIN).

---

## 2026-06-18 — Gustav (sieving: runs table sorted newest-first)

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- Runs table now displays in reverse chronological order (newest entry at the top) across all product tabs (Fine Leaf, Coarse Leaf, Indent Stick, Block). Previously the order was inconsistent due to merging QMS and legacy data sources.

---

## 2026-06-18 — Gustav (sieving: remove serial number format validation)

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- Removed the `GS-####` / `VS-####` / `MAT-####` / `Lab samples` format check from the serial number field across all product tabs. Serial numbers vary per run type; only blank-check remains for in-process runs.

---

## 2026-06-18 — Gustav (sieving: fix Coarse Leaf serial number validation)

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- Coarse Leaf serial numbers use a date-based format (e.g. `18.06.01`), not the raw-material lot format (`GS-####` etc.). The format validation now only applies to non-Coarse-Leaf tabs, so QC can save Coarse Leaf runs without a false error on the serial number field.

---

## 2026-06-18 — Gustav (pasteuriser: per-sample QC Controller name)

**Files changed:**
- `app/(app)/quality/pasteuriser/page.tsx`

**Changes:**
- QC Controller name is now required per individual sample (was only at the batch level). `AddSampleModal` includes a required "QC Controller" input field, and saving is blocked if it is empty.
- `BatchSample` interface extended with `qc_name: string`.
- Samples table gains a new **QC** column between Bin/Bag and Temp°C so each row shows which controller recorded that specific sample.

---

## 2026-06-18 — Gustav (sieving tower: batch format, leaf shade pull-through, required fields, collapsible table)

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- Serial number validation: in-process runs now enforce format `GS-####`, `VS-####`, `MAT-####`, or `Lab samples`. Error shown on save if format doesn't match.
- Leaf shade auto-fill: page loads from `qms.leaf_shade_predictions` keyed by lot number — uses `actual_leaf_shade` if set, falls back to `leaf_shade` prediction. Auto-fills when lot number is entered.
- Bulk density is now **required** for all run types. Red border + error message shown if missing.
- Leaf shade is now **required** for all run types on Coarse Leaf / Fine Leaf (not just Final QC).
- Runs table below the chart has a **collapse/expand toggle** showing the record count.

---

## 2026-06-18 — Gustav (maintenance: voice-note → smart job card via Gemini, no audio stored)

**Files changed:**
- app/api/maintenance/transcribe/route.ts (new)
- components/maintenance/VoiceCapture.tsx (new)
- components/maintenance/RaiseJobCardForm.tsx
- components/maintenance/JobCardItem.tsx

**Changes:**
- New **voice-note** button on the Raise Job Card form and on the technician's Root Cause field. Record up to 30s; Gemini transcribes + refines it and fills the structured fields. **The audio is never stored** — sent for transcription in-memory and discarded; only the refined text is saved
- Raise form: voice note fills short description, detailed description and suggests maintenance type(s)
- Technician: voice note fills the Root Cause (and appends Work Done if mentioned)
- New `/api/maintenance/transcribe` route (Gemini 2.5 Flash → flash-lite fallback); SA English with Afrikaans/isiXhosa handled, written back in English; caps ~30s / 4MB
- **Smart job card validation:** raising now requires area, machine/equipment, a description, and (for planned) at least one maintenance type

---

## 2026-06-18 — Gustav (maintenance: raiser linked to signed-in user + close button)

**Files changed:**
- components/maintenance/RaiseJobCardForm.tsx

**Changes:**
- "Raised By" is now taken from the **signed-in account** — when the account has a real name it's shown read-only ("your account") and nothing is typed, keeping the data clean (the card is already linked to the user id server-side)
- Accounts with **only an email (no name)** get an editable field that is **mandatory and must be a name + surname** (validated on submit) so every card traces to a real person
- Added an **X close button** to the Raise Job Card screen header

---

## 2026-06-18 — Gustav (granule + pasteuriser: cross-workcenter open-batch banners + button UX)

**Files changed:**
- `app/(app)/quality/granule/page.tsx`
- `app/(app)/quality/pasteuriser/page.tsx`

**Changes:**
- Granule dashboard: moved "+ New Run" button to the **left** of the active runs header (was on the right).
- Added hover tooltip to **+ Sample** button: "Add when a new sample is taken during the current run".
- Added hover tooltip to **+ New Run** button: "Start when a new batch has been completed or begun".
- Granule page: on load, queries `qms.quality_records` (workcenter=pasteuriser) for open batches (no `final_result` in `data_json`). If any are found, shows an amber warning banner linking to the Pasteuriser dashboard.
- Pasteuriser RunDashboard: on load, queries `qms.granule_runs` for runs where `final_status IS NULL`. If any are found, shows an amber warning banner linking to the Granule Line dashboard.

---

## 2026-06-17 — Alyssa (permissions: master matrix view + standardized read/write/delete registry)

Standardize the permission model into a clean Module → Function → Read/Write/Delete taxonomy and surface a single master view of every function. UI + API enforcement (RLS deny-by-default is a future phase). Existing keys are kept and mapped — no rename, no data migration.

**Files changed:**
- `lib/auth/permission-registry.ts` — NEW canonical `PERMISSION_MATRIX`: every module's functions mapped to `read / write / delete` (+ a `manage` list for workflow/special actions like finalise, approve, allocate, verify, export — so nothing is lost). Reads that are implied by department show as "by dept".
- `lib/auth/permissions.ts` — added the previously-undocumented `can_access_intelligence` key (already used by `app/api/sales/*`, `app/api/signals/*`, Sidebar) to the type + `ALL_PERMISSION_KEYS`. Existing keys untouched.
- `app/(app)/users/page.tsx` — new **Master matrix** view in the Permissions tab (default): every module/function as Read · Write · Delete columns + an expandable Manage list, each cell a toggle bound to its key, reusing the existing role-default/override resolution and save flow (sparse overrides → `app_roles.permissions`, no schema change). A **Detailed list** toggle keeps the previous grouped editor.

**Note:** enforcement remains UI + API layer (route guards + `getCallerPermissions().can()`), now consistently defined via the registry. Database-level RLS enforcement (activate the JWT-claims hook + deny-by-default policies) is a deliberate future phase.

---

## 2026-06-17 — Alyssa (access: co_developer is a near-full developer role again)

Gustav (co_developer / IT) could see module links but routes blocked him after the recent "IT is not a blanket key" change. Restore co_developer as a developer role that reaches every module — while still excluded from destructive/admin actions.

**Files changed:**
- `app/(app)/layout.tsx` — `co_developer` (like `senior_developer`) now **bypasses the department check** in route guards, but remains subject to the per-route **permission** check, so `/users` and other admin/destructive routes stay blocked (co_developer lacks `can_manage_users` / `can_run_migrations` / `can_manage_integrations`).
- `components/layout/Sidebar.tsx` — same: `co_developer` sees every department's nav, minus items requiring permissions it doesn't hold.

Net: Gustav can now open Quality (and all other modules) — links no longer dead-end — without granting destructive/admin powers. `senior_developer` remains the only true full-bypass admin.

---

## 2026-06-17 — Alyssa (maintenance: grant access to users outside the Maintenance department)

Maintenance access was department-only, so there was no way to give a non-Maintenance user (e.g. an IT/co-developer) access. Added a `can_access_maintenance` permission that works as an *alternative* to department membership.

**Files changed:**
- `lib/auth/permissions.ts` — new `can_access_maintenance` permission key (in the Maintenance permission group).
- `app/(app)/layout.tsx` — route guards: added an `orPermission` flag (permission acts as department **OR**, not an extra requirement) and applied it to the `/maintenance` guards. In-department users are unaffected; anyone with `can_access_maintenance` granted gets in regardless of department.
- `components/layout/Sidebar.tsx` — same `orPermission` semantics so the Maintenance nav shows for cross-department grantees too.
- `app/(app)/users/page.tsx` — added "Access Maintenance module" to the **Cross-department view access** toggles; fixed the "Primary modules" summary (Maintenance was missing from IT/Management lists and the Maintenance department itself showed "select a department").

So to grant an outsider: edit the user → Permissions → **Cross-department view access** → enable **Access Maintenance module**. Action permissions (allocate/verify/QC) still gate what they can *do*.

---

## 2026-06-17 — Alyssa (maintenance: reorder / request-inventory flow)

Raise a reorder when a part is low/out of stock (or a tech needs one), track it to received, and add received qty back into the register. Booking/deduct (`logSpare`) unchanged.

**Files changed:**
- `supabase/migrations/20260617_010_spare_requests.sql` — NEW `maintenance.spare_requests` (part_id/part_no, qty, reason, card_id, status open→ordered→received/cancelled, requester). **Run in Supabase before requests persist.**
- `app/api/maintenance/spare-requests/route.ts` — NEW. POST creates a request and notifies maintenance managers (in-app + email, best-effort).
- `lib/maintenance/types.ts` — `SpareRequest`.
- `lib/maintenance/useMaintenanceData.ts` — defensive `requests` load (own effect, won't break the module pre-migration); `createRequest`, `setRequestStatus` (received → `qty_new += qty`), `cancelRequest`.
- `app/(app)/maintenance/stock/page.tsx` — "Open requests" stat; "Reorder Requests" section (manager actions: ordered / received / cancel; read-only otherwise); per-part "Reorder" inline form (auto low/out reason); "Request a part" free-text.
- `components/maintenance/JobCardItem.tsx` — "Request part" button on the in-progress spares panel (reason `job_card`).

**Deploy note:** run `20260617_010_spare_requests.sql` in Supabase (staging). Built defensively — the module works before it's applied; requests just won't persist until then.

---

## 2026-06-17 — Alyssa (maintenance: tighten access control)

The maintenance module was visible/accessible too broadly — the sidebar group had no gating (shown to every department) and the route guard let all of Production into the whole module.

**Files changed:**
- `components/layout/Sidebar.tsx` — gated the Maintenance nav items: Dashboard / Scheduled / Planner / Stock → `Maintenance, Management`; Job Cards → those + `Production` (so Production can report breakdowns + track their own cards). No longer shown to Sales / Quality / Marketing. (Per app convention, IT is not a blanket key — `senior_developer` still bypasses.)
- `app/(app)/layout.tsx` — split the `/maintenance` route guard: `/maintenance/job-cards` → `Maintenance, Management, Production`; `/maintenance` (dashboard, scheduled, planner, stock) → `Maintenance, Management` only (longest-prefix matcher). Production can no longer reach the dashboard/planner/stock directly.

---

## 2026-06-13 — Gustav (maintenance: auto-pause a job when a breakdown pulls the technician away)

**Files changed:**
- app/api/maintenance/job-cards/route.ts
- components/maintenance/{JobCardItem,Timer}.tsx
- lib/maintenance/{types,useMaintenanceData}.ts
- Supabase staging migration: maintenance_jobcard_pause

**Changes:**
- When a **breakdown is auto-assigned to a technician who is already mid-job**, that in-progress job's timer now **pauses automatically** (frozen) so the breakdown takes priority. Logged as "Timer paused — pulled to breakdown JC-xxx"
- The paused card shows a **"Continue previous job"** button — disabled while the technician still has the breakdown in progress, enabled once it's finalised — which **resumes the timer** from where it stopped
- New `job_cards` columns `paused`, `paused_at`, `pause_ms`, `paused_reason`. `pause_ms` banks the paused duration so the recorded worked time stays accurate (the timer and the completion "Duration" both subtract paused time)
- Timer component shows a greyed "Paused" state when frozen
- The work-logging panel is hidden while a card is paused, so a tech can't log work against a job they've stepped away from

---

## 2026-06-17 — Alyssa (sales: live EXCO dashboard from Acumatica via Supabase)

The sales dashboard now shows **live actuals from Acumatica `CNTP`**, stored in Supabase (so KPIs are consistent and we keep history) rather than read live on every load. Acumatica → Supabase → dashboard, with live-OData as a fallback.

**Files changed:**
- `lib/acumatica/sales-actuals.ts` — NEW. Aggregates `CNTPSALESREPORT` into KPI/monthly/customers/products/categories (ZAR base currency: revenue=`ARTran_extPrice`, cost=`ARTran_unitCost`×qty, volume=`BaseQty`). Reads from Supabase first; falls back to live OData if empty/error. Filterable scope: product / contract / freight / other.
- `lib/acumatica/sales-sync.ts` — NEW. Pulls the full sales report and full-replaces `acumatica.sales_lines` via RPC. Guards against wiping on an empty fetch.
- `app/api/dashboard/sales/route.ts` — NEW. `GET ?year=&include=` — gated to Sales/Management/IT/Marketing; 5-min cache.
- `app/api/acumatica/sync-sales/route.ts` — NEW. Triggers the sync (logged-in user **or** `x-sync-secret` header for cron/webhook).
- `supabase/migrations/20260615_004_acumatica_sales_lines.sql` — NEW. Typed `acumatica.sales_lines` table + `acumatica_replace_sales_lines` / `acumatica_get_sales_lines` SECURITY DEFINER RPCs. **Run in Supabase before deploy.**
- `app/(app)/sales/page.tsx`, `app/(app)/layout.tsx`, `app/(app)/sales/layout.tsx`, `components/dashboard/CommandCentre.tsx` — wired the page to the live API + scope chips; consolidated the duplicate sales header into one with a live "Synced" indicator; removed the hardcoded sales KPIs from the main Command Centre (sales figures now only on the gated /sales page).

**Deploy notes:** run migration `20260615_004` in Supabase, set `ACUMATICA_*` env vars (live tenant = `CNTP`), then trigger `/api/acumatica/sync-sales` once. Webhook + scheduled sync to follow.

---

## 2026-06-17 — Alyssa (dashboards: user-editable department dashboards + Production template)

A reusable engine for **per-user, customizable department dashboards**. Each user arranges their own widgets — drag to reorder, resize (S / M / L / Full), add from a catalogue, remove — and the layout persists per-user. With no saved layout, a code-defined default is shown, so nobody sees a blank page. **Production** is the first dashboard built on the engine; other departments follow by adding a widget set + default layout.

**Files changed:**
- `supabase/migrations/20260617_001_dashboard_layouts.sql` — NEW. `shared.dashboard_layouts` (PK `user_id,dashboard_key`; `widgets` jsonb) with own-row RLS + grants, mirroring `shared.user_preferences`. **Run in Supabase (staging, then prod) before deploy.**
- `lib/dashboard/types.ts` — NEW. Widget span vocabulary (`sm`/`md`/`lg`/`full` → 12-col classes) + `WidgetInstance` / layout row types.
- `lib/dashboard/data.tsx` — NEW. `DashboardDataProvider` — one fetch of the production ops dataset (sc_sessions, prod_sessions, mass balance, bag tags), exposes derived KPIs + section statuses so widgets share data instead of each querying.
- `lib/dashboard/registry.tsx` — NEW. Widget catalogue (label, icon, allowed spans, category, optional permission) + the `production` default layout + permission-filtered picker helper.
- `lib/dashboard/useDashboardLayout.ts` — NEW. Load / save (upsert) / reset (delete → default) a user's layout against `shared.dashboard_layouts`.
- `components/dashboard/editable/widgets.tsx` — NEW. Concrete widgets reading from the provider: KPI tiles (accuracy, sections, yield, tags, tagged weight, sessions, variances), plus reuse of `WarehouseMap`/`UptimeGrid`/`ActivityFeed`/`Notepad`/`MiniCalendar`, and a new Recharts yield-by-section chart.
- `components/dashboard/editable/EditableDashboard.tsx` — NEW. The shell: header (Refresh / Customize / Add / Reset / Cancel / Save), dnd-kit drag-reorder, size toggles, widget picker, loading + empty states.
- `components/dashboard/editable/WidgetFrame.tsx`, `WidgetPicker.tsx` — NEW. Sortable per-widget frame (view = bare; edit = toolbar) and the add-widget panel.
- `app/(app)/production/dashboard/page.tsx` — NEW. Mounts `EditableDashboard` with `dashboardKey="production"`.
- `components/layout/Sidebar.tsx` — added an Operations nav entry "Production Dashboard" (`/production/dashboard`, Production + Management).
- `package.json` — added `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (drag-and-drop). Install with `--legacy-peer-deps`.

**Notes:** Home `CommandCentre` is untouched. Drag/drop uses dnd-kit with preset size toggles (not freeform pixel resize) to match the design language and stay React-19/SSR-safe. Per-widget permission gating is supported in the registry (`requiredPermission`) but mostly unused in v1 — route-level access still applies. Follow-ups: role-managed default layouts, and replicating the engine to Quality / Maintenance / Sales.

---

## 2026-06-15 — Alyssa (access control: IT is no longer a blanket all-access key)

Being in the **IT department** no longer auto-grants access to every department and module. IT users are now gated by the same role/permission rules as everyone else. Two things are deliberately preserved: the **full admin** role (`senior_developer`) still bypasses guards (it's role-based and is the break-glass account), and IT's *own* modules — **AXIS** (`itOnly`) and **`/status`** platform diagnostics, plus the platform-health Connections panel — stay IT-scoped.

**Files changed:**
- `lib/auth/context.tsx` — removed `isIT` from the `canAccessQuality/Production/Sales/Marketing/Management/Maintenance` flags; each module is now gated by its own department or explicit permission (full admin still sees all).
- `app/(app)/layout.tsx` — `ROUTE_GUARDS`: dropped `'IT'` from every cross-department `departments` list. AXIS stays `itOnly`; `/status` stays `['IT']` (IT's own platform-diagnostics module). Updated the header comment.
- `components/layout/Sidebar.tsx` — `NAV`: dropped `'IT'` from every cross-department item so IT no longer sees other departments' modules in the sidebar. AXIS items remain `itOnly`.
- `app/(app)/management/page.tsx`, `app/(app)/production/operations/page.tsx`, `components/layout/page.tsx` — removed the `|| !isIT` blanket escape from the page-level Management guards (now rely on `canAccessManagement`); tidied the unused `isIT` destructure and the "or IT only" copy.
- `components/dashboard/CommandCentre.tsx` — removed blanket `isIT` from the Signals KPI, the floor/production status card, and `canSeeFloor`, so the dashboard only surfaces modules the user can actually reach. The IT/Management Connections (platform-health) panel is unchanged.

**Notes:** Server-side API routes were already permission-based (`caller.can(...)`); only AXIS endpoints check `department === 'IT'`, which is correct for IT's own module — so no server changes were needed. IT users who genuinely need cross-department access should be granted the relevant permission override or role, same as any other user.

---

## 2026-06-13 — Gustav (maintenance: roster from both shift pairs + on-duty quick-pick allocation)

**Files changed:**
- lib/maintenance/useMaintenanceData.ts
- components/maintenance/JobCardItem.tsx
- Supabase staging migration: reseed duty_roster from boiler shift pairs

**Changes:**
- The duty roster now seeds from **both shift columns** of the boiler-start sheet, not just the single boiler-starter: Morning Shift = 07:00–16:00, Afternoon Shift = 16:00–01:00, each with its **two** technicians. The 4 technicians run in fixed pairs (Shane+Yamkela, John+Mohapi) alternating morning/afternoon weekly, so a breakdown routes to whichever pair is on duty at that time
- **Easier allocation:** the allocate panel now shows "On duty now:" quick-pick chips for the technician(s) currently on shift — one tap selects them, then Forward. The full technician dropdown and external option remain
- New `dutyNow` selector returns everyone on duty right now (a shift has two)

---

## 2026-06-13 — Gustav (maintenance: IT full view, machine catalogue, roster from boiler schedule, QC→Quality notify)

**Files changed:**
- lib/maintenance/{roles,types,useMaintenanceData}.ts
- components/maintenance/RaiseJobCardForm.tsx
- app/(app)/maintenance/job-cards/page.tsx
- app/api/maintenance/job-cards/[id]/to-qc/route.ts (new)
- lib/notifications/recipients.ts
- Supabase staging migration: maintenance_machines_and_roster_seed

**Changes:**
- **IT / full-admin full view:** the Job Cards board now shows a "View as" switcher (Maintenance Manager / Technician / QC / Raiser) for IT and full admins, so IT sees every profile. Other users keep their single derived role; access still refined per-user in the permissions UI
- **Machine catalogue:** new `maintenance.machines` table seeded with ~60 machines from the spreadsheet's Job Card "Equipment" column. The raise form's Machine field is now a dropdown (datalist) that also lets you **type a new machine** — it's saved to the catalogue on submit and appears next time
- **Consistent name entry:** "Your Name / Reported By" on the raise form is now a datalist of staff + roster names so names are entered consistently (breakdown included), while still allowing free text
- **Duty roster seeded from the boiler-start schedule:** the 4 technicians (Shane, Mohapi, Yamkela, John) now populate the duty roster on their weekly rotation from the boiler-start log — this drives breakdown auto-assign. (Names will bind to real logins once Gustav creates the technician users and allocates roles.)
- **QC → Quality hand-off:** when a completed card needs QC, a notification now fires to the station QC (area→QC map) or all Quality users via the new `to-qc` route, so the Quality dashboard can surface the pending check (Gustav is adding that feature on the Quality side)

---

## 2026-06-15 — Alyssa (acumatica: read-only OData integration + incremental sync)

Live read-only link to Acumatica via its OData Generic Inquiry API, plus a high-water-mark incremental sync that lands GI data into a dedicated `acumatica` schema in Supabase. Reads from Acumatica only — there is no write path back to Acumatica.

**Files changed:**
- `lib/acumatica/odata.ts` — NEW. Server-side OData client. Hits the per-tenant GI endpoint (`/t/{tenant}/api/odata/gi/{inquiry}`) with HTTP Basic auth (the plain Acumatica **Login**, not the email), whitelists read-only `$`-options (`$top`/`$filter`/`$select`/`$orderby`/`$skip`), 30s timeout, normalises `{value:[]}` / bare-array responses.
- `app/api/acumatica/odata/route.ts` — NEW. `GET /api/acumatica/odata?inquiry=…` — gated behind app login; proxies one read so credentials never reach the browser.
- `lib/acumatica/sync.ts` — NEW. Incremental sync: read watermark → fetch only rows changed since (`$filter LastModifiedOn gt …`, oldest-first) → upsert → advance watermark. DB access goes through the public RPCs below.
- `app/api/acumatica/sync/route.ts` — NEW. `GET /api/acumatica/sync?inquiry=…` triggers one sync run (spike uses GET for ease; production should be POST + a scheduler).
- `supabase/migrations/20260615_001_acumatica_sync.sql` — NEW. Dedicated `acumatica` schema; `sync_rows` (JSONB landing, PK `inquiry,row_key`) + `sync_state` (watermark) + grants/RLS.
- `supabase/migrations/20260615_002_acumatica_sync_rpc.sql` — NEW. `public.acumatica_get_watermark` / `public.acumatica_apply_sync` `SECURITY DEFINER` functions, so writes don't depend on the Data API exposing the `acumatica` schema. Execute locked to `authenticated`/`service_role`.
- `supabase/migrations/20260615_003_set_timezone_sast.sql` — NEW. Sets the database default timezone to `Africa/Johannesburg` (SAST), so all timestamps render UTC+2.

**Deploy notes:** run migrations `001`, `002`, `003` in the Supabase SQL editor (staging, then prod) before deploy. Requires `ACUMATICA_BASE_URL`, `ACUMATICA_COMPANY`, `ACUMATICA_ODATA_USER`, `ACUMATICA_ODATA_PASSWORD` set in the target environment (a read-only Acumatica Login). First sync of `SM-ExportScenarios` brought in 32 rows. Next steps: schedule via n8n, and swap the personal Acumatica login for the dedicated read-only `CNTPreadonly` user.

---

## 2026-06-15 — Alyssa (maintenance: barcode scanner + Gemini-vision part lookup)

Book spares on a job card by scanning, with an AI photo-identify fallback. Booking still deducts from the register via the existing `logSpare` (unchanged).

**Files changed:**
- `supabase/migrations/20260615_050_spare_part_barcode.sql` — NEW. Adds `maintenance.spare_parts.barcode` + partial index. **Run in Supabase before deploy.**
- `components/maintenance/PartScanner.tsx` — NEW. A picker modal with four ways to find a part: handheld/USB scan (autofocused field, code+Enter), camera scan (browser `BarcodeDetector`, gracefully hidden where unsupported), **Identify by photo** (snap → Gemini matches against the register; photo not stored), and manual search.
- `app/api/maintenance/identify-part/route.ts` — NEW. Sends the image + parts register to `gemini-2.5-flash` (reuses `GEMINI_API_KEY`); returns top matches with confidence. Degrades gracefully if the key is unset.
- `lib/maintenance/types.ts` — `barcode` on `SparePart`.
- `lib/maintenance/useMaintenanceData.ts` — `addPart` accepts `barcode`; new `findPartByBarcode` action (barcode → part_no, trimmed/case-insensitive).
- `app/(app)/maintenance/stock/page.tsx` — editable Barcode column + add-row field; search includes barcode; "Scan to find" toolbar button.
- `components/maintenance/JobCardItem.tsx` — "Scan / identify" button on the in-progress spares panel opens the scanner; picking a part pre-selects it for the existing "+ Log" booking (deduct unchanged).

**Deploy notes:** run `20260615_050_spare_part_barcode.sql` in Supabase (staging) before deploy. Camera scan uses the browser `BarcodeDetector` (Chromium/Android); handheld scan, photo-identify and manual search work everywhere. Photo-identify reuses the existing paid Gemini key — no new config.

---

## 2026-06-15 — Alyssa (maintenance: compact, scannable job-card board)

- `components/maintenance/JobCardItem.tsx` — board cards now render **compact** by default: a scannable summary (priority/type/status badges, card no, area·machine, raised-by, one-line title) + a one-line hint (assignee · age · update count) and a single **next-action button** (Allocate / Accept / Log work / QC check / Verify) that expands the working panel on demand — instead of every card showing its full form inline. Priority shown as a filled colour badge (High=red, Medium=amber, Low=grey) with a faint red tint on high-priority/breakdown cards so they stand out.
- `app/(app)/maintenance/job-cards/[cardId]/page.tsx` — detail view passes `compact={false}` so the full panel stays open there. Workflow logic unchanged.

---

## 2026-06-14 — Alyssa (settings: complete redesign — sidebar layout + new sections)

**Files changed:**
- app/(app)/settings/page.tsx — full redesign
- app/api/me/activity/route.ts — new self-scoped activity endpoint
- lib/notifications/index.ts — honour per-user channel opt-outs
- supabase/migrations/20260614_005_user_preferences_notifications.sql — new

**Changes:**
- **Redesigned the Settings page** from a single scroll into a left-sidebar shell with eight sections: Profile, Appearance, Language, Notifications, My Access, Activity, Security, About. Sidebar collapses to a horizontal pill row on mobile. Profile now also shows account-created date and the section badge.
- **New "My Access" section** — shows the user their department, role, granted-permission count, the modules they can open (linked), and a grouped read-only list of every permission currently granted to them (derived from the existing `p()` resolver — no new data). Full admins see an "all access" note.
- **New "Notifications" section** — toggles for the Email and Urgent WhatsApp/SMS channels. These are **real**: `notify()` now reads each recipient's `shared.user_preferences.notifications` (service_role, RLS-bypassed) and skips email/urgent for users who opted out. In-app feed is always delivered.
- **New "Activity" section** — lists the caller's own last 30 audit-log events via the new `/api/me/activity` route. The route forces `actor_id = caller`, so a user can only ever see their own activity (no permission gate needed; distinct from the admin-only `/api/admin/audit`).
- **Migration** — adds `notifications jsonb` to `shared.user_preferences`, (re)asserts the table + own-row RLS policies, and grants `service_role` SELECT so the notify pipeline can read recipient prefs. Idempotent. **Must be run in the Supabase SQL editor (staging, then prod) before the notification toggles take effect.**

---

## 2026-06-14 — Alyssa (maintenance: Planner colours — distinct hues)

- `app/(app)/maintenance/planner/page.tsx` — reworked the technician palette to maximally-distinct hues (violet · blue · emerald · amber · rose · cyan · orange · fuchsia) assigned **by position in the staff list** (not name-hash, which collided on similar pinks) with saturated borders/dots, so each technician is clearly distinguishable. Follow-up to the colour-identity change below.

---

## 2026-06-14 — Alyssa (maintenance: Planner colour identities + depth)

- `app/(app)/maintenance/planner/page.tsx` — each technician now has a stable **pastel identity colour** (by name hash) applied to their planner slots, duty windows, roster rows and the "next" strip, with a colour **legend** under the calendar; plus depth (soft shadows, on-duty glow, "today" tag). Purely visual — no logic change.

---

## 2026-06-14 — Alyssa (monthly count: section-id mapping fix + seed correction)

**Files changed:**
- components/count/monthly/MonthlyReconciliation.tsx — production↔count section-id map
- supabase/seeds/demo_monthly_count.sql — use valid production section ids

**Changes:**
- Fixed a latent mismatch: the production module uses section ids `sieving`/`refining1`/… while the count module uses `sieve`/`ref1`/…. Reconciliation joined produced (`prod_sessions`) and consumed (`bag_tags.consumed_at_section`) to count sections by raw id, so they'd never match. Added a `PROD_TO_COUNT` map (lenient — unknown ids pass through) applied to both, so Produced/Consumed now line up with the count's sections — for the demo and for real data
- Seed corrected: the demo production session + bag tags now use the valid production section id `sieving` (the earlier `sieve` violated `prod_sessions_section_id_check`)

---

## 2026-06-14 — Alyssa (monthly count: fix reconciliation/ledger queries + extend demo)

**Files changed:**
- components/count/monthly/MonthlyReconciliation.tsx — produced + bag-tag query fixes
- components/count/monthly/MonthlyBatchLedger.tsx — bag-tag query fix
- supabase/seeds/demo_monthly_count.sql — March bag tags + production session

**Changes:**
- **Two query bugs fixed** that meant the Reconciliation "Produced/Consumed" and Batch Ledger bag-tag columns could never populate:
  - Bag-tag queries filtered on `bag_tags.captured_at`, which doesn't exist — corrected to `created_at` (3 places: Batch Ledger, Reconciliation consumed, variance drill-down)
  - "Produced" read `prod_sessions.notes` (no such column) for a `total_kg` — rewritten to sum real output from `prod_mass_balance` (B+C+D) for the month's submitted/approved sessions
- **Demo seed extended** so those columns light up: a March Sieving production session (500 kg via `prod_mass_balance`) and seven March `bag_tags` against the monthly-count batches — giving the Batch Ledger a Reconciled (R2603-EF), a Variance (R2603-DB) and Unlinked rows, and Reconciliation real Produced (500 kg) + Consumed (330 kg) figures for Sieving. All demo rows are clearly marked (`DEMO-MC-*` serials, `DEMO-MONTHLY-SEED` session) and included in the seed's DELETE block
- Re-run `supabase/seeds/demo_monthly_count.sql` (after the table migration) to load the extended demo

**Files changed:**
- supabase/migrations/20260614_004_monthly_count_tables.sql (new)
- supabase/seeds/demo_monthly_count.sql — note migration prerequisite

**Changes:**
- **Root cause found:** the Monthly Count UI queries `production.mc_sessions` / `mc_entries` / `mc_reviews`, but those tables were never created — so the whole monthly feature (Comparison · Reconciliation · Batch Ledger · Variances) has been silently non-functional in production, not just the demo. (`relation "production.mc_entries" does not exist`.)
- New migration creates the three tables in the `production` schema to match exactly what the app reads/writes (mirrors the daily `sc_*` tables): `mc_sessions` (per month/warehouse/product, two counters → match rate, sign-off), `mc_entries` (per item/batch/role), `mc_reviews` (variance review notes) — with indexes, the shared `updated_at` trigger, RLS, and grants
- **Run order:** migration `20260614_004` first, then the demo seed `supabase/seeds/demo_monthly_count.sql`. This both fixes the live feature and lets the demo load

**Files changed:**
- supabase/seeds/demo_monthly_count.sql (new) — demo monthly count data
- components/count/monthly/MonthlyComparison.tsx — segmented filter + export button polish

**Changes:**
- Added a **demo monthly count seed** (Rooibos · BHW) so the Monthly Count sub-tabs (Comparison · Reconciliation · Batch Ledger · Variances) can be seen populated: Feb 2026 (opening stock) + March 2026 (both counts submitted, with a realistic mix of matches and variances incl. one >10% review). Run `supabase/seeds/demo_monthly_count.sql` in the SQL editor, then open Monthly Count → March 2026 → Rooibos. Idempotent and fully deletable (DELETE block included)
- The monthly sub-tab components were already on the app's clean standard (KPI tiles, surface tokens, tidy tables, status chips); only a small consistency tweak applied — MonthlyComparison's filter is now the segmented-pill style and Export CSV a bordered button to match the rest
- IT already sees all monthly sub-tabs without waiting for both counts, so the seed is what makes them visible

**Files changed:**
- app/(app)/count/page.tsx — role mapping, page header + KPI tiles, relabelled count-side control
- lib/store/countStore.ts — countRoleLabel/countRoleShort helpers
- lib/auth/departments.ts — add stock_controller role + landing
- lib/auth/permissions.ts — stock_controller defaults; production_supervisor no longer counts
- components/count/CountCompareView.tsx, RecountTab.tsx, monthly/* — relabel counter sides

**Changes:**
- **Counter roles fixed.** The two stock counters are now correctly the **Warehouse Supervisor** and **Stock** (the old "Admin" label was a misnomer). Factory staff no longer count — `production_supervisor` lost `can_submit_count`. New **`stock_controller`** role added (Production dept) for the Stock-side counter; `warehouse_supervisor` is the Warehouse-side counter. The count's underlying DB values stay `'supervisor'`/`'admin'` (no data migration) — only labels, the app-role→side mapping, and who-can-count changed
- IT/management keep an oversight toggle to count as either side; the two counter roles are pinned to their side
- **Interim landing**: `warehouse_supervisor` and `stock_controller` land on `/count`; `production_supervisor` still lands on `/supervisor`
- **Daily count redesign** to the app's clean standard: proper page header, a KPI tile row (items counted · total kg · % complete · counting-as), and the count-side picker as a tidy segmented control. Recount, comparison and monthly views relabelled to Warehouse/Stock
- No DB migration. New role surfaces in Users & Roles automatically

**Files changed:**
- lib/auth/departments.ts — Production roles + getDefaultRoute/isProductionSupervisor
- lib/auth/context.tsx — isSupervisor recognises production_supervisor
- app/(app)/count/page.tsx — map app role → count-domain role
- app/(app)/production/section/page.tsx — sign-off gate accepts production_supervisor
- supabase/migrations/20260614_002_supervisor_role_rename.sql (new)

**Changes:**
- The single Production **'supervisor'** role is split into **'production_supervisor'** (factory floor — lands in the Supervisor Hub, keeps count/capture sign-off powers) and a new **'warehouse_supervisor'** (assigned from Users & Roles; does NOT auto-land in the hub, though it can still open it). The hub and everything built for it is for factory/production supervisors
- `isSupervisor` (count + capture sign-off) now means production supervisor specifically; warehouse supervisors are excluded. `'supervisor'` is accepted everywhere as a **legacy alias** for `'production_supervisor'`, so the change is non-breaking before/after the data migration
- The count module's own `'supervisor'`/`'admin'` domain value (sup_*/adm_* counts) is untouched — a production supervisor is mapped to the count 'supervisor' role at the boundary
- `permissions.ts` already defined both roles, so no permission defaults change
- **Requires migration** `20260614_002_supervisor_role_rename.sql` (renames existing `shared.app_roles` 'supervisor' → 'production_supervisor'). After it, reassign any warehouse staff to 'warehouse_supervisor'
- Note: OAuth (Microsoft) first logins still pass through `/auth/callback` → `/dashboard`; the role-aware landing applies on the login page and root redirect

**Files changed:**
- components/layout/Sidebar.tsx — collapse 6 Supervisor nav items into one
- lib/auth/departments.ts — getDefaultRoute now role-aware
- app/login/page.tsx, app/page.tsx — pass role to getDefaultRoute

**Changes:**
- **Sidebar declutter**: the six-item "Supervisor" nav group is replaced by a single **Supervisor Hub** entry inside the Operations group, right under Capture (it's a factory-supervisor area). Module navigation (Timesheets, Productions, Calendar, Messages, Analytics) already lives in the in-page hub tabs, so nothing is lost — the sidebar is just much leaner, especially for IT who sees every group
- **Supervisor landing**: `getDefaultRoute()` is now role-aware — a Production user with the **supervisor** role lands on `/supervisor` on login (instead of the generic `/production`). Applied in the login redirect and the root `/` redirect. Other roles/departments unchanged
- The single hub entry highlights across all `/supervisor/*` routes (existing active-state rule)

**Files changed:**
- app/(app)/supervisor/analytics/page.tsx (new) — trend charts (recharts)
- components/supervisor/HubTabs.tsx — Analytics tab
- components/layout/Sidebar.tsx — Analytics nav item
- app/(app)/layout.tsx — /supervisor/analytics page title

**Changes:**
- New **Analytics** (`/supervisor/analytics`): trend view over a date range (7/14/30-day presets + custom) built with recharts
- Summary tiles (total hours, kg out, productions, operators, balance flags) + four charts: hours worked per day, kg bagged out per day, hours by operator (top 8), and kg out by section (section-coloured) — from `prod_timesheets` + `prod_sessions` + `prod_mass_balance`
- Completes the supervisor hub roadmap (Overview · Timesheets · Productions · Calendar · Messages · Analytics). Tag lookup stays the Bag Tracking quick-link; wiring line messages into the global NotificationBell remains optional future polish

**Files changed:**
- components/production/capture/LineChat.tsx (new) — single-channel chat component
- app/(app)/production/capture/[section]/page.tsx — Messages tab, handover note at sign-off, previous-shift handover banner

**Changes:**
- **Operators can now message back** (closes the Phase 3 loop): a new **Messages** tab on the capture screen shows that line's channel (same `production.line_messages` backend as the supervisor hub) so the operator can read supervisor messages and post to their line. Reuses the new `LineChat` component
- **Handover note at sign-off**: operators can leave a note for the next shift in the Sign-off tab — saved to `prod_sessions.comments` on submit (already surfaced in the supervisor Productions overview)
- **Previous-shift handover banner**: the most recent handover note left on this line shows as an amber banner at the top of capture, so the incoming operator sees what the last shift flagged
- No new migration (uses Phase 3's `line_messages` + the existing `prod_sessions.comments`); messages still need migration `20260614_001` applied to persist. Defensive — chat degrades to empty if the table isn't present

**Files changed:**
- supabase/migrations/20260614_001_line_messages.sql (new) — line_messages table
- lib/production/messages.ts (new) — load/send/delete + localStorage last-seen
- app/(app)/supervisor/messages/page.tsx (new) — channels + thread + composer
- components/supervisor/HubTabs.tsx — promote Messages tab (no more "soon")
- components/layout/Sidebar.tsx — add Messages nav item
- app/(app)/layout.tsx — /supervisor/messages page title
- lib/supabase/database.types.ts — line_messages types

**Changes:**
- New **Messages** (`/supervisor/messages`): per-line communication for the hub. Channels = an "All lines" general channel + one per production section; two-pane layout (channel list with last-message preview + unread dots · thread with WhatsApp-style bubbles · composer)
- New **`production.line_messages`** table (text-only v1; soft-delete via `deleted_at` for audit). Author = current user (name + role chip)
- Polling refresh every 15s (no realtime-publication dependency); unread tracked per-channel via `localStorage` last-seen (no read-receipt schema); authors can delete their own messages
- Defensive: if the table isn't present yet (migration pending) the page degrades to an empty state — never breaks the hub
- **Requires migration** `20260614_001_line_messages.sql` (Supabase SQL editor, staging) before messages persist
- Scope note: supervisor-hub side first; an operator-side entry point (from the floor capture view) is the next increment so operators can post back

**Files changed:**
- app/(app)/supervisor/calendar/page.tsx (new) — master shift calendar
- components/supervisor/HubTabs.tsx — promote Calendar tab to active
- components/layout/Sidebar.tsx — add Shift Calendar nav item
- app/(app)/layout.tsx — /supervisor/calendar page title
- app/(app)/production/capture/assign/page.tsx — accept ?date/?shift query params (Suspense wrapper) so calendar cells deep-link to the right roster

**Changes:**
- New **Shift Calendar** (`/supervisor/calendar`): master view of who's rostered, built from `shift_assignments` + `operators` (no calendar library — date-fns grid)
- **Week view**: sections (rows) × 7 days (columns); each cell shows the shifts rostered (colour-coded morning/afternoon/night dots) with operator initials; day headers show the **maintenance technician on duty** (from `maintenance.duty_roster`, overlap-per-day); today is highlighted; empty cells offer a quick "+" to roster
- **Day view**: sections × the 3 shifts with full operator names + variant/lot, and a technician-on-duty banner
- Every cell deep-links into the existing roster editor (`/production/capture/assign?date=&shift=`) — which now reads those query params to pre-select
- Read-only calendar (rostering still happens in the assign editor); Messages remains the next hub tab

**Files changed:**
- app/(app)/supervisor/page.tsx (new) — hub Overview (today snapshot)
- app/(app)/supervisor/timesheets/page.tsx (new) — operator hours dashboard
- app/(app)/supervisor/productions/page.tsx (new) — productions overview
- components/supervisor/HubTabs.tsx (new) — hub sub-nav
- lib/utils/csv-export.ts (new) — client-side CSV download helper
- lib/production/shifts.ts (new) — shift hour constants + currentShift()
- components/layout/Sidebar.tsx — new "Supervisor" nav group
- app/(app)/layout.tsx — /supervisor route guard + page titles

**Changes:**
- New `/supervisor` hub section (gated to Production / Management / IT) — Phase 1 of a phased supervisor platform. No DB migration: reads existing tables
- **Overview** (`/supervisor`): today-at-a-glance KPI tiles — shifts rostered, operators on shift, hours logged, productions, open breakdowns, and technician on duty (reuses `resolveOnDutyTechnician` from maintenance) — plus quick links into each module
- **Timesheets** (`/supervisor/timesheets`): operator hours from `prod_timesheets` over a date range (Today / This week presets + custom), section/operator/shift filters, interactive KPI tiles, two views (By operator with per-operator totals, and All shifts), expandable break detail, CSV export (gated on `can_export_csv`), rows deep-link into capture
- **Productions** (`/supervisor/productions`): filterable table from `prod_sessions` + `prod_mass_balance` — operator(s), section, shift, variant/lot, kg in/out, status, and expandable handover notes (`comments`); CSV export
- Extracted shift-time logic into `lib/production/shifts.ts`; added a reusable `downloadCsv` helper
- Roadmap (next phases): master shift calendar (shifts + maintenance tech-on-duty), supervisor↔operator messaging/notes, handover-note capture at sign-off + trend analytics

---

## 2026-06-13 — Alyssa (production: timesheet auto-derive from capture activity)

**Files changed:**
- supabase/migrations/20260613_001_timesheets.sql (new)
- lib/production/timesheet.ts (new)
- components/production/capture/TimesheetConfirm.tsx (new)
- app/(app)/production/capture/[section]/page.tsx
- lib/supabase/database.types.ts

**Changes:**
- Operators no longer log shift times on paper — timesheets are now auto-derived from production-capture activity. Rule: first action = shift start; a 5–30 min gap = tea break; a >30 min gap = lunch; last action = shift end
- New append-only **`capture_activity`** heartbeat: the capture page writes a timestamp (throttled to once/60s, tagged with session + operator) on real edits via the existing 2.5s autosave debounce. There was no per-operator timestamp stream before this (scan_events omits operator/session; structured rows are rewritten each autosave), so the heartbeat is required for derivation
- New **`prod_timesheets`** table stores the confirmed result (start/end, breaks jsonb, worked minutes, raw derived snapshot for audit), keyed on session + operator
- `lib/production/timesheet.ts` — pure `deriveTimesheet()` (gap heuristic) plus `loadActivity` / `loadTimesheet` / `saveTimesheet` helpers
- New **TimesheetConfirm** card in the Sign-off tab: shows the auto-derived shift start/end and gap-based tea/lunch breaks, allows light edits (nudge times, add/remove breaks), and the operator confirms — the **Submit** button is now gated on both a confirmed timesheet and the operator signature
- Heartbeat-only (no retroactive backfill); supervisor reporting view is a follow-up

---

## 2026-06-12 — Gustav (maintenance: single breakdown/planned selection)

**Files changed:**
- components/maintenance/RaiseJobCardForm.tsx

**Changes:**
- Removed the duplicate breakdown-vs-planned toggle inside the Raise Job Card form — the choice is made first via the **Report Breakdown** / **New Job Card** buttons (and the urgent banner), and the form now shows the chosen mode as a fixed badge instead of a second selector
- Non-Production users who somehow open the breakdown mode still get downgraded to planned with an explanatory note (unchanged server-side gate)

---

## 2026-06-12 — Gustav (quality: harden Microchem PA extraction against garbled PDF text layer)

**Files changed:**
- app/api/upload/route.ts

**Changes:**
- Follow-up to the Microchem COA fix: fresh uploads extracted the totals correctly but missed Sample List, PO and the lab name, because the COA's two-column layout comes out scrambled in the PDF text layer (labels separated/transposed from their values)
- The `pa_ta_analysis` prompt's Microchem section now identifies header fields by **character patterns** rather than adjacent labels only: batch `MAT-####`, lab reference `YYYY-MM-DD-NNN_NN`, sample ID `BF#####`, PO `BH-PO#######`; sample date = the earlier of the two received/validated dates; the four header fields are marked required
- Clarified that the screening list with LOQ values (0.01 etc.) is not a detections table, and pinned `lab` to Microchem for this format
- Data fix (staging): backfilled lab/sample list/PO/sample date on the three records uploaded before this hardening (MAT-0377/0378/0379)

---

## 2026-06-12 — Gustav (quality: PA/TA extraction now reads Microchem COAs)

**Files changed:**
- app/api/upload/route.ts

**Changes:**
- The Raw Material PA/TA Gemini prompt (`pa_ta_analysis` in the `PROMPTS` object) only knew the Stellenbosch University CAF multi-batch format — Microchem/AGQ "Certificate Of Analysis" uploads (e.g. MAT-0377/0378/0379) extracted as ND/blank
- Prompt rewritten to detect and handle **both formats**. For Microchem COAs it now maps: Variety → batch number, Our Lab Reference Number → report, Laboratory Sample ID → sample list, PO Number → purchase order, Date Received → sample date, and reads the "Sum of Pyrrolizidine alkaloids CR (EU) 2023/915" row with **mg/kg → µg/kg conversion** (0.019 mg/kg → 19 µg/kg → P1)
- Added a server-side safety net in `computePaGrade`: if the model returns a total flagged as mg/kg it is converted to µg/kg before grading, so P-levels can't be computed off the wrong unit
- Re-upload the three failed MAT PDFs after deploy; delete the bad ND rows first

---

## 2026-06-12 — Gustav (scheduled maintenance dashboard: readings capture, Excel data import, shift summaries)

Ported onto the restructured module (lib/maintenance hook + routed pages).

**Files changed:**
- lib/maintenance/{types,helpers,useMaintenanceData}.ts
- app/(app)/maintenance/scheduled/page.tsx
- app/(app)/maintenance/job-cards/page.tsx
- Supabase staging migration: maintenance_readings_and_calibration (+ full Excel data import)

**Changes:**
- **Excel import (Maintenance_Database.xlsx → staging DB):** 124 IP readings, 122 diesel readings, 846 loadshedding log entries, 33 water meter readings, 241 boiler start log entries, 85 compressor/forklift run-hour readings, 187 calibration/verification assets — all historic values preserved for trends. New tables: `ip_readings`, `diesel_readings`, `loadshedding_log`, `water_readings`, `boiler_start_log`, `equipment_hours`, `equipment_config`, `calibration_assets`
- **Scheduled Maintenance is now a dashboard** with five segments: Overview, Weekly, Monthly, Annual/Calibration, Readings & Trends
- **Overview / Actions Needed:** calibrations overdue or due ≤30 days (one-tap "done today"), run-hour services due for the compressor + 9 forklifts (serviced-today + raise-job-card buttons), and all checklists outstanding this week/month with when each was last completed and by whom
- **Checklist audit trail:** every task tick stamps the person + timestamp (shown inline); checklist cards show who completed them and when; all past periods kept in the DB
- **Fault → Job Card:** any checklist task flagged as a fault (or with a note) gets a "→ Job card" button that raises a pre-filled planned card into the normal allocation workflow
- **Readings & Trends:** friendly numeric capture (numeric keypad, previous value alongside, usage auto-calculated like the Excel) for water meters, IP/paraffin, generator diesel (auto fuel estimate at 40.7 L/hr), loadshedding/power outages, compressor + forklift run-hours, boiler starts — each with inline trend charts
- **Excel due-date formulas built in:** service due = `WORKDAY(reading_date, CEILING((interval − hours_since_service) / hours_per_workday))` exactly as the spreadsheet (interval/rate editable per equipment in `equipment_config`, default 350h/16h); calibration next-due = last done + interval days
- **Shift summaries** on the manager board: date + shift picker (Day 07:00–16:00 / Evening 16:00–01:00, defaults to the last ended shift) showing breakdowns raised, cards raised/accepted/finished and checklists worked — computed live from recorded timestamps
- Full calibration register (187 assets) with search, colour-coded days-left and one-tap "done today"

---

## 2026-06-12 — Alyssa (maintenance overhaul · Phase 8: Planner & Roster tab + priority board)

Split the confusing Planner/Roster out of the Job Cards segmented control into its own calendar tab, and structured the board by priority. Core scheduling/workflow logic unchanged.

**Files changed:**
- `app/(app)/maintenance/planner/page.tsx` — NEW "Planner & Roster" route. Proper **week calendar** (7 day-columns, Prev/Today/Next) with planner slots + duty windows as time chips, click-empty-to-add / click-to-remove. A glanceable **"next" strip** (On duty now · Up next on roster · Next scheduled job). **Collapsible** sections: This week, Duty roster (grouped by day, on-duty-now highlight), QC area map. Editing manager-gated; read-only otherwise. Reuses all existing handlers (addSlot/delSlot/addSlotFor/addRoster/delRoster/saveAreaQc).
- `app/(app)/maintenance/job-cards/page.tsx` — removed the Board/Planner/Roster segmented control (planner moved out); the manager board is now grouped into **collapsible High / Medium / Low priority sections** (High/Medium open, Low collapsed), with the status filter narrowing within. Breakdown banner + dual actions intact.
- `lib/maintenance/helpers.ts` — `priorityOf()` (display-only derived priority: breakdown/reopened/aged → High, etc.) + `PRIORITY_META`.
- `components/maintenance/JobCardItem.tsx` — coloured left-accent bar + priority pill so high-priority cards stand out (all views).
- `components/layout/Sidebar.tsx` — "Planner & Roster" nav row (CalendarRange) after Scheduled.
- `app/(app)/layout.tsx` — ROUTE_META for `/maintenance/planner`.

---

## 2026-06-12 — Alyssa (maintenance overhaul · Phase 7: auto AI analyst, prominent breakdown, lighter UI everywhere)

Quality pass on user feedback: AI should analyse on its own, the breakdown action was hard to find, and the UI felt heavy. Logic unchanged; visual/UX rework.

**Files changed:**
- `components/maintenance/AiAnalystPanel.tsx` — the AI analyst now **runs automatically** on load (cached per day in sessionStorage); the "Get analysis" button is gone (a quiet refresh remains).
- `app/(app)/maintenance/job-cards/page.tsx` — a distinct, urgent **Report Breakdown** action + an unmissable banner (Production-gated), separate from **New Job Card**; lighter board (calm section headers + pill filter chips, no boxed status tiles / redundant filter row).
- `components/maintenance/RaiseJobCardForm.tsx` — accepts `initialWorkflow` so the form opens straight into breakdown or planned mode.
- `components/maintenance/JobCardItem.tsx` — reworked to the lighter language: hairline card (no glass / coloured left-border), header + concise meta + collapsible detail and activity log; all workflow action panels restyled to a calm shared container with subtle two-state toggles and one primary button each. Logic untouched.
- `app/(app)/maintenance/scheduled/page.tsx` — redesigned to the lighter language: segmented Weekly/Monthly/Annual, calm checklist rows with larger toggles, hairline annual table; logic untouched.
- `app/(app)/maintenance/job-cards/[cardId]/page.tsx` — clean detail header + back link, lighter spacing, hairline chat container.
- `components/maintenance/MaintenanceDashboard.tsx`, `app/(app)/maintenance/stock/page.tsx` — consistency light-touch: glass `.card` wrappers → hairline surface cards; functionality (charts, drill-downs, AI, interactive grid) untouched.

**Design language:** less boxing (whitespace + light section headers over nested cards), hairline borders, calmer colour (strong red reserved for urgent), clearer type hierarchy, one primary button per context.

---

## 2026-06-12 — Alyssa (maintenance overhaul · Phase 6: dashboard declutter + interactive Stock grid)

UI quality pass — the dashboard was overloaded and Stock was a read-only table. Logic unchanged; layout/UX reworked to the app standard.

**Files changed:**
- `app/(app)/maintenance/page.tsx` — decluttered: removed the duplicate basic-KPI tiles and mini-stat strip; now a clean header + three module quick-links + the focused analytics (KPIs/charts live in the dashboard component).
- `components/maintenance/MaintenanceDashboard.tsx` — one curated KPI row (open cards, MTTR, reactive %, top downtime asset, chronic assets, weekly compliance) + charts organised behind a **segmented control** (Reliability / People / Spares & compliance) so only two show at once; drill-downs and the AI analyst retained. Removed the previous wall of six charts + gauges.
- `app/(app)/maintenance/stock/page.tsx` — rebuilt as an **interactive grid**: inline-editable part #, type, description; +/- quantity steppers (new/used); add-part row; search; low/out-of-stock row highlighting; summary tiles. Offsite equipment is now add-able + "mark returned". Usage log stays read-only.
- `lib/maintenance/useMaintenanceData.ts` — added spare-parts CRUD (`addPart`, `updatePart`, `adjustPartQty`, `deletePart`) and offsite CRUD (`addOffsite`, `updateOffsite`, `returnOffsite`).

---

## 2026-06-12 — Alyssa (maintenance overhaul · Phase 5: UI ↔ server wiring + interactive grids)

Connected the Phase 2 UI to the Phase 3 server routes so gating, roster routing, notifications and chat photos fire end-to-end, surfaced the real staff directory, and made the roster/planner/QC grids interactive.

**Files changed:**
- `lib/maintenance/useMaintenanceData.ts` — added `staff` (fetched from `/api/maintenance/staff`, TECHS fallback); repointed `createJC`→`POST /api/maintenance/job-cards` (Production-only breakdown gate + roster auto-route + notifications now fire; 403 surfaced), `allocate`→`POST …/[id]/assign` (carries `assigned_user_id`+name, pre-fills on-duty suggestion), `verifyCard`→`POST …/[id]/verify` (bounce-back notification fires); `addRoster`/`addSlot` persist `technician_user_id`, `saveAreaQc` persists `qc_user_id`; `addSlotFor` for click-to-add planner cells.
- `lib/maintenance/types.ts` — `Staff` type; `technician_user_id` on `Roster`/`Slot`, `qc_user_id` on `AreaQc`, `size`/`mime` on chat attachments.
- `components/maintenance/RaiseJobCardForm.tsx` — breakdown toggle gated on `isProduction || can_raise_breakdown` (UX layer over the API gate).
- `components/maintenance/JobCardItem.tsx` — allocation picker uses real staff (name + user id) + on-duty pre-fill.
- `components/maintenance/JobCardChat.tsx` — wired to the real chat backend: send/upload via the card-messages routes, photo thumbnails + upload spinner + tap-to-enlarge lightbox, @mentions resolve to real staff user-ids.
- `app/(app)/maintenance/job-cards/[cardId]/page.tsx` — loads/sends chat via the card-messages API + photo upload; passes the staff directory in.
- `app/(app)/maintenance/job-cards/page.tsx` — clickable status filter tiles; **interactive roster** (weekly view, "on duty now" highlight, staff-driven, drives breakdown routing), **click-to-add/remove planner cells**, inline staff-driven **QC area map**.
- `supabase/migrations/20260612_001_maintenance_user_links.sql` — also adds `maintenance.tech_schedule.technician_user_id` (planner slots now reference a real user).

---

## 2026-06-12 — Alyssa (maintenance overhaul · Phase 2: frontend restructure & reskin)

Reskinned the whole maintenance module to the app's design system and split the four in-page tabs into real sidebar routes; the workflow logic was moved verbatim (no behaviour change).

**Files changed:**
- `lib/maintenance/{types,constants,helpers,useMaintenanceData,roles}.ts` — NEW. Extracted the monolith: interfaces + `ChatMessage`; constants with a token-based `STATUS_STYLE` (replaces hex `STATUS_COLOR`); pure helpers (`calClass` replaces hex `calCol`); a `useMaintenanceData()` hook owning the single 11-table load + all ~20 mutations + derived selectors; `deriveMaintRole(useAuth())` (replaces the mock view-switcher).
- `app/(app)/maintenance/layout.tsx` — NEW. `MaintenanceDataProvider` mounts the data hook once so all sub-routes share one load (preserves cross-tab optimistic updates).
- `app/(app)/maintenance/{page,job-cards/page,job-cards/[cardId]/page,scheduled/page,stock/page}.tsx` — NEW. The four tabs split into routes; `page.tsx` is the dashboard landing.
- `components/maintenance/{StatusBadge,Timer,RaiseJobCardForm,JobCardItem,JobCardChat}.tsx` — NEW. Extracted + reskinned `renderCard`/raise-form/badges/timer; `JobCardChat` is a WhatsApp-style fork of `axis/CommentThread` (bubbles, @mention autocomplete against `/api/maintenance/staff`, camera/gallery photo attach).
- `components/layout/Sidebar.tsx` — single Maintenance row → four (Dashboard / Job Cards / Scheduled / Stock & Spares); active-state fixed so `/maintenance` only matches exactly.
- `app/(app)/layout.tsx` — ROUTE_META titles for the three sub-routes.
- IA: the Raise Job Card form moved out of the always-open top into a primary button + `BottomSheet`; board rows link to a `[cardId]` detail route; inline dark theme removed in favour of `.card`/tokens/`INP`/`.data-table`.

---

## 2026-06-12 — Alyssa (maintenance overhaul · Phase 4: analytics dashboard & AI analyst)

A custom maintenance dashboard with the existing KPIs plus smart reliability analytics, recharts visuals, clickable drill-downs, and a Gemini AI analyst.

**Files changed:**
- `components/maintenance/MaintenanceDashboard.tsx` — NEW. Smart KPI strip (MTTR, reactive ratio, top downtime asset, chronic assets, critical spares, weekly compliance) + recharts visuals: MTTR trend, breakdown-vs-planned with % reactive line, downtime-by-machine Pareto, repeat-offender machines, technician workload, status pie, top spares, weekly/monthly compliance gauges. Clickable cards/bars open a drill-down modal listing the underlying job cards. Builds the compact aggregate blob for the AI analyst.
- `components/maintenance/AiAnalystPanel.tsx` — NEW. Posts the aggregates to the analyst API, renders summary/highlights/recommendations/watchlist, caches the daily insight in `sessionStorage`, and offers a follow-up chat over the data.
- `app/api/maintenance/insights/route.ts` + `ask/route.ts` — NEW. Reuse `queryGeminiDetailed` (no new key) with a CMMS-reliability system prompt; send aggregates only (not raw rows) to keep tokens low.
- `app/(app)/maintenance/page.tsx` — replaced the Phase 4 placeholder with the dashboard + AI panel.

**Deploy note:** reuses the existing `GEMINI_API_KEY`; the panel reports gracefully if it's unset.

---

## 2026-06-12 — Alyssa (maintenance overhaul · Phase 3: assignment, notifications & job-card chat)

Backend for roster-based assignment, multi-channel notifications, the manager bounce-back loop, and the WhatsApp-style in-card chat. (Frontend wiring of these endpoints lands with the Phase 2 UI.)

**Files changed:**
- `supabase/migrations/20260612_002_maintenance_notifications_chat.sql` — NEW. `maintenance.notifications` (per-user feed; in `maintenance` not `shared` so the service-role client can write on behalf of other users, while each user reads only their own via RLS), `maintenance.card_messages` (chat thread, separate from the immutable `job_card_logs`), and a private `maintenance-card-photos` storage bucket.
- `lib/notifications/email.ts` — shared Office365 sender lifted from `notify-new-user` (`sendEmail` + `ctaEmail`), skips when SMTP unset.
- `lib/notifications/urgent.ts` — provider-agnostic WhatsApp/SMS (Meta Cloud API or Twilio); **skips silently** when `WHATSAPP_PROVIDER` unset, so breakdowns ship without the provider decision.
- `lib/notifications/index.ts` — `notify()` orchestrator: fans out to in-app + email + urgent, each best-effort.
- `lib/notifications/recipients.ts` — resolves user ids → name/email/phone (auth.users + app_roles); `getMaintenanceManagerIds()`.
- `lib/maintenance/roster.ts` — `resolveOnDutyTechnician()` for breakdown auto-routing.
- `app/api/maintenance/job-cards/route.ts` — server-side create; **Production-only breakdown gate**, breakdown auto-routes to the on-duty technician (urgent notify) and informs the manager.
- `app/api/maintenance/job-cards/[id]/assign/route.ts` — manager allocation (`can_allocate_jobs`), GET suggests the rostered tech, notifies the assignee.
- `app/api/maintenance/job-cards/[id]/verify/route.ts` — verify; **not-satisfied bounces the card back to the technician** + notifies; satisfied closes the card and auto-deletes its chat photos.
- `app/api/maintenance/job-cards/[id]/archive/route.ts` — optional SharePoint/OneDrive photo archive (manager-gated, uses the caller's Microsoft token, degrades gracefully).
- `app/api/maintenance/card-messages/route.ts` + `upload/route.ts` — chat read (signed photo URLs) / post (fires @mention notifications) / photo upload to the private bucket.
- `components/layout/NotificationBell.tsx` — merges the per-user `maintenance.notifications` feed (urgent flagged red, deep-links to the card, marks read on open).

**Deploy notes:**
- Run `20260612_002_maintenance_notifications_chat.sql` in Supabase (staging first). Confirm the `maintenance-card-photos` bucket exists (create it manually in Storage if the `storage.buckets` insert was blocked) and is **private**.
- Optional env for urgent alerts: `WHATSAPP_PROVIDER` = `meta` (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`) or `twilio` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`). Left unset → urgent channel is skipped; in-app + email still fire.

---

## 2026-06-12 — Alyssa (maintenance overhaul · Phase 1: data & identity foundation)

First of four phases overhauling the maintenance module (reskin + sidebar routes + real users/assignment + notifications + in-card chat + AI analytics dashboard). Phase 1 lays the identity/permission groundwork — no user-facing UI change yet.

**Files changed:**
- `lib/auth/permissions.ts` — added **Maintenance** department, roles (`maintenance_manager`, `maintenance_technician`, `maintenance_qc`, `maintenance_default`), permission keys (`can_raise_breakdown`, `can_raise_planned`, `can_allocate_jobs`, `can_qc_jobs`, `can_verify_jobs`), role defaults, and a Maintenance permission group for the user-admin toggle UI.
- `lib/auth/context.tsx` — added `isMaintenance` and `canAccessMaintenance` (open to Maintenance + Management + Production, since Production raises breakdowns).
- `app/(app)/layout.tsx` — added a `/maintenance` route guard (`IT`, `Maintenance`, `Production`, `Management`); one rule covers all sub-routes via the longest-prefix matcher.
- `supabase/migrations/20260612_001_maintenance_user_links.sql` — NEW. Additive/idempotent: `maintenance.job_cards.assigned_user_id` + `raised_by_user_id`, `maintenance.duty_roster.technician_user_id`, `maintenance.area_qc.qc_user_id`, and `shared.app_roles.phone` (for urgent WhatsApp/SMS).
- `app/api/maintenance/staff/route.ts` — NEW. GET lists Maintenance-dept users (name/email/phone/role) to replace the hardcoded `TECHS` array and drive @mention/assignment; POST onboards a maintenance user (manager-gated via `can_allocate_jobs`), reusing the `admin/users` invite/create flow but hardcoding the Maintenance department.

**Deploy notes:**
- Run `20260612_001_maintenance_user_links.sql` in the Supabase SQL editor (staging first) **before** deploying — the staff route reads the new `phone` column.
- Schema baseline of the 11 existing `maintenance.*` tables was intentionally **not** hand-written (the `card_no` auto-generation trigger and exact defaults can't be reproduced safely without DB access); capture it later via a Supabase `pg_dump` if a reproducible baseline is needed.
- The 5 legacy technician names stay as a frontend fallback; real users populate the new `*_user_id` columns as they are onboarded via **Maintenance → Staff**.

---

## 2026-06-11 — Gustav (maintenance workflow v2: breakdown vs planned split, role views, planner, QC loop)

**Files changed:**
- app/(app)/maintenance/page.tsx
- Supabase staging migration: maintenance_workflow_v2

**Changes:**
- **Raise Job Card moved to the top** of the Job Cards tab, open to everyone; now has a **short description + optional detailed description**
- Job cards split into **two workflows**: 🔴 Breakdown (urgent) and 📋 Scheduled/Planned (multi-select maintenance types, Breakdown removed from the type list)
- **Breakdown flow:** auto-assigns directly to the **technician on duty** from a new duty roster (maintenance manager informed, not the allocator); timer runs from the moment the card is raised; technician still accepts
- **Planned flow:** new cards pop to the top of the manager's board for allocation — manager picks internal technician **or external company**, and toggles whether a **QC check is required** for the job
- **Clarify loop:** if the manager doesn't understand the request, they send the card back to the raiser with a comment; raiser updates the description and resubmits
- **QC checks now YES / NO / N/A**; any YES requires a QC comment and returns the card to the technician (reopen counted, manager informed via log); on the same card log work continues
- "Not satisfactory" verification by the originator also returns the card to the technician instead of closing it
- **Spares / critical equipment used** logged by the technician per job card — linked to and **decrements the Stock & Spares register**; new usage-log table on the Stock tab; tools-used field (required focus for external jobs)
- **Comment box on every card at every stage** + full per-card log (every comment and transition kept in `maintenance.job_card_logs` for analysis)
- **Role views** (to be locked to real users later): Manager (full board + new-card allocation panel + planner + roster), Technician (only their assigned cards), QC (QC queue by station), Raiser (dashboard of own cards: outstanding/needs-input/in-progress/completed + full log, no manager controls)
- **Technician planner calendar** (manager): week grid per technician with estimated time slots linked to job cards
- **Duty roster editor** (manager) driving the breakdown auto-assign, and a **station/area → QC officer map** that routes completed jobs to the right QC
- New tables: `job_card_logs`, `job_card_spares`, `duty_roster`, `area_qc`, `tech_schedule`; `job_cards` gained `workflow`, `long_desc`, `qc_required`, `external`, `external_company`, `tools_used`, `reopen_count` and a `clarify` status

---

## 2026-06-11 — Alyssa (session 9)

**Fix missing operators table + remove section PIN + operator dashboard sandbox**

- `supabase/migrations/20260611_004_operators.sql` — NEW. Creates `production.operators` (it never existed on the clean DB — that was the `relation "production.operators" does not exist` error). Includes the auth-link columns + RLS, so it supersedes migration 003 (003 becomes a no-op; run 004).
- `app/(app)/production/capture/[section]/page.tsx` — removed the per-section PIN gate. Operators log in once at `/floor`; the capture screen now resolves the signed-in operator from `operators.user_id` for sign-off attribution. No second PIN.
- `app/(app)/layout.tsx` — floor operators are sandboxed: any route outside `/production/capture` redirects to it. They never reach the general dashboard or settings. Added topbar titles for the capture/operators routes.
- `components/layout/Sidebar.tsx` — floor operators get a custom nav ("My Dashboard" → capture) instead of the full sidebar; no Dashboard/Settings/other modules.
- `app/(app)/production/capture/page.tsx` — now doubles as the operator dashboard: personalized greeting ("Hi {name}") and an at-a-glance overview (my sections / in progress / completed) above the assigned-section cards.

**Deploy note:** Run `20260611_004_operators.sql` in Supabase (staging). Skip 003. Add operators via **Capture → Operators** (provisions their login) — not the old SQL seed.

---

## 2026-06-11 — Alyssa (session 8)

**Operator login (name + PIN, no Microsoft email) + Operators admin**

Floor operators now sign in themselves with their name + 4-digit PIN, backed by a hidden Supabase auth account (synthetic email) so row-level security and route guards work normally. Provisioning uses the same service-role pattern as `app/api/admin/users`. Decision confirmed with developer: per-operator real login (not shared-tablet).

**Files changed:**
- `supabase/migrations/20260611_003_operator_auth.sql` — NEW. Adds `user_id` + `auth_email` to `production.operators` (unique indexes) linking each operator to its hidden auth user.
- `lib/production/operator-auth.ts` — NEW. Synthetic email generator + deterministic `deriveAuthPassword(pin,email)` (satisfies Supabase's ≥6-char rule; effective secret stays the 4-digit PIN) + `FLOOR_OPERATOR_PERMISSIONS`. Shared by server (provisioning) and client (login).
- `app/api/production/operators/route.ts` — NEW. POST creates an operator: auth user (service role) → `production.operators` row → `shared.app_roles` row (Production / floor_operator / capture permissions). PATCH updates incl. PIN→password sync; auto-provisions auth for legacy SQL-seeded operators.
- `app/api/production/operators/[id]/route.ts` — NEW. DELETE removes the operator + app_roles + auth user.
- `app/api/floor/operators/route.ts` — NEW. Public list (id, display name, synthetic email — never PIN) for the unauthenticated floor login.
- `app/floor/page.tsx` — NEW. Floor login: pick name → numeric PIN pad → signs in via `signInWithPassword` with the derived password → redirects to `/production/capture`. Outside the `(app)` auth gate.
- `app/(app)/production/operators/page.tsx` — NEW (built this session). Supervisor/IT admin to add/edit/deactivate/remove operators; now provisions through the API so logins are created.
- `app/login/page.tsx` — added a "Floor operator? Sign in with your PIN" link to `/floor`.
- `lib/supabase/database.types.ts` — added `user_id` / `auth_email` to the operators type.

**Gating:** operator management requires `can_reset_operator_pin` (production supervisors) or `can_manage_users` (IT).

**Deploy note:** Run `20260611_003_operator_auth.sql` in Supabase (staging). `SUPABASE_SERVICE_ROLE_KEY` must be set (already used by the admin users API). SQL-seeded operators won't have logins until re-saved through the Operators screen.

---

## 2026-06-11 — Alyssa (session 7)

**New Phase-1 manual capture system (Sieving Tower vertical slice)**

Built a brand-new manual-capture flow at `/production/capture`, separate from the barcode-scanning `/production/live`. Both share the same DB schema, Acumatica code derivation, and label printer, so flipping a section to scanning later (Phase 2) is a config change, not a rewrite. Architecture confirmed with developer: roster + PIN identity, autofilled headers, barcode generation per output bag, Sieving first as the proven template.

**Files changed:**
- `supabase/migrations/20260611_002_shift_assignments.sql` — NEW. `shift_assignments` table: supervisor rosters operators (operator_ids[]) onto a section/shift/date with pre-set lot/variant/production-orders. One per (date, shift, section); RLS + updated_at trigger.
- `lib/supabase/database.types.ts` — added `shift_assignments` + `operators` table types and `ShiftAssignment`/`Operator` exports.
- `lib/production/capture-config.ts` — NEW. Section mode (manual/scan) registry, variant options (full Acumatica words), variant→short mapping, destination→grade options, serial generation helper, tolerance constant.
- `components/production/capture/SignaturePad.tsx` — NEW. Reusable touch/stylus signature pad → base64 PNG.
- `components/production/capture/PinGate.tsx` — NEW. Roster+PIN identity gate; operator confirms with 4-digit PIN against `production.operators`.
- `components/production/capture/SievingCapture.tsx` — NEW. Sieving debagging (bucket-elevator spillage excluded from balance + farm-bag inputs) and bagging (per output type: weight/batch/destination/QC → generates serial, derives Acumatica code, upserts bag_tags immediately, prints barcode label). Exports `sievingTotals` for mass balance.
- `app/(app)/production/capture/page.tsx` — NEW. Operator landing: shows today's rostered sections for the current shift with assigned operator names + session status; supervisors get an "Assign sections" button.
- `app/(app)/production/capture/assign/page.tsx` — NEW. Supervisor assignment board: pick date/shift, multi-select operators per section (filtered by their section_ids), set lot/variant/POs, save → upserts shift_assignments.
- `app/(app)/production/capture/[section]/page.tsx` — NEW. Capture orchestrator: loads assignment → autofills header, PIN gate, session lifecycle (draft/submit/approve), writes prod_sessions/prod_debagging/prod_bagging/prod_mass_balance, stores operator+supervisor signatures to session_signatures, live mass-balance strip, 30s autosave. Non-built sections show "coming soon".
- `components/layout/Sidebar.tsx` — added "Capture" nav entry above "Live Capture".
- `lib/production/types.ts` — reverted the `RefiningFormState.line` type change (it broke the legacy refining page; that field is an internal form discriminator, not the DB section_id).

**Deploy note:** Run `20260611_002_shift_assignments.sql` in Supabase SQL Editor (staging) before using the new flow.

---

## 2026-06-11 — Alyssa (session 6)

**Files changed:**
- `supabase/migrations/20260611_001_production_capture.sql`
- `lib/supabase/database.types.ts`
- `lib/production/types.ts`
- `app/(app)/production/section/page.tsx`

**Changes:**
- Added `draft_data jsonb NOT NULL DEFAULT '{}'` column to `prod_sessions` in the clean migration — required for tablet draft restore without a JSON blob notes column
- Rewrote `lib/supabase/database.types.ts` — full typed schema for all 7 new production tables (`prod_sessions`, `bag_tags`, `prod_debagging`, `prod_bagging`, `prod_mass_balance`, `session_signatures`, `scan_events`) plus existing stock-count tables
- Fixed `lib/production/types.ts` `PRODUCTION_SECTIONS` IDs from short codes (`sieve`,`ref1`,`ref2`,`gran`,`blend`,`past`) to canonical IDs (`sieving`,`refining1`,`refining2`,`granule`,`blender`,`pasteuriser`) matching the migration's CHECK constraint; also fixed `RefiningFormState.line` type
- Rebuilt `app/(app)/production/section/page.tsx` from scratch — clean orchestration shell around existing form components with proper DB writes:
  - Session lifecycle: load existing draft → resume, or create new on first save
  - `saveDraft`: writes to `prod_sessions`, `prod_debagging`, `prod_bagging`, `prod_mass_balance`, `bag_tags`; no longer sets `balance_kg` (it is a computed column)
  - Mass balance strip: live variance calculation shown in header, warns if outside 15 kg tolerance
  - Signatures: stored to `session_signatures` table with `signer_role`, `signer_name`, `signature_b64`; also updates `op_signed/sup_signed` flags on session
  - Auto-save: every 30 s and on page visibility change, writes `draft_data` to session row
  - Removed ~200-line stale SQL comment block that was at the top of the old file

---

## 2026-06-11 — Alyssa (session 5)

**Files changed:**
- `app/(app)/quality/lab-results/page.tsx`

**Changes:**
- Fixed Final Product Lab Results page crashing on load with `TypeError: Cannot read properties of undefined (reading 'length')`
- Root cause: `TEST_TYPES` defines 8 tab types (`micro`, `residue`, `heavy_metals`, `eto`, `aflatoxins`, `mosh_moah`, `pa_final`, `glyphosate`) but `records` state was only initialised with 6 keys — `pa_final` and `glyphosate` were `undefined`. Tab bar rendering `records[t.key].length` for those two tabs crashed the whole page.
- Fix: added `pa_final:[]` and `glyphosate:[]` to the records initial state.

---

## 2026-06-11 — Alyssa (session 4)

**Files changed:**
- `app/auth/callback/page.tsx`

**Changes:**
- Fixed Microsoft OAuth always failing on first sign-in attempt ("Sign-in failed" shown, then redirected to login, where the existing session was detected and user forwarded to dashboard — appeared as needing to click the button twice)
- Root cause: `createBrowserClient` from `@supabase/ssr` has `detectSessionInUrl:true` by default — it automatically exchanges the `?code=` param for a session when the callback page loads. The page was also manually calling `exchangeCodeForSession(code)`, a second attempt on an already-consumed PKCE verifier → "PKCE code verifier not found in storage"
- Fix: removed manual `exchangeCodeForSession` call; callback page now uses `onAuthStateChange` to listen for `SIGNED_IN` and redirect. Added `getSession()` immediate check and a 15s timeout fallback. Single clean sign-in on first press.

---

## 2026-06-11 — Alyssa (session 2)

**Files changed:**
- `app/(app)/layout.tsx`
- `app/page.tsx`
- `lib/auth/departments.ts`

**Changes:**
- Added inactivity auto sign-out: 60 minutes of no activity signs the user out automatically
- Warning banner appears 5 minutes before sign-out showing a countdown timer and "Stay signed in" button
- Fixed root route `/` — was an old duplicate login page (no Microsoft button); now correctly redirects signed-in users to `/dashboard` and others to `/login`
- Fixed `getDefaultRoute()` fallback from `/` to `/dashboard` — prevents redirect loop for users with no department assigned yet (new Microsoft sign-ins before role is assigned)
- Azure app registration confirmed correct — no changes needed

---

## 2026-06-11 — Alyssa

**Files changed:**
- `next.config.js`
- `package.json`

**Changes:**
- Removed invalid `eslint` key from `next.config.js` (dropped in Next.js 15+) — was causing warning spam and repeated PM2 crash-restart cycles
- Fixed build script to use `DISABLE_ESLINT_PLUGIN=true` so ESLint doesn't block builds
- Merged Gustav's `Gustav/claude-boom` branch — resolved CHANGELOG conflict, all quality page changes now live on staging
- Exposed `sales`, `production`, `logistics` schemas needed in Supabase staging (manual step — Alyssa to action in Supabase dashboard)

---

## 2026-06-11 — Gustav (new Maintenance module — own section + dedicated schema)

**Files changed:**
- app/(app)/maintenance/page.tsx (new)
- components/layout/Sidebar.tsx
- app/(app)/layout.tsx
- Supabase staging migration: create_maintenance_schema (+ seed data)

**Changes:**
- New standalone **Maintenance** section in the sidebar (own group, separate from Quality) at `/maintenance` — replica of the approved maintenance system design with four tabs: Job Cards, Scheduled Maintenance (Weekly / Monthly / Annual-Calibration), Stock & Spares, Analytics
- New dedicated `maintenance` schema in the **staging** database (additive only — no existing schema touched) with tables: `job_cards`, `checklist_templates`, `checklist_completions`, `annual_items`, `spare_parts`, `offsite_equipment`; grants mirror the `qms` pattern
- Job card workflow persisted to the database: raised → forwarded to a technician by the maintenance manager → technician prompted to accept (timer starts) → work done + root cause → QC post-maintenance check (6 FSSC questions) → originator verification (satisfactory / not) → complete. Card numbers continue the paper register (`JC-26/268` onwards via DB sequence)
- New job card form: area (32 locations), machine, maintenance types, description with keyword-based AI suggestion, photo upload (downscaled client-side)
- Weekly/monthly checklists seeded from the QM-FM forms (6 weekly + 18 monthly areas); tick-state, fault flags, task notes and comments saved per ISO week / per month
- Annual register seeded with 20 calibration/inspection/YPM/service items; due-date colour coding (overdue/urgent/soon/plan/ok), supplier email draft, editable notes
- Spare parts register (12 parts) and offsite equipment tracking (3 items) seeded
- Analytics computed from live job-card data: totals, recorded repair time, avg time-to-close, completion rate, job cards by area, workload by technician
- Seeded 24 job cards (20 historical from the May paper register + 4 current examples)
- Route is open to all logged-in users for now; per-user permissions to be added as roles are defined
- **Manual step required:** add `maintenance` to Exposed Schemas in the Supabase staging dashboard (Project Settings → API), same as was done for `qms`/`shared`/`production`, otherwise the page cannot query the schema

---

## 2026-06-10 — Gustav (granule specs: stop per-run duplication, select from library)

**Files changed:**
- app/(app)/quality/granule/page.tsx
- Supabase staging migration: granule_specs_unique_type_customer

**Changes:**
- New Granule Run modal now **selects a saved specification** from the library (dropdown) instead of re-entering one each run; the selected spec is shown read-only and a snapshot is copied into the run
- Removed the auto-upsert that created a new `granule_specs` row on every run (root cause of duplicates — it relied on an onConflict target that didn't exist)
- Added `UNIQUE(type_grade, customer)` constraint on `qms.granule_specs` so duplicates can no longer form
- Specifications tab "add" now shows a friendly message when a grade+customer spec already exists (edit it instead)
- Specs are created/edited only in the Specifications tab
- Data cleanup (staging): collapsed duplicate granule specs — merged all CNTP-own customer variants to blank, kept one canonical spec per grade (Super Grade id 16, Super Fine id 15), deleted the rest. Existing runs unaffected (they carry their own spec_json snapshot)

---

## 2026-06-10 — Gustav (pasteuriser variation flags + overview dashboard)

**Files changed:**
- app/(app)/quality/pasteuriser/page.tsx

**Changes:**
- Added variation/outlier detection to the pasteuriser sample entry modal — flags sieve fractions, moisture, BD and temperature that sit >2.5 std deviations from the batch's other samples (non-blocking warning banner)
- Temperature spec validation: input turns red with a warning when below spec (default min 85°C, overridable per batch via temp_min/temp_max)
- Tablet-friendly numeric entry: sieve grams, temperature, moisture, BD and weight inputs now trigger the numeric keypad (inputMode decimal/numeric); larger sieve gram inputs
- New "Runs Overview" dashboard at the top of Active Runs — KPI cards (active runs, live samples, avg moisture, avg temp, sieve fails, pass rate) plus a live moisture & temperature trend chart for the selected batch

---

## 2026-06-10 — Gustav (staging login fix)

**Files changed:**
- QUALITY_MIGRATION_NOTES.md

**Changes:**
- Fixed staging login: added gustav@, alyssa@, jan@ to staging `auth.users` with matching UUIDs and password hashes from production
- Added matching `shared.app_roles` rows with full permissions
- Fixed `confirmation_token` NULL issue causing Supabase auth crash
- Updated `NEXT_PUBLIC_SUPABASE_ANON_KEY` in VPS `.env.local` to correct staging key
- Granted schema/table permissions on `shared` and `production` to authenticated role
- Rebuilt and restarted staging app
- Remaining manual step: add `shared`, `production`, `qms` to exposed schemas in Supabase dashboard (Project Settings → API)
- Updated QUALITY_MIGRATION_NOTES.md with full session handoff notes

---

## 2026-06-10 — Alyssa (session 3)

**Files changed:**
- `app/(app)/users/page.tsx`
- `app/api/admin/audit/route.ts` (new)
- `app/api/admin/audit/auth-event/route.ts` (new)
- `lib/auth/context.tsx`
- `C:\Users\Alyssa\Documents\Supabase Scripts\05_audit_log_grants.sql` (local only)

**Changes:**
- Rebuilt Users & Access page with two top-level tabs: **Users** and **Audit Log**
- Audit Log tab restricted to Alyssa + Jan UUIDs at both API and UI level — hardcoded, no permission toggle can grant or revoke this
- Audit log shows sign-in, sign-out, and data change events with actor name, action badge, timestamp, and context
- Added `/api/admin/audit` route — reads `axis.audit_log`, enriches rows with display names from `shared.app_roles`
- Added `/api/admin/audit/auth-event` route — writes `sign_in` / `sign_out` events to `axis.audit_log`
- `lib/auth/context.tsx` — `signIn` fires audit event after successful auth; `signOut` awaits audit write before invalidating the session
- `PermissionsPanel` gains a **Cross-department view access** section — shows view/access permissions from departments other than the user's own (blue-accented, collapsed by default). Allows e.g. a Quality person to be granted Management dashboard view without a role change
- Users table now shows **active permission count** alongside override count — so you can see what a user can actually do, not just how many overrides they have
- SQL: `05_audit_log_grants.sql` — grants `service_role` INSERT on `axis.audit_log`, adds `event_type` column

---

## 2026-06-10 — Alyssa (session 2)

**Files changed:**
- `app/(app)/workspace/page.tsx`
- `scripts/staging_migration.sql` (new)
- `scripts/staging_migration_workspace_axis.sql` (new)
- `scripts/staging_fix_grants_and_columns.sql` (new)
- `scripts/staging_fix_qms_schema.sql` (new)
- Supabase staging: qms, workspace, axis schemas + full data migration

**Changes:**
- Locked `/workspace` page to Alyssa UUID only — no role or permission override can grant access to anyone else
- Created full staging database schema: `qms` (35 tables), `workspace` (2 tables), `axis` (13 tables)
- Migrated 3,795 rows from production to staging across all schemas — staging is now a complete mirror of production
- Fixed service_role sequence grants so serial ID inserts work correctly
- Corrected column type mismatches in qms tables (Gustav's original setup had wrong types)
- Exposed `qms`, `workspace`, `axis` schemas in staging Supabase API settings

---

## 2026-06-10 — Alyssa

**Files changed:**
- `.env.local` (VPS only — not committed)
- Supabase staging: `shared` schema, `shared.app_roles` table

**Changes:**
- Discovered staging Supabase (`qjqkpockmujecjgmdple`) was created fresh by Gustav today with no user profiles configured
- Fixed `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` on VPS — was pointing to production project key, now correctly set to staging
- Exposed `shared` schema in Supabase staging API settings (Project Settings → API → Exposed schemas)
- Created `shared.app_roles` table with `user_id UNIQUE` constraint
- Added user roles: Alyssa Krishna (`senior_developer` / IT), Gustav (`quality_default` / Quality — Quality module only)
- Restarted PM2 with updated environment
---

## 2026-06-10 — Gustav

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`
- `scripts/restart-staging.sh` (new)
- `QUALITY_MIGRATION_NOTES.md` (new)
- Supabase staging: `qms` schema permissions + data migration

**Changes:**
- Fixed `data_json` parsing for PA/R-grade lookups in sieving lot auto-fill
- Fixed `lookupLot()` to fire PA/R fill even when no prior sieving runs exist for the lot
- Fixed double-space typo in `calcPercents` that broke gram → percent calculation
- Fixed spec editor: editable Grade name, always-visible mesh inputs, delete row button, PA auto-fill always fires on save
- Granted `SELECT/INSERT/UPDATE/DELETE` on all `qms` tables to `authenticated` role in staging Supabase
- Migrated ~375 PA/TA records and ~250 residue records from production into `qms.quality_records` on staging
- Added R-grade (residue) lookup alongside PA level — auto-fills both in lot message, e.g. `PA: P1 · R: R-0`

---

## 2026-06-09 — Gustav

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- Replaced grade dropdown with tab buttons: Export, Export Bland, Domestic
- Added Variant dropdown: CON, ORG, RA-ORG, RA-CON, FT-CON, FT-ORG
- Run Type moved to top of New Run form as large tablet-friendly In-Process / Final QC toggle buttons
- Time auto-fills to current time on new run (editable); leaf shade auto-fills from previous runs of same lot
- Final QC mode hides sieve fractions and needle count — only bulk density, leaf shade, PA required
- Per-fraction outlier detection flags values more than 2.5 std dev from recent similar runs
- Trend chart dot click highlights matching table row with yellow glow for 3 seconds
- Spec Editor: Add Row button for new Grade + Variant combinations not in the default database
- Tablet-optimised layout with larger touch targets and responsive grid

---
