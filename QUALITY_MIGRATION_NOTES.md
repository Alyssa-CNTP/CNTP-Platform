# Quality Module — Migration Notes

## Session Context
Developer: Gustav  
Date: 2026-06-10  
Branch workflow: always branch from `staging`, name `gustav/feature-name`, PR → staging → auto-deploy via GitHub Actions.  
GitHub token (push access): stored in session — use `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` for git remote URL.

---

## Architecture

### Old System
Single-page React + Express app (`CNTPquality`) hosted on Render.  
- `client/src/App.js` — 17,828 lines, all quality sections in one file  
- `server/server.js` — Express API (2,490 lines)  
- `server/residue_specs.js` — R-grading logic  
- `server/sievingDashboard.js` — Sieving spec helpers  

### New System
Next.js 15 app (`CNTP-Platform`) with modular pages per workcenter.  
- Database: Supabase, schema `qms`  
- Auth: Supabase Auth via `/lib/auth/context.tsx`  
- DB client: `getDb()` from `/lib/supabase/db.ts` — always call `db.schema('qms').from(…)`  
- Staging URL: https://cntpplatform-staging.rooibostea.co.za  
- VPS: `cntpdev@154.65.97.200` port 2022, app at `/home/cntpdev/apps/staging/app/cntp-ops`

---

## Quality Pages

| Old Workcenter | New Route | Lines |
|---|---|---|
| Raw Material | `/quality/raw-material/page.tsx` | 2009 |
| Pasteuriser | `/quality/pasteuriser/page.tsx` | 2055 |
| Sieving Tower | `/quality/sieving/page.tsx` | 1390 |
| Granule Line | `/quality/granule/page.tsx` | 2107 |
| Lab Results | `/quality/lab-results/page.tsx` | 837 |
| Customer Specs | `/quality/customer-specs/page.tsx` | 395 |

---

## Key Business Logic

### PA/TA Grading (Raw Material)
Thresholds based on EU 2023/915:
- P0 = 0 µg/kg (not detected)
- P1 = 1–50 µg/kg
- P2 = 51–200 µg/kg
- P3 = 201–400 µg/kg
- P4 = > 400 µg/kg (FAIL)

Fields in `data_json`: `pa_level`, `total_pa_ug_kg`, `total_pa_mg_kg`, `pa_status`, `ta_status`  
Workflow key: `pa_ta_analysis` | Workcenter: `rawMaterial`

### Residue R-Grading (Raw Material)
- R-0 = Not detected
- R-1 = Detected, value < ½ × MRL
- R-2 = Detected, value ≥ ½ × MRL and < MRL
- R-3 = Detected ≥ MRL, OR no MRL exists, OR SA-banned compound (auto-fail)

Banned compounds (SA Act 36 / EU Reg. 1107/2009): Chlorpyrifos, Endosulfan, Methamidophos, Parathion, Carbofuran, Aldicarb, and others — any detection = R-3.  
Fields in `data_json`: `overall_r_grade`, `overall_status`, `total_detections`, `total_exceedances`, `compounds_detected[]`  
Workflow key: `residue` | Workcenter: `rawMaterial`

### Glyphosate
Workflow key: `glyphosate` | Workcenter: `rawMaterial`  
Fields: `glyphosate_value_mg_kg`, `ampa_value_mg_kg`, `glufosinate_value_mg_kg`

### Pasteuriser PA/TA Final (Final Product)
EU limits: PA ≤ 400 µg/kg, TA ≤ 1000 µg/kg  
Fields in `results` JSON: `total_pa_eu` (µg/kg), `total_pa_bfr28` (µg/kg), `scopolamine_total` (µg/kg), `total_ta` (µg/kg), `overall_status`, `report_reference`, `lab`, `date_issued`, `date_received`  
Stored in: `qms.lab_results` table, `test_type = 'pa_final'`

### Microbiology Specs
| Analyte | Spec |
|---|---|
| TPC | ≤ 300,000 cfu/g |
| E. coli | ≤ 10 cfu/g |
| Yeast | ≤ 5,000 cfu/g |
| Mould | ≤ 5,000 cfu/g |
| Staph. aureus | ≤ 10 cfu/g |
| Salmonella / Listeria / E. coli O157 | Absent |

### Heavy Metals EU Limits
| Metal | Limit (mg/kg) |
|---|---|
| Lead | 3.0 |
| Cadmium | 1.0 |
| Mercury | 0.02 |
| Arsenic | 1.0 |

### EtO (Ethylene Oxide)
EU limit (sum EtO + 2-Chloroethanol): 0.02 mg/kg

### Aflatoxins EU Limits
| Compound | Limit (µg/kg) |
|---|---|
| Aflatoxin B1 | ≤ 5 |
| Total Aflatoxins | ≤ 10 |
| Ochratoxin A | ≤ 20 |

---

## Sieving Dashboard

### Product Types & Mesh Fractions

| Product | CON Mesh | ORG Mesh |
|---|---|---|
| Fine Leaf | >6, >12, >18, >40, Dust | >6, >10, >18, >40, Dust |
| Coarse Leaf | >6, >12, >18, >40, Dust | same |
| Rooibos Blocks | >6, >12, >16, >20, >60, Dust | >6, >10, >16, >20, >60, Dust |
| Indent Sticks | >6, >12, >18, >40, Dust, Fine Leaf | same |

### Grade / Variant
Grades: `Export`, `Export Bland`, `Domestic`  
Variants: `CON`, `ORG`, `RA-ORG`, `RA-CON`, `FT-CON`, `FT-ORG`

### Sieving Data Model (`qms.sd_runs`)
Key columns: `product`, `date`, `lot_number`, `serial_number`, `grade`, `variant`, `run_type` (in-process / final), `qc_name`, `time_of_run`, `needle_count`, `leaf_shade`, `bulk_density`, `pa_level`, `pass_status`, `violations[]`, `gram_values{}`, `sieve_results{}`

### PA/R Auto-fill in Sieving
When a lot number is typed in the new run form:
- Looks up `qms.quality_records` where `workcenter='rawMaterial'` and `workflow='pa_ta_analysis'` → maps `batch_number → pa_level`
- Looks up `qms.quality_records` where `workcenter='rawMaterial'` and `workflow='residue'` → maps `batch_number → overall_r_grade`
- Batch numbers in staging were normalised (removed spaces around dashes, e.g. `"GS - 0098"` → `"GS-0098"`)
- Staging has ~375 PA records and ~250 residue records copied from production for GS/VS/MAT batches

---

## Staging Database (Supabase: `qjqkpockmujecjgmdple`)

### Schema: `qms`
Key tables: `quality_records`, `sd_runs`, `sieving_spec_overrides`, `past_sensorial_sessions`, `past_sensorial_samples`, `granule_runs`, `granule_samples`, `granule_tastings`, `granule_specs`, `lab_results`, `customer_specs`

### Permissions Fixed This Session
```sql
GRANT SELECT ON ALL TABLES IN SCHEMA qms TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA qms TO authenticated;
GRANT USAGE ON SCHEMA qms TO anon, authenticated;
```

### Production DB (Supabase: `sxzjjcyuzyfneesnsjna`)
Do not write to production. Read only for data migration purposes.

---

## Sieving Spec Storage
Custom spec overrides saved to `qms.sieving_spec_overrides` (columns: `product`, `specs` JSONB).  
Spec key format: `"Grade|Variant"` e.g. `"Export|CON"`, `"Export Bland|ORG"`.  
Loaded on page init and merged with hardcoded defaults in `SIEVING_SPECS_DB`.

---

## Pasteuriser Data Model

### Active Runs (`qms.quality_records`, `workflow='pasteuriser_run'`)
`data_json` contains: `status` (active/completed), `customer`, `batch_number`, `serial_number`, `production_date`, `grade`, `variant`, `spec`, `batch_specs{}`, `hourly_samples[]`, `notes`

### Sensorial Sessions
Tables: `qms.past_sensorial_sessions` + `qms.past_sensorial_samples`  
Fields per sample: `aroma` (1–5), `flavour_profile` (1–5), `briskness` (1–5), `strength` (1–5), `cup_colour` (1–5), `cup_clarity` (1–5)

### Lab Results (`qms.lab_results`)
Columns: `id`, `test_type`, `workcenter`, `batch_no`, `lab_name`, `overall_status`, `results` (JSONB), `comment`, `created_at`, `uploaded_by`  
`test_type` values: `micro`, `residue`, `heavy_metals`, `eto`, `aflatoxins`, `mosh_moah`, `pa_final`, `glyphosate`

---

## Granule Line Data Model

### Runs (`qms.granule_runs`)
Fields: `id`, `type` (run type), `grade`, `variant`, `serial_number`, `date`, `qc_name`, `status` (active/finalised), `spec_id`, `batch_number`, `notes`

### Samples (`qms.granule_samples`)
Fields: `run_id`, `sample_number`, `date`, `time`, `moisture`, `untapped_bd`, `needle_count`, `sieve_pct{}` (JSONB keyed by sieve name), `violations[]`, `has_sieve`, `has_mb`

### Tastings (`qms.granule_tastings`)
Fields: `run_id`, `sample_id`, `aroma`, `flavour_profile`, `briskness`, `strength`, `cup_colour`

### Specs (`qms.granule_specs`)
Fields: `type`, `grade`, `moisture_max`, `bd_min`, `bd_max`, plus sieve columns

---

## Changes Made This Session

| Change | File | Description |
|---|---|---|
| R-grade lookup | `sieving/page.tsx` | Added `rLookup` state fetching residue R-grades; auto-fills alongside PA in lot lookup |
| PA auto-fill fix | `sieving/page.tsx` | `lookupLot()` now fires PA/R fill even when no previous sieving runs exist for that lot |
| Gram % calc fix | `sieving/page.tsx` | Fixed double-space typo in `calcPercents` that prevented gram→percent calculation |
| Spec editor | `sieving/page.tsx` | Editable Grade name input, Variant dropdown, always-visible mesh inputs, delete row button |
| Staging DB grants | Supabase migration | Granted SELECT/INSERT/UPDATE/DELETE to authenticated role on all qms tables |
| Data migration | Supabase staging | ~375 PA records + ~250 residue records copied from prod into `qms.quality_records` |

---

## What Still Needs Work (Priority Order)

1. **TestTab analyte-level detail** — Pasteuriser + Lab Results: generic table hides all per-analyte values (Heavy Metals, EtO, Aflatoxins, MOSH/MOAH, Micro). Only shows Batch/Date/Lab/Status.
2. **Pasteuriser PA tab** — Needs specialised table showing `total_pa_eu`, `total_pa_bfr28`, `scopolamine_total`, `total_ta` with EU limit thresholds, not just generic status.
3. **Sieving sensorial fields** — `aroma`, `flavour_profile`, `briskness`, `strength`, `cup_colour`, `cup_clarity` missing from sieving run form and table.
4. **Raw Material Leaf Shade tab** — Missing from new raw-material page.
5. **Sieving PDF upload → review modal** — Old had Gemini extraction + review before save.
6. **Granule recheck panel** — Mini-form to enter recheck moisture for out-of-spec samples.
7. **COA Builder** — Certificate of Analysis generator (new page needed).
8. **EU MRL sync + bulk regrade buttons** — Admin utilities for Raw Material.
