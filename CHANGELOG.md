# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

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

## 2026-06-10 — Gustav

**Files changed:**
- app/(app)/quality/sieving/page.tsx

**Changes:**
- Added R-grade (residue) lookup alongside PA level in sieving lot auto-fill
- New `rLookup` state fetches `workflow='residue'` records from `qms.quality_records` and maps batch number → `overall_r_grade`
- `lookupLot()` now auto-fills and displays both P-value (PA level) and R-value (residue grade) in the lot message, e.g. `PA: P1 · R: R-0`
- Staging Supabase populated with ~375 PA/TA records and ~250 residue records copied from production (GS, VS, MAT batch numbers)

---

## 2026-06-09 — Gustav

**Files changed:**
- app/(app)/quality/sieving/page.tsx

**Changes:**
- Grade tabs renamed: Market→Grade (Export/Export Bland/Domestic); Variant dropdown (CON/ORG/RA-ORG/RA-CON/FT-CON/FT-ORG)
- Run Type moved to top of New Run form as large tablet-friendly In-Process / Final QC buttons
- Time auto-fills to current time when opening a new run (editable)
- Leaf shade auto-filled from previous runs of the same lot number
- PA Level shows auto-fill indicator when pulled from raw material PA lookup
- Final QC mode hides sieve fractions table and needle count; only bulk density, leaf shade, PA level required
- Per-fraction outlier detection flags values >2.5 std dev from recent similar runs before saving
- Clicking a dot in the trend chart highlights the matching table row with a yellow glow for 3 seconds
- Spec Editor: Add Row button to add new Grade+Variant spec combinations not in the default database
- Inline edit form labels updated to match (Grade/Variant)
- Larger touch targets and responsive grid layout optimised for tablet use

---

## 2026-06-09 — Gustav (earlier)

**Files changed:**
- app/(app)/quality/sieving/page.tsx

**Changes:**
- Replaced Grade dropdown with tab-style buttons: Export, Export Bland, Domestic
- Renamed Variant dropdown to Grade with expanded options: CON, ORG, RA-ORG, RA-CON, FT-CON, FT-ORG
- Updated sdIsOrg() to treat RA-ORG and FT-ORG as organic variants
- Updated gradeStyle() badge colours to match new market names
- Applied same label changes in the inline edit form

---
