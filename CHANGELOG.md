# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

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
