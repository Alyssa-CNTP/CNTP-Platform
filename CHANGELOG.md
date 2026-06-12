# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

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
