# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

---

## 2026-06-09 — Gustav

**Files changed:**
- app/(app)/quality/sieving/page.tsx

**Changes:**
- Replaced Grade dropdown in the New Run form with tab-style buttons: Export, Export Bland, Domestic
- Renamed Variant dropdown to Grade with expanded options: CON, ORG, RA-ORG, RA-CON, FT-CON, FT-ORG
- Updated sdIsOrg() to treat RA-ORG and FT-ORG as organic variants (correct mesh fractions)
- Updated gradeStyle() badge colours to match new market names
- Applied same Market/Grade label changes in the inline edit form

---
