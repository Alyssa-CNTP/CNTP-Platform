# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

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
