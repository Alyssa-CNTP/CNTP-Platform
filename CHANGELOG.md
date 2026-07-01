# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

---

## 2026-07-01 — Gustav (Lab Manager: no comment step needed on Pass)

**Files changed:**
- `app/(app)/quality/lab-manager/page.tsx`
- `app/(app)/quality/pasteuriser/page.tsx`
- `app/(app)/quality/granule/page.tsx`

**Changes:**
- Pass now finalises immediately with no comment modal — one click, no interruption.
- Fail and Concession still open the comment modal and still require a comment, unchanged.

---

## 2026-07-01 — Gustav (Lab Manager: comment sent back to QC on duty)

**Files changed:**
- `components/shared/LmDecisionModal.tsx` (new)
- `app/(app)/quality/lab-manager/page.tsx`
- `app/(app)/quality/pasteuriser/page.tsx`
- `app/(app)/quality/granule/page.tsx`

**Changes:**
- Replaced the browser `prompt()` used to capture a Pass/Fail/Concession reason with a proper comment modal (`LmDecisionModal`), used consistently across the Lab Manager dashboard's Pending Approvals tab and the inline approve buttons on the pasteuriser and granule run pages.
- The comment is now optional on Pass (previously no comment was possible) and still required on Fail/Concession, and is written back to the existing `final_reason` field (already present on both `qms.granule_runs` and pasteuriser's run data).
- The comment now surfaces directly on the batch/run the QC on duty is looking at — a "💬 Lab Manager comment" banner on the pasteuriser batch header and the granule run card — instead of only being visible buried in the History tab.

---

## 2026-07-01 — Alyssa (fix capture autofill — name-based operator fallback)

**Files changed:**
- `app/(app)/production/capture/assign/page.tsx`
- `supabase/migrations/20260701_001_roster_entries_backfill_operator_id.sql`

**Changes:**
- Updated `fillFromRoster()` in the capture assign page to add a third resolution path: when `roster_entries.operator_id` is null and the `employees.operator_id` link is also missing, the function now tries to match `person_name` against `operators.name` (case-insensitive trim). This covers the ~20 floor workers who exist in the employees directory but were never linked to an `operators` record.
- Updated the back-fill migration to also include a Pass 2 name-match UPDATE (`LOWER(TRIM(roster_entries.person_name)) = LOWER(TRIM(operators.name))`), so existing roster entries pick up the correct `operator_id` when the migration is re-run.
- Previous Pass 1 (employee link) remains; Pass 2 name-match catches the rest.

---

## 2026-07-01 — Gustav (QC name autocomplete now sourced from the shift roster)

**Files changed:**
- `lib/hooks/useQcNames.ts`

**Changes:**
- Replaced the `production.employees` (`department='qc'`) lookup with distinct `person_name` values from `production.roster_entries`, filtered to role keys in the roster's "Quality" category (QC Supervisor, QC, Lab Analyst, Incoming Goods QC Inspector), across both day and night shift.
- Reason: the employees-table department flag no longer matched who is actually rostered onto QC roles — the autocomplete now mirrors exactly who shows up under "QUALITY" on the shift roster's on-duty card.

---

## 2026-07-01 — Gustav (QC name autocomplete across sieving, pasteuriser, granule)

**Files changed:**
- `lib/hooks/useQcNames.ts` (new)
- `components/shared/QCNameField.tsx` (new)
- `app/(app)/quality/sieving/page.tsx`
- `app/(app)/quality/pasteuriser/page.tsx`
- `app/(app)/quality/granule/page.tsx`

**Changes:**
- Added a type-ahead autocomplete to every QC/Quality Controller name field in sieving, pasteuriser, and granule (new run forms, add-sample forms, night/afternoon-shift QC overrides, and inline batch-header edits) to prevent spelling mistakes and name mismatches.
- Names are sourced from `production.employees` where `department='qc'` — the same staff directory used by the shift roster — via a new shared `useQcNames()` hook, so the roster itself is untouched and remains the single source of names.
- Autocomplete is assistive, not a hard lock: as the user types, matching names appear in a dropdown (new shared `QCNameField` component); picking one fills the field exactly, but a name not yet in the list can still be typed and saved (e.g. a fill-in QC not yet added to staff).

---

## 2026-07-01 — Gustav (Duplicate batch guard hardened; search added to Lab Results)

**Files changed:**
- `app/(app)/quality/pasteuriser/page.tsx`
- `app/(app)/quality/granule/page.tsx`
- `app/(app)/quality/lab-results/page.tsx`

**Changes:**
- Pasteuriser and granule already blocked creating a new run with a batch number that matches an **active or finalised/historical** run — but two gaps could let a real duplicate slip through:
  - **Normalisation**: the comparison was `.trim().toLowerCase()` only, so "GS-0098" vs "GS 0098" vs "GS_0098" were treated as different batch numbers. Added a shared `normBatch()` (same rule raw-material already used) so all common formatting variants collapse to the same key.
  - **Row cap**: the batches/runs used for the check were loaded with a single query, silently capped at PostgREST's 1000-row limit — a very old batch number beyond that cap could go undetected. Both pages now paginate through the full history (same pattern already used in Sieving), so the whole history is always loaded.
  - Messaging is unchanged: an active duplicate says to add a sample to the existing run instead; a finalised duplicate says to use a different batch number.
- **Lab Results**: added a single search box above the table (works across every tab — Micro, Residue, Heavy Metals, EtO, Aflatoxins, MOSH/MOAH, PAs, Glyphosate) that matches against every field of a record, not just the visible columns.

## 2026-07-01 — Alyssa (energy totals on production dashboard + production capture cron)

**Files changed:**
- `components/production/EnergyTotals.tsx` (new)
- `app/(app)/production/page.tsx`
- `.github/workflows/energy-capture-production.yml` (new)

**Changes:**
- Added a lightweight `EnergyTotals` component to the production dashboard: two stat tiles (Solar today / Grid today in kWh) with a % solar share indicator. No Recharts — plain HTML/CSS only, avoiding the Recharts + Next 16 / React 19 SSR build issue. Renders `null` silently on error so it never breaks the production page.
- Added `.github/workflows/energy-capture-production.yml`: scheduled cron at 20:00 UTC (22:00 SAST) that POSTs to the production app's `/api/maintenance/energy/capture` endpoint with the `PROD_CRON_SECRET` bearer token. Requires two new GitHub repo secrets: `PROD_APP_URL` and `PROD_CRON_SECRET`.

---

## 2026-07-01 — Alyssa (maintenance planner: remove add-slot/week calendar/duty-roster, add shift roster card)

**Files changed:**
- `app/(app)/maintenance/planner/page.tsx`

**Changes:**
- Removed "Add a planned slot" collapsible section (was writing to `maintenance.slots`).
- Removed "This week" weekly calendar section (was reading from `maintenance.duty_roster` which showed every maintenance person on duty every day — inaccurate).
- Removed "Duty roster" collapsible section (was a static info panel linking to `/production/roster`).
- Replaced all three with a single **"Maintenance on shift"** card that queries `production.roster_periods` and `production.roster_entries` directly, showing who is assigned to the Day shift and Night shift for the current period. The active shift (07:00–16:59 = day, otherwise night) is highlighted. Shows role label (Technician / Assistant), per-person ON DUTY badge where applicable, and a direct link to edit in the shift roster.
- Removed now-unused state (`openWeek`, `openAddSlot`, `openRoster`, `weekStart`), functions (`slotsOn`, `rosterOn`), and imports (`Plus`, `NavBtn`, `INP` from add-slot form, `PRIMARY` constant).

---

## 2026-07-01 — Gustav (Sieving chart: timeline navigator for previous weeks/months)

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- The new Mesh Trend / Outliers chart was bounded to only "this week" or "this month" — added a **◀ ▶ timeline navigator** so it can step back through any previous week or month (and a "Today" button to jump back to the current one). The window stays bounded (7 days or one month's worth of weeks) so it never becomes the unreadable "all runs" chart — you just move which window you're looking at. Shows the date range being viewed (e.g. "23 Jun – 29 Jun 2026" or "June 2026").

## 2026-07-01 — Alyssa (per-dept staged save + fix maintenance duplicates)

**Files changed:**
- `app/(app)/production/roster/page.tsx`

**Changes:**
- **Per-department staged save**: roster edits (add/edit/delete/drag) now stage in local state and do not write to the DB until "Save [Department]" is clicked on the category header. Save does delete-all + re-insert for that department's role keys only — two supervisors editing different departments simultaneously never overwrite each other. Switching periods discards unsaved local changes.
- **Fix maintenance duty_roster duplicates**: publish previously deleted only slots where `start_at` fell inside the period dates. Changed to an overlap delete so pre-existing entries for the entire window are cleared before inserting the new slots — eliminates the duplicate chips in the maintenance calendar.

---

## 2026-07-01 — Alyssa (roster Shift A/B naming with weekly swap)

**Files changed:**
- `app/(app)/production/roster/page.tsx`

**Changes:**
- Roster grid columns now display **Shift A / Shift B** (drawn from `day_label`/`night_label` on the period) instead of generic "Day/Night". Times remain as subtitle.
- "New period" modal includes a **Day = Shift A / Day = Shift B** toggle. Defaults to the opposite of the previous period (auto-alternates). First ever period defaults to Day = Shift A.
- "Generate next week" modal **auto-swaps labels**: if this week's day = Shift A, next week's day = Shift B (the shift letter follows the people, not the clock slot).
- "On duty" toggle buttons also show Shift A/B names.

---

## 2026-06-30 — Gustav (Outlier/typo prevention in pasteuriser, granule, sieving; new sieving Week/Month chart)

**Files changed:**
- `lib/utils/outliers.ts` (new)
- `app/(app)/quality/pasteuriser/page.tsx`
- `app/(app)/quality/granule/page.tsx`
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- Added a shared `checkOutlier`/`mean`/`stdDev` helper. A value is flagged only when the comparison history already has real spread (std > a field-specific floor) **and** the new value sits more than 2.5σ from the mean — avoids false positives on tightly-controlled fields.
- **Outlier warnings now require explicit confirmation before saving** (previously a passive banner you could ignore): a "Yes, these values are correct" checkbox appears next to the warning and the Save button is disabled until it's ticked. Applied to:
  - **Pasteuriser** (already had moisture/BD/temp/sieve-% checks vs. other samples in the batch) — added the confirm-gate.
  - **Granule** (had no statistical check at all, only a hard spec-max fail) — added moisture/BD/dryer-temp outlier detection vs. other samples in the run, to both the Add and Edit sample modals, with the confirm-gate.
  - **Sieving** (only checked sieve mesh %) — extended to also cover Bulk Density and Leaf Shade, with the confirm-gate on Save Run.
- **New sieving chart** — bounded to **This Week** (by day) or **This Month** (by week-of-month), never the full history, so it can't become unreadable again. Two views: **Mesh Trend** (every sieve fraction as its own line, like the original chart) and **Outliers** (a chosen metric — Bulk Density, Leaf Shade, or a sieve fraction — plotted with a ±2.5σ band; out-of-band points are red and clickable to scroll/highlight the matching table row).

---

## 2026-07-01 — Alyssa (roster auto-rotation, drag-and-drop, publish to maintenance)

**Files changed:**
- `app/(app)/production/roster/page.tsx` (major update)
- `supabase/migrations/20260630_002_roster_publish.sql` (new — run manually in Supabase dashboard)

**Changes:**
- **Wednesday deadline badge:** header of the roster page now shows a countdown to Wednesday (the roster change deadline). Turns amber at 2 days out, red on the day itself.
- **Generate next week modal:** "Generate next week" button opens a review modal that pre-fills the next 7-day period, rotates every person day↔night (the alternating week rule), checks leave records for the new dates, and highlights conflicts. Generates a new `roster_periods` row with all entries inserted rotated on confirm.
- **Drag and drop:** every `PersonChip` is now draggable via the HTML5 Drag API. Dragging a chip onto any other cell moves the person to that role/shift (updates DB immediately). Drop target is highlighted with a brand-colour ring.
- **Publish button + status badge:** period bar now shows a Draft/Published badge. Clicking Publish marks the period `status='published'` and syncs maintenance entries (`maintenance_tech`, `maintenance_asst`) to `maintenance.duty_roster` as daily slots (day shift = 05:00–14:00 UTC, night = 14:00–23:00 UTC) for each day in the period.
- **DB migration:** `supabase/migrations/20260630_002_roster_publish.sql` adds `status` (draft/published, default draft) and `published_at` columns to `production.roster_periods`. The app gracefully falls back to `status='draft'` if the column is not yet present — run the migration in the Supabase SQL editor to unlock publishing.

---

## 2026-06-30 — Gustav (Leaf Shade: fix wrong predictions — match desktop pipeline)

**Files changed:**
- `ml/leafshade/leaf_shade_api.py`
- `ml/leafshade/requirements.txt`

**Changes:**
- **Bug fix:** the web service decoded the CR3 with `half_size=True`, which halves resolution and skips demosaic interpolation, shifting the 30 colour features away from what the model was trained on → wrong leaf shade. Removed `half_size=True` so the RAW decode is full-resolution, matching the desktop training pipeline (Blackheath).
- Pinned the Python deps to the desktop reference versions so the demosaic + feature extraction reproduce training values exactly: `rawpy==0.25.1` (was 0.27.0), `opencv-python-headless==4.13.0.90` (was 4.13.0.92), `numpy==2.2.6` (was 2.4.6). scikit-learn stays 1.7.2 and joblib 1.5.3 (already matched).
- Requires a container rebuild on the VPS: `cd ml/leafshade && docker compose up -d --build`.

---

## 2026-06-30 — Alyssa (July 2026 roster seed)

**Files changed:**
- `supabase/migrations/20260630_001_roster_july2026.sql` (new)

**Changes:**
- Seeded all 4 July 2026 weekly roster periods to the database: 29 Jun–3 Jul, 6–10 Jul, 13–17 Jul, 20–24 Jul. Each period has day (07h00–16h00) and night (16h00–01h00) shifts with 286 entries total across Production, Store, QC, Cleaning, Maintenance, and H&S roles. Skill tags (FL, ER, FF, FA, II, FM, SHER, SS, H&S, C) parsed directly from the source spreadsheet. Data is live in `production.roster_periods` and `production.roster_entries` on staging.

---

## 2026-06-30 — Alyssa (Production Orders page, expandable capture overview, date-scoped serials, maintenance escalation)

**Files changed:**
- `app/(app)/production/orders/page.tsx` (new)
- `app/(app)/production/capture/[section]/page.tsx`
- `components/layout/Sidebar.tsx`
- `components/production/capture/CaptureOverview.tsx`
- `components/production/capture/TimesheetConfirm.tsx`

**Changes:**
- **Production Orders page** (`/production/orders`): lists all `prod_sessions` across every section, grouped by date, with status badge (in progress / awaiting sign-off / signed off), shift, variant, operator names, lot number, kg in → kg out, and variance badge (green/amber vs. tolerance). Filterable by section, status, shift, and date range. Each card links directly into the capture page for that session. Visible to Production + Management.
- **Sidebar**: added Production Orders nav entry under the Production group (FileText icon).
- **Capture overview — expandable grouped rows**: bagging rows grouped by product (10 bags of Fine Leaf = 1 row with count + total kg). Click any group to expand and see individual bag rows with serial number, time logged, and weight. Expand all / Collapse all buttons. Active filter badge. Filter bar: product text search, variant select, grade select, clear button.
- **Serial counter date-scoped**: `bag_tags` serial lookup now uses a `like('serial_number', 'ST-DDMMYY-%')` prefix so the counter resets to 001 each day instead of continuing from the previous day's last number.
- **Timesheet maintenance escalation**: maintenance break entries now require a description — confirm button is blocked and a warning is shown until notes are filled in. On timesheet confirm, each maintenance stoppage fires a `line_messages` alert to the section channel with operator name, section, shift, description, and duration for immediate supervisor visibility.

---

## 2026-06-29 — Gustav (Leaf Shade: Docker deployment for the Python service)

**Files changed:**
- `ml/leafshade/Dockerfile` (new), `ml/leafshade/docker-compose.yml` (new), `ml/leafshade/.dockerignore` (new)
- `ml/leafshade/README.md`

**Changes:**
- The staging VPS (Ubuntu 26.04) has Docker 29.5 but no Python 3.11. Added a `python:3.11-slim` Docker image + compose service so the Leaf Shade classifier runs in a container with the exact pinned deps (scikit-learn 1.7.2) without installing Python on the host.
- Uses `network_mode: host` so the Flask service keeps its original `127.0.0.1:5001` bind (localhost only, never internet-facing) and the Next.js proxy route reaches it unchanged — **no change to `leaf_shade_api.py`**.
- `restart: unless-stopped` keeps it alive across reboots. One-time start: `cd ml/leafshade && docker compose up -d --build`. README updated with Docker as the primary path (venv/pm2 kept as an alternative).

---

## 2026-06-29 — Gustav (Raw Material: Leaf Shade ML classifier + pH/TDS tab — ported from CNTPquality)

**Files changed:**
- `ml/leafshade/` (new) — `leaf_shade_api.py`, `leaf_shade_models/*.pkl`, `requirements.txt`, `setup.sh`, `run.sh`, `README.md`, `.python-version`
- `app/api/leaf-shade/predict/route.ts` (new)
- `app/(app)/quality/raw-material/page.tsx`
- `.gitignore`

**Changes:**
- Ported the **Leaf Shade Classifier** from the old `CNTPquality` Express app (`server/leafShade.js` + `server/leaf_shade_api.py`). It is a Flask micro-service that takes a Canon **CR3** RAW photo, extracts 30 colour features (OpenCV/rawpy) and predicts the leaf shade (Shade 0–11) with an MLPClassifier + StandardScaler + LabelEncoder.
- The three model pickles were saved with **scikit-learn 1.7.2**; `requirements.txt` pins the exact Python versions (validated: model loads, 30-feature pipeline runs end-to-end). **No Next.js `package.json` module versions were changed.**
- Added **`POST /api/leaf-shade/predict`** — a Next.js route that proxies the CR3 to the Python service on `127.0.0.1:5001` (not internet-facing) and returns prediction + top-5 + camera-compliance.
- Added a **🍃 Leaf Shade** tab in Raw Material: CR3 upload → model prediction, plus the lab's **physically observed shade (1–11)** and a **free-text observation** note. Saves to `qms.quality_records` (`workflow='leaf_shade'`).
- Added a separate **💧 pH / TDS** tab in Raw Material for manual pH + TDS entry per batch. Saves to `qms.quality_records` (`workflow='ph_tds'`). No schema migration needed — `data_json` is jsonb.
- The Python service runs as its own pm2 process (`cntp-leafshade`); see `ml/leafshade/README.md` for one-time VPS setup (`bash ml/leafshade/setup.sh` + `pm2 start ml/leafshade/run.sh --name cntp-leafshade`).

---

## 2026-06-29 — Gustav (Scheduled maintenance: interactive Overview tiles, required calibration sign-off, required fault choice)

**Files changed:** `app/(app)/maintenance/scheduled/page.tsx`, `lib/maintenance/useMaintenanceData.ts`

- **Overview tiles are now buttons:** clicking *Weekly outstanding*, *Monthly outstanding*, *Calibrations overdue / ≤30d* or *Services due* jumps straight to the relevant sub-tab.
- **No one-click "Done today":** the Overview quick-complete buttons were removed — *Mark calibrated →* now routes to the register and *Record service →* to Readings, so nothing is closed off without capturing the detail.
- **Calibration sign-off requires a person:** the full calibration register and the annual register both now have a required "Who did it?" selector (starts empty, highlighted); *Set / Today / ✓ Calibrated* are disabled until someone is chosen. `calDone`/`calDoneOn` record the chosen person.
- **Monthly fault choice is required and starts blank:** the Fault selector no longer defaults to "No Fault" — it opens on a "Fault? …" placeholder, and a monthly task **cannot be ticked done until Fault or No Fault is explicitly chosen** (the box is highlighted until then).

## 2026-06-29 — Gustav (Maintenance round 2: editable annual register, interactive trends, job-card filters/sort, individual prints)

**Files changed:**
- `supabase/migrations/20260629_001_maintenance_annual_calibration.sql` (new — applied to staging DB)
- `lib/maintenance/types.ts`, `lib/maintenance/useMaintenanceData.ts`, `lib/maintenance/exporters.ts`
- `app/(app)/maintenance/scheduled/page.tsx`
- `app/(app)/maintenance/job-cards/page.tsx`, `app/(app)/maintenance/job-cards/[cardId]/page.tsx`

**Changes:**
- **DB (additive, staging):** added `interval_days` and `last_done_by` to `maintenance.annual_items` to complete the calibrated-on / by / cycle stamp.
- **Annual / Calibration tab cleaned up:** removed the duplicate "due ≤60d" card list that repeated the table below it (now a single at-a-glance count strip). Every field in the register is **editable inline** (category, asset, serial, supplier, cycle days, next due). Added a **Mark calibrated** action per row — pick the date it was done + who did it; the next-due date recomputes from last-done + cycle. The last-done date and person are shown as a "✓ calibrated" stamp.
- **Readings & Trends graphs are interactive:** the table is gone — each trend point is now **clickable to reveal that reading's date and value** (with units). Diesel run-hours and compressor-hours points carry exact dates; the weekly trend-window filter (8w / quarter / 6mo / year) is retained.
- **Job cards — filters in every view:** the search bar plus a **raised-date range filter** now apply across the manager board, technician, QC and raiser views (previously search was manager-only). **High urgency always sorts to the top** of every list (manager-set urgency, then derived priority, then age).
- **Individual prints:** a **Print job card** button on the job-card detail page renders a full single-card document (header, work done, root cause, spares, activity log). A **per-checklist print** button renders one checklist with its who/when audit trail. (`printJobCardDetail`, `printChecklistOne` in exporters.)

## 2026-06-29 — Gustav (Maintenance overhaul: accept/start, urgency, edit/cancel, reactive filters, search, exports, calibration cycle, per-tech status)

**Files changed:**
- `supabase/migrations/20260625_001_maintenance_jobcard_overhaul.sql` (new — applied to staging DB)
- `lib/maintenance/types.ts`, `lib/maintenance/constants.ts`, `lib/maintenance/helpers.ts`
- `lib/maintenance/useMaintenanceData.ts`, `lib/maintenance/exporters.ts` (new)
- `components/maintenance/JobCardItem.tsx`, `components/maintenance/MaintenanceDashboard.tsx`
- `app/(app)/maintenance/job-cards/page.tsx`, `app/(app)/maintenance/scheduled/page.tsx`, `app/(app)/maintenance/planner/page.tsx`
- `app/api/maintenance/job-cards/route.ts`, `app/api/maintenance/job-cards/[id]/assign/route.ts`

**Changes:**
- **DB (additive, staging):** added `urgency`, `started_at`, `cancelled_at`, `cancelled_by` to `maintenance.job_cards`; widened the status CHECK to allow `cancelled`; added an urgency CHECK.
- **Allocate panel:** one technician picker only — on-duty chips (auto-ticked least-busy) with a single tick; off-duty staff move to a secondary dropdown (removes the confusing double tick). Manager can set an **urgency label** (low/medium/high/critical, or Auto) at allocation. The **Forward** button moved to the bottom of the panel, after the clarify/comment row.
- **Accept → Start split:** the technician now *accepts* first, then taps *Start job*; the work **timer only starts on Start** (`started_at`). Breakdowns still time from raise.
- **Finish gating:** a job cannot be completed until both Work Done and Root Cause are filled (button disabled + server-side guard).
- **Spares request pauses the timer:** requesting a part puts the job on hold (timer frozen) with a generalised Resume; the same pause/resume now covers breakdown interrupts and spares/problem holds.
- **Edit / cancel:** managers can edit a card's area/machine/description/urgency and cancel it (terminal `cancelled`). Technicians cannot delete/cancel — manager-only.
- **Breakdown routing:** breakdowns and the allocate suggestion now route to the **least-busy on-duty technician** (not just the most-recent shift); machine-criticality ranking added (pasteurizer → sieving → granule → refining 1/2).
- **Job-cards board:** Shift-summary tiles, the per-raiser tiles, and the personal-view tiles are now **reactive filter buttons**; added a **search bar**, a **By-technician** (assignee) filter, **CSV export** + **print**, and a 2-column card layout for a denser overview. Cancelled cards excluded from active lists.
- **Scheduled:** editable **calibration finalize date** that recomputes the next cycle (`calDoneOn`); **forklift run-hour rows ordered by forklift number**; a **trend window** selector (8w/quarter/6mo/year) on Readings & Trends sparks; **print/export** for weekly & monthly checklists.
- **Analytics:** dashboard graphs gained a 3/6/12-month range selector.
- **Planner:** new **per-technician status** panel showing who is busy with which card, who is available, and each person's outstanding cards.

---

## 2026-06-26 — Alyssa (fix: cross-department Quality access via permissions)

**Files changed:** `app/(app)/layout.tsx`, `lib/auth/context.tsx`

- **Root cause:** The `/quality` route guard only checked department (`['Quality']`) with no permission escape hatch. Management users with `can_view_history` toggled on saw Quality links in the sidebar (because `canAccessQuality` correctly checked permissions) but were redirected to `/dashboard` whenever they tried to navigate to any `/quality/*` page.
- **Fix in `layout.tsx`:** Added `permission: 'can_view_history', orPermission: true` to the `/quality` route guard. Users in the Quality department get through by department as before; users in any other department (e.g. Management) now get through if they have `can_view_history` enabled in their overrides.
- **Fix in `context.tsx`:** Aligned `canAccessQuality` to use `can_view_history` as the single cross-department gate (removed the `p('can_upload_pdfs')` check), so the sidebar and route guard now agree on who can access Quality. This eliminates the workaround of assigning Management users an IT role to bypass guards.

---

## 2026-06-26 — Alyssa (Home/floor-plan polish: login-image backdrop, richer graphics, weather → Home, dashboard leads with graphs)

**Files changed:** `app/(app)/home/page.tsx`, `components/home/HomeIsometric.tsx`, `components/production/FactoryFloorPlan.tsx`, `components/production/ProductionDashboard.tsx`

- **Home background** is now the **login photo** (`/rooibos-hero.png`) at low opacity, instead of the cargo illustration.
- **Weather moved to the Home page** (beside the greeting) and **removed from the Production dashboard**.
- **Home isometric is more graphical**: added a production line (teal/blue/orange machines + conveyor), silos, a delivery truck at the door, a forklift, pallets and trees, plus soft floor shadows and a warmer palette — still no numbers/KPIs.
- **Production floor plan is a nicer layout**: building shell with soft shadow, tinted Rosehips zone + zone labels, gradient-filled rounded bays, styled doors — instead of plain grey boxes.
- **Production dashboard now leads with the metrics + graphs**: removed the big quick-actions/weather row from the top; quick links are a small chip strip lower down (Capture · Supervisor Hub · Shift Rosters · Floor Plan).

---

## 2026-06-25 — Alyssa (Sidebar overhaul · about-style Home with isometric factory · dashboard filters · floor plan → Production)

**Navigation & access** — `components/layout/Sidebar.tsx`, `app/(app)/layout.tsx`, `lib/auth/departments.ts`, `lib/auth/roleHome.ts`, `app/(app)/dashboard/page.tsx`
- **Command Centre removed.** `/dashboard` now redirects to `/home`; all post-login defaults and guard fall-throughs point to `/home`.
- **Sidebar reordered** to Production → Operations → Quality → Maintenance → Sales → Marketing → Logistics → Management → Workspace → AXIS → Admin (Settings, Users & Roles last).
- **Home** pulled out of Operations into a standalone item at the top.
- **Shift Rosters** is now its own Operations page (universal/always-open), next to Bag Tracking; **Bag Tracking** opened to Production + Quality.
- **Floor Plan** added to the Production hub (`ProductionTabs` is now Dashboard + Floor Plan); the old Analytics and Planning hub tabs were removed (Analytics folded into the dashboard; roster moved to Operations).

**Home page** — `app/(app)/home/page.tsx`, `components/home/HomeIsometric.tsx` (new), `public/iso-cargo-bg.avif` (new)
- Rebuilt as an app-style **about page**: full-page isometric cargo backdrop (low opacity) with frosted-glass cards — greeting, About us, company links (website rich preview + branded Facebook/Instagram), help. Quick links removed.
- New **pretty isometric drawing of the factory** (`HomeIsometric`), generated from the real bay layout but deliberately showing no numbers/KPIs — just an illustration (with a delivery truck + pallets).

**Floor plan → Production** — `components/production/FactoryFloorPlan.tsx` (moved from `components/home/`), `app/(app)/production/floor-plan/page.tsx` (new)
- The accurate, **dimensioned** civil floor plan (bays to scale, capacities, live activity, ~126 m × 47 m footprint) now lives under Production → Floor Plan.

**Production dashboard** — `components/production/ProductionDashboard.tsx`, `app/(app)/production/{operations,roster,staff}/page.tsx`
- **Filterable**: trend window selector (7 / 14 / 30 days). **Colour-coded** KPI cards (accent border + tinted value per tone). **Analytics folded in** via the existing `OperationalTrends` (yield · count reliability · inventory velocity). **Section status moved to the very bottom**, as requested.

**Deferred (next):** links to quality-in-production by batch number (bigger build), and the OEE/downtime/scrap capture.

---

## 2026-06-25 — Alyssa (Smart factory floor plan on the home page)

**Files changed:**
- `lib/home/floorplan-data.ts` (new) — the real warehouse layout auto-derived from `Stock Floor Plan SdB 15012025.xlsx` (Insurance sheet): 128 storage bays to scale with kg capacities, Rooibos vs Rosehips zones, doors and the Packaging area. Coordinates in cm; regenerate from the sheet if the layout changes.
- `components/home/FactoryFloorPlan.tsx` (new) — interactive SVG of the plan (hover a bay for its capacity), a Rooibos/Rosehips/total capacity summary, and a live activity layer: sections running today and open breakdowns, with breakdown markers placed on the map by zone.
- `app/api/home/overview/route.ts` (new) — service-role ambient feed (so every role sees it): sections active today (from `prod_sessions`) + open breakdowns (from `maintenance.job_cards`). Returns only counts/labels, no sensitive figures.
- `app/(app)/home/page.tsx` — floor plan added as the centrepiece, under the hero.

**Changes:**
- Replaces the old (inaccurate) `WarehouseMap` for the home view with the **accurate** plan straight from the insurance spreadsheet — so it matches the building.
- The map shows what's happening on the floor without exposing detail: which sections are running and where breakdowns are. Because this is a **storage** plan, production-line breakdowns can't be placed exactly — markers sit by zone (approx) and everything is also listed.
- **Per-bay live stock is not wired yet** — there's no bay↔database link (`bag_tags.location` is free text; no bay table). Next step for that is a small admin screen to assign each bay a location; then bays can colour by what's actually stored.

---

## 2026-06-25 — Alyssa (Home page redesign + live Production Dashboard)

**Files changed:**
- `app/(app)/home/page.tsx` — rebuilt as the company landing page: glass hero over the brand photo (`/rooibos-hero.png`), greeting, a live WhatsApp-style rich preview of the company website, branded Facebook/Instagram cards, and quick links
- `app/(app)/production/dashboard/page.tsx` — replaced the blank editable-widget board (no live data) with the new live cockpit
- `components/production/ProductionDashboard.tsx` (new) — production manager's cockpit: live KPIs (output kg, bags, yield %, sections running, sign-offs pending, balance flags, open breakdowns), interactive Recharts (daily output, sessions/day, yield by section, overall yield trend, status pie, output by section), today's section-status table, solar widget, breakdowns affecting production, and the AI analyst
- `components/production/WeatherTile.tsx` (new) — factory weather via Open-Meteo
- `components/maintenance/AiAnalystPanel.tsx` — parameterised endpoints/title/cache key so the same panel serves both the maintenance and production dashboards (defaults unchanged)
- `app/api/weather/route.ts` (new) — Open-Meteo current conditions + 3-day forecast for Blackheath (no API key, no signup)
- `app/api/link-preview/route.ts` (new) — server-side Open Graph fetch for rich link previews, allow-listed to `rooibostea.co.za`
- `app/api/production/dashboard-insights/route.ts` (new) — Gemini production analyst (structured insights), mirrors the maintenance analyst contract
- `app/api/production/ask/route.ts` (new) — Gemini follow-up chat over production aggregates

**Changes:**
- **Home page** is now a true landing page rather than a placeholder: greeting, company links, and the site links rendered as a live rich preview (website) / branded cards (Facebook `@capenatural`, Instagram `@capenatural`). FB/IG use branded cards because those sites serve a login wall to server bots and don't return usable preview metadata.
- **Production dashboard** now pulls live data from the capture tables (`prod_sessions`, `prod_mass_balance`, `bag_tags`) and `maintenance.job_cards`, with interactive charts, an AI analyst, factory weather, and solar.
- **OEE, downtime/stoppages and scrap rate** are intentionally shown as "coming next" — they need machine run-time, stoppage reasons and reject weights that the floor doesn't capture yet (added in a later phase). The smart factory floor plan is also a later phase.

---

## 2026-06-25 — Alyssa (Live capture: one batch card + native keyboard for bag no. / lot-serial)

**Files changed:**
- `app/(app)/production/capture/[section]/page.tsx` (combined batch card; mandatory variant/grade)
- `components/production/capture/BatchKeypadField.tsx` (native keyboard, custom keypad removed)

**Changes:**
- **Variant, grade and the live mass balance are now one card** at the top of the Capture step, so the screen reads as three cards (Batch · Debagging · Bagging) instead of several loose headers. The standalone mass-balance card was folded into this card and appears once material goes in.
- **Variant and grade are now a mandatory, deliberate choice** — they no longer silently default to Export / Conventional. Both show a `Select…` placeholder (amber-outlined until chosen), and the debagging/bagging sections only open once both are set. A variant set by the supervisor at assignment time still pre-fills.
- **Bag no. and lot/serial use the device's native keyboard again** — the custom on-screen keypad modal is gone; the field is a normal input (auto-uppercased so codes read like `S-135`, `G-0353`). The "reuse a previous batch" chips are kept.

---

## 2026-06-25 — Alyssa (Live capture: custom keypad for bag no. / lot-serial)

**Files changed:**
- `components/production/capture/BatchKeypadField.tsx` (new — opens the existing BatchKeypad)
- `components/production/capture/SievingCapture.tsx`, `OutputPicker.tsx` (bag no. / lot / batch use it)

**Changes:**
- **Bag number and lot/serial now open the existing custom keypad** (`components/count/BatchKeypad`) as a centred modal — A–Z, 0–9 and the serial characters. Previously-used batches still show as tappable chips when the field is empty.
- **Weights (nett, spillage, output) stay on the native keyboard** (numbers + comma → stored as a clean decimal), unchanged.

---

## 2026-06-25 — Alyssa (Live capture: revert custom keypad; section-coloured bags; standalone mass balance)

**Files changed:**
- `components/production/capture/CaptureKeypad.tsx` (removed)
- `components/production/capture/SievingCapture.tsx` (native inputs; blue/orange bags; ungrouped tiles)
- `components/production/capture/OutputPicker.tsx` (native weight input)
- `app/(app)/production/capture/[section]/page.tsx` (mass-balance card with scale icon)

**Changes:**
- **Removed the custom keypad** — capture fields use the device's own keyboard again (number fields still accept a comma and store a clean decimal).
- **Bags carry the section colour** — Debagging bulk bags are **blue**, Bagging output bags are **amber/orange**, so each list clearly belongs to the section you tapped. The two section tiles stay separate (not merged into one card).
- **Mass balance is its own block** — a single cohesive card with a **balance/scale icon** showing in / out / variance, sitting under the steps.

---

## 2026-06-25 — Alyssa (Live capture polish: full-screen keypad, grouped balance, bold steps, mandatory fields)

**Files changed:**
- `components/production/capture/CaptureKeypad.tsx` (full-screen + physical-keyboard support)
- `components/production/capture/SievingCapture.tsx` (balance grouped with the tiles; mandatory bag fields)
- `app/(app)/production/capture/[section]/page.tsx` (bold stepper; removed the separate balance strip)

**Changes:**
- **Full-screen keypad** — the capture keypad now fills the screen on tablet/phone with large keys, and is fully usable on a laptop: the **physical keyboard is wired in** (type digits/letters, comma or dot for the decimal, Backspace, Enter/Esc to finish).
- **Balance grouped with the jobs** — the bold Debagging (blue) / Bagging (orange) tiles and the running mass balance now sit in **one card**, so the in/out/variance reads as a single block. Removed the separate balance strip.
- **Bold steps** — the process stepper is bolder and larger (the primary focus of the screen).
- **Mandatory fields** — a bulk bag can't be locked until **bag no., lot and weight** are all filled (it shows what's still missing); output bags already require their fields. Variant and grade are always set per production.

---

## 2026-06-25 — Alyssa (Live capture: on-screen keypad, edit re-lock, focus on steps, operator overview)

**Files changed:**
- `components/production/capture/CaptureKeypad.tsx` (new — on-screen keypad)
- `components/production/capture/SievingCapture.tsx` (keypad fields; Done re-lock for bags + bucket elevator)
- `components/production/capture/OutputPicker.tsx` (keypad for weight)
- `components/production/capture/CaptureOverview.tsx` (operator-readable overview, blue/orange)
- `app/(app)/production/capture/[section]/page.tsx` (steps primary, mass balance secondary; IT-only serials)

**Changes:**
1. **On-screen keypad** — capture fields (nett, spillage, output weight, bag no.) now open a custom keypad instead of the device keyboard: a numeric pad with a **comma decimal** for weights, and an A–Z / 0–9 / `-` / `/` pad for bag numbers. (Lot/serial keeps its type-ahead chips.)
2. **Edit re-locks cleanly** (#4/#5) — an open bulk bag and the bucket elevator each have a **"Done — lock"** button, so after editing a previous bag you can re-secure it directly and carry on, without deleting the bag you were busy with. Forward flow still auto-locks.
3. **Steps are the focus** — the process stepper sits directly under the header; the mass balance is now a slim secondary strip beneath it (quick glance, not the headline).
4. **Operator overview** — the overview now shows what the operator captured in their terms: **bag numbers, lot/batch, weight, variant, grade**, grouped as Debagging (blue) / Bagging (orange). System serials show only for IT.

---

## 2026-06-25 — Alyssa (Live capture: comma decimals, colour-coded jobs, stale handover note)

**Files changed:**
- `components/production/capture/SievingCapture.tsx` (comma→decimal; colour-coded Debagging/Bagging)
- `components/production/capture/OutputPicker.tsx` (weight accepts comma)
- `app/(app)/production/capture/[section]/page.tsx` (comma→decimal; handover-note recency)

**Changes:**
1. **Comma decimals captured correctly** — SA operators type the decimal as a comma (`1200,5`). The weight/spillage fields now accept a comma (text input + decimal keypad), and every captured number is normalised comma→period before parsing, so the **database always stores a clean decimal**.
2. **Debagging vs Bagging colour-coded** — the two job tiles now use two bold, distinct colours (blue = Debagging/in, amber = Bagging/out); the active one fills with its colour, so on a small screen the operator can see at a glance which job they're on.
3. **Stale handover note removed** — the line handover note only shows when it's from a genuinely recent shift (last 7 days). Old seed/demo notes (e.g. the 15 Mar "DEMO-MONTHLY-SEED") no longer persist.

---

## 2026-06-25 — Alyssa (Live capture: no-printer "Complete bag" + checks-first routine)

**Files changed:**
- `lib/production/capture-config.ts` (`LABEL_PRINTING_ENABLED` flag, default off)
- `components/production/capture/OutputPicker.tsx` ("Complete bag" vs "Add & print")
- `components/production/capture/SievingCapture.tsx` (skip print; prominent serial to hand-write)
- `app/(app)/production/capture/[section]/page.tsx` (open on Checks; capture gate; stepper tick)

**Changes:**
- **No printer needed for testing** — capture no longer depends on a label printer. With `LABEL_PRINTING_ENABLED = false`, the output picker reads **"Complete bag"** (no print round-trip — straight back to add the next bag) and each completed bag shows its **serial in bold for hand-writing on the bag**. Flip the flag to `true` when a printer is wired up — no other changes.
- **The system now guides the routine** — a fresh shift **opens on the Checks tab** (start-up) instead of jumping into Capture. The Capture tab leads with a clear **"Start with your machine checks"** gate (strong but overridable — capture is still available below), and the **Checks step in the stepper ticks green once checks are signed**.
- **Lost tags** (design): rather than a manual "reissue" step, the system serial stays canonical and re-findable; when sections are linked, downstream input will be **selected from the upstream bag list** (not retyped), so a lost paper tag is harmless and needs nothing extra to remember.

---

## 2026-06-25 — Alyssa (Live capture: guide non-technical operators — checks progress, auto-secure, timestamps, FT-Conventional)

**Files changed:**
- `components/production/capture/ChecksPanel.tsx` (per-phase progress + per-check status pills)
- `components/production/capture/SievingCapture.tsx` (auto-secure bags, lock bucket elevator, log timestamps)
- `lib/production/capture-config.ts`, `lib/supabase/database.types.ts` (FT-Conventional variant)
- `supabase/migrations/20260623_004_variant_ft_conventional.sql` (new — widen variant CHECK)

**Changes (from observing real operators on the floor):**
1. **Checks now show what's filled in** — each phase (Start-up / Running / Shut-down) shows a progress badge ("2 of 3 done · 1 to fill in") and every check carries a status pill (To fill in / Logged / OK / Flagged), so an operator can see at a glance whether start-up is complete.
2. **Bucket elevator locks per grade** — once the operator finishes the inbound step (moves to Bagging), the bucket-elevator spillage is logged and locked to a read-only summary; it only re-opens via Edit, and a new grade starts fresh.
3. **Fairtrade Conventional** added to the variant list (DB CHECK widened to allow `FT-CON`).
4. **Bag timestamps** — every bulk bag and output bag records and shows the time it was logged (SAST), to reconcile captured-vs-paper.
5. **Auto-secure** — bags secure themselves when finished (output bags on add; bulk bags when the next is added or the operator moves on), instead of needing a manual "secure" tap. Edit/Unlock still available.
- **Run on the DB (staging + prod):** `20260623_004_variant_ft_conventional.sql`.

---

## 2026-06-25 — Alyssa (Login: SSO-only — remove the email/password form)

**Files changed:**
- `app/login/page.tsx` — removed the email/password form, the "or sign in with email" divider, the `handleSubmit` password flow, and the now-unused `loading`/`signIn` wiring; updated footer copy to "Sign in with your @rooibostea.co.za Microsoft account"

**Changes:**
- **Root cause:** users hit `400 (Bad Request)` on `/auth/v1/token?grant_type=password`. `signInWithPassword` only validates a **Supabase-stored** password, but most accounts are SSO-provisioned (Azure-only, via the 2026-06-23 auth reconcile) and have no Supabase password — and Microsoft never exposes its password, so the email/password box can never authenticate a Microsoft user. The form was a dead path producing the errors.
- **Fix:** `/login` is now **Microsoft SSO only** ("Continue with work account"). This is the existing, working production flow: SSO auto-creates the Supabase account on first sign-in, admins then assign a role in `/users` (`shared.app_roles`). Floor-operator PIN login (`/floor`) is unchanged.
- **Still to do on production deploy:** fix `NEXT_PUBLIC_SITE_URL` in production `.env.local` (currently points at the staging host) so the new-user role-assignment email links to production.

---

## 2026-06-25 — Gustav (Lab results: heavy metals Aluminum+Copper, PA tab results, datetime stamps, None detected)

**Files changed:**
- `app/(app)/quality/lab-results/page.tsx`
- `app/api/upload/route.ts`

**Changes:**
- Heavy metals Gemini extraction prompt: now explicitly extracts ALL metals from the COA including Aluminum and Copper (was only extracting Lead, Cadmium, Mercury, Arsenic). Added instruction for "None detected" on ND values.
- PA/TA Final Gemini prompt (`pa_final`): completely revised to return results as an `analytes[]` array instead of flat fields, so actual PA values now appear in the table.
- `lab-results/page.tsx` COLS: added `pa_final` column definition — the PA tab previously had no column definitions so showed an empty table even with data.
- `expandRecord`: added backwards-compatible handler for existing PA records stored in old flat format (`total_pa_eu`, `total_pa_bfr28`, etc.) — converts them to analyte rows on the fly.
- `expandRecord`: null/empty analyte results now display as "None detected" instead of a dash.
- Date columns: all `created_at` timestamps in the lab results tables (main table, export CSV, historical table) now show date **and time** (`dd MMM yyyy HH:mm`) instead of date only.

---

## 2026-06-25 — Gustav (Pasteuriser: avg customer BD in history table + Excel exports)

**Files changed:**
- `app/(app)/quality/pasteuriser/page.tsx`
- `lib/utils/exportExcel.ts`

**Changes:**
- Added "Avg Cust BD" column to the History & Performance table, showing the average customer bulk density across all MB samples for each completed batch.
- Added `Avg Customer BD` to the Daily Averages sheet and Batch Summary sheet in the per-batch Excel export (`exportPasteuriserBatch`).
- Added `Avg Customer BD` to the Batch Summary sheet in the combined historical export (`exportPasteuriserBatches`), with correct number format (integer).

---

## 2026-06-24 — Gustav (maintenance: per-raiser tabs on Job Cards — IT + manager only)

**Files changed:**
- app/(app)/maintenance/job-cards/page.tsx

**Changes:**
- Added a **"By raiser"** panel to the Job Cards view: a tab for each person who has raised job cards (plus an **All** tab with counts). Selecting a tab shows that raiser's summary tiles (Outstanding / Needs input / In progress / Completed) and their cards
- Visible **only to IT (admin view) and the maintenance manager** (`isAdminView || role === 'maintenance_manager'`). Regular raisers still see only their own cards
- Maintenance managers see the panel on their board (above "Awaiting allocation"); IT reaches it via the existing **"view as → Raiser"** switcher

---

## 2026-06-24 — Alyssa (Production Dashboard becomes a hub: Analytics + Planning as tabs)

**Files changed:**
- `components/production/ProductionTabs.tsx` (new) — hub tab bar: Dashboard · Analytics · Planning
- `components/production/WorkforceTabs.tsx` — trimmed to Shift Roster + Staff Directory (Assign moved to Supervisor Hub)
- `app/(app)/production/{dashboard,operations,roster,staff}/page.tsx` — render `ProductionTabs` at the top
- `components/layout/Sidebar.tsx` — removed the "Planning & Analytics" sidebar group

**Changes:**
- The sidebar's **"Planning & Analytics" section is gone**. The Production Dashboard is now a **hub** with three tabs (`ProductionTabs`): **Dashboard** (the editable widgets), **Analytics** (the former "Production Control" / `/production/operations`, management-only), and **Planning** (Shift Roster + Staff Directory).
- **Analytics + Production Control now live inside the Production Dashboard** — reachable as the Analytics tab — since that's the dashboard's purpose.
- **Planning** is a single tab holding only the Shift Roster and Staff Directory; `WorkforceTabs` is its Roster/Staff sub-nav (Assign Sections was removed from it — assignment now lives in the Supervisor Hub).
- Sidebar **Production** group is now just: Production Dashboard · Capture · Stock Count · Supervisor Hub. No routes or permissions changed — Analytics stays management-gated; everything else reachable via the hub tabs.

---

## 2026-06-24 — Alyssa (Energy: history view + daily capture, scheduled by VPS cron)

**Files changed:**
- `app/api/maintenance/energy/route.ts` — live energy route now also upserts the day's totals into `maintenance.energy_daily` on read
- `app/api/maintenance/energy/history/route.ts` (new) — returns stored daily snapshots for the History view
- `app/api/maintenance/energy/capture/route.ts` (new) — secret-guarded, sessionless endpoint that records the day's totals unattended; `Authorization: Bearer <CRON_SECRET>`
- `components/maintenance/EnergyWidget.tsx` — adds the History tab/view
- `components/maintenance/EnergyHistory.tsx` (new) — historical daily grid/solar usage chart
- `lib/maintenance/energy.ts` (new) — shared Home Assistant fetch + `energy_daily` upsert helpers
- `supabase/migrations/20260619_001_energy_daily.sql` (new) — `maintenance.energy_daily` table (one row per SAST day), idempotent

**Changes:**
- **Energy history.** The maintenance Energy widget gains a History view backed by a new `maintenance.energy_daily` table — one row per SAST calendar day of solar / grid / generator / battery kWh, upserted as the live widget is read so it fills through the day.
- **Unattended daily capture.** New `/api/maintenance/energy/capture` endpoint records the day's totals even when nobody opens the dashboard. It takes no user session — it authenticates with a `CRON_SECRET` bearer token and writes via the service-role client.
- **Scheduled by VPS cron, not GitHub Actions.** Gustav's original branch scheduled this with a `.github/workflows/energy-capture.yml` Action, but pushing that file requires the `workflow` OAuth scope (which the deploy token lacks), so the push kept getting rejected. Dropped the workflow file; scheduling is now a VPS crontab entry on the staging host POSTing to the capture endpoint at 23:50 SAST.
- **Deploy notes:** run `20260619_001_energy_daily.sql` in the staging Supabase SQL editor; ensure `CRON_SECRET` and `HOMEASSISTANT_TOKEN` are set in `.env.local` on the VPS.

---

## 2026-06-24 — Alyssa (Declutter the Capture step — clearer Debagging/Bagging split)

**Files changed:**
- `app/(app)/production/capture/[section]/page.tsx` — removed the standalone "Debagging = … / Bagging = …" explainer banner from the Capture step
- `components/production/capture/SievingCapture.tsx` — replaced the thin Debagging/Bagging toggle with two prominent cards (live bag count + kg per side) and a context hint that changes with the active side

**Changes:**
- **Less stacked noise.** The Capture step previously stacked four full-width blocks (handover note, a blue Debagging/Bagging explainer, the checks nudge, the variant selectors) before the actual capture controls. Removed the blue explainer — its content now lives as a one-line contextual hint under the toggle, so there's one less block competing for attention.
- **In-vs-out reads as two clear jobs.** The quiet segmented toggle became two cards. Each shows its live progress — `2 bags · 480.0 kg` — so the split between what goes in and what comes out is the obvious anchor of the step, and operators can see at a glance how much they've logged on each side. The hint reads "What goes into the machine — weigh in each bulk bag." / "What comes out — every bag prints a barcode label." Presentation only; capture logic unchanged.

---

## 2026-06-24 — Alyssa (Capture screen reframed as a process + Overview step)

**Files changed:**
- `app/(app)/production/capture/[section]/page.tsx` — flat tabs replaced by a clickable numbered stepper; Messages moved to a header icon; added the Overview step
- `components/production/capture/CaptureOverview.tsx` (new) — post-capture overview (formerly "Acumatica summary"), rebuilt from the live capture model

**Changes:**
- **Process stepper.** The capture screen's flat tab row (Production · Checks · Cleaning · Sign-off · Messages) now reads as the real-world process the operators follow: **1 Checks → 2 Capture → 3 Cleaning → 4 Overview → 5 Sign-off.** Steps are numbered, the current one is highlighted, earlier ones show a tick, and they stay freely clickable — pure presentation over the existing logic, no behaviour change.
- **Messages out of the flow.** Line chat is no longer a step; it's a message icon in the header band (it isn't a production step).
- **Overview step (formerly Acumatica summary).** New read-only overview built from the live `Production[]` / `SievingData` model rather than the old draft shape. Groups bagging outputs by item + lot + variant with serials and totals, lists debagging inputs, and shows the mass balance — with Copy and Print for Acumatica data entry. It reflects exactly what the autosave already writes (`prod_debagging` / `prod_bagging` / `prod_mass_balance`); no new persistence was added.

---

## 2026-06-24 — Alyssa (Navigation IA cleanup, capture consolidation, Home landing)

**Files changed:**
- `components/layout/Sidebar.tsx` — regrouped nav; Home/Command Centre; renamed Production Control → Analytics; gated Staff Directory
- `app/(app)/home/page.tsx` (new) — general-information / company landing (placeholder)
- `app/(app)/layout.tsx` — `/home` always-open + route title; `/dashboard` titled "Command Centre"
- `app/(app)/production/{section,flow,refining}/page.tsx` — retired → redirect to `/production/capture`
- `app/(app)/production/operations/page.tsx` — renamed heading to "Analytics"; "Testing" badge on Live Capture tab
- `app/(app)/production/live/page.tsx` — "Testing" badge on Live Production header
- `components/supervisor/HubTabs.tsx` — added "Assign" tab (deep-links to section assignment)

**Changes:**
- **Sidebar information architecture.** The Operations group was a flat pile with two identical dashboard icons. Split into three role-gated groups: **Operations** (Home, Command Centre, Bag Tracking), **Production** (Production Dashboard, Capture, Stock Count, Supervisor Hub), and **Planning & Analytics** (Shift Roster, Analytics, Staff Directory). Distinct icons throughout.
- **Home → general information.** New `/home` company-facing landing (greeting, announcements, quick links, resources) as a designed-later placeholder; the sidebar's Home now points here. The old multi-department dashboard (`/dashboard`) is retained and relabelled **Command Centre**. Login-landing routing is unchanged for now (still Command Centre).
- **Capture consolidation.** The legacy capture pages `/production/section`, `/production/flow`, and `/production/refining` are retired and now **redirect to `/production/capture`** — the single capture surface. (Note: the new capture page currently implements Sieving; the other sections show "coming soon" there until rebuilt.)
- **Production Control → Analytics.** Renamed and moved into the Planning & Analytics group. Its barcode **Live Capture** tab — and the `/production/live` Live Production page — now carry a clear **"Testing"** badge (Phase 2, in testing).
- **Assign in the hub.** Added an **Assign** tab to the Supervisor Hub that deep-links to the section-assignment tool; the capture page's own Assign button is unchanged.
- **Staff Directory** is now reachable by department **or** the `can_view_ops_dashboard` permission (permission-gated index).

---

## 2026-06-24 — Alyssa (Quality: retire the public dual-read — qms is the single source)

**Files changed:**
- `app/(app)/quality/{pasteuriser,sieving,granule,lab-results,raw-material,customer-specs}/page.tsx`
- removed `app/api/quality/legacy-pasteuriser/route.ts`, `app/api/quality/legacy-public/route.ts`

**Changes:**
- After the 2026-06-24 production consolidation (all `public` + staging records now in `qms`), every Quality page now reads **`qms` only** — the runtime merge with the `public` schema and the two `legacy-*` service-role routes are removed. No capture/calc logic changed.
- **Sieving** now paginates `qms.sd_runs` (it exceeds the 1000-row default page — 2054 rows) so nothing is silently truncated.
- **Pasteuriser** 📜 Historical toggle is now a qms read instead of a public-schema read.
- **Raw Material** records render correctly now that `qms.quality_records.data_json` is `jsonb` (previously the qms rows had string `data_json` and showed blank; only legacy rendered).
- Depends on the production data work being complete (it is) + the `data_json → jsonb` ALTER (done). Verified: all six pages compile and serve 200; tsc clean.

**Files changed:**
- `lib/utils/exportExcel.ts` (replaced the SheetJS/`xlsx` writer with a lazy-loaded ExcelJS engine)

**Changes:**
- All five Quality exports — pasteuriser batch, pasteuriser archive, granule run, sieving runs, and the lab-results tables — now produce **branded, styled workbooks** instead of plain sheets. Each sheet has: a title block (embedded `logo.png` + "Cape Natural — Operations Platform" + a context subtitle + "Generated … (SAST)"), a brand-green frozen header row with **AutoFilter**, banded rows, borders, real number formats (moisture `0.00%`, sieves `0.0%`, BD `0`), and **spec-aware conditional fills** (moisture > 8.5% → red; Pass/Fail/Concession → green/red/amber; violations → red).
- Empty columns (a test that wasn't run for the batch set) are dropped from every sheet; the flat raw sheet stays a clean pivot source.
- **ExcelJS is lazy-loaded** (`await import('exceljs')`) inside the export path, so it never enters the main bundle — it only downloads when a user clicks Export. The `exceljs` dependency was already in `package.json`.
- No capture/calculation logic changed — this is presentation only. The previous `xlsx` writer (`addSheet`/`dl`) and its import were removed; `xlsx` is still used elsewhere for reading uploads (`admin/inventory-import`).
- Builds on the earlier Quality work already on staging (per-day average view, sortable History, lab CSV→Excel, Gap-A record fix).

---

## 2026-06-23 — Alyssa (tsconfig: include .next-build types for zero-downtime deploy)

**Files changed:**
- `tsconfig.json` (added `.next-build/types` + `.next-build/dev/types` to `include`)

**Changes:**
- The zero-downtime staging deploy (`scripts/staging-deploy.sh`, #149) builds into a side dir via `NEXT_DIST_DIR=.next-build`, so Next emits its route-type validator under `.next-build/types`. `tsconfig.json` only included `.next/types`, so the side-dir build's generated types weren't covered. Added the `.next-build/*` include globs (harmless no-ops for normal `.next` builds). Previously applied as an untracked manual edit on the VPS; now tracked so it survives `git pull`.

---

## 2026-06-23 — Alyssa (Workforce sub-nav + drop tablet-login messaging)

**Files changed:**
- `components/production/WorkforceTabs.tsx` (new — shared sub-nav)
- `app/(app)/production/roster/page.tsx`, `app/(app)/production/staff/page.tsx`, `app/(app)/production/capture/assign/page.tsx` (render the tabs; autofill copy cleanup)

**Changes:**
- **Easy navigation** — added a shared **Workforce** tab bar (Shift Roster · Staff Directory · Assign Sections) across all three pages, so the people/roster screens are one click apart (mirrors the Supervisor Hub tabs).
- **Dropped the "tablet login" friction** from the autofill — "Fill from roster" no longer mentions PINs/tablet logins or counts "skipped" people; it simply reports how many it filled. Assign subtitle reworded to point at the Fill-from-roster shortcut.

---

## 2026-06-23 — Alyssa (Roster → Capture autofill + department colour-coding)

**Files changed:**
- `app/(app)/production/capture/assign/page.tsx` (Fill-from-roster + section colour accent)
- `app/(app)/production/roster/page.tsx` (department colour-coded grid)
- `app/(app)/production/staff/page.tsx` (department colour accent on rows)

**Changes:**
- **Roster → Capture autofill** — the "Assign sections" screen has a **Fill from roster** button: it finds the roster period covering the selected date, maps each capture section to its roster role(s) (sieving→Sieving Tower, granule→Granule Operator/Granule, etc.) and capture's 3 shifts onto the roster's 2 (morning+afternoon→day, night→night), and pre-fills each section with the rostered people — resolving each to their Capture operator login (directly or via their employee record). People with no tablet login are skipped and counted. The supervisor reviews and Saves as normal.
- **Department colour-coding** (mirrors the Shift Layout workbook) — the roster grid now shows each department as a coloured band with a colour-matched left accent on its role rows; capture section cards and staff-directory rows carry the same department/section colour accent, so people can distinguish areas at a glance.

---

## 2026-06-23 — Alyssa (Pasteuriser Quality: per-day averages, pivot-ready export, sortable history)

**Files changed:**
- `app/(app)/quality/pasteuriser/page.tsx` (per-production-date average view + sortable History columns + Gap-A fix)
- `lib/utils/exportExcel.ts` (dimension columns + AutoFilter/column widths on every QC export sheet)

**Changes:**
- **Per-production-date averages back on screen** — each expanded batch in the History view has a `Samples | 📅 Per-day avg` toggle. The per-day view groups the batch's samples by production date and shows avg temp / moisture / BD / each sieve fraction + MB/Full counts. Re-requested by Cyril; it had existed in the legacy HerbalQMS UI but only survived in the Excel export. Reuses the **same** reducer as the export's "Daily Averages" sheet, so screen and spreadsheet match exactly. No capture/calculation logic changed.
- **Pivot-ready Excel export** — every raw sheet now carries Batch / Production Date / Product / Grade / Variant / Customer / Result on each sample row (a tidy, flat table for Insert ▸ PivotTable), and a new `addSheet` helper applies an AutoFilter + auto-sized columns to every sheet across pasteuriser, granule and sieving exports.
- **Sortable History table** — History column headers (Batch, Date, Customer, Product, Variant, Samples, Avg Moisture, Avg BD, Result) are now click-to-sort with ▲/▼ indicators.
- **Gap-A fix (records pulling)** — legacy `public`-schema records lacking an inner `data_json.id` are no longer dropped by `parseRec`; they fall back to the DB row id / batch number and now appear in the History table. (Production audit: 44 of 85 legacy pasteuriser records were affected — the legacy PDF lab COAs.)
- **Note:** SheetJS community build can't embed a live PivotTable or freeze panes; the flat raw sheet is the pivot *source* (user clicks Insert ▸ PivotTable once).

---

## 2026-06-23 — Alyssa (Staff Directory admin + leave/availability across roster & capture)

**Files changed:**
- `supabase/migrations/20260623_003_employee_leave.sql` (new — `employee_leave` table + `employee_leave_active` view)
- `app/(app)/production/staff/page.tsx` (new — Staff Directory admin)
- `components/layout/Sidebar.tsx` (added "Staff Directory" nav)
- `app/(app)/production/roster/page.tsx` (leave-aware picker + on-duty flags)
- `app/(app)/production/capture/assign/page.tsx` + `components/production/capture/OperatorPicker.tsx` (leave-aware operator picker)

**Changes:**
- **Staff Directory** (`/production/staff`) — the shared `production.employees` list is now fully editable and filterable in-app, persisting on save: search by name/job-title, filter by department, add/edit a person (name, display name, department, job title, skills, phone, active), and manage **leave/availability** (date-ranged periods: leave/sick/training/other).
- **Leave-aware allocation** — both the Shift Roster picker and the Capture "Assign sections" picker now flag people who are on leave for the relevant date(s) (amber "on leave" markers), so a stand-in can be allocated instead. Roster's "On duty" view also strikes through anyone on leave.
- This is additive — Capture/Maintenance save logic is unchanged; the pickers just surface availability.
- **Run order on the DB:** `20260623_003_employee_leave.sql` (after the `001` directory migration).
- **Next (Phase 3 cont.):** roster → Capture/Maintenance auto-fill; AI suggester + approve + send (PDF/WhatsApp).

---

## 2026-06-23 — Alyssa (Shared staff directory + cross-department roster + "who's on when")

**Files changed:**
- `supabase/migrations/20260623_001_staff_directory.sql` (new — `production.employees` canonical registry)
- `supabase/migrations/20260623_002_roster_june2026.sql` (new — reconcile 75 June people into the directory + prefill all four June weeks)
- `app/(app)/production/roster/page.tsx` (picker now uses the staff directory; added the "On duty" view)

**Changes:**
- Added **`production.employees`** — one company-wide staff directory (name, department, job title, skills/certs, phone, active) that all modules can reference. It's additive: Capture (`production.operators`) and Maintenance (`maintenance.duty_roster`) are unchanged. Every existing operator is backfilled as an employee; `roster_entries` gains an `employee_id` link.
- The June 2026 Shift Layout workbook is imported: **75 distinct people** reconciled into the directory across all departments (37 production, 13 store, 11 QC, 9 cleaning, 4 maintenance, 1 H&S), and **all four June weeks (281 entries)** prefilled, each linked to its employee + operator and tagged with the certs from the sheet.
- The roster page now picks people from the shared directory (search by name or job title; selecting a person auto-fills their known certs), and shows a date-aware **"On duty"** card: for today (SAST) it lists who's on the Day/Night shift grouped by department, with a Day/Night toggle and a "now" marker.
- **Run order on the DB:** `20260623_001_staff_directory.sql` first, then `20260623_002_roster_june2026.sql`.
- **Next (Phase 3):** roster → Capture section assignments and roster → Maintenance duty roster auto-fill; then AI suggester + approve + send (PDF/WhatsApp) + leave tool.

---

## 2026-06-23 — Alyssa (Shift Roster moved into Production area + linked to employees)

**Files changed:**
- `app/(app)/production/roster/page.tsx` (new — relocated from `app/(app)/supervisor/roster/`)
- `lib/production/roster-config.ts` (new — roster roles, categories, skill tags)
- `supabase/migrations/20260622_001_roster.sql` (new — `roster_roles` / `roster_periods` / `roster_entries`, now with `operator_id` FK to `production.operators`)
- `components/layout/Sidebar.tsx` (added "Shift Roster" nav under Operations, Production+Management)

**Changes:**
- The whole-site monthly Shift Roster now lives in the **Production area** (`/production/roster`, manager-owned) instead of the Supervisor Hub, and has its own sidebar entry.
- Roster people are now **linked to real employees** — the person picker searches `production.operators` (the 77-name employee list) and stores `operator_id` alongside the denormalised display name, instead of free-typed names. This is the foundation for the planned AI-suggested roster.
- Migration is additive and idempotent; nothing touches the production-capture `shift_assignments` flow.
- **Next phases (planned, not in this change):** AI-suggested month-ahead roster → manager approve → send out via printable PDF + WhatsApp/SMS; a simple leave/availability tool to feed the AI; offline-resilient capture (IndexedDB queue) + trimming autosave round-trips.

---

## 2026-06-23 — Alyssa (Supervisor Hub: redesigned Overview into a command-centre dashboard)

**Files changed:**
- `app/(app)/supervisor/page.tsx` — full Overview redesign: KPI strip, live shift-lines panel, sign-off queue, 7-day trend charts
- `components/supervisor/HubTabs.tsx` — dropped the Analytics tab; added a shared `HubHeader`
- `app/(app)/supervisor/{timesheets,productions,messages,analytics}/page.tsx` — adopt `HubHeader`
- `app/(app)/supervisor/calendar/page.tsx` — rebuilt on the Day/Night shift model + a click-to-open day review
- `app/(app)/production/capture/[section]/page.tsx` — capture screen now honours a `?tab=` deep-link

**Changes:**
- The Overview was just a few snapshot tiles + module links — it showed neither *what needs action* nor *what's happening right now*, and looked nothing like the app's Analytics tab. Rebuilt it as a proper at-a-glance dashboard using the same recharts / `ChartCard` / design-token vocabulary as `supervisor/analytics`.
- **KPI strip (7 metrics):** Pending sign-off, Operators on shift, Productions today, kg out today, Hours logged, Open breakdowns, Tech on duty. All derived from a single 7-day data pull (sessions + mass balance + confirmed timesheets) plus today's roster.
- **Lines this shift** panel: live status of every section rostered for the current shift — colour badge, operators, kg out so far, and a status pill (Not started / In progress / Awaiting sign-off / Signed off), with an `X/Y signed off` header counter. Each row links into the section; submitted ones deep-link to the Sign-off tab. Empty state links to Assign sections.
- **Needs your sign-off** queue (alongside the lines panel): every `prod_sessions` row in `submitted` status (not date-bound, so older hand-overs can't slip past), oldest first, each a one-tap row deep-linking to the section's Sign-off tab. Count badge in the header; calm "All caught up" state when empty.
- **Last 7 days** trends: kg-bagged-out area chart + hours-worked bar chart (gaps filled with zeros), with a "Full analytics →" link to the Analytics tab.
- To make the sign-off deep-links land correctly, the capture `[section]` page now reads an optional `tab` query param (validated against the known tabs) to set its initial tab — previously it always opened on Production. The signature-based approval flow itself is unchanged.

**Hub tab cleanup (same session):**
- **Removed the Analytics tab** from the hub sub-nav — its kg/day + hours/day trends now live on the Overview. The deeper breakdowns (by-operator, by-section, custom date range) stay on the `/supervisor/analytics` page, reachable via the Overview's "Full analytics →" link, so nothing is lost.
- **Consolidated the per-tab header.** Every tab page previously re-implemented the `Supervisor Hub` title + subtitle + `<HubTabs />` block slightly differently. Extracted a single **`HubHeader`** component (title, contextual subtitle, optional right-aligned action) and adopted it across Overview, Timesheets, Productions, Calendar, Messages, and Analytics — so all tabs are visually identical at the top and easy to follow.

**Calendar redesign (same session):**
- The week grid showed cramped, unreadable chips (`M GA`, `M AL AM AK` — shift letter + operator initials) and clicking a cell jumped straight into the editor. Rebuilt it to be **reviewable**: each day (header or cell) opens a **Day Review modal** showing the full roster — Day/Night shift groups, each section with full operator names and variant/lot, plus the technician on duty — with a per-shift "Edit" button that deep-links to Assign sections. Closes on backdrop click or Escape.
- **Standardised on the Shift Roster's Day/Night model** for cross-app consistency. The calendar previously displayed capture's three sub-shifts (Morning/Afternoon/Night) with bespoke amber/sky/indigo dots that appeared nowhere else. It now folds morning + afternoon → **Day Shift** (07h00–16h00, Sun) and night → **Night Shift** (16h00–01h00, Moon), matching `/production/roster`'s `ROSTER_SHIFTS` and Sun/Moon language. Week-grid cells now show a clean Sun/Moon chip with a head-count per shift instead of initials; the Day view lists each shift's roster in full. Editing still opens the capture Assign screen (which keeps its finer 3-shift control).

---

## 2026-06-23 — Alyssa (Auth reconcile: align prod users & roles to the staging model)

**Files changed:**
- `.github/workflows/db-reconcile.yml` — two new reconcile phases + a read-only auth preview
- `supabase/reconcile/auth_prune_cntp_local.sql` (new) — FK-checked prune of `@cntp.local` placeholders
- `supabase/reconcile/AUTH_RECONCILE_RUNBOOK.md` (new) — run sequence + rollback
- `supabase/reconcile/CONFIRMED` — set to `auth-add-staff`

**Changes:**
- Production auth had only 3 real staff (Alyssa/Gustav/Jan) plus 8 placeholder `@cntp.local` operator/supervisor accounts; staging is the model we want — real staff on Azure work-account SSO (`@rooibostea.co.za`) each with a `shared.app_roles` role, plus `@floor` PIN operators.
- **`auth-add-staff`** (new `MODE=authstaff`): additively copies real-staff `auth.users` + their `auth.identities` (so Azure SSO matches the same account) + their `shared.app_roles` rows from staging → prod, `ON CONFLICT DO NOTHING`. UUIDs preserved so roles bind correctly; the 3 existing accounts are skipped; `@floor` operators untouched. Column lists derived from prod so any auth-schema drift aborts cleanly instead of misaligning.
- **`auth-prune-cntp-local`** (new, via `MODE=sqlfile`): deletes `@cntp.local` accounts only when no real data table references them; referenced accounts are kept and logged. Prints a KEEP/DELETE report before any delete. Single transaction.
- Read-only **Auth reconcile preview** step on `reconcile/diff` lists the staff to be copied and the `@cntp.local` accounts + their references, for review before applying.
- Both phases run through the existing backup-first, double-gated DB Reconcile action. Azure provider already enabled on the prod project (prerequisite).

**Result (applied to prod 2026-06-23):**
- Phase A: **12 staff added** (15 staging staff minus the 3 already present), 12 Azure identities, 10 app_roles rows. Prod now has all 15 `@rooibostea.co.za` staff with their staging roles. (Jan kept his existing prod role `co_developer` rather than staging's `bis_manager` — additive copy does not overwrite existing accounts.)
- Phase B: of the 8 `@cntp.local` placeholders, **7 deleted** (no production data), **1 kept** (`blender@cntp.local`, referenced by `production.scan_events`). Final prod auth = 16 users.
- Two iterations were needed on the copy logic: (1) prod's `shared.app_roles` has `updated_at` (bucket2) that staging lacks → switched to the staging/prod column **intersection**; (2) `auth.users.confirmed_at` is a **generated** column → excluded generated/identity columns. All failures rolled back cleanly (atomic txn) — no partial writes.
- Discovered a **second roles table** `production.app_roles` (separate from `shared.app_roles`); the prune treats both as the account's own record.

---

## 2026-06-22 — Alyssa (Alara Signal Engine: Gemini multi-model conversion + scraper hardening)

**Files changed:**
- `research-engine/n8n/cntp-signal-engine.json` — corrected + re-architected workflow
- `supabase/migrations/20260622_003_signals_dedup.sql` (new) — DB-enforced dedup backstop

**Changes (n8n workflow):**
- **Removed the remote-PC dependency.** Tier 1 was Ollama (`alara-engine`) on a remote PC over Tailscale; a full run fired ~940 inferences at it and twice froze the machine (RDP `0x204`). Tier 1 now runs on **`gemini-2.5-flash-lite`** (cloud) via the existing CNTP Gemini credential — same Alara persona/scoring prompt, parse node updated to read Gemini's response shape. The engine is now VPS + cloud only; nothing local to crash.
- **Multi-model tiering, deliberately off `2.5-flash`** (which the app uses heavily — separate per-model quota buckets avoid contention): Tier 1 = `gemini-2.5-flash-lite` (cheap bulk, all new items), Tier 2 deep = `gemini-2.0-flash`. Future: Tier 3 `gemini-2.5-pro`, vision `gemini-3.1-flash-lite`, dedup `gemini-embedding-001`. A separate API key/GCP project for the scraper is the recommended next isolation step.
- **Loophole-aware escalation:** Score Filter now escalates to the Tier-2 deep pass on `relevance_score >= 7` **OR** `intelligence_type` in (loophole, switching_signal, competitor_intel, threat) — moderate-score competitor/loophole signals still get full analysis. All scores are still saved (no relevance gate — low scores are leads).
- **Throttle node** (`max new/run`, enabled, 25) caps items per run — protects against floods and bounds Gemini spend; tune upward as proven safe.
- **Per-workflow timezone** `Africa/Johannesburg` + trigger at **03:00 SAST** (n8n instance clock was New York).
- `raw_content` capped at 2k chars on both save paths.
- **Fixed the real "nothing saves" cause:** `sales.signals.classification` has a CHECK constraint (`signals_classification_check`) allowing only opportunity/threat/competitor/regulation/relationship/neutral, but Tier 1 was writing the richer `intelligence_type` vocabulary (loophole/market_gap/switching_signal/…) → every insert rejected. Both save paths now map `intelligence_type` → an allowed `classification` and preserve the fine-grained type in `intel`.
- **Fixed all-false-branch:** old Tier-1 parser couldn't read the Gemini node's output nesting → every item scored 0. Replaced with a deep-scan extractor (also applied to the Tier-2 parser); added a `_raw` debug field.

**Changes (database):**
- `20260622_003_signals_dedup.sql` — dedup is already enforced by the pre-existing `signals_source_url_unique` constraint; the earlier draft's unique title index was redundant and fails on real data (distinct articles sharing a title prefix), so it is NOT created.

**VPS:**
- Found n8n already runs persistently as user `ubuntu` (25-day uptime) — it does **not** die when PuTTY closes; PuTTY only provides the tunnel to the editor. The `pm2`-under-`cntpdev` attempt would have spun up a broken empty duplicate on a clashing port; cleaned up, `cntpdev` pm2 now runs only the two apps.

---

## 2026-06-22 — Alyssa (Alara Signal Engine: structured-intelligence columns)

**Files changed:**
- `supabase/migrations/20260622_002_signals_intel_columns.sql` (new) — adds `sales_angle`, `urgency`, `tier`, `intel jsonb` to `sales.signals`
- `components/intelligence/types.ts` — `Signal` gains `sales_angle`/`urgency`/`tier`/`intel`; new `Urgency` type
- `components/intelligence/helpers.ts` — new `urgencyStyle()` palette helper
- `app/api/signals/route.ts` — GET select now returns the new columns
- `app/api/pipeline/ingest/route.ts` — `IngestPayload` accepts + sanitises the new fields (urgency whitelisted, intel object-guarded)
- `components/intelligence/SignalCard.tsx` — urgency badge + recommended-action line
- `components/intelligence/SignalDrawer.tsx` — urgency badge, Tier chip, "Recommended action" section

**Changes:**
- The live Alara pipeline ("CNTP Signal Engine" — Ollama Tier 1 → Gemini Tier 2) was writing `sales_angle`/`urgency`/`tier` as top-level columns that did not exist on `sales.signals` (insert failed: *"Could not find the 'sales_angle' column … in the schema cache"*), and overloading `sections` (the app's `text[]` tab tags) with a JSON object. Added the missing columns plus a catch-all `intel jsonb`; `sections` is left to the app and the pipeline now writes its structured extras (target_segment, competitor_mentioned, full Tier-2 analysis) to `intel`.
- Surfaced `sales_angle` ("one concrete action for CNTP") and `urgency` in the Signal feed + drawer so the per-signal next action is visible.
- DB note: `sales` is a prod-only schema; the ALTER is run manually in the Supabase SQL editor on the project the pipeline writes to (not via `db-migrate.yml`). Additive + nullable only.

---

## 2026-06-22 — Alyssa (DB reconcile Phase 1: rebuild production qms to match staging)

**Files changed:**
- `.github/workflows/db-reconcile.yml` (new) — one-time, push-triggered (`reconcile/diff` / `reconcile/apply`), gated
- `supabase/reconcile/CONFIRMED` (new) — apply confirmation marker

**Changes (production database):**
- Discovery via read-only diff: staging and production had **diverged in different directions** (staging ahead on qms/maintenance/acumatica; production ahead on fields ~1.38M rows/sales/logistics/marketing/public). The `qms` module was *redesigned* on staging (split sieve columns, `id` integer→bigint, `created_by` uuid→text, no FKs). So "make prod match staging" wholesale was rejected as destructive; scoped to a surgical, module-by-module reconciliation starting with qms.
- **Phase 1 applied to production**: rebuilt prod `qms` to staging's design — `DROP SCHEMA qms CASCADE` + staging qms DDL + staging qms data, in one `--single-transaction`. Production backed up to the VPS first (`/home/cntpdev/apps/backups`). Verified prod `qms` == staging `qms` (39 tables, identical row counts). Production `public.*` quality data left intact; the dropped prod qms was only the redundant old service-role copy (also in backup).
- Ran entirely via gated GitHub Actions; DB passwords live only in GitHub secrets.
- **Bucket 1 applied to production**: added `maintenance` (24 tables) and `acumatica` (3 tables) from staging — purely additive (prod had neither schema), counts match staging, no existing prod data touched. Backed up first; atomic.
- Decisions for remaining work: prod's `production`/`axis`/`shared` data is real → align those **additively only** (preserve prod data); prod-only `fields`/`sales`/`logistics`/`marketing` left as-is; the old `public.*` JSON-blob quality data will be retired (not merged — blob format breaks the Acumatica push).
- **Bucket 2 applied to production** (additive, atomic): created 15 missing `production` tables + `shared.dashboard_layouts` (structure only) and added 50 staging-only columns across existing tables (`shared.app_roles`, `axis.tickets`, `production.prod_sessions`/`bag_tags`/`inventory_items`/etc.) — all nullable, `IF NOT EXISTS`. Also created `production.set_updated_at()` trigger fn (absent in prod). Existing prod data fully preserved (verified: inventory_items 554, prod_sessions 25, scan_events 125, sc_entries 210, shared.audit_log 776). SQL: `supabase/reconcile/bucket2_add_columns.sql`.
- **Database structure alignment now complete** (qms, maintenance, acumatica, production, axis, shared, workspace).
- **Production app deployed (internal)**: cloned repo to `/home/cntpdev/apps/production/app/cntp-ops`, created prod `.env.local` (→ production Supabase), built, and started under pm2 as `cntp-production` on port 3001. Local health check HTTP 200. Docs: `docs/production-deploy.md`.
- **Remaining to go live**: Compunique must repoint the `cntpplatform` nginx site from static-file serving to `proxy_pass http://localhost:3001` (needs root; SSL already configured). Plus: fast-forward `main` to `staging` to make `main` the production branch (deferred — must neutralize the not-yet-ready `db-migrate.yml` auto-push first). Deferred: retire old `public.*` blob quality tables.

---

## 2026-06-21 — Alyssa (DB promotion flow: staging→prod migrations + nightly data refresh)

**Files changed:**
- `.github/workflows/db-migrate.yml` (new)
- `.github/workflows/staging-data-refresh.yml` (new)
- `docs/db-reconciliation-runbook.md` (new)

**Changes:**
- Groundwork to clean up the production Supabase DB (`sxzjjcyuzyfneesnsjna`) to match staging (`qjqkpockmujecjgmdple`), which is the source of truth (full `qms` schema, users, roles). The repo migrations had drifted (mostly `public`; `qms` was built directly on staging), so staging's live DB — not the repo — is the real source of truth.
- Established a **"schema up, data down"** flow:
  - `db-migrate.yml` — applies `supabase/migrations` via `supabase db push` on merge: `staging` branch → staging DB, `main` branch → production DB. DB passwords held as GitHub Actions secrets (`STAGING_DB_URL`, `PRODUCTION_DB_URL`, `SUPABASE_ACCESS_TOKEN`).
  - `staging-data-refresh.yml` — nightly (01:00 UTC / 03:00 SAST) + manual job that copies `qms` data prod → staging (truncate + `pg_restore`), so staging tests against recent real data. Read-only on production; the app remains the single writer of prod data.
- `docs/db-reconciliation-runbook.md` — one-time reconciliation steps (backups → diff → capture staging baseline → review → apply to prod → verify → enable automation). All password-bearing steps are run locally by the developer; secrets never enter the repo.
- No database changes executed yet — these are the workflow/runbook scaffolding. The destructive prod cleanup is gated behind backups and explicit review.

---

## 2026-06-19 — Gustav (maintenance: "Energy Today" widget — Home Assistant solar/grid/battery)

**Files changed:**
- app/api/maintenance/energy/route.ts (new)
- components/maintenance/EnergyWidget.tsx (new)
- app/(app)/maintenance/page.tsx

**Changes:**
- New **Energy Today** card on the Maintenance dashboard (rendered above the analytics). Shows today's solar / grid / generator / battery kWh pulled from Home Assistant, plus hourly Electricity Usage and Solar Production charts (Recharts) and a Sources breakdown table
- New `/api/maintenance/energy` route fetches today's daily-total sensors and best-effort hourly power history from HA, bucketing power into per-hour kWh (SAST day window). Auth-gated via `getCallerPermissions`
- Reads the `HOMEASSISTANT_TOKEN` env var server-side; entity IDs default to the CNTP inverter config and are overridable via `HA_ENTITY_*` env vars. Without the token the widget shows a "Home Assistant not connected" setup prompt
- Note: the `HOMEASSISTANT_TOKEN` env var must be set on the VPS for live data

---

## 2026-06-19 — Gustav (Export Excel button in history rows + remove Sensorial tab)

**Files changed:**
- `app/(app)/quality/pasteuriser/page.tsx`

**Changes:**
- Added an "⬇ Excel" export button directly in each completed-batch row of the History & Performance table, so the export is always visible without needing to expand the row. The button stops row-click propagation so it doesn't accidentally toggle expansion.
- Removed the "🍵 Sensorial Table" tab from the top tab bar — the sensorial data is still captured per-sample inside the Run Dashboard but the separate stand-alone table tab has been removed as it was not in use.

---

## 2026-06-19 — Gustav (export pasteuriser historical runs to Excel)

**Files changed:**
- `app/(app)/quality/pasteuriser/page.tsx`
- `lib/utils/exportExcel.ts`

**Changes:**
- The pasteuriser "📜 Historical — public schema" archive table previously had no export option. Added a per-row "⬇ Excel" button (exports a single historical batch) and an "⬇ Export All" button that produces one combined workbook for every historical record.
- New `exportPasteuriserBatches()` helper builds the combined workbook with an "All Raw Samples" sheet (every sample across all batches) plus a per-batch "Batch Summary" sheet for pivots.
- Note: Granule Line and Sieving Tower already merge legacy/historical runs into their main run lists, so those historical runs were already exportable via the existing buttons.

---

## 2026-06-19 — Gustav (Excel export + duplicate batch prevention across QC workcenters)

**Files changed:**
- `lib/utils/exportExcel.ts` (new)
- `app/(app)/quality/pasteuriser/page.tsx`
- `app/(app)/quality/granule/page.tsx`
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- New shared export utility `lib/utils/exportExcel.ts` generates multi-sheet `.xlsx` workbooks using the existing `xlsx` library.
- **Pasteuriser**: "⬇ Export Excel" button on each active batch header and each expanded history row. Exports 3 sheets — Raw Data (all samples with every measurement), Daily Averages (grouped by date), and Batch Summary (metadata + overall averages).
- **Granule Line**: "⬇ Excel" button on active run cards and history rows. Same 3-sheet structure — Raw Data, Daily Averages, Run Summary.
- **Sieving Tower**: "⬇ Export CSV" replaced with "⬇ Export Excel" — now exports Raw Data, Daily Averages, and a By Grade/Variant summary sheet.
- **Duplicate batch prevention (Pasteuriser)**: `createBatch` now checks for an existing run with the same batch number. If one is open, QC is told to add a sample to the existing run. If it's already finalised, they're told to use a different batch number.
- **Duplicate batch prevention (Granule Line)**: Same logic in `handleCreateRun` — blocks creation and redirects to the open run if one exists.

---

## 2026-06-19 — Alyssa (operators admin: auto codes, auto display name, simpler form)

**Files changed:**
- `lib/production/operator-auth.ts`
- `app/api/production/operators/route.ts`
- `app/(app)/production/operators/page.tsx`
- `supabase/migrations/20260619_002_operator_codes_displaynames.sql` (new)

**Changes:**
- **Operator codes are now assigned automatically** (sequential `OP001`, `OP002`, …) on create and when a legacy operator without one is edited; the manual code field is gone. The migration backfills codes for existing operators (continuing past the highest existing number).
- **Display name defaults to the full name** — the display-name field is removed; the migration backfills `display_name = name` where blank.
- **Simpler operators form** — just Full name, PIN, Allowed sections, Active. The role toggle is removed: this page is for **floor operators** only. A note points supervisors to **Users & Roles** (Production → Production Supervisor), where they sign up with their work email and get a real account/role.
- **List polish:** each row shows its code chip and a **"No PIN"** flag for operators that still need a PIN before they can sign in (e.g. the imported roster). Account + `floor_operator` app-role provisioning is unchanged (already handled by the operators API).

---

## 2026-06-19 — Alyssa (tablet device binding for section/supervisor testing)

**Files changed:**
- `lib/production/device.ts` (new)
- `app/(app)/production/device/page.tsx` (new)
- `app/(app)/production/capture/page.tsx`
- `app/(app)/production/capture/[section]/page.tsx`
- `components/production/capture/ChecksPanel.tsx`
- `components/production/capture/CleaningPanel.tsx`

**Changes:**
- **Per-tablet device binding** (localStorage, no backend) — a "This tablet" setup screen (`/production/device`) binds a device to a **section (machine)** or to the **Supervisor**, not to a person. A section-bound tablet opens straight to that section's capture on launch (once per launch, so the back button still works); a supervisor-bound tablet lands on the capture/assign home. A "This tablet: …" chip in the capture header shows the binding and links to change/reset it.
- **Sign-off identifies the operator by PIN:** because a tablet is bound to a machine (not a person), the Checks and Cleaning sign-offs now resolve the signer from the entered PIN against the section's rostered operators (PIN still required — audit intact). A person-logged-in tablet still attributes live events to that single operator.

---

## 2026-06-19 — Alyssa (smart cleaning: frequency-aware, photo-verify, AI summary)

**Files changed:**
- `supabase/migrations/20260619_001_cleaning_smart.sql` (new)
- `app/api/production/verify-clean/route.ts` (new)
- `app/api/production/check-summary/route.ts`
- `lib/production/cleaning-config.ts`
- `components/production/capture/CleaningPanel.tsx`

**Changes:**
- **Frequency-aware surfacing:** weekly/monthly cleaning tasks now appear in the actionable list **only when due** (tracked in new `production.cleaning_task_state`); not-due tasks show a muted "next due …" line so nothing is hidden silently. Daily tasks always show. Cuts clutter and the risk of confirming a task that wasn't actually performed.
- **Photo-verify evidence (Gemini vision):** each cleaning area has a "Verify" camera action — the operator snaps the cleaned equipment and `verify-clean` returns a clean/not-clean verdict + note, recorded in the append-only `cleaning_logs` trail (`photo` action). The image itself is not stored.
- **AI cleaning summary** at sign-off: a concise hygiene summary is generated (reuses `check-summary` with `kind: 'cleaning'`) and stored in `cleaning_records.ai_summary` for supervisor review.
- All additive — the existing exception-based flow, PIN sign-off, and supervisor verification are unchanged.

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
