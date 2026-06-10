# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

---

## 2026-06-10 — Alyssa (session 4)

**Files changed:**
- `components/search/CommandSearch.tsx` (new)
- `app/api/search/batch/route.ts` (new)
- `components/layout/Sidebar.tsx`
- `app/(app)/layout.tsx`

**Changes:**
- Added global `Cmd+K` / `Ctrl+K` batch/lot search accessible from anywhere in the app
- Search queries `qms.quality_records`, `production.prod_sessions`, `production.bag_tags`, and `sales.signals` in parallel
- Results are permission-gated server-side — Production sections only appear for users with `can_view_ops_dashboard`, Sales only for users with `can_access_sales`
- Sidebar gains a search button below the brand header (dispatches `open-command-search` event)
- `CommandSearch` mounted once in the app layout — modal overlay with debounced 300ms search, grouped results by schema, `Esc` to close

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
