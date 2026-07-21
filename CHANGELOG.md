# Changelog

All changes deployed to staging are logged here automatically.  
Format: date · developer · files changed · description of code changes.

---

## 2026-07-21 — Alyssa (PRODUCTION: fixed floor "on shift" list vs roster, and Microsoft silent auto-login on shared devices)

**Promoted to production from staging PR [#416](https://github.com/Alyssa-CNTP/CNTP-Platform/pull/416) — login fix only, cherry-picked onto `main` (the other 8 commits ahead on `staging` at this time — print-relay agent, maintenance pop-ups/filters, calibration work — were intentionally left off this promotion; they'll go to prod separately once their DB migrations are confirmed on the production Supabase project).**

**Files changed:** `app/api/floor/operators/route.ts`, `app/login/page.tsx`

- **Fixed operators not showing "On shift" correctly on the floor login.** The `/api/floor/operators` route resolved today's date and the current day/night shift from `new Date().getHours()` / `.toISOString()` — i.e. the **server's** timezone. The VPS runs in UTC (no `TZ` set for the app process), so the shift boundary — and the date around midnight — landed two hours off SAST, making the on-shift list disagree with the published roster (day-shift people showing before 09:00, etc.). Replaced with a SAST-aware `sastNow()` helper (`Intl.DateTimeFormat` with `timeZone: 'Africa/Johannesburg'`), mirroring the roster page's own `sastNow()` / "On duty" logic so both read the roster identically.
- **Stopped Microsoft silently auto-logging the previous person back in on a shared browser.** The Azure OAuth call had no `prompt` param, so Azure re-used its cached SSO session and signed the last user straight back in ("storing cache and logging people in automatically"). Added `queryParams: { prompt: 'select_account' }` to `signInWithOAuth`, forcing the account picker every time so the next user must choose/confirm their own account. (Inactivity auto-logout — 60 min, in `app/(app)/layout.tsx` — left unchanged, as intended.)
- **No database migration required** — pure application code change.

---

## 2026-07-20 — Alyssa (VPS ops: fixed staging crash-loop, reclaimed disk, added weekly self-cleaning maintenance cron) — ⚠️ IMPORTANT, DO NOT REMOVE

**Ops change (no application code changed).** Files added on the VPS (`cntpdev@154.65.97.200:2022`), not in the repo: `/home/cntpdev/scripts/vps-maintenance.sh` (new), a new weekly entry in `cntpdev`'s crontab, `/home/cntpdev/logs/maintenance.log` (new).

**Why this matters:** the staging server ran out of disk (`/dev/vda1` hit **85%**), which had already caused a "No space left on device" failure (syslog, Jun 01) and left `cntp-staging` **crash-looping — 2552 PM2 restarts** with `Error: Cannot find module '.next/server/middleware-manifest.json'` (corrupt/incomplete `.next` build). Root cause of the disk pressure: VS Code Remote-SSH downloads a fresh ~590 MB server binary to `~/.vscode-server/cli/servers/` on every client update and **never deletes the old ones** — 5 stale copies had piled up to 2.9 GB.

**What was done (all on the VPS via SSH/PuTTY, nothing merged/deployed):**
- **Fixed the crash-loop:** `pm2 stop cntp-staging` → `rm -rf .next` → `npm run build` (full clean rebuild) → `pm2 restart cntp-staging` → `pm2 save`. Restart counter froze at 2552 (loop stopped); app confirmed stable — `curl localhost:3000` → **HTTP 200**, public `https://cntpplatform-staging.rooibostea.co.za` → **HTTP/2 200**.
- **Reclaimed disk 85% → 70%** (5.6 GB free): deleted the 4 stale VS Code server binaries (kept only the in-use hash `Stable-fc3def…5573f`), `npm cache clean --force`, `pm2 flush`.
- **Added a weekly self-cleaning maintenance job** so this can't recur: `~/scripts/vps-maintenance.sh` prunes stale VS Code servers (identifies live ones via `pgrep` and **never deletes the server currently in use**), clears the npm cache, and flushes PM2 logs. Scheduled in crontab: `0 3 * * 0` (Sundays 03:00), logging to `~/logs/maintenance.log`. Test-run confirmed it keeps the active server and reports disk state.

**If disk pressure returns:** check `df -h /` and `du -h -d1 ~/.vscode-server/cli/servers`; the maintenance script can be run on demand with `~/scripts/vps-maintenance.sh`. Do not delete a VS Code server hash that appears in a running process (the script guards this automatically).

---

## 2026-07-17 — Alyssa (AXIS: ticket assignment bug fix, real assignee routing, Submit Request 4-way redesign, GitHub-backed changelog)

**Files changed:** `app/(app)/axis/tickets/page.tsx`, `app/(app)/axis/request/page.tsx`, `app/(app)/axis/page.tsx`, `app/(app)/axis/consideration/page.tsx`, `app/(app)/axis/changelog/page.tsx`, `app/api/axis/tickets/route.ts`, `app/api/axis/tickets/[id]/route.ts`, `app/api/axis/requests/route.ts`, `app/api/axis/requests/[id]/approve/route.ts`, `app/api/axis/requests/[id]/reject/route.ts`, `app/api/axis/users/route.ts`, `app/api/axis/projects/route.ts`, `app/api/axis/changelog/github/route.ts` (new), `components/layout/Sidebar.tsx`, `lib/notifications/recipients.ts`, `lib/production/it-ticket.ts`, `lib/github/client.ts` (new), `.env.example`, `supabase/migrations/20260717_010_axis_tickets_routing_redesign.sql` (new), `supabase/migrations/20260717_011_axis_projects_backfill_prj001_004.sql` (new), `supabase/migrations/20260717_012_axis_project_requests_redesign.sql` (new), `supabase/migrations/20260717_013_axis_change_logs_github.sql` (new)

- **Fixed ticket status buttons not working**: the permission check never considered whether the viewer was the ticket's own assignee, only IT/`can_assign_tickets` — anyone else's assigned ticket showed a read-only badge with no way to update it. Both the client gate and the server PATCH gate now include an `isMyTicket` check.
- **Fixed the Tickets nav link being invisible** to eligible non-IT managers (e.g. `maintenance_manager`) — the Sidebar's `itOnly` flag ignored `can_assign_tickets` entirely; that entry now gates on department OR permission like the rest of the app.
- **Removed all hardcoded ticket auto-routing** (three separate copies of `'Alyssa'/'Jan'/'Gustav'` name-matching). Tickets are now created unassigned; IT/managers pick the assignee from a real picker populated dynamically from whoever currently holds ticket-management rights — no hardcoded names, doesn't break when roles change.
- **Consolidated AXIS notifications onto the shared `notify()` system** (ticket assignment, request approved, request rejected) instead of raw inserts — gains email delivery and respects each user's notification preferences. Stopped writing to the dead `axis.ticket_notifications` table (written in 3 places, read nowhere).
- **Fixed the Consideration board missing major projects**: removed the "New Project" dashboard shortcut that bypassed the request→approve flow entirely (projects created there had no linked request and never showed up on the board). All new projects now go through Submit Request → Consideration board → Approve. Backfilled PRJ-001–004 (real historical projects that only ever existed as OneDrive folders) as `status: 'historical'` records so AXIS has a complete project ledger.
- **Redesigned Submit Request into 4 types**: "Changes to current/new feature" (page/module picker derived from the real Sidebar nav, description, why-necessary, priority) and "Suggestions" (now truly anonymous — submitter identity is never stored, only department for context) both route to Tickets; "Major Project Request" (renamed from the old catch-all) and "Code Contribution" both route to the Consideration board. Removed the duplicate-record pattern where every submission also silently created a ticket.
- **Added an automatic GitHub-backed feed to the Changelog**: merged PRs into `staging` are ingested into the same `axis.change_logs` table as manual entries (`source: 'github'`), shown with author avatar, a linked PR badge, and a diff-stat chip — one unified timeline instead of a purely hand-typed log.
- Flagged separately to the user: a live GitHub token found committed in plaintext in `QUALITY_MIGRATION_NOTES.md` needs to be revoked — unrelated to this change, not touched by it.
- **Migrations must be run manually** (Supabase SQL editor, staging then production) per this repo's established practice — `db-migrate.yml`'s auto-apply is deliberately disabled.

---

## 2026-07-20 — Gustav (EU MRL: real export parser + upload refresh path, loaded 516 Rooibos MRLs)

**Files changed:** `lib/quality/eu-mrl.ts`, `app/api/eu-mrl-sync/run/route.ts`, `app/api/eu-mrl-sync/upload/route.ts` (new), `app/(app)/quality/raw-material/page.tsx`

- Handled the **real** EU export format. The official "Export_Pesticide_residue_CurrentMRL.xlsx" has 6 preamble rows, a `Selected Product: 0632020 - Rooibos` line, then a 3-column table (`Pesticide Id | Pesticide residue | Maximum residue level (mg/kg)`, values like `0.01*`). Added `parseEuMrlWorkbook()` / `toEuMrlPayload()` that skip the preamble, auto-detect the header row, read the product code from the file, and parse ~516 substances.
- **Added the reliable refresh mechanism: file upload.** The EU export is a session-based download with no stable auto-download URL, so refreshing = re-export from the EU site and upload. New route `POST /api/eu-mrl-sync/upload` (multipart) parses the file and replaces that commodity's MRL set. New **"⬆️ Upload EU MRL file"** button on the Raw Material → Residue tab.
- Refactored `POST /api/eu-mrl-sync/run` (URL/cron path) to use the same shared parser, so both paths behave identically.
- **Loaded the current Rooibos MRLs (516 substances, product 0632020) into the staging `qms.eu_mrl` table** from the supplied EU export, so grading works immediately. Values verified (e.g. Glyphosate 2, Difenoconazole 20, Chlorpyrifos 0.01 mg/kg).
- **How updates work going forward:** click "⬆️ Upload EU MRL file" with a fresh EU export whenever the EU revises MRLs (a few times a year), then "🔄 Re-enrich MRLs" to re-grade existing records. Production `qms.eu_mrl` needs the same load when promoted.

---

## 2026-07-20 — Gustav (EU MRL sync: residue grades tracked against the live EU database)

**Files changed:** `supabase/migrations/20260720_001_eu_mrl.sql` (new), `lib/quality/eu-mrl.ts` (new), `app/api/eu-mrl-sync/run/route.ts` (new), `.github/workflows/eu-mrl-sync.yml` (new), `app/api/upload/route.ts`, `app/api/admin/re-enrich-residues/route.ts`

- **What this does:** the EU Maximum Residue Level (MRL) for each pesticide is now sourced from the official **EU Pesticides Database** and kept **continuously up to date**, and residue R-grades (R-0…R-3) are computed against those live limits instead of relying solely on the value printed on each lab report.
- New reference table `qms.eu_mrl` (per pesticide × commodity) plus `qms.eu_mrl_sync_log` (one row per sync run, so you can see when it last ran). Rooibos = EU product code `0632020`.
- New route `POST /api/eu-mrl-sync/run` downloads the EU's official bulk MRL export, parses it (xlsx/csv), and upserts into `qms.eu_mrl`. It's called by both the **"🌍 EU MRL Sync"** admin button and the weekly cron.
- New GitHub Actions workflow `eu-mrl-sync.yml` runs the sync **every Monday 05:00 SAST** (continuous updates), same cron pattern as the roster/energy jobs.
- Grading now overlays the synced EU MRLs before computing grades — applied both on **new uploads** (`upload` route) and on **"🔄 Re-enrich MRLs"** (re-grades all existing residue records against the latest EU limits). Each compound is tagged `mrl_source: 'eu_db' | 'lab_report'`.
- **⚠️ VPS setup required (I can't reach the EU servers from the build environment, so this must be verified on the VPS):**
  - Set env var **`EU_MRL_DOWNLOAD_URL`** to the EU MRL export URL for Rooibos (product `0632020`). Optional: `EU_MRL_COMMODITY_CODE` / `EU_MRL_COMMODITY_NAME` to override the default. Until this is set, the sync returns a clear "not configured" message rather than syncing.
  - Ensure `CRON_SECRET` is set (already used by the roster/energy crons) so the weekly workflow can authenticate.
  - Migration applied to **staging** Supabase; production needs it when promoted.

---

## 2026-07-20 — Gustav (Raw Material Residue: fix "API_URL is not defined" + wire Re-enrich MRLs)

**Files changed:** `app/(app)/quality/raw-material/page.tsx`, `app/api/admin/re-enrich-residues/route.ts` (new)

- Fixed the runtime error **"✗ API_URL is not defined"** thrown by the residue-tab admin buttons. Two `fetch()` calls used an undefined `${API_URL}` global (a leftover from the old separate-Express-server era). Changed both to relative `/api/...` paths, consistent with the sibling "Recalculate R-Grades" button and the unified Next.js convention.
- Added the missing backend route `POST /api/admin/re-enrich-residues` that powers the **"🔄 Re-enrich MRLs"** button. It re-runs the same EU MRL → R-grade computation used at upload time over every stored raw-material residue record (`qms.quality_records`, `workflow='residue'`), updates only records whose grades changed, and returns `{ updated, total }`. Gated on `can_save_records`.
- **Note:** the separate "🌍 EU MRL Sync" button (`/api/eu-mrl-sync/run`, which would scrape the official EU Pesticides Database) still has no backend and will 404 — it needs an EU data source before it can be implemented. The "API_URL is not defined" crash on it is fixed regardless.

---

## 2026-07-20 — Gustav (COA Generator: PDF export — centered columns, header field lines)

**Files changed:** `app/(app)/quality/coa/page.tsx`

- PDF export (`exportPdf`): table column text (headers and cell values, across Microbiological Analyses, Cut Length, and Other Analysis) is now centered within its column instead of left-aligned, matching the on-screen preview.
- PDF export now draws the same dashed underline beneath each header field value (Date of Issue, Batch Number, Invoice No., Grade, Destination, Quantity of Bags, Order Number, Production Date, Quantity (Kg's), Best Before Date) that already appears in the on-screen COA, so the printed certificate matches the preview layout.

---

## 2026-07-20 — Gustav (COA Generator: align table column widths)

**Files changed:** `app/(app)/quality/coa/page.tsx`

- Fixed misaligned vertical column borders across the COA's stacked Microbiological Analyses, Cut Length Guidelines, and Other Analysis tables. Each `<table>` was auto-sizing its own 3 columns based on that table's longest cell content, so the borders drifted from one table to the next.
- Both `CoaTable` (the live/editable generator preview) and `SampleTable` (the read-only example template at the bottom of the page) now use `table-layout: fixed` with a shared `<colgroup>` (32% / 38% / 30%), so column boundaries line up consistently across all tables. The PDF export (`exportPdf`) already computed matching widths and was unaffected.

---

## 2026-07-17 — Alyssa (Supervisor Hub Roster: always show an auto pre-filled draft, never blank)

**Files changed:** `app/(app)/supervisor/page.tsx`

- The Roster tab's Staffing view now **never sits blank**. When the roster period covering today has no production crew yet — or no period covers today at all — it shows an **unsaved pre-filled draft** carried over from the most recent populated period with **day↔night swapped** (the same rule the weekly rotate cron uses). A brand-tinted banner explains it's a starting point; the supervisor adjusts and **Saves** to confirm.
- **Save now materialises a period if none exists.** `saveDraft()` returns the period it wrote into; a missing "this week" period is created via `nextPeriodConfig()` chained forward from the latest period — the *same cadence the rotate cron uses*, so the dates line up and the cron's idempotency check skips it (no duplicate/overlap). Falls back to a 7-day week from today only when there's no roster history at all.
- No change to the weekly **auto-swap cron** (`/api/production/roster/cron?task=rotate`), `roster-rotate.ts`, the full `/production/roster` tool, or the capture-section autofill — all untouched. This only makes the Hub's Roster tab self-sufficient so a supervisor always has something to work from.
- **Verified:** `tsc --noEmit` identical to baseline; `/supervisor` compiles and serves 200 with no console errors. Logged-in flows (pre-fill save when period empty, and save-creates-period when none covers today) still need a click-through on staging — no credentials in this environment.

---

## 2026-07-17 — Alyssa (Supervisor Hub Phase 2: redesign to 5 tabs, Production Manager sign-off role, PO reopen-request flow)

**Files changed:** `components/supervisor/HubTabs.tsx`, `app/(app)/supervisor/page.tsx` (rewritten), `app/(app)/supervisor/signoff/page.tsx` (new), `app/(app)/supervisor/productions/page.tsx`, `lib/auth/permissions.ts`, `lib/auth/permission-registry.ts`, `lib/auth/departments.ts`, `lib/notifications/recipients.ts`, `app/api/production/orders/[id]/reopen-request/route.ts` (new), `supabase/migrations/20260717_009_po_reopen_requests.sql` (new)

- **Hub restructured to 5 tabs**, matched to what a low-tech-comfort supervisor actually needs day to day: **Roster → Sign-off → Productions → Messages → Timesheets**. The old Overview/Analytics/Calendar/Assign tabs are no longer in the primary nav (pages still exist, just not linked from the hub) — decluttered on purpose.
- **New "Roster" tab** (`/supervisor`, the hub's landing page) with two sub-views, toggled at the top:
  - **Staffing** — a focused, Production-only editor over the *same* `roster_entries` / `roster_periods` / `roster_section_status` tables the full company-wide Shift Roster uses — not a data fork. A supervisor edits who's on each line and **Saves** a draft; only a **Production Manager** can **Submit** it (edit/save stays with the supervisor; sign-off moves up a tier). **Print** is open to anyone who can view. Links out to the full multi-department roster tool for period management.
  - **Today's sections** — the daily section-assignment tool (operators + variant + lot + production order per section, per shift; this is what actually unlocks capture). The existing `/production/capture/assign` component is **embedded unchanged** — its save behaviour and capture-unlock are untouched, no save/submit split added (it's operational/time-sensitive: a saved assignment is live immediately, as before). This restores the entry point the initial Phase 2 nav had dropped.
- **New "Sign-off" tab** (`/supervisor/signoff`): the "which lines are running, what's waiting on my signature" view, extracted from the old Overview — KPI strip and 7-day trend charts were deliberately cut (analytics, not a daily tool).
- **New role: Production Manager** (`production_manager`, Production dept) — submits the Roster's Production section and decides "reopen this PO" requests; does not edit capture sessions or the roster directly. New permission `can_approve_reopen_request`. `production_supervisor` no longer holds `can_submit_roster_production` (moved to the new role) but keeps everything else, incl. Maintenance roster submit.
- **"Productions" tab reopen-request flow**: a supervisor can no longer reopen a submitted/signed-off session directly from the Hub — they **submit a request with a reason**; it notifies Production Managers + IT (in-app + email), who **approve or decline** from a panel right on the same tab. Approval flips the session back to `draft` (same effect as the existing direct "Reopen for edits" action on `/production/orders`, which is untouched and still available to whoever holds `can_edit_session`) and is written to the audit log. New table `production.po_reopen_requests`.
- **Verification:** `tsc --noEmit` across the whole project — identical error set before/after (30 pre-existing errors, none in touched files). `next build` compiled successfully across the whole app (including every new/changed file); the one build-time failure that followed is in an unrelated, untouched route (`/api/accounts/[id]`, pre-existing env issue). **Could not drive the logged-in Supervisor Hub flows in a browser — no valid login credentials were available in this environment.** Please click through Roster (save + submit as both roles), Sign-off, and the reopen-request flow on staging before treating this as fully verified.

---

## 2026-07-17 — Alyssa (Timesheets: fix worked-minutes — anchor to login → sign-off, stop inferring breaks from gaps, changeover prompt)

**Files changed:** `lib/production/timesheet.ts`, `components/production/capture/TimesheetConfirm.tsx`, `app/(app)/production/capture/[section]/page.tsx`, `supabase/migrations/20260717_008_timesheet_worked_minutes_recompute.sql` (new, optional/manual)

- **Root cause fixed:** worked-time was `span − inferred_breaks`, and *any* inactivity gap ≥5 min was inferred as a break (>30 min = lunch). Operators do long stretches of physical floor work without touching the tablet, so a full shift collapsed into one giant "lunch" and worked-time came out as minutes (e.g. an 08:24–15:57 shift showing **8m**, several showing **0m**).
- **`deriveTimesheet` rewritten** to anchor to real clock events, never gaps:
  - **shift start = the operator's first activity stamp = login / page-open** — fixed, read-only ("can't be changed").
  - **shift end = when they reach sign-off / submit** (passed in as `endIso`), falling back to the last stamp.
  - **breaks = the standard tea/lunch schedule for the shift only**, clipped to the worked window so an out-of-window break (e.g. a 13:00 lunch for someone who left at 12:00) can't subtract. No gap-inference.
  - `workedMinutes` now subtracts only the portion of each break that overlaps `[start, end]`; never negative.
- **TimesheetConfirm:** the start field is now read-only (login-anchored); the end defaults to sign-off time; copy updated. Removed the dead gap constants.
- **Changeover-aware submit:** when a **morning** operator submits **before 15h30** having already run **2+ production orders**, a *"Is there a changeover?"* prompt appears. "Yes" logs a structured handover note (shows in Productions history + the next shift's handover banner) and submits; the incoming afternoon/night operator's own login records their shift start on a fresh record. "No" submits as end-of-day.
- **Verified** against 6 scenarios incl. the exact screenshot case → now **6h 33m** (was 8m), end-anchored-to-submit, and out-of-window break clipping.
- **Optional historical recompute** (`…_008_…recompute.sql`) — preview-first SELECT then a transaction-wrapped UPDATE to re-approximate existing confirmed rows (morning −60m, afternoon/night −75m). Approximate by design: old rows' end was the last tap, so they can be made sane but not exact. **Not auto-run.**

---

## 2026-07-17 — Gustav (COA Generator: editable signatory names + drawable, persistent signatures)

**Files changed:** `app/(app)/quality/coa/page.tsx`, `supabase/migrations/20260717_006_coa_signatories.sql` (new)

- **Signatory names and titles are now editable** (no longer hard-coded), stored in the new `qms.coa_signatories` table and shared across every COA. Seeded with the current two — Laboratory Supervisor (Monique Gordon) and Quality Assurance Manager (Michelle Brown).
- **Drawable signatures:** each signatory has a signature pad (draw with mouse or touch) in a new "✍ Signatories" section. Saved signatures persist and render above the signing line on the COA preview, print, and PDF export. Draw once and it's maintained for future COAs; Clear + redraw to change.

---

## 2026-07-17 — Gustav (COA Generator: logo, signatures, company footer + logistics order details)

**Files changed:** `app/(app)/quality/coa/page.tsx`, `supabase/migrations/20260717_005_coa_orders.sql` (new)

- **Cape Natural logo** now appears top-left of the COA (on-screen preview, print, and PDF export), matching the standard certificate design.
- **Signature blocks** added at the bottom — Laboratory Supervisor (Monique Gordon) and Quality Assurance Manager (Michelle Brown), each with a ruled signing line — plus the centred company footer (CAPE NATURAL TEA PRODUCTS (PTY) LTD, address, Reg/VAT no.).
- **Logistics order details:** invoice no., order number, quantities and destination are now a dedicated "🚚 Order details (logistics)" section with a **Save** button. They persist per batch in the new `qms.coa_orders` table, so logistics can fill them in later when ready and they pull through automatically on the next generation. (The header fields remain inline-editable too.)

---

## 2026-07-17 — Gustav (COA Generator: pull specifications from customer specs by grade+customer+variant, + generation history)

**Files changed:** `app/(app)/quality/coa/page.tsx`, `supabase/migrations/20260717_004_coa_generated.sql` (new)

- **Specification column now auto-fills from the customer COA specs.** When a batch is generated, the generator matches a `qms.coa_specs` row by **customer + grade + variant** (derived from the pasteuriser batch) and fills every Specification cell — micro limits, cut-length mesh specs, moisture/BD, residue regulation wording, PA limit, heavy-metal limits, sensorial wording. Which sections appear is now driven by what that customer's spec requires (not just what data exists), so e.g. a customer that needs heavy metals shows that block even before the lab report lands (flagged outstanding).
- **Customer-spec picker:** a dropdown lists all of that customer's specs, auto-selecting the best match; the lab manager can switch to a different product spec and every Specification cell re-fills instantly.
- **Variant-aware matching:** Conventional / Organic / RA-Organic / RA-Conventional (and Fairtrade variants) are normalised on both sides so the right spec is chosen.
- **Generation history:** new `qms.coa_generated` table logs every Print/Export with a full JSON snapshot; a 🕘 History panel shows past generations (date, batch, customer, grade, spec used, by whom).

---

## 2026-07-17 — Gustav (Customer Specs: import Client_Specs.xlsx as an editable per-customer COA requirements matrix)

**Files changed:** `components/quality/CoaSpecsTab.tsx` (new), `app/(app)/quality/customer-specs/page.tsx`, `supabase/migrations/20260717_003_coa_specs.sql` (new), `supabase/seeds/coa_specs_seed.sql` (new)

- **New `qms.coa_specs` table** holding the full per-customer COA specification matrix imported from `Client_Specs.xlsx` (67 customer product specs across 30 customers). Identity + physical fields are columns; the ~70 analysis fields (mesh, micro, contaminants, residue/foreign/sensorial) live in a `specs` jsonb. A field is stored only when it carries a real spec — an absent field means **NOT REQUIRED** on that customer's COA (this is how "what requires specs vs not" is represented). All 67 rows seeded into the staging DB.
- **New "📄 COA Requirements" tab** on the Customer Specs page (default tab; the old sieve-spec table moves under a "🧪 Sieve Specs" tab). Lists every customer spec with search, a required-analysis count, and at-a-glance badges (Micro / Sieve / Metals / PA / Residue) showing which COA blocks each customer needs.
- **Fully editable and saved back to the database:** an Edit modal groups every field (Identity, Physical, Sieve/mesh with spec+min+max, Microbiology, Contaminants, Other) — blank = NOT REQUIRED, a value = required with that spec. Add / edit / delete rows, gated on `can_edit_customer_specs`.
- This is the per-customer template the COA Generator will read from to decide which sections a batch's certificate requires and the spec-column values (wiring the generator to it is the next step).

---

## 2026-07-17 — Gustav (COA Generator: add filled-in example template at the bottom)

**Files changed:** `app/(app)/quality/coa/page.tsx`

- Added a collapsible, read-only **example template** at the bottom of the COA Generator, populated with the real 26138-CON-SG sample values, so anyone can see exactly how a completed certificate looks (header, description, microbiology, other analysis) before generating a real one. Clearly labelled as illustrative and hidden from print.

---

## 2026-07-17 — Gustav (COA Generator — v1: type a batch number, auto-populate a customer COA from linked sources)

**Files changed:** `app/(app)/quality/coa/page.tsx` (new), `components/layout/Sidebar.tsx`

- **New "📋 COA Generator" tab** (Quality → COA Generator, gated on `can_save_lab_results`). Type a batch number — the single join key across every source — and it builds a standard Certificate of Analysis:
  - **Header** (grade, production date, destination/customer) ← pasteuriser batch; invoice/order/quantities typed on the form; **Best Before auto-computed** = production + 3 years.
  - **Microbiology** ← Final Product Lab Results (`micro`) — TPC, E.coli, Salmonella, Yeast, Mould, Listeria, E.coli O157, with COA-standard result wording (E.coli/Listeria "Not detected", Salmonella "Absent").
  - **Cut length / sieving** ← pasteuriser sieve samples, averaged across the batch (the pasteuriser >6/>10/>12/>16/>20/>60/Dust mesh set matches the COA exactly). Optional.
  - **Moisture / Bulk Density** ← pasteuriser samples, averaged. Plus Foreign Material.
  - **Pesticide residue** ← Lab Results (`residue`); **Pyrrolizidine Alkaloids** ← Lab Results (`pa_final`); **Heavy metals / MOSH-MOAH** ← Lab Results (optional) — all rendered as "Complies" / "None detected".
  - **Description of goods** (organic vs conventional) + **Sensorical properties** ← centralised standard wording (`COA_WORDING`) so every COA reads identically.
- **Outstanding-data panel** flags any included section that has no source data yet. **Section toggles** let the lab manager include/exclude blocks (some customers need heavy metals/residue/PA, some don't).
- Every header field, spec and result is **editable inline** before generating (specs blank/default for now — they'll be driven by a per-customer template under Customer Specs later, per the plan).
- **Output: both** — on-screen preview, browser **Print**, and **PDF export** (jsPDF) laid out to mirror the template.
- Batch matching is separator/case-insensitive (`normBatch`) so "26138-CON-SG" / "26138 CON SG" / "26138/CON/SG" all resolve to the same batch across pasteuriser and lab results.

---

## 2026-07-17 — Gustav (Lab Results: fix duplicate ≤ in spec column, edit-after-extraction for every tab, heavy metals/PA extraction no longer collapses detection-limit values)

**Files changed:** `app/(app)/quality/lab-results/page.tsx`, `app/api/upload/route.ts`

- **Fixed duplicate "≤≤" in the Spec column.** `expandRecord()` was prefixing "≤" onto values that had already been extracted with their own "≤" (or another comparison operator), producing "≤≤1.0". Added a `formatSpec()` helper that only prefixes "≤" when the value doesn't already start with a comparison operator.
- **Added edit-after-extraction to every non-Micro tab** (Residue, Heavy Metals, EtO, Aflatoxins, MOSH/MOAH, PAs, Glyphosate) — Micro already had this via `MicroEditCell`. New `RecordEditModal` handles the three result shapes: `compounds_detected[]` (Residue), `analytes[]` (everything else), and a flat-field fallback for any older records with neither. An ✏️ Edit button now sits next to the existing 🗑 Delete on every record.
- **Fixed heavy metals (and PA) extraction dropping the lab's actual reported value.** The Gemini prompt explicitly told the model to collapse any below-detection-limit result (e.g. a printed "<0.010") into the generic string "None detected" — discarding the real reported threshold. Reworded both prompts to keep the value exactly as printed (e.g. "<0.010"), only falling back to "None detected" when the document truly has no value/threshold printed.

---

## 2026-07-17 — Alyssa (Shift Roster: wire WhatsApp into reminders, real delivery counts, self-test tool)

**Files:** `app/api/production/roster/cron/route.ts`, `app/api/production/roster/notify-test/route.ts` (new),
`app/(app)/production/roster/page.tsx`

- **Root cause found for "submitted the roster but never got the reminder
  email"** (real reports from Monique Gordon and Shaun De Beer): email is sent
  via Office365 SMTP (`lib/notifications/email.ts`, `SMTP_USER`/`SMTP_PASS`) —
  if those env vars aren't set on the server, `sendEmail()` silently skips and
  reports `ok:true, skipped:true`. The cron's `reminded: 15` figure from the
  Jul 15 run counted **attempts**, not deliveries, so the outage was invisible
  from the app's own numbers. `doRemind()` now tracks real `emailSent` /
  `whatsappSent` counts (from `notify()`'s actual per-channel result) alongside
  the attempt count, visible in the Backend status panel's cron history.
- **Wired WhatsApp into roster reminders.** The `urgent` channel
  (`lib/notifications/urgent.ts`, Meta WhatsApp Cloud API or Twilio) was
  already fully built and used for maintenance breakdowns / Axis tickets, but
  never included in the roster reminder's `channels` array, and the cron
  didn't resolve recipients' phone numbers at all (built emails inline instead
  of via `resolveRecipients()`). Fixed both — reminders now attempt in-app +
  email + WhatsApp for anyone with a phone number on file
  (`shared.app_roles.phone`), same "one template serves everything" setup as
  breakdowns (see `docs/whatsapp-setup.md`).
- **New self-test tool** in the Backend status panel ("Send test to me") — an
  admin-only button that sends a real test notification to the calling
  admin's own email/phone right now (no waiting for the Mon/Wed cron, no
  effect on real roster data) and reports exactly what happened per channel:
  configured or not, sent or skipped or failed, with the raw provider error if
  one occurred.
- **Still needed (ops, not code):** confirm `SMTP_USER`/`SMTP_PASS` are
  actually set in the VPS `.env` for both `cntp-staging` and
  `cntp-production` — Office365/Microsoft 365 tenants increasingly block
  legacy SMTP AUTH by default, so if the account password doesn't work, check
  Exchange Admin Center → that mailbox → "Authenticated SMTP" is enabled, and
  use an app password if MFA is on. WhatsApp needs `WHATSAPP_PROVIDER=meta`
  (or `twilio`) plus the corresponding credentials — full setup in
  `docs/whatsapp-setup.md`. Neither can be checked or set from this session
  (no VPS SSH access).

---

## 2026-07-17 — Alyssa (Shift Roster: admin-only "Backend status" panel)

**Files:** `app/(app)/production/roster/page.tsx`, `app/api/production/roster/insights/route.ts` (new),
`app/api/production/roster/cron/route.ts`, `supabase/migrations/20260717_002_roster_cron_log.sql` (new)

- **New admin-only "Backend status" panel** on the roster page (collapsed by
  default) so real backend state is visible in the UI instead of requiring a
  manual DB check — this is the same class of check that caught the false
  "Published" bug earlier today. Shows three things, fetched from a new
  admin-gated `/api/production/roster/insights` route:
  - **Real per-section submission state** — the literal `roster_section_status`
    rows for the period (section, status, submitter's actual name, exact
    timestamp), not the derived checkmark shown in the regular confirmation
    tracker.
  - **Cron history** — when rotate/remind last ran and what happened
    (reminded count + pending sections, or rotate/skip reason). The
    rotate/remind cron previously left no trace inside the app — the Jul
    8/12/13 `CRON_SECRET` 401 outage was only visible in GitHub Actions logs.
  - **Recent activity** — the audit trail (added earlier today) for this
    specific period: who edited/submitted/published/reopened what, and when.
- New table `production.roster_cron_log` (migration `20260717_002`) records
  each rotate/remind run; the cron route now writes a best-effort log row
  after every run. RLS denies `authenticated` entirely — only the service-role
  cron route and the admin-gated insights route touch it.
- Gated to full admins only (`role === 'senior_developer'`), matching the
  Reopen action added earlier today.
- **Needs migration `20260717_002_roster_cron_log.sql` run in Supabase SQL
  editor (staging, then production)** before the "Cron history" section will
  show data — it degrades gracefully (shows "No runs logged yet") until then.

---

## 2026-07-17 — Gustav (Sieving: add hourly "By Hour" view to Mesh Trend/Outliers charts)

**Files changed:** `app/(app)/quality/sieving/page.tsx`

- **New "By Hour" view** alongside By Week / By Month on the Sieving Tower's Mesh Trend and Outliers charts. Buckets the day into 24 hourly slots (parsed from each run's `time_of_run`), so an out-of-spec reading is visible the same shift it happened — not just once the day rolls into a weekly average. Defaults to today, with the same ◀ ▶ / Today navigator to step back through previous days.
- Unified the day/week/month bucketing behind a single `bucketKeyFor(run)` function (previously date-only `bucketOf`), since hourly bucketing needs both date and time.
- X-axis tick density is thinned for the 24-slot hourly view (`interval` prop) so hour labels don't collide on the per-mesh mini charts.

---

## 2026-07-17 — Alyssa (Shift Roster: publish now requires genuine full confirmation, admin Reopen action)

**Files:** `app/(app)/production/roster/page.tsx`, `app/api/production/roster/audit/route.ts`

- **Root cause found for "roster says Published but nobody actually confirmed":**
  the manual "Publish" button was shown to anyone holding edit rights on just
  ONE section, and clicking it marked the WHOLE period `published` regardless
  of whether the other departments had submitted. Confirmed live on staging —
  the "20–24 Jul" period was `published` (since 11 Jul) with **zero** rows in
  `roster_section_status`, i.e. no department had submitted anything. Fixed by
  removing the manual early-publish override entirely: publishing now only
  ever happens automatically, the moment every department has genuinely
  submitted (existing `autoPublishedRef` logic, unchanged). "Published" now
  always means fully confirmed, with no exceptions.
- **Added an admin-only "Reopen" action** (full admin, shown only when a period
  is published) so a period can be unpublished for correction without touching
  the database directly — it just flips the period back to draft; section
  submission status is untouched, so it re-publishes automatically for real
  once every department re-confirms.
- Corrected the affected staging period ("20–24 Jul") back to draft directly
  via the service-role API (no DB migration needed — this was a data fix, not
  a schema change). **Production has the same code path and needs the
  equivalent correction** — either via the new Reopen button (once this ships
  to prod) or a targeted `UPDATE production.roster_periods SET status='draft',
  published_at=NULL WHERE id='<period id>'` for any period published with no
  real section submissions.
- Removed the now-dead `publishing` state (no longer read since the manual
  Publish button is gone) and updated the roster Help modal + published-notice
  banner copy to match the new behaviour.

---

## 2026-07-17 — Alyssa (Shift Roster: Maintenance Manager role, drop stale tech list, roster audit trail)

**Files:** `lib/production/roster-config.ts`, `lib/maintenance/constants.ts`,
`supabase/migrations/20260717_001_roster_maintenance_manager.sql` (new),
`app/api/production/roster/audit/route.ts` (new), `app/(app)/production/roster/page.tsx`

- **Maintenance Manager is now a roster role.** The roster's Maintenance section
  only had "Maintenance Tech" and "Maintenance Assistant" rows, and both keys
  are the on-duty technician keys (`MAINT_ROLE_KEYS` in `lib/maintenance/roster.ts`)
  used to auto-route urgent breakdowns and sync `maintenance.duty_roster` on
  publish. With no Manager row, Shuaib Sentso (the maintenance manager, SSO
  login, not a PIN tech) could only be placed under "Maintenance Tech" — which
  made the system treat him as an on-duty technician eligible for breakdown
  auto-assignment. Added a dedicated `maintenance_manager` role (sorted above
  Tech) that is deliberately NOT one of the on-duty keys, so a manager is
  rostered for visibility but never auto-assigned a breakdown. Migration also
  moves any existing Shuaib tech/asst entries onto the new Manager row.
- **Removed Shuaib from the stale `TECHS` fallback** in `lib/maintenance/constants.ts`
  so he is never re-introduced as a technician before the live staff directory loads.
- **Roster activity now writes to the audit trail.** The roster mutated
  `production.roster_*` client-side with no audit record, so pre-planning and
  changes never appeared in Users & Roles → Audit. Added a small server route
  (`/api/production/roster/audit`) that records edit / submit / publish /
  generate / delete events into `axis.audit_log` with the verified caller as
  actor; the roster page calls it fire-and-forget after each successful mutation.
- **Verification (notifications):** the rotate/remind GitHub Actions workflow is
  live on `main` and firing on schedule, but Jul 8/12/13 runs failed with HTTP
  401 (GitHub `CRON_SECRET` did not match the server env); Jul 15 succeeded
  (`reminded: 15`) so the secret is now aligned. All six sections were still
  `pending` on Jul 15 — reminders dispatch but no section has been submitted.
  Still to confirm server-side: email provider env (in-app notifications work
  regardless; email delivery depends on the provider being configured).

---

## 2026-07-16 — Alyssa (Fix multi-record data loss in Overview/mass balance, Overview redesign, empty-record discard)

**Files:** `app/(app)/production/capture/[section]/page.tsx`, `components/production/capture/CaptureOverview.tsx`,
`app/(app)/production/orders/page.tsx`

- **Root cause found for "Refining Overview missing bags" and "only the most
  recent work got saved":** the same bug. A shift can have more than one
  `prod_sessions` row (a batch submitted — with errors or not — then "Start
  new batch record" opens another), but the page only ever loaded the single
  newest row for this shift, and the newest row for the other shift, into
  Overview/mass balance. The only way an earlier record's data could still
  count was the optional "Continue the production run?" banner — easy to
  skip by ignoring it or picking "Start new run." Sieving rarely revisits
  this flow (one batch per shift); Refining commonly runs several batches a
  shift, so it hit the bug far more often. Fixed by loading every session row
  for this shift (and the other shift) and folding every one of them into
  Overview and the on-screen mass balance, independent of run-linking.
- **Overview redesigned** — Debagging and Bagging were dense HTML tables;
  converted to flowing card/list rows matching the rest of the app's recent
  redesigns (Blender debagging, Production Orders). Each bag's serial is now
  its own isolated chip element (not part of a joined string), so wiring it
  to a Bag Tracking hyperlink later is a one-line change, not a layout
  rework.
- **Empty submitted records now flagged with a direct discard action** — a
  record submitted/signed-off with zero debagging or bagging shows a visible
  "Empty record" warning right on its card (not buried in the "…" menu), with
  a one-click Discard for permissioned roles (reuses the existing archive
  flow — hidden, kept for audit, restorable, excluded from KPIs). Generic
  across all sections, not just Blender, since the gap was in the shared
  Production Orders card.

---

## 2026-07-16 — Alyssa (Direct-to-printer label printing + Printers admin page)

**New files:** `lib/production/label-zpl.ts`, `lib/production/label-pplb.ts`,
`lib/production/printer-registry.ts`, `lib/production/print-socket.ts`,
`app/api/print/label/route.ts`, `app/api/print/test/route.ts`,
`app/(app)/users/printers/page.tsx`, `supabase/migrations/20260619_003_printers.sql`

**Changed:** `lib/production/label-print.ts`, `lib/production/capture-config.ts`,
`components/production/capture/SievingCapture.tsx`, `components/layout/Sidebar.tsx`,
`app/(app)/layout.tsx`

Added direct printing from the app to networked label printers over raw TCP (port 9100),
replacing the browser print dialog. The app generates the printer's native command language
— **ZPL** for Zebra (e.g. ZD230) and **PPLB/EPL2** for Argox (e.g. CP-2140EX) — and streams it
to the printer via `net.Socket`. Both builders reproduce the existing 100×50mm tag (product,
section, Code-128 barcode = serial, variant/grade badge, lot/weight/date/QC footer).

The section→printer binding is enforced **server-side**: the client only sends the bag, and
`/api/print/label` resolves the printer purely from the bag's `section_id`, so a section's tags
can only ever reach the printer assigned to that section (no printer picker, no OS dialog).
`printLabelAuto()` falls back to the browser print window if a printer is unreachable.

Made the binding editable at runtime via a **Printers** module inside a new **Stock Control** page
under Operations (`/stock-control`, gated to Production + Management; Stock Control is a module
container so more stock tools can be added later). One row per production section with printer
name/IP/port/language, a per-row **Test print** button (`/api/print/test`, prints a sample label to
the on-screen IP), and Save. Assignments persist to a new `production.printers` table; the print API
reads it with a ~30s cache (`printer-registry.ts`), so UI edits take effect within about half a
minute with no code change. The `SECTION_PRINTER` map remains as the fallback/seed when the table
has no row for a section.

Added a `KNOWN_PRINTERS` catalogue (three Zebra ZD230s by serial — D5J261603773/.115,
D5J261605257/.124, D5J261603949/.126 — the Argox CP-2140EX at .55, and a not-yet-wired spare)
surfaced as an "Assigned printer" dropdown per section; picking one fills IP/language/name, and
several sections can share a printer by picking the same one. Seed defaults: Sieving→.115,
Blender→.124, Granule→.126 (each its own Zebra), Pasteuriser→Argox .55, Refining 1&2→the spare
(blank IP until it's wired, so they share it). Added an About panel explaining the server-side
binding, the ~30s cache window, and the dual ZPL/PPLB language support.

**Migration:** run `supabase/migrations/20260619_003_printers.sql` in the Supabase SQL Editor
(staging, then prod) before the page's Save/persistence works.

---

## 2026-07-16 — Alyssa (Production Orders page redesign, archived orders excluded from KPIs)

**Files:** `app/(app)/production/orders/page.tsx`, `app/api/production/manager-kpis/route.ts`,
`app/(app)/supervisor/analytics/page.tsx`, `app/(app)/dashboard/supervisor/page.tsx`,
`lib/dashboard/data.tsx`, `components/dashboard/CommandCentre.tsx`,
`components/production/ProductionDashboard.tsx`, `components/production/LiveCaptureKPIs.tsx`

Archiving (soft-delete via `prod_sessions.deleted_at`) already existed on `/production/orders`
but nothing actually excluded an archived order from anywhere it got aggregated — added
`.is('deleted_at', null)` to every place that reads `prod_sessions` for a KPI/total
(manager KPIs API, supervisor analytics, both supervisor/production dashboards, and
the live-capture KPI strip), so archiving a record now actually removes it from
throughput/yield/mass-balance numbers, not just from the visible list.

Also cleaned up `OrderCard`'s layout — the old design crammed record no./archived
badge/name/shift/variant, operators/lot/PO, weights, and variance into a rigid
4-column grid that left ragged empty cells on records with fewer facts and felt
crowded on ones with more. Replaced with a flowing header line + one muted meta
line, same information, same actions (edit/reopen/archive/restore), less visual
noise.

---

## 2026-07-16 — Alyssa (VSD prompt on Overview, production-order review tab, Blender debagging redesign)

**Files:** `app/(app)/production/capture/[section]/page.tsx`, `app/(app)/supervisor/productions/page.tsx`,
`components/production/capture/BlenderCapture.tsx`

- **Hourly VSD prompt popping up while just reading Overview/AI summary:** it was
  rendered unconditionally regardless of tab. Suppressed while `tab === 'overview'` —
  it still nags on every other tab throughout the shift, just not over someone
  reading a review, not operating the line.
- **"Why does the production-orders page open the whole session?"** — there's no
  separate lightweight review view yet; a supervisor's review link reuses the exact
  same capture page an operator uses. That link now defaults to `?tab=overview`
  instead of the live Capture tab, so reviewing a production order actually opens on
  the Overview + AI summary, not the operator's active data-entry screen.
- **Blender debagging redesigned as a popup add-bag flow.** The old design had every
  ingredient group carrying its own always-visible scan/system/manual card + mode
  toggle — with 5+ groups (a real blend recipe) the tab became a wall of near-
  identical purple cards, worse once two groups shared a material label. Replaced
  with one "+ Add debagging bag" button that opens a modal: product type is now a
  dropdown over the blend's ingredients (first field, not "which of several buttons
  did I tap"), then serial (scan/type + look-up, or "pick from in-stock bags"),
  weight (pre-filled 300kg for Fine/Coarse Leaf), batch number when the material
  needs one. Submitting locks the bag immediately — no partial/unsecured rows ever
  sit on the main screen. Tapping a logged bag reopens the same modal to edit or
  remove it. The list itself is now just compact, colour-coded one-line summaries
  per group.

---

## 2026-07-16 — Alyssa (Blender: per-group add-mode UX fix, run-continuity serial fix)

**Files:** `components/production/capture/BlenderCapture.tsx`, `app/(app)/production/capture/[section]/page.tsx`

- **Confusing shared "Manual entry" highlight:** the scan/system/manual mode toggle
  was one shared piece of state across every ingredient group, so tapping "Manual
  entry" for one group visually lit up "Manual entry" for every other group too —
  looked like the whole screen had switched modes when only one row's add-button
  had. Made it per-group.
- **Verified** the Blender Overview batch-grouping + component-ratio table shipped
  in the 2026-07-16 lot-format/overview PR is working as intended — no changes needed.
- **Run continuity across shifts:** the app already prompts "Continue the production
  run from the previous shift?" (explicitly naming the blend code for Blender) when
  the same blend/variant/PO has an open run from an earlier shift — that part already
  worked. But accepting "Continue" only linked the session to the run for mass-balance
  totals; it never seeded the new shift's output-run number, so the first bag added
  still forked to a brand-new run (`…/2-01`) instead of continuing the same one
  (`…/1-13`) even though the operator explicitly chose to continue. Added
  `resolveExistingBlendRunNo()` and seed it into the continuing production's
  `outputRunNo` when "Continue run" is accepted.

---

## 2026-07-16 — Alyssa (Correct break times, operator-message notifications, checks persistence + AI summary retry, Blender group colours)

**Files:** `lib/production/timesheet.ts`, `components/production/capture/TimesheetConfirm.tsx`,
`lib/notifications/recipients.ts`, `app/api/production/notify-line-message/route.ts`,
`lib/production/messages.ts`, `components/production/capture/ChecksPanel.tsx`,
`components/production/capture/BlenderCapture.tsx`

- **Standard break times corrected:** the fallback schedule used when no inactivity gap
  is detected had tea at 10:00 (15min) and lunch at 12:30 (60min) for morning shift —
  real times are tea 10:30-11:00 and lunch 13:00-13:30 (30min each). Updated the
  fallback schedule and the quick-add buttons in the timesheet confirm screen to match.
- **Operator messages now notify supervisors:** `sendMessage()` (used by every
  section's line chat, and by maintenance-stoppage escalation at sign-off) now fans out
  to every production supervisor's notification bell via a new
  `/api/production/notify-line-message` route + `getProductionSupervisorIds()`, deep-
  linking back to that section's Messages tab. Also fixed a pre-existing bug in the
  maintenance-escalation path: it inserted into `line_messages` using columns
  (`sender_name`/`sender_id`/`type`) that don't exist on that table (real columns are
  `author_id`/`author_name`/`author_role`) — every maintenance-stoppage message was
  silently failing to send. Now goes through the same `sendMessage()` helper LineChat
  already uses correctly.
- **Sieving Tower checks disappearing after submission:** the load effect only rebuilt
  VSD readings and raised-maintenance flags from saved events — every other check
  (confirms, numbers, text, scale verification, mass balance) stayed as empty local
  state on reload, so a signed check record looked blank on any later visit even
  though the data was saved. Now rebuilds all of them from events on load. Also added
  a visible fallback + manual "Generate" retry for the AI shift summary, since a failed
  Gemini call previously showed nothing with no way to try again.
- **Blender ingredient groups now colour-coded per group**, not all one purple —
  two groups with the same material label (e.g. two separate Fine Leaf slots at
  different ratios) were visually identical, risking a bag going into the wrong slot.

---

## 2026-07-16 — Alyssa (Timesheet heartbeat coverage + multi-operator conflation fix)

**Files:** `app/(app)/production/capture/[section]/page.tsx`, `lib/production/timesheet.ts`,
`components/production/capture/TimesheetConfirm.tsx`

Investigated "timesheets not working well across all sections." Root causes (shared
code, affects every section identically):

- **Heartbeat coverage gap:** `logActivity()` only ever fired as a side-effect of the
  `productions` array changing (bag/batch data edits), so a shift spent on Checks,
  Cleaning, Overview or Sign-off — or doing real floor work between edits (walking to
  weigh a bag, waiting on a scale) — left gaps in `capture_activity` with nothing to
  distinguish "present but not editing bag data" from "on a break." `deriveTimesheet()`
  then misread those ordinary working gaps as tea/lunch breaks, or — when there weren't
  even two heartbeats — collapsed `shiftStart === shiftEnd` and reported 0 minutes
  worked. Added a generic `pointerdown`/`keydown` listener that heartbeats on any real
  interaction anywhere in the app (still throttled to once/60s), not just data edits.
- **Multi-operator session conflation:** `loadActivity(sessionId)` ignored
  `operator_id` entirely, so when two operators shared a section/shift session, their
  heartbeats merged into one stream — masking each operator's real breaks (hidden
  whenever the other was still active) and giving both operators identical, individually
  wrong derived shift times when they each confirmed. `loadActivity` now scopes to the
  confirming operator's own heartbeats, falling back to the full session stream only
  if that comes back empty.

Flagged separately (not fixed — needs a product decision, see chat): `/production/live`
has its own independent manual timesheet (writes to a plain `timesheets` table, no
`capture_activity`/`prod_timesheets` involved) and `PasteuriserForm.tsx` has a third,
also-independent variant — if operators use either of these in parallel with the main
capture route, that shift's real timesheet is invisible to `/supervisor/timesheets`
(which only reads `prod_timesheets`). `TimesheetTab.tsx` is unused dead code (confirmed
via repo-wide grep) implementing yet a fourth model — never wired up, but a trap for a
future edit.

---

## 2026-07-16 — Alyssa (Lot-format fix, Blender batch suggestions/numbering, Overview rendering fixes, Sieving cleaning checklist)

**Files:** `components/production/capture/SievingCapture.tsx`,
`components/production/capture/BlenderCapture.tsx`,
`components/production/capture/CaptureOverview.tsx`,
`app/(app)/production/capture/[section]/page.tsx`, `lib/production/cleaning-config.ts`

- **Lot-number format too strict:** `isValidLot` (letter-prefix + dash + digits, exactly
  7–8 chars) rejected real batch numbers like `GS26-MIX-A` (a manual-mix batch). Relaxed
  to the actual invariant across real examples — at least one dash separating
  alphanumeric segments, 3–20 chars — so multi-segment batch numbers validate correctly
  on both Sieving Tower and Blender.
- **Blender batch-number suggestions:** now also include lots already typed into a
  sibling input row this session (not just in-stock `bag_tags`), since a debagged lot
  that hasn't been registered as its own bag_tags record yet is still a real, reusable
  batch number for the next bag of the same lot.
- **Blender debagging numbering:** input rows now show "Bag 1", "Bag 2"… per ingredient
  group, matching the numbering convention Sieving Tower already uses for bulk bags.
- **Overview tab rendering bugs (Blender + Refining 2):** `CaptureOverview.tsx`
  branched on `'inputs' in d`, which is true for both `RefiningData` and `BlenderData`
  — so Blender's debag/bag data was silently processed as if it were Refining's,
  producing wrong/blank output. Added a dedicated Blender branch: debagging groups by
  batch number (lot) instead of serial, and output bags render as "Blend {bomId}"
  instead of vanishing (Blender's output shape has no `productType`/`outputA-D`, which
  the Refining branch expected). Also fixed the Refining branch's `map.set()` — an
  unconditional overwrite that silently dropped a bag's kg whenever two rows shared a
  fallback key (e.g. two manual-entry rows across different shifts with no serial both
  defaulting to "Input bag 1") — now merges into the existing group instead. Refining's
  debag grouping now also keys off the real lot/batch number, not the serial.
- **Blender component-ratio table in Overview:** added the same "target vs actual %"
  ratio table Blender's own Bagging tab shows — this is how mass balance is actually
  read for a blend, not a simple in/out total. `page.tsx` now fetches each distinct
  blend code's BOM components (cached per bomId) and sums captured input weights by
  ingredient across both shifts, passed to `CaptureOverview` as `blenderRatios`.
- **Sieving Tower cleaning checklist:** the digital checklist
  (`lib/production/cleaning-config.ts`) only covered 6 of the paper form's 13 numbered
  areas (folded into 3 generic buckets: Sieving/De-bagging/Dust Collection Room).
  Relabelled existing tasks to their correct specific area (Magnet, Conveyor belt,
  Rolsif, Indent screen, Fanie Sieve, Dust extraction system, Debagging hopper) without
  changing their audit-log keys, and added the 5 areas that had no digital task at all:
  Bucket elevator, Mini Sifter, Blender (in-line unit), Floor Scale, DB.

---

## 2026-07-15 — Alyssa (Blender: enforce Sieving Tower's lot-number format on Fine/Coarse Leaf batch numbers)

Confirmed: Blender's Fine/Coarse Leaf batch-number suggestions already pull straight
from Sieving Tower's real output records (`useSystemBagsForType`'s in-stock `bag_tags`
query) — so the batch number being entered here always IS a Sieving Tower lot, and
should be held to the exact same format rule Sieving Tower itself enforces before
locking a bag: letter prefix + dash + digits, 7–8 characters (e.g. `GS-0299`).

Exported the existing `isValidLot` check from `SievingCapture.tsx` (unchanged
otherwise) instead of writing a second copy that could drift, and wired it into
Blender's batch-number field the same way Sieving already uses it: inline error
message, and the bag can't be locked ("Done — lock this bag") until the format is
right — catches a dropped digit or missing dash before it becomes a batch number that
doesn't match anything real.

**Files:** `components/production/capture/SievingCapture.tsx` (`isValidLot` now
exported, no behaviour change), `components/production/capture/BlenderCapture.tsx`
(imports and enforces it).

## 2026-07-15 — Alyssa (Blender: output bag serials now use the real blend-code format)

Output bags were using the generic per-section serial (`BL-DDMMYY-NNN`) like every
other section — but Blender's actual paper convention, confirmed from real operator
reports, embeds the blend code itself: `{blendCode}/{runNo}-{bagNo}`, e.g.
`SFC-KUN25-C/1-01`, `SFC-KUN25-C/1-02`. `runNo` distinguishes separate runs of the same
blend (e.g. if it's made again on a different day); `bagNo` is sequential within that
run. Both are resolved from whatever's already in `bag_tags` for that blend code the
first time an output bag is added to a production, then held in a ref and incremented
locally so every "Add bag" tap after the first doesn't re-query. `runNo` is also
persisted onto the batch record (`BlenderData.outputRunNo`) so a page reload mid-batch
can't renumber it. Generic `genSerial()` (still used everywhere else) is kept as a
fallback for the edge case of adding an output bag with no blend chosen, which
shouldn't be reachable — the Bagging tab is gated on a blend being picked first.

**Files:** `components/production/capture/BlenderCapture.tsx` only.

## 2026-07-15 — Alyssa (Blender: product type is a fixed label per section, not an overridable field)

Follow-up to the manual-entry pass earlier today — the new "Change" link on product
type let a row's material silently disagree with its own section header (e.g. a
"Sieved Fine Leaf: Export - Conventional" section showing a row actually logged as
something else). Since the header already declares exactly what belongs there,
allowing a per-row override broke that consistency. Removed it: product type is now a
fixed, non-interactive label matching the section it's under, for every input mode
(scan/system/manual) — the section identity never changes underneath a row. A genuine
substitute (the "Cut Heavy Stick vs Corn Cutter" case) now goes through "+ Add Other"
to create its own distinctly-labelled section instead.

Also tightened scan validation to match: a scanned bag is checked against the section's
full declared material (not just its grade family) — a mismatch is rejected outright
with a pointer to "+ Add Other", rather than being accepted under a relabeled type.

**Files:** `components/production/capture/BlenderCapture.tsx` only.

## 2026-07-15 — Alyssa (Blender: smarter manual entry — pre-filled weight/product type, real batch suggestions, "+ Add Other")

Floor feedback (with screenshots) on Blender's manual-entry flow: it was asking the
operator to redo work the system already knew the answer to, and had one outright bug.

1. **Batch number was pre-filled with the blend code** (e.g. `SFC30-KUN25-C` showing up
   in a "Batch number" field meant for a Sieving Tower lot like `GS-0415`) — a bug, not
   a design choice. Removed the `assignment.lot_number` prefill entirely and replaced
   the plain text field with the same `BatchKeypadField` Sieving Tower already uses
   (tappable recent-value chips), sourced from batches *actually in stock* for this
   exact material (reusing the query already built for system-pick) rather than a
   guess — "confirm based on the batch number and what's existing in the system."
2. **Weight now pre-fills to 300kg** for Fine Leaf / Coarse Leaf manual rows (the
   standard bag weight, same convention `OutputPicker.tsx` already uses for Sieving) —
   a starting figure the operator confirms, not a forced value.
3. **Product type is now a confirmed display, not an active search box**, whenever it's
   already known (which is always, for a BOM-declared slot — the recipe already says
   exactly what goes there). Searching Master Inventory is now a deliberate "Change"
   action for the override case, not the default interaction every time.
4. **"+ Add Other"** — a distinct, separate action at the end of the ingredient list for
   logging a material that isn't part of the blend's declared recipe at all (searches
   Master Inventory, creates its own section going forward, flagged "not in recipe" in
   the ratio table) — instead of every ingredient slot looking like it might need one.

**Files:** `components/production/capture/BlenderCapture.tsx` only.

## 2026-07-15 — Alyssa (Production: schema audit + Sieving Tower per-bag print/write choice + FT-CON run fix)

Ran a full audit of the `production` schema (grown across ~15 migrations, hard to see
the current state of any table from one file) at the request of understanding what's in
`prod_debagging`/`prod_bagging`/`capture_activity` before wiring in traceability.
Reconstructed every table's true current columns from migration history and
cross-checked against real staging data. Findings (not all acted on yet — see below):
- `capture_activity` is a plain flat table (`session_id, operator_id, section_id,
  occurred_at`) — **not** JSON, despite appearing that way at a glance. The JSONB blobs
  are `prod_sessions.draft_data` and `prod_timesheets.{breaks,derived_data}`.
- **Fixed:** `production_runs.variant` was missing `'FT-CON'` in its CHECK constraint —
  it was created two weeks after the migration that widened every sibling table for
  FT-CON, and was never included. Any FT-CON session's day-level run rollup was
  silently failing to be created (the run-linking code wraps this in a try/catch on
  purpose so a run-schema hiccup never blocks the actual capture save — but it meant
  the rollup just silently never happened). `20260715_002_production_runs_ft_con.sql`
  brings it in line with `prod_sessions`/`bag_tags`/`prod_debagging`/`prod_bagging`/
  `shift_assignments`, which already all allow it.
- **Flagged, not yet acted on:** `bag_tags.destination` is read in 4+ places but only
  ever written by a dead legacy route (`/production/live/capture`, unreachable —
  operators are hard-redirected away from it) — every bag made through the *current*
  capture flow leaves it permanently NULL. That whole legacy cluster (`BagScanner.tsx`,
  `SievingTowerForm.tsx`, `PasteuriserForm.tsx`, `GranuleLineForm.tsx`,
  `RefiningForms.tsx`, the live-capture route) references `bag_tags` columns that don't
  exist in the schema at all — predates the 2026-06-11 schema rewrite, candidate for
  deletion. Also ~8 columns across several tables that are declared but never written
  by any live page (`prod_sessions.{scale_std_kg,scale_actual_kg}`, `bag_tags.location`,
  `shift_assignments.notes`, `bom_components.{warehouse,uom}`,
  `prod_mass_balance.{water_kg,dust_extraction_kg,floor_waste_kg}`). Left in place
  pending a decision on each — dropping a column is a one-way door, wanted confirmation
  first.

**Sieving Tower now has the same per-bag "Print label" / "Write on tag" choice Blender
already has**, instead of the site-wide `LABEL_PRINTING_ENABLED` flag (which stays
`false` and now goes unused by Sieving — every other section using it is unaffected).
Lets Sieving Tower test the real printer today without turning printing on everywhere
that flag touches. Reprint is still available once a bag's tagged as printed.

**⚠️ Manual steps:** run `supabase/migrations/20260715_002_production_runs_ft_con.sql`
on staging (this session's `20260715_001_production_ref.sql` should already be in from
earlier today).

**Files:** `components/production/capture/SievingCapture.tsx` (per-bag tag-method
choice, mirrors `BlenderCapture.tsx`'s pattern), `supabase/migrations/
20260715_002_production_runs_ft_con.sql` (new).

## 2026-07-15 — Alyssa (Blender: purple/orange debag-bag colors, grade enforcement, traceability groundwork)

Floor feedback on the Blender screen, from real screenshots and a Pasteuriser job card
(the paper form that shows blend ratios/grades are genuinely fixed by the material's own
identity, not a free per-row choice):

1. **Debagging/Bagging tabs were both shades of purple** — barely distinguishable. Now
   purple (in) / orange (out), matching Sieving Tower's established in/out color pairing.
2. **Removed the manual "Local/Export" dropdown.** Grade (Export / Export Blend /
   Domestic) is already baked into which specific Master Inventory item a bag is — the
   BOM lists "Sieved Fine Leaf: Export Blend - Conventional" as a distinct component from
   "...Export..." or "...Domestic...". A separate dropdown defaulting to "Export" was
   redundant at best, actively wrong at worst (every Blender debag row has been writing
   `local_or_export = 'Export'` regardless of what was actually scanned — that field is a
   real, pre-existing column also used by Sieving, just never populated correctly here).
   `destination` is now derived from the picked/scanned item's own description.
3. **Grade consistency is now enforced.** A bag graded "Export Blend" at Sieving Tower
   must not be consumable under a "Domestic" slot at Blender — that's a hard rule, unlike
   the flexible "Other" ingredient slot (Cut Heavy Stick vs Corn Cutter, which stays a
   free search — those are legitimate substitutes, not a data error). Scanning or
   searching in a bag whose grade doesn't match the slot's declared grade is now
   rejected with a clear message; slots with no grade concept (Blocks, Sticks, Granules)
   are unaffected.
4. **Traceability groundwork** (not a trace feature yet — real scan data needs to be
   flowing consistently first): which blend a debagging/bagging row belongs to was only
   ever recorded as free text inside `notes` (e.g. "blend 25CH60C40WBC") — unreliable to
   query. Added a real `production_ref` column to `prod_debagging`/`prod_bagging` so a
   future "trace this bag back to its Sieving Tower batch" feature has something solid
   to query against once bag-tag scanning is consistently used on the floor instead of
   the current dual paper/system run.

**⚠️ Manual step required:** run `supabase/migrations/20260715_001_production_ref.sql`
in the staging Supabase SQL editor (adds `production_ref` to both tables).

**Files:** `components/production/capture/BlenderCapture.tsx` (colors, grade
derivation/enforcement, `parseGrade`), `app/(app)/production/capture/[section]/page.tsx`
(`production_ref` + `local_or_export` now actually written for Blender's debag/bag rows),
`supabase/migrations/20260715_001_production_ref.sql` (new).

- Explicitly deferred (discussed, not building yet): a real bag-lineage trace UI, and
  moving blend selection toward "confirm the Pasteuriser job card you're executing"
  instead of a free search — both are real follow-ups once today's data-quality fixes
  are live and scanning is consistent, not day-one work.

## 2026-07-15 — Alyssa (Sieving: restrict output batch to lots debagged this session)

Floor feedback: batch/lot numbers were free-typed on both Sieving Tower and Granule Line, and typos (a `.` instead of a `-`, lowercase instead of caps, a dropped digit) were slipping bad batch numbers into records — an output could end up tagged with a batch that was never actually debagged that session.

- **Sieving Tower output batch is now tap-only, not typed.** `BatchKeypadField` gained a `restrictToOptions` mode: when set, it renders the allowed batch numbers as tappable chips only — no text input, so a typo literally can't happen. `OutputPicker` now passes this mode whenever `batchHints` (the lots actually debagged this session, already computed in `SievingCapture.tsx`) is non-empty, and also hard-validates in `confirm()` that the selected batch is one of those hints before allowing the bag to be added. If no batches have been debagged yet this session, the field shows a message prompting the operator to capture a debagging row first instead of silently blocking.
- **Granule Line not touched.** It has no separate typed output-batch field today (output bags always carry the fixed session lot), so there's nothing equivalent to restrict yet — needs its own design pass on what "output batch" even means there before a fix can be scoped.

**Files:** `components/production/capture/BatchKeypadField.tsx`, `components/production/capture/OutputPicker.tsx`.

## 2026-07-15 — Alyssa (Auth: HR gated behind permission, staging login banner, Logistics added to Users & Roles)

Three requests: (1) staging login should look visually distinct from prod, (2) prod sessions weren't signing out after an hour of inactivity, (3) HR pages and Logistics needed proper gating in Users & Roles.

1. **Staging login banner + accent.** No env/hostname signal existed anywhere in the app to tell staging from prod at runtime — both were purely a deployment-topology difference (different Supabase project, branch, port). Added `NEXT_PUBLIC_APP_ENV` (set on each VPS's `.env.local`: `staging` on the staging box, `production` on the prod box — both untracked, so this only lives in `.env.example`/`.env.local` locally and on the servers). `app/login/page.tsx` now shows an amber "STAGING — testing environment" banner and amber accent color when that var is `staging`. Takes effect on next build (staging: automatic on next deploy; prod: next manual deploy, whenever that happens).
2. **Prod 1-hour sign-out — root cause found, not yet shipped.** The idle-logout bug (staying signed in indefinitely) was already fixed on `staging` in commit `5a84ecf` (`fix(session): wall-clock idle logout`, part of #360, merged 2026-07-09) — it replaced a naive `setTimeout` (which misses idle time on a slept device/throttled background tab) with a wall-clock comparison. That fix was never promoted to `main`. **Not touched here** — promoting to prod is a deliberate, separate action per project rules; flagging for explicit go-ahead rather than bundling into this branch.
3. **HR and Logistics now gated + visible in Users & Roles.** New permission `can_access_hr` gates Staff & Skills, SOP, and Skills Matrix (`/production/staff*`) — these view *other people's* HR data, so they're no longer "anyone logged in can see this." Training & Courses (`/training`, personal course-taking) stays universal since every employee needs to reach their own assigned training. Granted `can_access_hr` by default to every role that already had `can_view_staff` (supervisors, managers, HR roles, Management) so no one currently using it loses access. New permission `can_access_logistics` added alongside Logistics' existing department gate (Production/Quality/Management) so admins can now grant Logistics to someone outside those departments, mirroring the `can_access_maintenance` pattern — Logistics previously had zero presence in the permission matrix.

**Known follow-up (not fixed):** enforcement everywhere in this app is client-side only (`app/(app)/layout.tsx` + Sidebar) — there's no middleware or RLS backing it. `production.employees` RLS is `USING (true)`, so `can_view_staff`/`can_access_hr` aren't enforced at the data layer, only in the UI. Same gap likely exists for Logistics tables. Out of scope for this session (needs a migration + review), flagging for a follow-up.

**Files:** `app/login/page.tsx` (staging banner/theme), `lib/auth/permissions.ts` + `lib/auth/permission-registry.ts` (`can_access_hr`, `can_access_logistics`), `components/layout/Sidebar.tsx` + `app/(app)/layout.tsx` (wire the new gates into nav + route guards, remove `/production/staff` from the always-open list). Also folded in previously-uncommitted HR IA cleanup (`/hr` hub removal, "← HR" back-links removed from `training/page.tsx`, `users/page.tsx`, `StaffTabs.tsx`, `WorkforceTabs.tsx` — direct sidebar links replaced the hub per earlier feedback).

## 2026-07-14 — Gustav (Granule: add delete tasting)

**Files changed:** `app/(app)/quality/granule/page.tsx`

- **Added a delete button for tasting records.** Sample edit/delete already existed (✏️/🗑 on each sample row) and tastings could already be edited inline, but there was no way to delete a tasting — added a 🗑 button next to the existing ✏️ Edit on each inline tasting row, guarded by a confirm prompt, wired through `handleDeleteTasting`.

---

## 2026-07-14 — Gustav (Granule: cap tasting at one per sample, not one per batch)

**Files changed:** `app/(app)/quality/granule/page.tsx`

- **Fixed:** the previous "one tasting per batch" cap was too strict — it blocked adding a tasting to *any* sample once *one* sample in the batch had a tasting, hiding the "Add Tasting" button entirely for new samples. Changed to cap at one tasting per **sample**: each sample can have its own tasting, but once a sample has one, only editing it is allowed (guarded in both the UI and `handleAddTasting`). The batch-level "at least one tasting before allocating" rule on the Allocate button is unchanged.

---

## 2026-07-14 — Alyssa (Shift roster: fix cron 401, auto-dismiss reminders on submit)

**Files changed:** `app/(app)/production/roster/page.tsx`, `app/api/production/roster/cron/route.ts`, `components/layout/NotificationBell.tsx`, `lib/notifications/index.ts`, `supabase/migrations/20260714_002_roster_reminder_dismiss.sql`

- **`roster-rotate.yml` was 401'ing on every run.** Root cause: the GitHub Actions repo secret `CRON_SECRET` had never actually been created (the 2026-07-06 ops note only confirmed the server-side env var existed, not the GH Actions secret) — the workflow sent an empty/mismatched Bearer token, `handle()` in `app/api/production/roster/cron/route.ts` correctly rejected it, and cron auth fell through to session-based auth which has none. Confirmed by SSHing into staging and hitting the live endpoint with the VPS's own `CRON_SECRET` value (`400` for a deliberately-bad `?task=` beats a `401`, so auth itself was fine). Fixed by encrypting that same value with the repo's Actions public key and creating the `CRON_SECRET` repo secret via the GitHub API — no code change.
- **Reminder notifications now auto-dismiss when a section is submitted.** Previously `doRemind()` aggregated every pending section a user was responsible for into one untagged notification, so it had no link back to what it was about and lingered in the bell/email forever, even after the section was signed off. Split into one notification per `(user, section)` pair, tagged with new `roster_period_id` / `roster_section` columns on `maintenance.notifications`. A new trigger, `production.dismiss_roster_reminders()` (fires on `production.roster_section_status` submit), deletes every matching notification the moment that section is submitted — for every recipient who got one, not just the person submitting. The roster page also dispatches the existing `notifications:refresh`-style window event after a successful submit so the bell (mounted in the layout, not this page) drops the entry immediately instead of waiting for the next page load.
- **Migration to run (staging first):** `supabase/migrations/20260714_002_roster_reminder_dismiss.sql`.

---

## 2026-07-14 — Alyssa (Production: blend run continuity, sharper Master Inventory search, supervisor code sign-off)

Follow-up to today's earlier Small Blender / per-material session, closing three gaps found once blend selection moved to the batch record instead of the shift assignment:

1. **"Same blend → continue the record, different blend → new tracked run" now actually works.** `runGrade()` in `[section]/page.tsx` didn't know about `BlenderData.bomId` at all — Blender's run-continuity key (`poKey` + `variant` + `grade`) had no blend-code component, so two different blends captured in the same shift/variant were silently treated as the *same* open run, and the "Continue the production run?" prompt could never distinguish them. `runGrade` now returns the active production's `bomId` for Blender/Small Blender (mirroring how Granule already discriminates by product item); the `findOpenRun`/`openRun`/lazy-run-open gates that used to check `needsGrade || isGranule` now also check `isBlenderRun`, and the continue-detection effect no longer offers a stale prompt before a blend is even chosen. The "production order" being tracked is the blend code itself, the same model Sieving/Refining/Granule already use — no new numbering scheme needed, just the existing `production_runs` mechanism actually wired up for Blender.
2. **Master Inventory search now narrows correctly as you type.** `filterInventory` matched one contiguous phrase against `inventory_id + description`; a query like "cut heavy" would work but word-order or an extra space could silently drop real matches in this ~630-item list. It now splits the query into words and requires every word present (any order, either field) — each additional letter/word typed narrows the result set rather than requiring one exact phrase, cutting down on picking the wrong item by mistake.
3. **Supervisor confirms item codes at sign-off before approving.** Blender's ingredient/product-type fields are searched from Master Inventory rather than picked off a closed list, so a wrong search result is a real (if now less likely) possibility. `BlenderInputBag` now carries a resolved `productCode` (from the scan's `bag_tags.acumatica_id`, a system-pick, or an `ItemPicker` selection); `blenderCapturedCodes()` collects every distinct code/description a session actually captured, unresolved ones flagged. The Sign-off tab now lists them and gates "Approve & lock" on a supervisor checkbox confirming they're correct — scoped to Blender/Small Blender only (empty list elsewhere, so the block doesn't render for other sections).

**Also answered:** confirmed — no, capture-form persistence is not a Blender-specific concern; audited `persist()`/`ensureSession()`/the four autosave triggers (2.5s debounce, 20s backstop, visibility/pagehide flush, explicit Save) in `[section]/page.tsx` and none of them branch on `sectionId` — every section saves identically. Also found (not fixed, flagging for awareness): `CaptureOverview.tsx`'s `showSerials` prop is dead code — serials are shown unconditionally to anyone who expands a row in the Overview tab, regardless of the `isIT` gate `page.tsx` passes in.

**Files:** `app/(app)/production/capture/[section]/page.tsx` (run-continuity fixes, sign-off code-confirmation block), `components/production/capture/BlenderCapture.tsx` (`productCode` field, `blenderCapturedCodes`), `lib/production/inventory.ts` (`filterInventory` multi-word matching).

## 2026-07-14 — Alyssa (Production: Small Blender + Blender refinements — real per-material ingredient sections, Master Inventory search, in-capture blend switching)

Follow-up to yesterday's Blender/Master Inventory/Blends session, from floor feedback:
1. **Small Blender** now captures too — reuses `BlenderCapture` as-is (it was already generic over "whichever BOM is chosen"), scoped to the `05-BLENDER SMALL` work centre so its picker never offers a Big Blender recipe or vice versa.
2. **Ingredient sections are now per real material, not per coarse A-F column.** The old column scheme (inherited from `lib/production/live-types.ts`'s `BLENDER_INPUT_COLUMNS`) lumped "Blocks: Cut" and "Cut Heavy Stick" into one shared column — different Acumatica items, wrongly merged into one weight. `lib/production/bom.ts`'s `groupComponentsByItem` now groups by `component_item_id`, so every distinct material always gets its own section, its own weight, its own name — never merged, regardless of what column letter it happened to be tagged with.
3. **"Other" now shows the real material name and searches Master Inventory**, instead of a generic "Other" label locked to one BOM-declared type. A blend like SG-NAT26's flexible slot is sometimes Cut Heavy Stick, sometimes Corn Cutter Fine Leaf — `ScanRow`'s product-type field is now a live Master Inventory search (`ItemPicker`, extracted as a shared component so the Blends page and Blender capture use the same one) instead of a closed dropdown, and the strict `allowedTypes` scan gate was dropped for Blender specifically (existence/already-consumed/variant-family/finished-product checks still apply — those are real mistakes, not substitutions).
4. **Blend code is now picked in Capture, not locked to the Assign screen.** A shift can run several different blends in a day; requiring the supervisor to re-edit Assign every time was going to become a real bottleneck. `BlenderData` now owns its own `bomId` (prefilled from the Assign screen's pick as a convenience default, but freely switchable per batch record in Capture, locked once any weight is captured — start a new batch record, an affordance that already existed, to run a different blend). Assign's picker is now explicitly labelled as just the shift's starting default.

**⚠️ Manual step required before Small Blender works:** run `supabase/migrations/20260714_001_smallblender_section.sql` in the staging Supabase SQL editor — `prod_sessions` and `shift_assignments` both had a `section_id` CHECK constraint that predates Small Blender and needs widening.

**Files:** `lib/production/bom.ts` (`groupComponentsByItem` replaces `groupComponentsByColumn`; `listBlenderBoms` takes an optional `workCentre` filter), `components/production/capture/ItemPicker.tsx` (new, shared), `components/production/capture/BlenderCapture.tsx` (per-item sections, in-capture blend picker, `WORK_CENTRE_FOR_SECTION` export), `components/production/capture/BlendCodePicker.tsx` (`workCentre` param), `app/(app)/production/blends/page.tsx` (now imports the shared `ItemPicker`), `app/(app)/production/capture/[section]/page.tsx` + `assign/page.tsx` (new `isBlenderSection()` helper covers both `blender`/`smallblender` everywhere the old code checked `sectionId === 'blender'` alone), `lib/production/capture-config.ts` + `lib/production/checks-config.ts` (add `smallblender`), `supabase/migrations/20260714_001_smallblender_section.sql` (new).

## 2026-07-13 — Alyssa (HR: link login accounts to Staff Directory profiles + "where does this fit" info buttons)

Follow-up to yesterday's HR/Training restructuring, after the question "can't the system match names and emails... so it works as one coherent system." Investigated first — the PIN/Capture side already required an `employee_id` link on every new operator (enforced since PR #362), but the **login side never did**: `shared.app_roles.employee_id` has existed as a column since 20260709_001_people_links.sql, but nothing in the Users & Roles create/edit flow ever read or wrote it. A person could get a Microsoft-SSO login and a Staff Directory profile that never once pointed at each other.

**What changed (no new migration — `employee_id` already existed):**
- `app/api/admin/users/route.ts` (GET/POST) and `.../[id]/route.ts` (PATCH) now read/write `app_roles.employee_id`, matching the pattern the operators/PIN API already used.
- `app/(app)/users/page.tsx` — new `EmployeeLinkField` in the New User / Edit / Assign-role modal: search Staff Directory by name, with an exact-email match surfaced as a one-click suggestion (never auto-linked — an admin still confirms). The user list now shows each login's linked person, or a suggested match for unlinked ones.
- Brand-new SSO sign-ins with no role yet (`no_role` "orphans") get the same exact-email suggestion, sourced from `production.employees.email`, and the "New user signed in" admin notification email (`app/api/auth/notify-new-user/route.ts`) now names the likely match.
- Staff Directory → "Create one →" (`app/(app)/production/staff/[id]/page.tsx`) now deep-links to `/users?newFor=<id>&name=…&email=…`, which pre-opens the New User modal already linked to that person — zero re-searching, zero chance of linking the wrong one.
- New `components/hr/PageInfo.tsx` (`PageInfoButton`) — a small (ⓘ) button added to the top of `/hr`, `/users`, `/production/staff`, and `/training`, explaining what each page actually is, who it's for, and where the related pieces of the system live (e.g. Users & Roles explicitly says it's IT-only for *access*, not where a person's profile is created). Added a matching blurb to the Shift Roster's existing help modal rather than a second icon.

**Still true from yesterday:** the `hr` schema migration + seed have not been run yet — see the earlier entry. This session confirmed there is no way to run that migration from a Claude Code session without a direct Postgres connection string or a Supabase personal-access token (only the PostgREST API URL + anon/service-role keys are in `.env.local`, which don't grant raw SQL execution) — it still needs the SQL Editor.

---

## 2026-07-13 — Alyssa (HR: new HR section hub + Training module redesign — Staff & Skills moved underneath, cross-linked with Rosters/Users & Roles/Audit Trail)

Follow-up to yesterday's Training Phase 1 build, after feedback that the `/training` page had gotten cluttered — a flat row of "Manage courses / Assignments / Review queue / Sign-off / Competency dashboard" buttons crammed above the learner's own course list. Restructures the information architecture instead of just tidying that one page: **HR** is now its own top-level nav section, hosting **Staff & Skills** (moved out of "Operations") and **Training** as modules, each reached via a proper card-grid hub rather than sidebar sprawl or button rows.

**Files:** `app/(app)/hr/page.tsx` (new — the HR hub); `components/hr/HubCard.tsx` (new — shared card tile, used by both hubs); `app/(app)/training/page.tsx` (rewritten — now a card hub: My Training / Manage / Assignments / Review / Sign-off / Competency); `app/(app)/training/my/page.tsx` (new — the actual learner course list + kiosk PIN switch, moved out of the old `/training`); `app/(app)/training/course/[slug]/page.tsx` (back-links updated to `/training/my`); `components/layout/Sidebar.tsx` (removed the 5-item "Training" nav group and "Staff & Skills" from "Operations"; both now live under one new "HR" nav entry → `/hr`; floor operators' sandboxed nav now points straight to `/training/my`); `app/(app)/layout.tsx` (route-guard/always-open updates for `/hr` and `/training/my`); `components/production/StaffTabs.tsx` and `components/production/WorkforceTabs.tsx` (added an "← HR" breadcrumb plus cross-reference links between Staff Directory, Shift Roster and Training — each is now one click from the other two); `app/(app)/users/page.tsx` (added an "← HR" breadcrumb).

- Nothing moved at the data layer — this is nav/IA only. Competency writes still land in `production.employee_competencies` on a live Supabase read with no caching, so Staff & Skills, Training and the Competency Dashboard already reflect each other immediately; "real-time" here means no stale cache, not a new sync mechanism.
- No dedicated Audit Trail page exists yet — it's currently a tab inside Users & Roles (IT-only), gated separately from the `can_view_audit_log` permission key that already exists but isn't enforced there. The HR hub's "Audit Trail" card links to that tab for now rather than a new page; flagging this as a gap worth a dedicated page later if wanted.

## 2026-07-13 — Alyssa (Production: Master Inventory + Blends (BOM) pages, and Blender capture)

Builds the Blender production-capture section on the same proven blueprint as Sieving/Refining/Granule (`[section]/page.tsx` + `*Capture.tsx`), plus two new pieces of editable master data it depends on that didn't exist as browsable pages before: **Master Inventory** (`production.inventory_items`, previously only reachable via a bulk-upload admin tool) and **Blends** (BOM recipes, previously living only in a spreadsheet). Blends validates its component item codes against Master Inventory (a live search picker, not free text) and Blender capture reads the Blends table directly — no publish/sync step, so a ratio correction on the Blends page is live in capture immediately.

**⚠️ Manual steps required before this is live (not run from this session — see CLAUDE.md's DB workflow):**
1. Run `supabase/migrations/20260713_001_blender_bom.sql` then `supabase/seeds/blender_bom_seed.sql` in the **staging** Supabase SQL editor.
2. Verify the new nav entries (Master Inventory, Blends) and route guards work once logged in — this session couldn't complete Microsoft SSO / PIN auth from its sandboxed browser, so the new pages are confirmed to build and route (no 404/500, no console errors) but not click-tested end to end. Please walk through: adding/editing an inventory item, adding a blend with components picked from Master Inventory, then picking that blend on the Assign screen and confirming Blender capture releases only its ingredients.

**Files:**
- New: `supabase/migrations/20260713_001_blender_bom.sql` (`production.bom_components` table + `bag_tags.tag_method` column), `supabase/seeds/blender_bom_seed.sql` (137 rows / 43 blend BOMs extracted from the Acumatica BOM export), `lib/production/bom.ts` (BOM read helpers + ingredient-column matching), `app/(app)/production/inventory/page.tsx` (Master Inventory grid), `app/(app)/production/blends/page.tsx` (Blends header/detail grid), `components/production/capture/BlenderCapture.tsx`, `components/production/capture/BlendCodePicker.tsx`
- Additive only: `app/(app)/production/capture/[section]/page.tsx` (new `blender` branches in the section dispatch, `gradeless`, `emptyProduction`, `buildDebag`/`buildBag`/`prodTotals` — no existing Sieving/Refining/Granule branch touched), `app/(app)/production/capture/assign/page.tsx` (blend-code picker replaces the generic production-order-items list only for `sectionId === 'blender'`), `lib/production/capture-config.ts` (flipped `blender` into `sectionMeta().built`), `lib/auth/permissions.ts` + `lib/auth/permission-registry.ts` (new `can_view/edit/delete_inventory` + `can_view/edit/delete_blends` keys), `components/layout/Sidebar.tsx` + `app/(app)/layout.tsx` (new nav entries + route guards)
- Untouched: `SievingCapture.tsx`, `RefiningCapture.tsx`, `GranuleCapture.tsx`, `BagScanner.tsx`, the older unwired `BlenderForms.tsx` (superseded, left in place)

- Blender capture reuses the same scan/system-pick/manual 3-mode input pattern already proven on Refining, validated through the shared `validateBagScan()` (existence, already-consumed, variant-family, product-type allow-list, finished-product block) — the allow-list per ingredient column (A–F) comes live from the chosen blend's BOM, so only that blend's real materials can be scanned in. Output bags get a per-bag "Print label" / "Write on tag" choice (both always available, independent of the site-wide `LABEL_PRINTING_ENABLED` flag) for testing the new handheld scanner + printer.
- Deliberately did **not** touch `BagScanner.tsx`'s camera-scan path (a reported "camera won't open" bug) — that component belongs to the older, unwired capture stack; the new Blender build uses the hardware-scanner text-input approach already working on Sieving/Refining/Granule, so it doesn't depend on the camera at all.
- `bom_components.output_item_id` / `component_item_id` are intentionally *not* hard foreign keys into `inventory_items` — the source spreadsheet predates a full inventory reconcile, so a hard FK would make the seed fail outright on a stale code. The "must exist in Master Inventory" rule is enforced at the UI layer (the Blends page's item picker only offers real items) and stale/unresolved links are surfaced as a dashboard count instead of a hard block.

## 2026-07-12 — Alyssa (Training: staff portfolios — video lessons + digital assessments → auto-updates the competency matrix)

Phase 1 of the long-parked "staff training profiles" initiative (raised 2026-07-09), driven by the need to get every operator trained on the new tablet-capture process (#361/#362) — efficiently, but still with the work-instruction + tested-competency audit trail FSSC requires. Digitizes the paper Refining 1 / Sieving Tower / Pasteuriser assessments into in-app courses: embedded YouTube work-instruction videos → a digital, mostly auto-graded assessment → a pass writes straight into the existing `production.employee_competencies` + `competency_history`, so the Skills Matrix reflects training automatically instead of a training officer marking paper by hand.

**New DB schema:** `hr` (separate from `production`, which keeps owning competency *state*) — `training_courses`, `training_lessons`, `training_questions` + `training_question_options`, `course_sops` (course → one or many SOP competencies), `training_assignments`, `training_attempts` (the audit record), `lesson_progress`. Adds `production.sops.requires_practical_signoff` — theory-only SOPs auto-advance to `competent` on a pass; hands-on machine SOPs advance to `assessed` and wait for a supervisor's practical sign-off.

**⚠️ Manual steps required before this is live (not run from this session — see CLAUDE.md's DB workflow):**
1. Run `supabase/migrations/20260710_001_hr_training.sql` then `supabase/seeds/training_seed.sql` in the **staging** Supabase SQL editor.
2. Add `hr` to **Exposed schemas** (Supabase dashboard → API settings) on staging (and production, once promoted) — PostgREST can't reach a schema that isn't exposed.

**Files:** `supabase/migrations/20260710_001_hr_training.sql`, `supabase/seeds/training_seed.sql` (new); `lib/auth/permissions.ts`, `lib/auth/permission-registry.ts` (new `can_author_training`/`can_assign_training`/`can_view_all_competency` keys + a new **HR** department with `training_officer`/`hr_manager` roles); `lib/training/*` (new — grading engine, shared question-kind config, PIN-identity helper); `app/api/training/**` (new — courses, assignments, attempts, manual-review); `app/(app)/training/**` (new — learner "My Training" + course player, and HR pages: manage courses/lessons/questions, assignments, review queue, practical sign-off, cross-department competency dashboard); `components/training/*` (new); `components/layout/Sidebar.tsx` + `app/(app)/layout.tsx` (new top-level Training nav group + route guards); `app/(app)/production/staff/[id]/page.tsx` (new Training portfolio panel); `app/api/staff/competencies/route.ts` (fixed a pre-existing bug — the route returned `{ok, id}` but the profile page's optimistic UI update expected `{competency, historyRow}`, so edits never reflected until a reload).

- Grading is server-side only — `is_correct`/`match_key` never reach the learner's browser. Six question kinds (single/multi-choice, true/false, numeric-with-tolerance, matching, short-text) cover everything in the three paper memos; the ~4 "marker's-discretion" questions route to a training-officer review queue with a provisional score instead of blocking.
- Floor operators are PIN-only (no login) and sandboxed to `/production/capture` by the layout guard — added a `/training` exception so they can reach their own training, plus a PIN-attested "take training as someone else" kiosk flow for shared tablets (mirrors the existing Capture shift-changeover PIN pattern).
- Digitized all three memos' questions faithfully, including their standard weights, temperatures, and procedures; four repeated "who is responsible" questions (the memo's hand-marked correct answer didn't survive as text/formatting in the .docx) were confirmed directly with the training owner rather than guessed, given the FSSC/audit stakes of getting a competency test wrong.

## 2026-07-09 — Alyssa (Shift Roster: rename "Rosehip" role to "Value Added Product")

**Files:** `lib/production/roster-config.ts`

- Renamed the `rosehip` role's display label from "Rosehip" to "Value Added Product" in the fallback role catalogue. The live label is actually seeded in `production.roster_roles.name` (DB row, `key='rosehip'` unchanged — nothing else references the name), so the visible rename requires running `UPDATE production.roster_roles SET name = 'Value Added Product' WHERE key = 'rosehip';` on staging and production.

## 2026-07-09 — Alyssa (Roster: fix staff-picker cancelling itself on selection — regression from same-day click-outside fix)

**Files:** `app/(app)/production/roster/page.tsx`

- The click-outside dismissal added earlier today (`PersonEditor`) had a race: picking a match calls `setOpen(false)`, which synchronously unmounts the search/dropdown DOM as part of the same click. By the time the bubble-phase `mousedown` listener ran, the clicked button was already detached, so `rootRef.current.contains(ev.target)` read `false` and the handler wrongly fired `onCancel()` — cancelling the selection the instant it was made. Net effect: staff could not be added to the Shift Roster at all.
- Fix: register the outside-click listener on the **capture** phase instead of bubble, so the containment check runs before React mutates the DOM in response to the click. Verified with an isolated DOM reproduction of the exact race (bubble-phase wrongly cancels; capture-phase does not) since the live app isn't reachable without auth from this environment.

## 2026-07-09 — Alyssa (Roster: staff-picker dropdown click-outside + redesign)

**Files:** `app/(app)/production/roster/page.tsx`

- The "+ Add" staff-search popup on the Shift Roster grid (`PersonEditor`) had no click-outside dismissal — it only closed on Escape or Save/Cancel, so it stayed open and overlapping the rows below it. Added the same click-outside pattern already used elsewhere in the app (`NotificationBell.tsx`): a ref + `mousedown` listener that calls `onCancel()` when the click lands outside the card.
- Redesigned the match list: colored department avatar (initial letter, reusing `categoryMeta`) + department label in matching color, replacing the plain text row; added a "No staff match…" empty state when a search finds nothing (previously showed nothing at all); rounder corners and a heavier shadow to read as a proper popover.

## 2026-07-09 — Alyssa (Staff Directory: show PIN + login status per person)

Follow-up to the people-identity-links work (#362), once the migration was run on staging. The Staff Directory profile already showed a person's linked PIN operator and login account, but the list view didn't — you had to open each profile to check. **No database migration required.**

**Files:** `app/api/staff/identities/route.ts` (new), `app/(app)/production/staff/page.tsx`

- New bulk endpoint `GET /api/staff/identities` returns every linked PIN operator + login account in one call (avoids an N+1 fetch per row). Login email/role is only included for IT / `can_manage_users`; everyone else gets a has-login flag only, same visibility rule as the per-employee endpoint.
- Each row in the Staff Directory list now shows a PIN badge (operator code) and a login badge (email for IT, "Login" otherwise) when present, dimmed if inactive.

## 2026-07-09 — Alyssa (People Identity Links: Staff Directory as the single front door + full audit trail)

Follow-up to the same day's Staff Directory work. CNTP had three "add a person" surfaces (Staff Directory, Operators/PIN, Users & Roles) that barely linked, so it was unclear where to add/remove someone and nothing was audited. This makes the **Staff Directory the single front door** for a person; PIN operators and login accounts become identity layers attached to that person; and every add/remove/relink is now audited.

**⚠ Requires `supabase/migrations/20260709_001_people_links.sql` to be run in the Supabase SQL Editor (staging first) to fully activate the operator↔employee↔login linking. The code degrades gracefully (writes without the link) if run before the migration, so this is safe to deploy first — but linking/offboard features are inert until the migration runs.**

**Files:** `supabase/migrations/20260709_001_people_links.sql` (new), `lib/audit/write.ts` usage added to `app/api/staff/route.ts`, `app/api/staff/[id]/route.ts`, `app/api/production/operators/route.ts`, `app/api/production/operators/[id]/route.ts`, `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`; `app/api/staff/[id]/identities/route.ts` (new), `app/api/staff/[id]/offboard/route.ts` (new), `lib/production/it-ticket.ts` (new), `lib/production/employee-payload.ts` (unchanged, reused), `app/(app)/production/staff/[id]/page.tsx`, `app/(app)/production/staff/page.tsx`, `app/(app)/production/operators/page.tsx`, `app/(app)/users/page.tsx`, `lib/supabase/database.types.ts`

- **Data model.** New migration adds `production.operators.employee_id` and `shared.app_roles.employee_id`, backfilled from the existing `employees.operator_id` reverse link. Every PIN and every login now traces back to one Staff Directory person.
- **Full audit trail.** Every add/edit/remove across Staff Directory, PIN operators, and Users & Roles now writes to `axis.audit_log` via the existing `writeAudit()` helper (previously only the production-orders route used it). PINs and passwords are never written to the audit log — snapshots redact them. The Users & Roles → Audit tab gained a "People & Access" quick filter and a Record (schema.table) column so these events are easy to find.
- **Employee profile is now the identity hub.** `/production/staff/[id]` shows the linked PIN operator (with an "Assign PIN & sections" action for supervisors) and linked login account (IT sees a link to Users & Roles; others see "Request login account", reusing the flow shipped earlier today).
- **Coordinated offboard.** Removing someone from the Staff Directory now calls `POST /api/staff/[id]/offboard` instead of a hard delete: marks the employee inactive, deactivates their linked PIN and login (blocks sign-in immediately), and raises an Axis ticket asking IT to delete the auth account. Fully reversible via a new "Reactivate" action — nothing is hard-deleted, so roster/capture history is preserved.
- **Closes the operator↔employee drift.** Creating a new PIN operator (via the Operators page) now requires linking to an existing Staff Directory person or creating one inline — so the two lists can no longer silently diverge. Editing a legacy (pre-migration) operator is not blocked on this.
- All new/changed DB writes tolerate the migration not having run yet (`42703` undefined-column) by falling back to writing without the link, so deploy order relative to running the migration is not a footgun.

## 2026-07-09 — Alyssa (Staff Directory: server-enforced add/remove + login-account requests)

Lets authorised people add and remove the staff who populate the Shift Roster, with the "function to do so" now actually enforced. **No database migration required.**

**Files:** `app/api/staff/route.ts` (new), `app/api/staff/[id]/route.ts` (new), `app/api/staff/[id]/request-login/route.ts` (new), `lib/production/employee-payload.ts` (new), `app/(app)/production/staff/page.tsx`

- **Add / edit / remove staff is now server-enforced.** `production.employees` has open RLS (`authenticated USING (true)`), and the Staff Directory wrote to it straight from the browser — so the `can_edit_staff_profiles` / `can_delete_staff` checks were cosmetic and *any* logged-in user could add or delete staff. Create/update/delete now go through new API routes that verify the caller's permission with `getCallerPermissions()` before touching the table. The two existing permissions are unchanged (grant them per-person in Users & Roles).
- **Fixed a latent gate bug.** The page checked `p?.can_edit_staff_profiles` — a property read on the `p` **function**, always `undefined` — so the Add/Edit/Delete controls were hidden for everyone. Now calls `p('can_edit_staff_profiles')` / `p('can_delete_staff')` correctly.
- **Request a login account (staff → auth-user bridge).** Creating sign-in accounts stays IT-only (at Users & Roles). On a staff person's editor, IT sees a link to Users & Roles; everyone else with staff-edit rights gets a "Request login account" action that opens an **Axis ticket** (category `app`, auto-routed to IT) describing who needs an account.
- Add/edit modal now shows a spinner while saving and surfaces server errors instead of failing silently; delete surfaces a page-level error if the server rejects it.

## 2026-07-09 — Alyssa (Ops batch: cleaning compliance, afternoon shift, session, hourly VSD, roster auto-publish)

Five changes shipped together. **No database migrations required.**

### Cleaning checklist — explicit ticking (compliance)
**Files:** `components/production/capture/CleaningPanel.tsx`, `lib/production/cleaning-config.ts`
- The capture cleaning panel was exception-based: every task rendered pre-ticked and sign-off auto-confirmed all areas, so an operator could sign off without touching anything (non-compliant). Inverted to explicit confirmation — each due task starts **unchecked** and must be ticked done, or flagged not-done with a reason, before the PIN sign is enabled.
- Per-task done proof is written to `cleaning_logs` (`area_confirmed` rows now carry `task_key`; `task_exception` unchanged) — no schema change.

### Afternoon shift — operators can sign in (16h00–01h00)
**Files:** `lib/production/shifts.ts`, `app/(app)/production/capture/page.tsx`, `app/(app)/production/capture/assign/page.tsx`, `app/(app)/production/capture/[section]/page.tsx`, `app/(app)/supervisor/page.tsx`, `app/(app)/supervisor/calendar/page.tsx`, `components/production/LiveCaptureKPIs.tsx`, `components/production/live/SessionModal.tsx`
- CNTP runs two shifts: Morning (07h00–16h00) and Afternoon/Night (16h00–01h00). The capture flow stores the 16h00–01h00 shift as `afternoon`, but the supervisor calendar wrote it as `night` — a value nothing on the capture side read. Result: operators signing in during 16h00–23h00 saw "No sections assigned", and the 16h00 hand-over found no incoming operators.
- Standardised the 16h00–01h00 shift on `afternoon` (displayed "Afternoon / Night"); `night` kept as a legacy alias, read via `shiftValuesFor()`. Clocks now resolve 16h00+ to `afternoon` (no more 23h00 split). Calendar Night column rosters `afternoon` and auto-fills from the roster's night band. Read paths accept both values for backward-compat.

### Session — reliable idle logout + sign out on shift submit
**Files:** `app/(app)/layout.tsx`, `app/(app)/production/capture/[section]/page.tsx`
- The 1-hour logout was a single `setTimeout` that browsers throttle in background tabs and drop when a device sleeps, leaving users logged in past the hour. Reworked to a wall-clock model (last-activity timestamp, re-evaluated on a 1s tick and on `visibilitychange`/`focus`) so a slept/throttled tab signs out the moment it wakes. Idle window unchanged (60m, 5m warning).
- A **floor operator** is now signed out when they submit their shift, so the incoming shift signs in fresh. Supervisors/IT capturing on a shared tablet are not signed out.

### Hourly VSD infeed prompt
**Files:** `components/production/capture/HourlyVsdPrompt.tsx` (new), `app/(app)/production/capture/[section]/page.tsx`
- Operators were never actively prompted to log the hourly infeed-VSD reading, and the passive nudge disappeared once checks were signed. Added a page-level modal that auto-pops whenever an hourly reading is due while the line is running and the session is open — **including after checks sign-off**. Readings append to `production.check_events` (flagged if outside the supervisor-set range); "Remind me shortly" snoozes 10 min. Only sections with an hourly numeric check (Sieving) surface it. Dashboard VSD KPIs already consume these events.

### Roster — Wednesday workflow: outstanding tracker, auto-publish, green export
**Files:** `app/(app)/production/roster/page.tsx`
- Added a confirmations tracker (X/N departments confirmed + which are outstanding), emphasised red on the Wednesday deadline. Once every department shown in the grid has submitted, the period **auto-publishes** (and syncs the maintenance duty roster); manual early-publish still available. **Export/Print buttons turn green** once published to signal the confirmed roster is ready to share.

---

## 2026-07-08 — Alyssa (Production Orders: record numbering + permissioned edit / soft-delete with audit trail)

**Files changed:** `supabase/migrations/20260708_001_prod_record_mgmt.sql` (new), `lib/audit/write.ts` (new), `app/api/production/orders/[id]/route.ts` (new), `app/(app)/production/orders/page.tsx`, `app/(app)/production/capture/[section]/page.tsx`

**⚠ Requires the migration to be run in the Supabase SQL editor (staging then prod) before the edit/delete actions work — see `20260708_001_prod_record_mgmt.sql`.**

- **PO / record numbering.** `prod_sessions` gains a `record_no` auto-assigned by a DB trigger — `<SECTIONCODE>-<DDMMYY>-<NN>` (e.g. `ST-080726-01`), backfilled for existing rows. Shown on every Production Orders card, alongside the Acumatica production order(s) where set.
- **Edit / reopen / soft-delete / restore from the UI, permission-gated.** A per-card actions menu appears only for users with `can_edit_session` / `can_delete_session` (granted in Users & Roles):
  - **Edit details** — inline panel to change operators, variant, lot, and production order(s).
  - **Reopen for edits** — unlocks a submitted/approved record back to draft.
  - **Archive** (soft-delete) — sets `deleted_at`/`deleted_by`; hidden from the list, kept for audit, restorable via the new **Archived** toggle.
- **Audit trail.** All actions go through `PATCH /api/production/orders/[id]`, which verifies the caller's permission server-side and writes a before/after entry to `axis.audit_log` via the new `writeAudit()` helper. `edited_at`/`edited_by` are stamped on edits.
- **Line-data editing** (weights/batches) routes through the existing capture screen: cards now link with `?session=<id>`, and the capture page loads that specific record so corrections keep serials, bag_tags, scan_events, mass balance and the run rollup consistent.
- New `prod_sessions` columns: `deleted_at`, `deleted_by`, `edited_at`, `edited_by`, `record_no` (all additive/nullable). Reads are best-effort so the page still works before the migration is applied.

---

## 2026-07-08 — Alyssa (Capture: stop duplicate empty "No data" production sessions)

**Files changed:** `app/(app)/production/capture/[section]/page.tsx`, `app/(app)/production/orders/page.tsx`

- **Root cause:** `startNewProduction()` ("Start new batch record", shown on a submitted session) **eagerly inserted** a `prod_sessions` row the instant it was clicked. When a second user opened an already-submitted shift and clicked it without capturing anything, an empty `status='draft'` session with one blank production was left behind — the duplicate "In progress · No data" order (confirmed on prod: the empty morning Sieving row was created 7h after the real one, by a different user).
- **Fix — sessions are now created only when there's real capture:**
  - `startNewProduction()` is **lazy** — it resets local state (clears `sessionId`/refs, fresh production, `status='new'`) instead of inserting; the row is created on the first weighed entry.
  - `flushSave()` never creates a session unless `hasCaptureData()` is true, and **skips submitted/approved** sessions entirely (a second viewer of a signed-off shift can no longer spawn a row). Explicit **Save draft** is guarded the same way.
  - `ensureSession()` only **reuses a `draft`** most-recent session; if the latest is submitted/approved it opens a new row, so a genuine next-batch capture doesn't write back into a signed-off session.
  - The load now syncs `sessionRef` to the loaded session so autosave always targets it rather than creating a duplicate.
  - New `hasCaptureData()` helper covers all section types (sieving/refining/granule).
- **Production Orders list** hides stray empty drafts (a `draft`/`new` session with no debagging, bagging or mass balance) so any pre-existing empties don't clutter the view. Submitted/approved always show.

---

## 2026-07-08 — Alyssa (Sieving: output batch suggestions restricted to what was debagged)

**Files changed:** `components/production/capture/SievingCapture.tsx`, `components/production/capture/OutputPicker.tsx`

- **Output batch numbers now suggest only the lots actually debagged this run.** Operators were still mis-picking batch numbers on outputs because the Bagging picker widened its suggestions with recent DB batches + the assignment lot + previous output batches. Now the Sieving output picker's batch suggestions (and the default batch) come **only from the lot numbers captured on the Debagging tab** this session — so a batch that was never fed in can't be suggested on an output. `OutputPicker` uses the supplied `batchHints` exclusively when present and only falls back to recent DB batches when a caller passes none.

---

## 2026-07-07 — Alyssa (Sieving: bucket elevator by time of day — start-of-day IN on Debagging, end-of-day OUT on Bagging)

**Files changed:** `components/production/capture/SievingCapture.tsx`

- **Bucket elevator now sits on the tab that matches its direction.** Previously the single "Bucket elevator" field lived on the Debagging (in) tab on both shifts and only flipped its badge to "output" on the afternoon — so the **end-of-day** figure was captured under "what goes into the machine," an easy-to-miss mental-model mismatch. Now:
  - **Morning · Debagging (in):** "Bucket elevator — start of day" (from yesterday · consumed this morning) — counts as **input**.
  - **Afternoon · Bagging (out):** "Bucket elevator — end of day" (left in the tower for tomorrow) — counts as **output**, shown just above "Total bagged out".
  - **Machine spillage** is split into its own card and stays on the Debagging tab on both shifts (always an input loss).
- The mass-balance maths is unchanged (`sievingTotals(data, shift)` still reads `spillage[0]` as the elevator, `spillage[1]` as machine spillage); this is purely where/how the two fields are presented. `goToTab` no longer auto-locks the elevator when moving to Bagging on the afternoon shift (the operator fills it there). Card colour follows direction — blue for in, amber for out.

---

## 2026-07-07 — Alyssa (Granule quality graph now sourced from QC lab, linked by lot + date)

**Files changed:** `lib/production/granule-quality.ts` (new), `components/production/capture/GranuleCapture.tsx`, `components/production/ProductionDashboard.tsx`

- **One source of truth for granule quality.** The QC lab already captures moisture / bulk density per sample on the Granule QC page (`qms.granule_runs` → `qms.granule_samples`). Instead of re-capturing those readings in production, the graph now **reads from QC, linked by lot number + date**. New shared helper `fetchGranuleQuality({ lot, fromDate })` joins `granule_runs` (matched on `batch_number` via the same `normBatch` rule QC uses) → `granule_samples`, returning the moisture/bulk-density time series.
- **Granule capture**: removed the manual quality-readings entry (and the `quality` field on `GranuleData`); the Quality section now shows a **read-only graph pulled from QC for the current lot**, with a clear empty-state ("No QC readings yet for lot X…") until QC captures them. No more double capture.
- **Production Dashboard**: the granule quality chart now sources from QC (`fetchGranuleQuality`, by date window) rather than the capture draft, so the dashboard, the capture screen, and the QC page all draw the same numbers. Wording updated to say the readings come from the QC lab, linked by lot + date.

---

## 2026-07-07 — Alyssa (Granule: live quality graph in capture; scale verification → Checks; dashboard explains + audits pass/fail)

**Files changed:** `components/production/capture/GranuleCapture.tsx`, `lib/production/checks-config.ts`, `app/(app)/production/capture/[section]/page.tsx`, `components/production/ProductionDashboard.tsx`

- **Live quality graph in capture.** The granule Quality readings section now renders a live dual-axis chart (moisture % + bulk density cc/100g vs time) built straight from the rows the operator enters — no separate drawing step. This is the data behind the operators' hand-drawn graph and the basis for AI/uniformity research.
- **Scale verification moved to the Checks page.** Removed the scale std/actual capture from the granule capture header (and the `scaleStd`/`scaleActual` fields + the `prod_sessions` scale write). Added a granule Checks config — **Scale zero check → Scale verification (test load) → pre-start** — so it runs through the existing Checks engine, which already does pass/fail (deviation vs ±tolerance, default ±0.1 kg), maintenance-raise on fail, and audit-trail sign-off (`check_events`).
- **Dashboard now explains, not just reports.** The Granule card gained two "what each entails" panels — granule quality (uniformity → density/flow/structural integrity, precise batching) and scale verification (verification ≠ calibration; zero check → test load → pass/fail; NRCS/SANAS + Legal Metrology Act, on-site providers). The scale-health chart now reads from the Checks audit (`check_records` → `check_events`, `scale_verification`), and a new **Scale verification audit** table lists each verification (date · shift · standard · actual · deviation · Verified/Fail) with a pass-rate badge — the per-production compliance audit.

---

## 2026-07-07 — Alyssa (Granule: hide grade selector; granule quality + scale-health KPIs on the dashboard)

**Files changed:** `app/(app)/production/capture/[section]/page.tsx`, `components/production/ProductionDashboard.tsx`

- **Grade selector hidden for Granule.** The run logic was already gradeless for granule, but the batch set-up card still rendered the Grade dropdown (and grade help) because they were gated on `!startsWith('refining')`. Switched those to the `gradeless` flag, so Granule (like Refining) shows only the Variant selector — traceability comes from the per-bag system serials.
- **Granule KPI foundations added to the Production Dashboard** (`ProductionDashboard.tsx`): a new "Granule Line — quality & scale health" card with two daily-trend charts over the selected window — **granule quality** (avg moisture % + bulk density cc/100g, dual-axis — the digital version of the operators' hand-drawn graph) and **scale-verification health** (avg deviation = actual − standard test weight, with a zero reference line; drift away from zero is the early predictive-maintenance signal). Data is read directly: scale from `prod_sessions.scale_std_kg/scale_actual_kg`, quality readings from the session `draft_data`. Best-effort so a parse/schema hiccup can't take the dashboard down; shows an empty-state until data is captured.

---

## 2026-07-07 — Alyssa (Granule: scale verification + quality readings; run continuity fix + item-switch fork)

**Files changed:** `components/production/capture/GranuleCapture.tsx`, `app/(app)/production/capture/[section]/page.tsx`

- **Scale verification captured** on the Granule Line (std weight / actual weight) — required for audit, and now persisted to the dedicated `prod_sessions.scale_std_kg` / `scale_actual_kg` columns (not just draft JSON) so it can be tracked as a metric. The UI shows the live **deviation** (green / amber / red bands) as an early KPI signal toward scale-health / predictive-maintenance dashboards.
- **Quality readings** capture on the Granule Line — moisture (%) and bulk density (cc/100g) with time, the data behind the operators' hand-drawn graph, stored for later charting + KPIs.
- **Run continuity fixed + made item-aware.** `needsGrade` was still `true` for granule, which (after granule went variant-only) broke its cross-shift run detection — the continue-run prompt never showed and the run wouldn't open on the variant path. Granule is now correctly gradeless for the run logic, so a run **continues across shifts** (07h00→01h00, operators change, mass balance keeps rolling up) as long as variant + item stay the same. Added an **item discriminator**: the granule product item (SG / SF / Export) is stored in the run's `grade` slot, so switching SG → SF/Export **forks a new run** — exactly as the floor treats it. (`runGrade()` helper threaded through `findOpenRun` / `openRun` and the detection/persist call sites.)

---

## 2026-07-07 — Alyssa (Granule Line rework from floor feedback; unified mass-balance table; Sieving bucket-elevator direction)

**Files changed:** `components/production/capture/GranuleCapture.tsx`, `components/production/capture/MassBalanceTable.tsx` (new), `components/production/capture/CaptureOverview.tsx`, `components/production/capture/SievingCapture.tsx`, `app/(app)/production/capture/[section]/page.tsx`, `lib/production/label-print.ts`

- **Unified mass balance** — new shared `MassBalanceTable` renders one balance for the whole production run as a table (Morning / Afternoon rows + whole-run total; variance vs ±15 kg). It's shown in **one place, the Overview** (via `balanceRows`/`balanceNote` from the capture page). Sieving now treats the **bucket elevator directionally**: consumed on the morning shift (input), left for the next day on the afternoon shift (output), so the run balance closes honestly (`sievingTotals(data, shift)`; `prodTotals`/`sessionTotals` take a shift arg).
- **Granule Line reworked from floor feedback** (`GranuleCapture.tsx`):
  - **Blends colour-coded** (per-blend colour + numbered chip) and **dust types colour-coded** throughout; a blend must be marked **complete before the next is added** (completed blends collapse to a coloured chip summary). Water is entered per blend and excluded from Total Mixed (A).
  - **Product item chosen once per session** (SG / SF / Export Granules), which drives the by-product dust type (SG→SG Dust, SF→SF Dust) and locks after capture starts.
  - **Per-lot serials `DD-MM-YY-NNN`** — the sequence continues across days/shifts for the same lot (looked up from `bag_tags` by lot), e.g. RSGG-04526 → `07-07-26-001…006` today, `08-07-26-007` tomorrow.
  - Bagging table gains **Bag Weight (target)** + **Total Weight (actual)**, auto time, and an **auto-generated bagging summary** grouped by lot. An **amber warning** prompts recording the SG/SF dust output before finishing (it's consumed in the next production — the bucket-elevator analogue).
  - **Grade removed** (granule is variant-only, like Refining). The Mass Balance sub-tab was **removed from the section page** — only end-of-shift readings (D / E / meter Y-Z) remain there; the calculated balance shows in the Overview with a `G = C* + carry-over/waste` and **% yield** note.
- `CaptureOverview` groups granule debagging by dust type and renders the shared `MassBalanceTable`; the capture-page balance is suppressed for granule so its balance lives in exactly one place.

---

## 2026-07-07 — Alyssa (Granule Line capture built; camera scanner fixed; bag label redesigned)

**Files changed:** `components/production/capture/GranuleCapture.tsx` (new), `app/(app)/production/capture/[section]/page.tsx`, `components/production/capture/CaptureOverview.tsx`, `lib/production/capture-config.ts`, `components/production/BagScanner.tsx`, `lib/production/label-print.ts`

- **Granule Line is now a live capture section** (`/production/capture/granule`), built on the Sieving/Refining template but with the granule line's own blend-based layout, faithful to the paper forms PR-FM-026/7 (Plant Shift Mass Balance Report) and PR-FM-005.1 (Granule Bagging Station Report). New `GranuleCapture.tsx` with three sub-tabs:
  - **Pellet Mill Feed (inputs):** dusts fed in, grouped into blends (1–5). Each dust input uses the same three modes as Refining — **scan / type serial**, **pick from system** (in-stock `bag_tags`), or **manual entry** — so every path from the paper-to-system transition is captured. Per-blend water is recorded but (confirmed from the paper) excluded from Total Mixed (A). Dust column totals (Brown/CP, White, Indent, Leaf, ALT, SG, Dust Extraction, Other) + Total Mixed (A) are shown as the primary overview figure.
  - **Bagging (outputs):** one row per granule bag (item, auto time, target vs actual weight, auto-generated serial), a Dust-from-granule-line by-product table, and a Waste table. Output serials register in `bag_tags` + log a `bagging_out` scan event, exactly like Refining.
  - **Mass Balance:** the PR-FM-026/7 report — A (auto), C\* from the bagging summary (auto), carry-overs D (dust not re-fed) and E (coarse not fed), waste F, Total Produced G = C\*+D+E+F, Balance = H−G (flagged beyond ±15 kg), % yield = G/H, and running hours = meter stop (Z) − start (Y).
  - Wired into the orchestrator `[section]/page.tsx`: `buildDebag`/`buildBag`/`prodTotals`/`persist` now branch for granule (inputs → `prod_debagging`, outputs → `prod_bagging`, A vs G → `prod_mass_balance`), so cross-shift production-run continuity and the unified run mass balance work the same as the other sections. Flipped `built: true` for granule in `capture-config.ts`. `CaptureOverview` now groups granule debagging by dust type (the totals the plant reads first).
- **Camera bag scanner fixed** (`BagScanner.tsx`). Three bugs: (1) the detector only looked for `qr_code`, but CNTP's printed labels are **Code128 1D barcodes**, so it could never decode a real label — now requests every format the browser supports (`code_128`, `qr_code`, EAN, etc.); (2) when `BarcodeDetector` was unavailable (iOS Safari, some Android browsers) the code called `stopCamera()` immediately, so the camera "opened then closed" — the reported symptom; it now keeps the preview open with a read-and-type fallback; (3) a mount race where the stream could attach before the `<video>` existed — acquisition moved into an effect that runs after the element mounts, with `await video.play()` and clearer permission-vs-unsupported error messages.
- **Bag label redesigned** (`label-print.ts`). The old single cramped badge is replaced by two clearly-labelled fields — **Type** (RA Conventional / Conventional / Organic / RA Organic) and **Grade** (Export A / Export Blend B / Domestic C) — above a larger Code128 barcode + serial. The barcode still encodes only the serial (all metadata stays in `bag_tags`, so a data change never invalidates a printed tag). Printing stays gated behind `LABEL_PRINTING_ENABLED` (write-on-bag remains the default on the floor); this readies the template for when the printer is enabled.

---

## 2026-07-07 — Alyssa (Roster print: fix real root cause — app shell clips print output to one page)

**Files changed:** `app/(app)/layout.tsx`, `app/globals.css`

- **Departments (Maintenance, Health & Safety) were still missing from the printout after the 3-column-layout fix.** Root cause was one level up from the roster page: `app/(app)/layout.tsx` wraps every page in a fixed-height shell (`h-screen overflow-hidden`) with an internally-scrolling `<main overflow-y-auto>`. That clipping applies during print too — only the one screen's worth of scrolled content ever reaches the print surface, so the printout was always exactly 1 page regardless of how the roster's own markup was laid out. Confirmed with a real headless-Chromium print-to-PDF test reproducing the shell: without this fix the roster is silently truncated at 1 page; with it, the same content correctly spans 2 pages with every department present.
- Added `.app-shell` / `.app-shell-col` / `.app-shell-main` marker classes to the three shell containers (outer flex wrapper, inner column wrapper, `<main>`) and reset them (plus `html`/`body`) to `height: auto; overflow: visible` inside `@media print`, so print always uses natural, unclipped document flow. This is a shared-layout fix — it applies to print output for every page under `(app)`, not just the roster.

---

## 2026-07-07 — Alyssa (Roster print: fix departments being cut off, drop 3-column layout)

**Files changed:** `app/(app)/production/roster/page.tsx`, `app/globals.css`

- **Print was still losing departments even across two pages.** The 3-column CSS multi-column layout (`column-count: 3`) added on 2026-07-06 relies on the print engine balancing column height to fit one page — any roster content beyond that calculated height is silently dropped rather than flowed onto a second page, which is exactly what was happening with the current 6-department, ~24-role roster. Replaced the multi-column block with plain full-width block stacking (one table per department, straight down the page). Normal block flow has no such height ceiling: the browser's print pagination reliably continues onto as many landscape pages as the content needs, so nothing gets lost regardless of roster size.
- Each department block keeps `break-inside: avoid` (plus `page-break-inside: avoid` for older engines) so a table only splits across a page break if it genuinely doesn't fit on one — same protection as before, just without the column-balancing that was causing the clipping.
- Widened the Day/Night columns (Role column narrowed from 30% to 22%) now that each table runs the full page width instead of a third of it.

---

## 2026-07-06 — Alyssa (Roster print: landscape, single-page, 3-column layout)

**Files changed:** `app/(app)/production/roster/page.tsx`, `app/globals.css`

- **Printout was cutting off after one portrait page.** The per-section tables stacked in a single tall column, so a 6-department, ~25-role roster ran past one page and the rest was silently lost. Forced `@page { size: landscape; margin: 10mm; }` in the print media query (~40% more usable width), and laid the section blocks out in a 3-column CSS multi-column flow (`column-count: 3`, sequential fill) instead of one long column.
- **Sections still never split mid-table** — each department's block keeps `break-inside: avoid`, so a table can move to the next column but never breaks partway through a role's row.
- **Trimmed print typography** (headers, row padding, section labels) to fit the full roster on one landscape page at the denser 3-column layout, while keeping it readable at arm's length for a noticeboard.

---

## 2026-07-06 — Alyssa (Roster print fix: app chrome still bleeding through, duplicated header text)

**Files changed:** `app/(app)/production/roster/page.tsx`, `app/globals.css`

- **The app's Topbar (breadcrumb, notification bell, date) was still printing.** The previous print fix hid the sidebar and the roster page's own on-screen content, but the shared `Topbar` component is rendered by the app-wide layout (`app/(app)/layout.tsx`), outside the roster page — `.no-print` never touched it. Added `header { display: none !important; }` to the print media query (Topbar is the only `<header>` in the app), matching the existing `aside` rule for the sidebar.
- **Duplicated shift-time text fixed.** Some older periods store the raw time range as the shift label (e.g. `day_label = "07h00 till 16h00"`) instead of a shift letter ("Shift A") — the print header was unconditionally appending "· 07h00–16h00" regardless, producing "07h00 till 16h00 · 07h00–16h00". Now only appends the fixed time suffix when the stored label doesn't already look like one.
- **Duplicated date-range text fixed.** The print subtitle showed the formatted range and the period's auto-generated name side by side (e.g. "6 Jul – 10 Jul 2026 · 6–10 Jul") — near-identical, just missing the year. The name is now only shown when it's a genuine custom label (contains no digits), not an auto-generated short date.

---

## 2026-07-06 — Alyssa (Roster: printable noticeboard layout, help guide, bigger add-person UI, phantom scrollbar fix)

**Files changed:** `app/(app)/production/roster/page.tsx`, `app/globals.css`, `components/production/WorkforceTabs.tsx`

- **Print now produces a real printout, not a screenshot.** The Print button used to print the interactive on-screen grid (sticky columns, tiny UI chips, centred narrow layout). Added a dedicated `PrintRoster` view — a plain, full-width table per section with the section's colour as a left-border/header tint, large readable text, and a skill-tag legend at the foot — shown only inside `@media print` (new `.print-only` / `.print-full-width` CSS). The interactive grid, buttons, and period bar are hidden from the printout via `.no-print`.
- **Help guide added.** New info icon next to the "Shift Rosters" title opens a modal explaining the four per-section permissions (View/Edit/Submit/Delete), how to add/move people, how the Wednesday deadline and Sunday auto-rotation work, and — importantly — that **Publish is manual, not automatic**. Someone with edit rights must click Publish; nothing publishes itself on the deadline.
- **Bigger add/edit-person popover.** The search-and-tag popover used when adding someone to a role/shift was cramped (240px wide, 9–12px text). Widened to 320px with larger text, padding, and touch targets throughout (search input, staff dropdown, skill-tag buttons, Save/Cancel/Delete) for practical use on the shop floor. Person chips and the "Add" button in each cell were bumped slightly too for consistency.
- **Phantom scrollbar fixed.** The `WorkforceTabs` sub-nav wrapped its single "Shift Roster" tab in an `overflow-x-auto` container (needed for future multi-tab cases, but wrong for the current one-tab reality) combined with a `-mb-px` trick — this produced a spurious thin horizontal scrollbar with nothing to scroll to. Removed the unneeded `overflow-x-auto`.

---

## 2026-07-06 — Alyssa (Roster export: friendlier filename)

**Files changed:** `lib/utils/exportExcel.ts`, `app/(app)/production/roster/page.tsx`

- **Download filename changed** from `Roster_<period-name>.xlsx` to `Shift Roster (<date range>).xlsx`, e.g. `Shift Roster (6 Jul – 12 Jul 2026).xlsx` — matches the date range shown on-screen instead of the internal period name/id.

---

## 2026-07-06 — Alyssa (Roster export: upgraded from plain CSV to branded, colour-coded .xlsx)

**Files changed:** `lib/utils/exportExcel.ts`, `app/(app)/production/roster/page.tsx`

- **Roster export now matches the Quality workcenter standard.** The roster's Export button previously produced a plain, unstyled CSV — nothing like the branded ExcelJS workbooks used by Pasteuriser/Granule/Sieving exports (title block + logo, bold coloured header row, frozen header, autofilter, auto-sized columns). Replaced with a real `.xlsx` export using the same shared engine (`buildStyledWorkbook`).
- **Colour-coded by section.** Each row is tinted with a light wash of its section's colour (Production/Store/Quality/Cleaning/Maintenance/H&S — the same colours used in the on-screen grid), with the Section column bolded, so the exported file visually matches what's on screen.
- **Engine extended, not duplicated.** Added optional `rowFill` (arbitrary ARGB row tint, for category-coded exports) and `boldCols` to the shared `StyledSheet` type in `exportExcel.ts` alongside the existing pass/fail tone system — new `exportRosterPeriod()` reuses `buildStyledWorkbook()` rather than a bespoke roster-only implementation.

---

## 2026-07-06 — Alyssa (Roster CSV export: wide layout for readability)

**Files changed:** `app/(app)/production/roster/page.tsx`

- **CSV export layout improved.** Changed from a tall format (one person per row) to a wide format (one role per row with Day and Night shifts side-by-side, deduped tags). Matches the grid's visual structure and is much easier to read/print in Excel. Example: `Bagging / Vacuum | Exavior; Siyavuya; Chuma | (empty) | Mawande; Sisonke; Luvo | FL` (instead of 7 separate rows).

---

## 2026-07-06 — Alyssa (AXIS: ticket assignment, resolved-by tracking, notification bell z-index fix)

**Files changed:** `supabase/migrations/20260703_003_axis_tickets_resolved_by.sql`, `app/api/axis/tickets/[id]/route.ts`, `app/(app)/axis/tickets/page.tsx`, `components/layout/NotificationBell.tsx`

- **Notification bell z-index fixed.** Dropdown was being hidden behind page content on tablets. z-index raised to 9999.
- **"Assign to me" button added.** Ticket detail panel now has an Assign to me button. IT and users with `can_assign_tickets` can pick up unassigned tickets or reassign from someone else. "Unassign" button appears when the ticket is already yours.
- **Ticket assignment notifies assignee.** When a ticket's `assigned_to` changes, the new assignee receives an AXIS notification that appears in their bell.
- **Status buttons fixed.** Previously the buttons had a silent `&&` guard — non-permitted clicks did nothing with no feedback. Buttons are now properly `disabled` for users without permission, and errors are shown inline if a PATCH fails.
- **Resolved-by tracking.** New `resolved_by_name` and `resolved_at` columns on `axis.tickets`. When IT marks a ticket resolved, their name + timestamp is captured. Re-opening a ticket clears these fields. Resolved-by is shown in the detail panel meta grid.
- **Per-person resolved count strip.** Below the KPI cards, a row now shows how many tickets each person has resolved. Computed client-side from the ticket list.

---

## 2026-07-06 — Alyssa (Resilience: run_id load no longer blocks capture)

**Files changed:** `app/(app)/production/capture/[section]/page.tsx`

- **Capture load no longer depends on the run migration being present.** The core session load selected `run_id`; on a database where the run migration hadn't fully applied (e.g. `ALTER … ADD COLUMN run_id` didn't stick due to lock contention), that select 400'd and took capture down entirely — refining (and all sections) appeared not to save. `run_id` is now dropped from the core select and fetched in a separate best-effort query, and the run linking/rollup in `persist()` is wrapped so a run schema/write hiccup can never affect the already-committed capture save.

---

## 2026-07-06 — Alyssa (Shift Roster: per-section permissions, auto-rotation, submission tracking, reminders & export)

**Files changed:** `lib/auth/permissions.ts`, `lib/auth/permission-registry.ts`, `components/layout/Sidebar.tsx`, `app/(app)/production/roster/page.tsx`, `lib/notifications/recipients.ts`, `lib/production/roster-rotate.ts`, `app/api/production/roster/cron/route.ts`, `supabase/migrations/20260706_003_roster_section_status.sql`, `.github/workflows/roster-rotate.yml`, `app/globals.css`

- **Two new departments.** `Store` and `Health & Safety` added to the org `Department` list (with metadata + default roles `store_supervisor` / `hs_officer`), so users can be assigned to them across the app.
- **Four-way roster permissions, per section.** New permission keys: one global `can_view_roster` plus `can_{edit,submit,delete}_roster_<section>` for each of the 6 roster sections (production, store, qc, cleaning, maintenance, hs). Rendered as a new **Shift Roster** group in the Users & Roles permission panel + matrix — nothing hardcoded, all set per user/role. Viewing, submitting, editing and deleting are now genuinely separate capabilities.
- **Roster page is now permission-gated.** The sidebar link and page require `can_view_roster`. In the grid, Add / edit / drag / delete and the **Save** button appear only for sections you can edit (others show a *view only* lock); a new **Submit [section]** button (needs the submit permission) signs a section off. Each section shows a Draft / ✓ Submitted status chip. Top-bar New period / Generate / Publish / Delete are gated on having edit/delete rights somewhere.
- **Section submission tracking.** New `production.roster_section_status` table records per-section draft/submitted state (+ who/when). Saving a section reverts it to draft; submitting stamps it.
- **Automatic weekly rotation.** New `lib/production/roster-rotate.ts` holds the shared rotate logic (day↔night swap, Shift A/B labels follow the people; cadence is the one constant `ROSTER_PERIOD_DAYS`). A new `/api/production/roster/cron` endpoint runs `?task=rotate` (idempotently creates next week's rotated period) and `?task=remind`. Driven by `.github/workflows/roster-rotate.yml` (rotate Sun night; remind Mon + Wed mornings). Auth: `Bearer CRON_SECRET`, or a signed-in editor (so the manual **Generate next week** button also fires the reminder).
- **Reminder emails — not hardcoded.** `remind` emails whoever holds `can_submit_roster_<section>` for each section not yet submitted, resolved live from role defaults + per-user overrides via the new `getRosterSubmitterIds()` helper (reads `shared.app_roles` through a `SECURITY DEFINER` `public.roster_submitter_candidates()` function, since the service-role cron can't reach the `shared` schema directly). Uses the existing `notify()` in-app + email pipeline.
- **Export + print.** New CSV **Export** (section, role, shift, person, tags) and a colour-preserving **Print** view (`@media print` rules hide app chrome / interactive-only controls).
- **Migration to run (staging first):** `supabase/migrations/20260706_003_roster_section_status.sql`. **Ops:** add the `roster-rotate.yml` schedule; `CRON_SECRET` already exists on the server.

---

## 2026-07-06 — Alyssa (Duplicate-session fix + 16h00 shift-changeover PIN)

**Files changed:** `supabase/migrations/20260706_002_shift_takeovers.sql`, `lib/supabase/database.types.ts`, `app/(app)/production/capture/[section]/page.tsx`

- **Duplicate empty sessions fixed.** Opening a capture section no longer eagerly inserts a draft `prod_sessions` row — that open-time insert raced with the first autosave (the select-first check ran before the insert committed), producing duplicate "No data" sessions in production. Sessions are now created lazily on first real capture, and `ensureSession()` coalesces concurrent callers onto a single in-flight insert (with a synchronously-updated `sessionRef`) so it can never double-insert. localStorage still backs up any typing before the row exists.
- **16h00 shift-changeover PIN gate (audit).** When 16h00 passes and a morning session is still being captured (not signed off), capture is blocked behind a modal until the incoming operator enters their PIN. The PIN is validated against the section’s afternoon-rostered operators (fallback: any active operator, flagged), and each hand-over is recorded in the new `production.shift_takeovers` table (who, when, rostered-or-not) — an audit trail of who captured after the changeover. Subsequent capture and sign-off are attributed to the operator who took over.

---

## 2026-07-06 — Alyssa (Cross-shift production runs, full-day mass balance, numeric keypad)

**Files changed:** `supabase/migrations/20260706_001_production_runs.sql`, `lib/supabase/database.types.ts`, `app/(app)/production/capture/[section]/page.tsx`, `components/production/capture/NumericKeypad.tsx`, `components/production/capture/ChecksPanel.tsx`

- **Production runs (cross-shift continuity).** New `production.production_runs` table models one production order (PO + variant + grade) that can span several shifts of a production day (07h00–01h00). Each shift still writes its own `prod_sessions` + `prod_mass_balance` row; `prod_sessions.run_id` links them and the run row holds the durable full-day rollup. A partial unique index enforces one *open* run per (section, day, PO, variant, grade).
- **Continue-run prompt at shift hand-over.** When the incoming operator picks variant (+ grade for non-refining) and an open run from an earlier shift matches PO + variant + grade, the Capture tab prompts *“Continue the production run from the previous shift?”* with **Continue run** / **Start new run**. Continue links the session so the mass balance carries over; Start new closes the previous run and opens a fresh one. Opening a genuinely new product opens a run silently.
- **Full-day mass balance carried over.** `persist()` recomputes the run rollup by summing every linked session's mass balance and writes `total_input_kg` / `total_output_kg` / generated `balance_kg` onto the run. The Overview now widens to all sessions sharing the run (morning + afternoon + night), not just morning↔afternoon.
- **One unified mass balance for everyone.** The Capture card, Checks panel and Sign-off now all show a single run-level mass balance (in / out / variance) combined across every shift and batch on the run — not a per-shift or per-batch slice — so operators on every shift read the same figure. When the run spans shifts, a sub-line notes what the current shift added.
- **End-of-run control.** Supervisor approval gains an optional “End of production run” checkbox that closes the run so the next shift isn't prompted to continue.
- **Custom on-screen numeric keypad.** New `NumericKeypad` component (digits, decimal, backspace, clear, and a dash key) replaces the native `type="number"` input in the machine-checks `ValueCapture`. Tablets' native decimal pad has no minus key, so negative readings (e.g. indent screen angle, `allowNegative`) can now be entered reliably; the minus key shows only where negatives are allowed.

---

## 2026-07-03 — Alyssa (AXIS: comments fix, notifications bell, consideration board resolution tracking)

**Files changed:** `supabase/migrations/20260703_001_axis_comments_parent_id.sql`, `supabase/migrations/20260703_002_axis_notifications_resolution.sql`, `app/api/axis/github-pr/route.ts`, `app/api/axis/requests/[id]/approve/route.ts`, `components/layout/NotificationBell.tsx`, `app/(app)/axis/consideration/page.tsx`

- **AXIS comments fixed.** `axis.comments` was missing `parent_id`, `deleted_at`, `edited_at`, and `mentions` columns — PostgREST was rejecting every comment fetch on the consideration board. Migration adds all four columns idempotently.
- **Notification bell now shows AXIS alerts.** Previously the bell only showed `maintenance.notifications` and management announcements. Now also fetches `axis.notifications` (project approved/rejected, comment mentions). AXIS notifications link directly to the consideration board or projects list. Both sources are marked read when the panel opens.
- **axis.notifications: read_at column + RLS added.** The table existed but had no `read_at` column, making unread state impossible. Migration adds `read_at` and row-level security so users only see their own notifications.
- **Consideration board: resolution tracking.** Approved/rejected requests now display who reviewed them (by name), a resolution note, and a live GitHub PR card showing branch, merge status, PR title and body preview.
- **Approval form: resolution fields added.** IT can now add a resolution note and paste a GitHub PR URL when approving. The PR card previews live (title, branch, merged status) before the approval is submitted. These are optional — existing approvals are unaffected.
- **New `/api/axis/github-pr` route.** Server-side GitHub API proxy that fetches PR details from a URL. Keeps the `GITHUB_API_TOKEN` env var server-side. Requires `GITHUB_API_TOKEN` in `.env.local` for authenticated requests (unauthenticated hits GitHub's 60 req/hr limit).

---

## 2026-07-04 — Alyssa (Settings, Audit log, Platform Health)

**Files changed:** `app/layout.tsx`, `app/(app)/settings/page.tsx`, `app/(app)/users/page.tsx`, `app/api/admin/audit/route.ts`, `app/(app)/management/platform/page.tsx`, `app/(app)/layout.tsx`, `components/layout/Sidebar.tsx`

- **Theme flash bug fixed.** Added a blocking `<script>` in the root layout that reads `cntp_theme` from localStorage and sets `data-theme` before first paint. Previously the settings page was the only place `applyTheme()` ran — navigating to it would apply the stored dark theme and make the whole app stay dark-green until a reload.
- **Settings: removed Security and About tabs.** Password change and app info sections removed from user settings. Password resets are still available to admins via Users & Access.
- **Audit log: IT department access.** Audit log tab in Users & Access is now visible to all IT users (not just Alyssa and Jan by UUID). The API also enriches each entry with `actor_department` and `actor_role`.
- **Audit log UI rebuilt.** New table layout with columns: Person, Department, Event, Role, Time. Added summary strip (total events, sign-ins, sign-outs, active users). Added department filter dropdown and A–Z sort toggle. Increased fetch limit to 500 events. People dropdown is sorted alphabetically.
- **Platform Health: auto-refresh.** Page now auto-refreshes every 60 seconds. Manual Refresh button added to header with spinner. Last-updated timestamp shown alongside subtitle.
- **Unassigned users redirect (from staging).** Users with no role/department are redirected to `/home` and see only Submit Request + Settings in the sidebar.

---

## 2026-07-03 — Alyssa (Refining capture fixes, server recovery, Github icon build fix)

**Files changed:** `components/production/capture/RefiningCapture.tsx`, `app/(app)/production/capture/[section]/page.tsx`, `lib/production/live-types.ts`, `app/(app)/axis/consideration/page.tsx`, `supabase/migrations/20260704_004_refining_section_constraints.sql`, `supabase/migrations/20260704_005_prod_sessions_section_direct.sql`

- **`notInSystem` false-positive fixed.** Manual entry rows were showing "Not found in system" warning incorrectly. The warning now only appears for non-manual rows where `notInSystem === true`, and clearing the serial field properly resets the flag via a single merged `patch()` call (fixes React stale-closure bug).
- **Serial input losing keystrokes fixed.** Two sequential `patch()` calls with the same stale `value` prop caused the second to overwrite the first. Fixed by merging serial and notInSystem updates into a single patch inside `updateInput`.
- **400 on `prod_sessions` INSERT fixed.** Production DB `section_id` CHECK constraint didn't include `'refining1'`/`'refining2'`. Added migrations to widen the constraint (NOT VALID so existing rows aren't re-checked). `ensureSession()` now does a SELECT-first before INSERT so duplicate session creates are avoided.
- **`prod_debagging`/`prod_bagging` empty fixed.** FK violation: manually-entered serials weren't in `bag_tags` so `bag_serial_no` references failed. Manual rows now use `bag_serial_no: null` with serial stored in `notes`; `secureInput` always upserts manual bags into `bag_tags`.
- **`grade`/`logged_at` columns removed from build payloads.** These columns don't exist in `prod_debagging`/`prod_bagging` — removing them from `buildDebag` and `buildBag` resolved silent insert failures.
- **Mass balance split fixed.** All refining output was previously written to `total_output_b_kg`. Fixed to correctly split B/C/D totals across their respective columns in `prod_mass_balance`.
- **Variant and bag date removed from input rows.** Variant is now inherited from session-level selection; bag date auto-populates from system date. Both fields removed from the per-row UI.
- **Coarse Leaf added as refining 2 input type.** Added to `live-types.ts` inputTypes and a required batch number field appears when Coarse Leaf is selected (`needsLot` flag).
- **`Github` lucide icon replaced.** `Github` is not exported from lucide-react in this version. Replaced with `GitBranch` across `axis/consideration/page.tsx` — resolves the production build failure.
- **Server recovery after disk full.** VPS hit 97.2% disk usage causing `npm run build` to fail and `cntp-production` to error (396 restarts). Freed space by cleaning npm cache, flushing pm2 logs, removing stale `.next-old` dirs, and running `apt clean`. Production and staging both restored to online.

---

## 2026-07-04 — Gustav (Pasteuriser: moisture re-check for out-of-spec samples)

**Files changed:** `app/(app)/quality/pasteuriser/page.tsx`

- **Moisture re-check, mirroring the granule line's per-sample recheck:** when a pasteuriser sample's moisture is out of spec, an inline "🔁 Re-check" panel now appears under that sample (time, moisture %, temp), pass/fail computed against the batch's moisture spec. Persists to the sample's `recheck_done`/`recheck_moisture`/`recheck_temp`/`recheck_time`/`recheck_pass` fields on the batch's `data_json`, the same JSON blob everything else about that sample lives in — so it stays attached to that specific sample and batch wherever it's read from: the active batch table, the "Out-of-spec results" summary, and the closed/history batch detail view.

---

## 2026-07-04 — Gustav (Sieving: darker out-of-spec chart shading; Granule: one tasting per batch + QC batch delete)

**Files changed:** `app/(app)/quality/sieving/page.tsx`, `app/(app)/quality/granule/page.tsx`

- **Sieving Mesh Trend charts:** out-of-spec zones (above/below the spec band) now shade a dark red, in addition to the existing red out-of-spec dots, so it's unmistakable at a glance. Y-axis domain is computed per mesh (data + spec band, padded) instead of a fixed 0–100%, so tight-spec meshes like Dust (0–1%) stay readable.
- **Granule Line — one tasting per batch:** the "Add Tasting" button now only shows if the batch has zero tasting records; once one exists, it's replaced with a note to edit the existing tasting instead. Guarded both in the UI and in `handleAddTasting` itself.
- **Granule Line — QC can now delete a batch, with extreme caution:** the delete button is no longer admin-only. Clicking it opens a confirmation modal that requires typing the exact batch number before "Delete Permanently" is enabled. Also fixed: deleting a run now explicitly deletes its `granule_samples`/`granule_tastings` rows first, since there's no FK/cascade between them — previously this would have left orphaned rows behind.

---

## 2026-07-04 — Gustav (Sieving: split Mesh Trend chart into per-mesh charts with spec bands)

**Files changed:** `app/(app)/quality/sieving/page.tsx`

- **Mesh Trend view is now one small chart per mesh size** (>6, >12/>10, >18, >40, Dust, and Fine Leaf where applicable), instead of every mesh overlaid on a single combined chart — applies to all four products (Fine Leaf, Coarse Leaf, Indent Sticks, Rooibos Blocks).
- **Each mesh chart shows a clear spec band**: a shaded green region between the spec min/max plus solid dark boundary reference lines labelled with the actual min/max %, so it's unmistakable whether the trend is running inside spec.
- **Out-of-spec points are flagged red** — any bucket average outside the spec band renders as a larger red dot, and the chart header shows a 🚩 out-of-spec count for that mesh.

---

## 2026-07-04 — Gustav (Sieving: add P4 to PA Level dropdown)

**Files changed:** `app/(app)/quality/sieving/page.tsx`

- **PA Level dropdown now includes P4.** The dropdown (both the quick-edit table cell and the main Add Run form) previously only offered P0–P3 and FAIL. Raw material PA/TA records with a P4 grade auto-filled into `paLevel`, but since P4 wasn't a valid `<option>`, it didn't render/select correctly in the Sieving Tower tab. Added P4 as a selectable option; raw material's own PA level logic is unchanged.

---

## 2026-07-03 — Alyssa (Quality: remove Lab Assistant PINs sidebar entry; redirect to Lab Manager)

**Files changed:**
- `components/layout/Sidebar.tsx`
- `app/(app)/quality/lab-assistants/page.tsx`

**Changes:**
- Removed "Lab Assistant PINs" entry from the Quality section of the sidebar — the page was redundant since the same functionality is accessible via Lab Manager.
- Replaced the `/quality/lab-assistants` page with a server-side `redirect()` to `/quality/lab-manager`.
- *Deployed to production — PRs #319, #320.*

---

## 2026-07-04 — Alyssa (Quality lab assistant PIN login — roster-driven, sections, prod deploy)

**Files changed:**
- `supabase/migrations/20260704_002_quality_lab_auth.sql` *(new — run in prod)*
- `supabase/migrations/20260704_004_lab_auth_sections_roster.sql` *(new — run in prod)*
- `lib/quality/lab-auth.ts` *(new)*
- `lib/auth/permissions.ts`
- `app/quality-login/page.tsx` *(new)*
- `app/api/quality/lab-assistants/route.ts` *(new)*
- `app/api/quality/lab-assistants/manage/route.ts` *(new)*
- `app/(app)/quality/lab-assistants/page.tsx` *(new)*
- `app/login/page.tsx`
- `components/layout/Sidebar.tsx`

**Changes:**
- **`qms.lab_auth` table**: stores user_id, auth_email, full_name, pin (plaintext), section_ids, active. RLS restricts to quality_manager, lab_manager, and IT.
- **`/quality-login`**: PIN login page — lab assistant picks name from roster list, enters 4-digit PIN, lands on `/quality/lab-results`.
- **Manage API** (`/api/quality/lab-assistants/manage`): pulls names from `production.roster_entries` (qc/qc_supervisor/lab_analyst/incoming_goods_qc roles). Excludes Monique, Tamlyn, Shannon, Cyril, Michelle, Lucinda, Amoretta (Microsoft SSO) by first name. Returns PIN and section_ids for manager view.
- **Admin UI** (`/quality/lab-assistants`): roster-driven list, eye toggle to reveal/hide PIN, section picker in edit modal, active/inactive toggle.
- **`quality_lab_assistant` role**: added to `DEPARTMENT_ROLES` (Quality) and `ROLE_PERMISSION_DEFAULTS` (save records, create runs, add samples/tastings/sieving). Shows in role preset buttons in Users & Roles. Quality read columns display "by dept" in the permissions matrix.
- **Login page**: Quality Lab card added alongside Maintenance Tech and Floor Operator.
- *Deployed to production — PRs #299, #317, #318.*

---

## 2026-07-04 — Alyssa (Refining capture: DB save correctness — column fixes, mass balance, Coarse Leaf batch, auto date)

**Files changed:** `app/(app)/production/capture/[section]/page.tsx`, `components/production/capture/RefiningCapture.tsx`, `lib/production/live-types.ts`, `supabase/migrations/20260704_005_prod_sessions_section_direct.sql`

**Changes:**
- Removed non-existent `grade` column from refining `prod_debagging` inserts (schema has no grade on debag rows) — was causing every input-bag save to fail silently.
- Removed non-existent `logged_at` column from both `prod_debagging` and `prod_bagging` inserts — same issue.
- Fixed `prod_mass_balance` for refining: was writing all output to `total_output_b_kg` with C and D hardcoded to 0. Now correctly splits refining totals across B (first output stream), C (second), D (third).
- `ensureSession()` now does a SELECT before INSERT — recovers an existing session if a prior page-load insert failed silently, instead of repeatedly failing with 400.
- Bag date field in refining input rows now auto-fills with today's date (DD-MM-YY).
- Added 'Coarse Leaf' to refining 2 input types. When selected, a batch number field appears and is required before the row can be locked.
- New migration `20260704_005` directly widens `prod_sessions.section_id` CHECK (adds refining1/refining2) and `prod_bagging.output_group` CHECK (adds 'A') using `NOT VALID`.

---

## 2026-07-04 — Alyssa (Refining capture: fix "Not found in system" false-positive + 400 on session create)

**Files changed:** `components/production/capture/RefiningCapture.tsx`, `supabase/migrations/20260704_004_refining_section_constraints.sql`

**Changes:**
- Fixed "Not found in system" warning showing on fresh manual-entry rows and persisting after typing. Root cause: `onUpdate('notInSystem', 'false')` was setting the field to the string `'false'` which is truthy in JS, so the warning always displayed after the first keystroke. Fixed by using `''` to clear the flag and tightening the display condition to check for `=== 'true'` explicitly, and only in non-manual input mode.
- Added DB migration to widen two CHECK constraints in production: `prod_sessions.section_id` now explicitly includes `'refining1'` and `'refining2'` (the original CHECK may have been missing these in production, causing 400 on session creation); `prod_bagging.output_group` now includes `'A'` alongside `B/C/D` (refining's first output stream uses group A). Both constraints use `NOT VALID` so existing rows are unaffected.

---

## 2026-07-04 — Alyssa (Production capture: floor operators only see their own rostered sections)

**Files changed:** `app/(app)/production/capture/page.tsx`

**Changes:**
- Floor operators now only see sections where their operator ID is listed in `shift_assignment.operator_ids` for the current shift. Previously all rostered sections were shown to every logged-in user regardless of who they were assigned to.
- Supervisors and admins still see all rostered sections (for overview and sign-off).
- If a logged-in user has no matching operator record (e.g. a supervisor account with no operator row), falls back to showing all sections so access is never blocked unexpectedly.
- Added `user_id` to the operators query so the logged-in auth user can be matched to their operator record.

---

## 2026-07-04 — Gustav (Granule: typed bag serial + Lab Manager per-bag OOS listing)

**Files changed:** `app/(app)/quality/granule/page.tsx`, `app/(app)/quality/lab-manager/page.tsx`

- **Granule Add Sample — Bulk Bag Serial is now typed directly**, replacing the old "Bag Number" input that auto-generated the serial as `DD.MM.<bagnumber>`. The Edit Sample modal already took a typed serial; Add Sample now matches it.
- **Lab Manager Daily Overview — out-of-spec listing restructured per bag/serial.** Previously all OOS entries for a batch were concatenated into one run-on line (unreadable once a run had many samples, e.g. Granule Line with 37 runs). Now each out-of-spec bag/serial gets its own line with the serial clearly tagged (🏷), for both Pasteuriser and Granule Line sections.

---

## 2026-07-04 — Gustav (Lab Manager: station-grouped Pending Approvals + date-range Daily Overview)

**Files changed:** `app/(app)/quality/lab-manager/page.tsx`

- **Pending Approvals grouped by station:** now shows Pasteuriser / Granule Line / Sieving as separate sections (matching the Daily Overview layout), so nothing is missed regardless of which station or production date a run belongs to. Pending Approvals already had no date filter — this makes that explicit and visible. Sieving shows an informational note since it self-grades Pass/Fail at capture and doesn't route through Lab Manager approval.
- **Daily Overview & Sign-off is now a date range:** replaced the single "Production day" picker with From/To date inputs (plus Today / This week shortcuts). Each station's batches now show their production date, and sign-off tracks per-date within the range — the sign-off button signs off every unsigned day in range in one action, and the header shows "X/Y days signed off" until complete.

---

## 2026-07-04 — Gustav (Lab Manager: standing per-batch notes + weekly Approvals History tab)

**Files changed:** `app/(app)/quality/lab-manager/page.tsx`, `app/(app)/quality/pasteuriser/page.tsx`, `app/(app)/quality/granule/page.tsx`, `supabase/migrations/20260704_002_granule_runs_lm_notes.sql`

- **Standing Lab Manager notes:** Added an always-visible comment box (`LmNotesBox`) on every Pending Approvals card, saved on blur independently of the Pass/Fail/Concession decision — no click-to-open modal. Notes persist to `qms.quality_records.data_json.lm_notes` (pasteuriser) or the new `qms.granule_runs.lm_notes` column (granule), and remain visible after the batch is closed.
- **New `lm_notes` column:** Added to `qms.granule_runs` via migration (additive, nullable).
- **New "🗓 Approvals History" tab:** Monday-based weekly navigator (◀ / ▶ / "This week"), full-text search across all history regardless of week, and status filter chips (Outstanding / Approved / Concession / Fail) with live counts. Each card shows the decision comment and LM notes.
- **Surfaced `lm_notes` for QC:** Pasteuriser and granule pages now show the Lab Manager's standing note (when present) both while a batch is still pending and after it's finalized.

---

## 2026-07-03 — Alyssa (Alara: Lead fix, South Africa tab, SignalCard title fallback, prod deploy)

**Files changed:** `app/(app)/research/page.tsx`, `components/intelligence/SignalCard.tsx`

- **Lead button fix:** `promote()` and `promoteToLead()` now build the account name using a fallback chain (`title → summary_en → keyword_group → source_domain → "Signal"`) instead of calling `signal.title.slice(0, 120)` directly. Signals with empty title fields were sending `name: ""` to `/api/accounts`, which returned 400, causing the "Failed" state.
- **South Africa tab added to Alara:** New "South Africa" section in the Alara tab bar. Filters signals to `region = 'ZA'`, with a classification sidebar (Opportunity / Threat / Competitor / Regulation / Neutral), stat chips, and the same card + drawer UX as the Signal Feed. The separate `/intelligence/south-africa` page remains but is now superseded.
- **SignalCard title fallback:** Shared `SignalCard` component now falls back through `intel.title → keyword_group · classification → source_domain` when both `title` and `summary_en` are empty — fixes blank cards in the South Africa section.
- **Promoted to production:** All Alara changes (redesign, botanical logo, header cleanup) plus this fix were promoted to `main` via PR #301.

---

## 2026-07-03 — Alyssa (Alara: custom botanical logo across header, hero, About)

**Files changed:** `app/(app)/research/page.tsx`

- **Custom SVG logo mark:** Replaced Lucide Leaf icon with a hand-traced rooibos botanical SVG (circle ring + Aspalathus linearis stems and needle clusters) matching Alyssa's reference design.
- **Header:** Logo mark (32px) + "ALARA" in Georgia serif, spaced caps, deep burgundy `#3D1A14` — matches the logo's typographic treatment.
- **Hero card:** Botanical mark rendered at 100px in translucent cream/gold so it reads on the dark green hero background.
- **About section:** 72px logo mark alongside "ALARA" in large spaced serif caps + "Sales Intelligence Engine" subtitle.

---

## 2026-07-03 — Alyssa (Alara: clean white/green design system; fix leads bug)

**Files changed:** `app/(app)/research/page.tsx`

- **Design system overhaul:** Replaced parchment background + dark forest green header with app design tokens — white `var(--color-surface-card)` cards, `var(--shadow-card)`, transparent body, Inter font. Header is now glass/white matching the rest of the platform.
- **Single green accent:** Removed parchment + terracotta + dark header multi-colour scheme. Only forest green (`#1A3A0E`) and sage (`#5A8A2A`) used throughout.
- **Leads bug fix:** `promote()` and `promoteToLead()` now check `r.ok` before setting success state. Also removed pipeline status bar ("n8n · News pipeline…") and trimmed header to logo + name only (no repeated subtitle).

---

## 2026-07-04 — Alyssa (Quality lab assistant PIN login + manager PIN management)

**Files changed:**
- `supabase/migrations/20260704_002_quality_lab_auth.sql` *(new)*
- `lib/quality/lab-auth.ts` *(new)*
- `app/quality-login/page.tsx` *(new)*
- `app/api/quality/lab-assistants/route.ts` *(new)*
- `app/api/quality/lab-assistants/manage/route.ts` *(new)*
- `app/(app)/quality/lab-assistants/page.tsx` *(new)*
- `app/login/page.tsx`
- `components/layout/Sidebar.tsx`
- `lib/auth/permissions.ts`

**Changes:**
- **Quality lab assistant PIN login**: lab assistants now sign in at the tablet via `/quality-login` — select name from list, enter 4-digit PIN, redirects to `/quality/lab-results`. Mirrors the maintenance technician and floor operator pattern.
- **DB table `qms.lab_auth`**: stores `user_id`, `auth_email`, `full_name`, `pin` (plaintext for manager visibility), `active`. RLS restricts access to quality managers, lab managers, and IT.
- **Auth helpers** (`lib/quality/lab-auth.ts`): `deriveLabPassword` (`lab_{pin}_{email}` max 64 chars), `newLabEmail` (`lab-{rand}@lab.rooibostea.co.za`), `LAB_ASSISTANT_PERMISSIONS` (save records, create/add runs/samples/tastings/sieving).
- **Admin PIN management page** (`/quality/lab-assistants`): quality managers and lab managers can add new assistants, see their PIN (eye reveal/hide toggle), change PIN, and toggle active status. Accessible from the Quality sidebar group.
- **Login page** (`/login`): added Quality Lab card alongside Maintenance Tech and Floor Operator.
- **Permissions registry**: added `quality_lab_assistant` role to `DEPARTMENT_ROLES` (Quality group) and `ROLE_PERMISSION_DEFAULTS` with capture-only permissions.

---

## 2026-07-03 — Alyssa (Explicit confirm checks + QC serial bag tag lookup)

**Files changed:**
- `components/production/capture/ChecksPanel.tsx`
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- **Explicit confirm checks**: confirm-type checks (machine startup/shutdown inspections) are no longer assumed OK by default. Operator must explicitly tap **OK** or **Flag** for each one. Sign-off is blocked until all checks have been acted on. Description text updated to reflect this requirement.
- **QC serial bag tag lookup**: serial number field in the sieving QC "New Run" modal now triggers a `production.bag_tags` lookup on blur or Enter (barcode scanner compatible). Pre-fills date (from `created_at`), lot number, variant, and grade (destination A→Export, B→Export Blend, C→Domestic). Green/red status indicator shown under the field.

---

## 2026-07-03 — Alyssa (QC sieving: link result to bag audit trail)

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`
- `app/(app)/tags/page.tsx`
- `lib/supabase/database.types.ts`

**Changes:**
- **QC result write-back**: after saving a sieving QC run with a serial number, two best-effort writes happen: (1) `production.bag_tags` is updated with `qc_initials` and `qc_signed_at`; (2) a `qc_check` scan event is inserted with pass/fail, QC controller name, product/grade/variant, and any spec violations in the notes field.
- **Bag tracking timeline**: scan event `notes` field now rendered in the event timeline on `/tags` so the QC result is visible when tracing a bag's history.
- **`ScanAction` type**: added `qc_check` to the TypeScript union type.

---

## 2026-07-02 — Alyssa (Refining capture: predefined outputs, no grade, system pick fixes, overview serials)

**Files changed:**
- `components/production/capture/RefiningCapture.tsx`
- `app/(app)/production/capture/[section]/page.tsx`
- `components/production/capture/CaptureOverview.tsx`

**Changes:**
- **Predefined output types**: bagging tab now shows fixed output slots per section rather than the generic OutputPicker. Refining 1 outputs: A = Indent Dust, B = White Dust, C = Powder Dust. Refining 2 outputs: A = Cut Heavy Stick Fine, B = Cut Heavy Stick Coarse, C = Powder Dust, D = White Dust. Operators enter weight only; the system generates the serial and looks up the Acumatica code automatically.
- **No grade for refining**: grade removed from output bag creation. Refining records variant only. `gradeLetter` prop removed from `RefiningCapture`.
- **System pick variant + bag date fix**: when picking from system, the variant stored in `bag_tags` is now carried into the input row, and `created_at` is converted to DD-MM-YY and used as the bag date.
- **Overview serials**: debagging section now groups each input bag by its serial (one row per bag). Bagging output section shows the bag serial in the LOT/BATCH column.
- **`outputA` slot added**: `RefiningData` now has `outputA | B | C | D` to support Refining 2's four output streams.

---

## 2026-07-02 — Alyssa (Checks: indent screen angle allows negative values)

**Files changed:**
- `lib/production/checks-config.ts`
- `components/production/capture/ChecksPanel.tsx`

**Changes:**
- Added `allowNegative?: boolean` field to `MachineCheckDef` interface
- Set `allowNegative: true` on the `indent_screen_angle` check definition
- Updated `ValueCapture` to use `inputMode="text"` when `allowNegative` is true — shows the minus key on mobile keyboards

---

## 2026-07-02 — Alyssa (Timesheet: log shift start on page open; pre-populate standard breaks)

**Files changed:** `app/(app)/production/capture/[section]/page.tsx`, `lib/production/timesheet.ts`, `components/production/capture/TimesheetConfirm.tsx`

- **Shift start logged at login**: a `capture_activity` stamp is written when the operator opens a section (only if no prior stamps exist), so shift start reflects actual login time rather than first data-entry time.
- **Standard breaks pre-populated**: when no inactivity gaps are detected from activity, the standard factory schedule is pre-filled — morning shift gets tea at 10:00 (15 min) and lunch at 12:30 (60 min); night shift gets tea at 19:00 (15 min) and meal at 21:00 (60 min). All entries are editable at sign-off.

---

## 2026-07-02 — Alyssa (Production capture: operator must choose variant; mismatch warning + supervisor note)

**Files changed:** `app/(app)/production/capture/[section]/page.tsx`

- **Variant no longer pre-filled**: operator always starts with a blank variant and must actively choose it — applies to new captures, change-overs, and new batch records.
- **Mismatch detection**: if the operator selects a different variant than the supervisor assigned, an amber warning banner appears immediately with the conflicting values.
- **Auto supervisor note**: the mismatch is automatically appended to the handover comments so the supervisor sees it at sign-off. Deduplication prevents the note appearing twice if the operator changes selection.

---

## 2026-07-02 — Alyssa (Production assign page: remove roster/staff links; fix filled-count bug)

**Files changed:** `app/(app)/production/capture/assign/page.tsx`

- **WorkforceTabs removed**: Shift Roster and Staff & Skills navigation links removed from the Assign Sections page — the page now shows assigned sections only.
- **Filled-count bug fixed**: "Filled X people" message always showed 0 because the counter was incremented inside the `setDrafts` async callback. Calculation moved outside so the count is correct when `setFillNote` is called.

---

## 2026-07-02 — Alyssa (Production capture: bucket elevator included in balance; balance sign fix)

**Files changed:** `components/production/capture/SievingCapture.tsx`, `components/production/capture/CaptureOverview.tsx`

- **Bucket elevator label corrected**: UI previously showed "excluded from balance" on the bucket elevator spillage row, contradicting the actual calculation which already included it in `totalIn`. Label now reads "included in balance".
- **Mass balance sign flipped**: variance was calculated as `totalIncl - totalOut` (positive when material is outstanding), changed to `totalOut - totalIncl` so the balance is **negative** when output is less than input — correctly expressing outstanding output as a deficit.
- **Overview display updated**: mass balance row now reads `Out X − In Y =` to match the flipped formula; clipboard copy label updated from "Variance" to "Balance (out − in)".

---

## 2026-07-02 — Alyssa (Alara: second redesign — clean white/green design system; fix leads bug)

**Files changed:** `app/(app)/research/page.tsx`

- **Design system overhaul**: replaced parchment background + dark forest green header with the app's actual design tokens — white `var(--color-surface-card)` cards, `var(--shadow-card)` shadows, transparent body (inherits the app's gradient from `globals.css`), and Inter font throughout. Header is now glass/white matching the rest of the platform.
- **Single green accent**: removed the multi-colour scheme (parchment + terracotta + dark header). Only forest green (`#1A3A0E`) and sage green (`#5A8A2A`) are used as accent colours, consistent with the platform's brand tokens.
- **Leads bug fix**: `SignalCard.promote()` and `SignalDrawer.promoteToLead()` were calling `setPromoted(true)` unconditionally after `await fetch(...)` — even on 401 or 500 responses, the button turned green while nothing was actually saved. Fixed to check `r.ok` before setting success state. Added `promoteErr` state to show red error feedback when the API returns a non-2xx response.
- **Bookmark bug fix**: same pattern fixed in `SignalCard.bookmark()` — now checks `r.ok` before `setBookmarked(true)`.
- Layout structure (left sidebar + 2-column card grid), hero card, signal drawer, Gap/Loophole routing, and all section logic retained.

---


## 2026-07-02 — Alyssa (Alara: full visual redesign — dark header, image cards, sidebar filters, routing)

**Files changed:** `app/(app)/research/page.tsx`

- **New dark forest green header**: sticky top bar with Leaf logo, "Engine active" dot, and an "ⓘ About" button; tab bar on same dark background with green active indicator — replaces the old light earthy header.
- **Shopping-site layout for Signal Feed**: left sidebar (264px, sticky) contains all filter controls (search, classification, relevance, region, keyword group, sort); main area is a 2-column card grid — mirrors the reference design requested.
- **Redesigned signal cards**: image area (148px, uses `media_url` or classification-coloured gradient with Leaf icon), platform + classification badge overlays, score bar, title (2-line clamp), summary (3-line clamp), source link, and a 4-button action row: **Save** (bookmarks via `/api/marketing`), **Lead** (promotes via `/api/accounts`), **Gap** (navigates + auto-runs Gap Finder), **Loophole** (navigates + auto-runs Loophole Scan).
- **Hero card**: first item in the card grid, full-width dark green gradient with Leaf icon, Alara branding, live signal count and update time.
- **Signal drawer**: removed auto-analysis on open; replaced with an explicit "Analyse with Alara" button so AI is not triggered unless requested.
- **Cross-section routing**: Gap/Loophole buttons on cards lift `gapPreload`/`loopholePreload` state to the page root and switch section; GapSection and LoopholesSection auto-run analysis on preload change using a `prevPreload` ref to avoid duplicate runs.
- **Map toggle**: world map is now collapsed by default; "Show map" button expands it above the card grid.
- **New colour scheme**: dark header (`#0D1B09`), warm parchment background (`#F0EDE6`), forest green brand (`#2D6B1E`) replacing old earthy terracotta as the primary brand tone; terracotta (`#B84B25`) retained for threat/loophole contexts; amber retained for warnings.
- **About section — signal schedule**: added a styled weekly schedule table (Mon–Sun) showing which regions/themes Alara scrapes on each day.
- All section interiors (Gap, Loopholes, Intel, Vault, Compass) updated to use `C.brand` (forest green) for active states and primary buttons instead of old `C.red`.

---

## 2026-07-02 — Alyssa (Production capture: auto-fill assignments, remove tablet setup, session delete)

**Files changed:** `app/(app)/production/capture/assign/page.tsx`, `app/(app)/production/capture/page.tsx`, `app/(app)/production/history/page.tsx`, `app/(app)/production/device/page.tsx` (deleted), `lib/auth/permissions.ts`, `lib/auth/permission-registry.ts`

- **Shift assignment auto-fill**: assign page now auto-loads operators from the Shift Roster when no assignments exist for the selected date/shift — supervisor only needs to confirm variant, grade/lot, and production orders. Removed the manual "Fill from roster" button.
- **Tablet setup removed**: deleted `/production/device` page and removed "Set up this tablet" button from the capture home. Existing device bindings in localStorage continue to route as before; new ones can no longer be set.
- **Session delete**: added `can_delete_session` permission key; supervisors and IT get it by default. Delete button appears on session history cards — cascades through `session_signatures`, `scan_events`, `prod_mass_balance`, `prod_debagging`, `prod_bagging` before removing the session.
- **New permission keys**: `can_edit_session`, `can_delete_session`, `can_edit_bag_tag`, `can_delete_bag_tag` — added to `permissions.ts`, `permission-registry.ts`, and the Production supervisor/legacy supervisor role defaults.

---

## 2026-07-02 — Gustav (Pop-up targeting, job-card history search/filters, boiler startup schedule)

**Files changed:** `components/maintenance/MaintenanceAlerts.tsx`, `app/(app)/maintenance/job-cards/page.tsx`, `app/(app)/maintenance/planner/page.tsx`, `lib/maintenance/useMaintenanceData.ts`, `lib/maintenance/types.ts`, `supabase/migrations/20260702_010_maintenance_boiler_schedule.sql` (new)

- **Pop-up targeting** now follows the notification: the technician modal fires for **any** card allocated to them (breakdown or planned, matched on `assigned_user_id`) — not just breakdowns — and never for the raiser; the allocate pop-up stays manager-only, and the acceptance toast still fires for the manager.
- **Job-card history is searchable/filterable:** the "Last 20" table is replaced by a full history panel — free-text search (card, machine, root cause, work done…), per-column filters (Type / Area / Technician), a Done/Cancelled status filter and a closed-date range.
- **Boiler startup schedule** restored in the Planner: a compact, editable weekly roster (this week + 5 ahead) of the technician on boiler startup — managers edit current/future weeks. New `maintenance.boiler_schedule` table (applied to staging).

---

## 2026-07-02 — Gustav (Live breakdown pop-ups: technician accept + manager allocate/accept alerts)

**Files changed:** `components/maintenance/MaintenanceAlerts.tsx` (new), `app/(app)/maintenance/layout.tsx`, `lib/maintenance/types.ts`

- New `MaintenanceAlerts`, mounted once in the maintenance layout: polls `job_cards` every 10s while the app is open and raises on-screen pop-ups (no realtime/web-push infra exists yet, so closed-tab delivery still uses the existing email/WhatsApp path).
- **Technician**: when a breakdown is auto-assigned to them (`assigned_user_id === userId`) and not yet accepted, a blocking modal appears — **Accept & attend**, or leave a **first comment** — even if they were idle on another maintenance page; it reloads the board on new events.
- **Maintenance manager**: a corner pop-up lists **job cards awaiting allocation** with an "Allocate now →" link, and a **toast fires the moment a technician accepts** a breakdown, so the manager can track acceptance and manage urgent work.
- Added `assigned_user_id` to the `JobCard` type (already on the table). QC-on-duty routing is intentionally out of scope for now (to follow).

## 2026-07-02 — Alyssa (Permissions: production orders added to matrix + orPermission sidebar gate)

**Files changed:**
- `lib/auth/permission-registry.ts` — added `production.orders` resource under Production module with `read: 'can_view_live_history'`
- `components/layout/Sidebar.tsx` — Production Orders now uses `permission: 'can_view_live_history', orPermission: true` so any user with that toggle gets the sidebar link
- `app/(app)/layout.tsx` — added explicit route guard for `/production/orders` with `can_view_live_history` orPermission

**Changes:**
- Production Orders now appears in the Users & Roles permission matrix so read access can be toggled per user
- Any user outside Production/Management can be granted access to Production Orders by enabling `can_view_live_history`
- **Standard going forward:** every page in the app must have a corresponding entry in `lib/auth/permission-registry.ts` with read/write/delete/manage mapped to the appropriate permission keys, so all access can be managed from Users & Roles without code changes

---

## 2026-07-02 — Alyssa (Permissions: quality read toggles, staff/roster gate, delete error surfacing)

**Files changed:**
- `lib/auth/permission-registry.ts` — replaced `read: 'dept'` with `read: 'can_view_history'` on quality.lab_results, quality.specs, quality.runs, quality.sieving
- `app/(app)/layout.tsx` — removed staff/roster from always-open list; added route guards for `/production/staff` and `/production/roster` behind `can_view_staff`
- `app/api/admin/users/[id]/route.ts` — delete auth account before app_roles row; surface real Supabase error instead of generic "Failed to delete user"

**Changes:**
- Quality matrix no longer shows "by dept" for lab results, specs, runs, and sieving — now shows a real `can_view_history` toggle so cross-department users (e.g. Management) can be granted read access
- Staff Directory, Skills Matrix, SOP Catalogue, and Shift Roster are now permission-gated behind `can_view_staff` — previously open to all logged-in users
- User delete API fixed to show the actual Supabase error on failure (e.g. SSO identity conflict) and to delete auth account before app_roles to prevent orphaned records

---

## 2026-07-02 — Alyssa (Alara: Signal Engine merged in, full UI update, sidebar cleanup)

**Files changed:**
- `app/(app)/research/page.tsx` — SignalsSection full rewrite
- `app/(app)/intelligence/page.tsx` — replaced with redirect to `/research`
- `components/layout/Sidebar.tsx` — removed Signal Engine nav entry

**Changes:**
- **Signal Engine merged into Alara**: `SignalsSection` now includes the world map (`SignalMap`), 4 stat cards (total, opportunities, threats, avg relevance), full filter bar (search, region, keyword group, sort), classification chip row, relevance bucket chips, load-more pagination, and a reset-filters empty state. All powered by the same `/api/signals?limit=300` endpoint.
- **`/intelligence` redirect**: visiting the old Signal Engine URL now redirects to `/research` so no broken links.
- **Sidebar**: Signal Engine entry removed. "Alara" is the single entry for both the research engine and signal feed.
- **About Alara — etymology fix**: removed the Alyssa personal reference from the "ra" etymology card. Now reads: "Rooibos · Intelligence — the ability to range, detect, and act on what others miss."

---

## 2026-07-02 — Gustav (Breakdown routing: spread across on-duty crew from the shift roster)

**Files changed:** `app/api/maintenance/job-cards/route.ts`

- Breakdown auto-routing now distributes across the technicians on the **Operations shift roster**: the on-duty tech with the **fewest breakdowns in hand** gets the new one. A breakdown counts as "in hand" from the moment it is assigned (accepted or not) through in-progress, so once one on-duty tech is holding a breakdown, the next breakdown routes to the **other** technician on shift. Single-tech shifts still route to that tech; deterministic tie-break (fewest breakdowns → fewest open cards → name).

## 2026-06-30 — Gustav (Maintenance overhaul round 4: table board, checklist allocation, unified roster, dashboard trends, energy)

**Files changed:** `app/(app)/maintenance/job-cards/page.tsx`, `app/(app)/maintenance/job-cards/[cardId]/page.tsx`, `app/(app)/maintenance/page.tsx`, `app/(app)/maintenance/scheduled/page.tsx`, `app/api/maintenance/job-cards/route.ts`, `app/api/maintenance/energy/history/route.ts`, `lib/maintenance/roster.ts`, `lib/maintenance/useMaintenanceData.ts`, `lib/maintenance/types.ts`, `components/maintenance/JobCardTable.tsx` (new), `components/maintenance/Spark.tsx` (new), `components/maintenance/TrendsPanel.tsx` (new), `components/maintenance/EnergyHistory.tsx`, `components/maintenance/EnergyWidget.tsx`

- **Job-card board → one-line table** (`JobCardTable`): rows expand to the full job card (allocate / log work / QC / verify) with a live in-row timer; **per-technician allocation tabs** replace the old "by raiser" panel; **urgency filter** added (search + date-range kept).
- **New-job-card alert** on the maintenance dashboard for managers.
- **Checklist allocation** to technicians (on-duty suggested first) with assignee highlight (+migration `20260629_002`).
- **Roster unified:** on-duty technician sourced from the Operations shift roster (incl. breakdown routing); maintenance duty-roster editor retired.
- **Trends moved to the dashboard** (`TrendsPanel`/`Spark`); Scheduled "Readings & Trends" tab is now capture-only.
- **Energy:** solar charts shrunk; From/To date-range filter on energy history.

## 2026-07-02 — Alyssa (Alara: phase 3 — briefing cards, full signal cards, audience companies)

**Files changed:**
- `components/intelligence/BriefingCards.tsx` (new) — structured briefing output component
- `app/(app)/marketing/page.tsx` — full rewrite of Dashboard, Campaigns, Audiences, Content tabs
- `app/api/marketing/route.ts` — added `save_report` and `audience_companies` actions

**Changes:**
- **BriefingCards**: replaces the plain-text `AiResult` block across all three generation surfaces (campaign brief, audience brief, content angles). Parses `##` section headings into collapsible cards; renders bullet/numbered lists and inline bold. "Save to reports" button → `sales.reports` via new `save_report` action.
- **Opportunities + Social Trends columns**: switched from compact to full `SignalCard` so the recommended-action block (sales_angle) is visible. Social Trends shows source platform label above each card.
- **Audience Signals column**: added Matching Buyers panel — lazy-loads `company_profiles` filtered by the signal regions via new `audience_companies` action (shows company, country, shipment count, current supplier). "Save as audience" button writes to `sales.audiences` and logs a report.
- **`save_report`**: inserts into `sales.reports` (title, body, report_type, created_by).
- **`audience_companies`**: returns company_profiles filtered by country list with panjiva data.

---

## 2026-07-02 — Alyssa (Alara CRM: marketing loop wired — phase 2 step 2)

**Files changed:**
- `app/api/marketing/route.ts` — mirrored campaign saves + audience briefs to sales schema
- `supabase/migrations/20260702_002_audiences_name_unique.sql` (new) — unique constraint on `sales.audiences.name`

**Changes:**
- `save_campaign` now writes to both `marketing.campaigns` (existing) and `sales.campaigns` (CRM). UI unchanged.
- `audience_brief` generation now upserts to `sales.audiences` (tag, signal provenance, brief excerpt) after generating. Best-effort, never blocks the response.
- Unique constraint on `sales.audiences.name` applied (migration run in Supabase staging).

---

## 2026-07-02 — Alyssa (Alara CRM: lead pipeline — phase 2 step 1)

**Files changed:**
- `app/(app)/intelligence/leads/page.tsx` (new) — kanban pipeline page grouped by stage
- `components/leads/AccountDrawer.tsx` (new) — right-slide account detail drawer
- `app/api/accounts/route.ts` (new) — GET list + POST create/promote
- `app/api/accounts/[id]/route.ts` (new) — GET detail (account + profile + interactions + signals), PATCH
- `app/api/accounts/[id]/interactions/route.ts` (new) — POST add timeline entry
- `components/intelligence/SignalDrawer.tsx` — added "Promote to lead" button
- `components/layout/Sidebar.tsx` — added "Lead Pipeline" nav entry (KanbanSquare icon)

**Changes:**
- Built the **lead pipeline view** at `/intelligence/leads`: kanban columns for all 6 stages (lead → qualified → proposal → negotiation → won → lost), stage tab filter, search, and 3-KPI row (total / active / won).
- **AccountDrawer**: click any account card to open a detailed panel — stage picker (one-click advance), next-action block, company dossier (panjiva shipment data + current supplier), linked signals list, and an activity timeline with an add-note form (interaction type + next step).
- **Three new API routes** wire the accounts/company_profiles/account_interactions/signals tables into the UI. Auth mirrors the signals route (Sales/Management/Marketing/IT or `can_access_intelligence`).
- **Promote to lead**: "Promote to lead" button in the signal drawer creates an `accounts` row (stage='lead', signal_ids=[signal.id]) and logs a genesis `account_interactions` entry so every lead is traceable to its source signal.
- The `docs/alara-crm-vision.md` spec and `supabase/migrations/20260702_001_crm_campaigns_audiences.sql` are now committed to the repo.

---

## 2026-07-02 — Alyssa (Alara: multi-source engine LIVE + CRM data-model foundation)

**Files changed:**
- `research-engine/n8n/cntp-signal-engine.json` — corrected/expanded workflow (reference export)
- `supabase/migrations/20260702_001_crm_campaigns_audiences.sql` (new) — CRM `campaigns` + `audiences`
- `docs/alara-crm-vision.md` — CRM closed-loop spec + schema introspection + phase-2 build order

**Changes (n8n — done via the n8n public API over SSH; workflow lives in n8n, not the repo):**
- Built the **multi-source** engine (`ud8p5FxBhqiDHH6X`): added TikTok + Instagram (Apify), X/web (Exa), YouTube alongside the 16 news feeds — each normalised to `{title,link,description,source}`, pooled via `Merge Sources` (social-first) → existing dedup→Gemini→Save pipeline.
- **Models off the app's `2.5-flash-lite`** → dedicated: Tier 1 `gemini-3.1-flash-lite`, Tier 2 `gemini-2.5-flash`. Fixed ~16s/item slowness (old free-tier key → paid key in `CNTP Gemini` → 1.59s/item).
- **Region-per-day rotation** (`Day Selector`) for Apify/Exa to cap credits + fit the 3am–5am window; news/YouTube global daily.
- Fixes: dedup by URL **and** title; classification mapped to the `signals_classification_check` values (fine type kept in `intel`); `source_type` from the real platform (was hardcoded `news`); `region` = full country names; deep-scan JSON parsers both tiers.
- **Went live:** activated multi-source (3am SAST, throttle 300), deactivated old news-only `kDhYBC0Q9IBM7CyS` (fallback), deleted 4 duplicate copies.

**Changes (production `sales` schema):**
- Introspected the live schema (20 tables): `accounts` already a full lead pipeline; only gap = `campaigns` + `audiences` (added by the migration above). Phase-2 app wiring not yet started.

---

## 2026-07-02 — Alyssa (Global Wits trade intelligence + campaign close-loop)

**Files changed:**
- `app/(app)/intelligence/global-wits/page.tsx` (new)
- `app/api/global-wits/route.ts` (new)
- `app/(app)/marketing/page.tsx`
- `app/api/marketing/route.ts`
- `components/layout/Sidebar.tsx`
- `app/(app)/quality/lab-manager/page.tsx`
- `supabase/migrations/20260704_001_global_wits.sql`

**Changes:**
- **Global Wits**: replaced LinkedIn placeholder with a trade file import tool. Drop a Global Wits `.xlsx` — all sheets (hscode, US customs, global shipping, rooibos) are parsed client-side; each unique buyer becomes a `sales.company_profiles` record, a `sales.accounts` lead, and a `sales.signals` trade signal via 3 bulk upserts.
- **Global Wits overview**: persistent trade dashboard loads from DB on every visit — stat cards (441 buyers, $23.4M, 1,860 shipments), SVG country bar chart, sortable/searchable buyers grid with expandable rows. Expanded row shows a dot-on-line shipment timeline (sized by $ value), monthly bar chart, pitch angle, and recent shipment detail.
- **Import history**: collapsible accordion grid of past file imports.
- **Campaign close-loop**: `campaign_brief` AI action now returns `signal_ids` (which signals inspired the brief); `save_campaign` persists `channel` and `signal_ids` to `marketing.campaigns`.
- **Lab manager fix**: removed broken `import { computePastOosFlags } from '../pasteuriser/page'` — the export never existed, causing every production build to fail. Replaced with a local stub returning `[]`.
- **Sidebar**: LinkedIn replaced with Global Wits under Sales group.

---

## 2026-07-02 — Alyssa (Maintenance: remove Shuaib Sentso from PIN system)

**Files changed:**
- `supabase/migrations/20260702_002_remove_shuaib_tech_auth.sql`

**Changes:**
- Deactivated Shuaib Sentso in `maintenance.tech_auth` and `shared.app_roles` — he is the maintenance manager and logs in via Microsoft SSO, not PIN. He no longer appears on the Technician PINs page.

---

## 2026-07-02 — Alyssa (Maintenance: breakdown auto-assignment fix + login clarification)

**Files changed:**
- `lib/maintenance/roster.ts`
- `app/maintenance-login/page.tsx`

**Changes:**
- Removed `maintenance_manager` from `MAINT_ROLE_KEYS` in roster.ts — the manager was being included as a candidate for breakdown auto-assignment when present on the Operations roster, causing breakdowns to route to the manager instead of the on-duty technician. Only `maintenance_tech` and `maintenance_asst` are now considered.
- Removed "Maintenance manager? Sign in with Microsoft" link from the PIN login page — the manager uses the standard `/login` page like everyone else; no special section needed.

---

## 2026-07-04 — Gustav (Sieving: bulk density/leaf shade only required on Final QC)

**Files changed:**
- `app/(app)/quality/sieving/page.tsx`

**Changes:**
- Bulk density and leaf shade are no longer mandatory for In-Process runs — only Final QC still requires them. In-Process can now be saved without either field filled in; the range check (1–11) on leaf shade still applies if a value is entered.

---

## 2026-07-04 — Gustav (Granule: remove redundant run-level Tasting button)

**Files changed:**
- `app/(app)/quality/granule/page.tsx`

**Changes:**
- Removed the "🍵 Tasting" button in the run header — the per-sample "Add Tasting" button further down already covers this, so the top-level one was a duplicate entry point.

---

## 2026-07-03 — Alyssa (Management role — read-only access to all modules by default)

**Files changed:**
- `lib/auth/permissions.ts`
- `lib/auth/context.tsx`

**Changes:**
- `management_default` role now includes read-only permissions for quality (`can_view_history`, `can_export_csv`), production (`can_view_ops_dashboard`, `can_view_all_sections`, `can_view_live_history`), maintenance (`can_access_maintenance`), and management reporting (`can_view_management`, `can_view_reports`, `can_export_reports`) by default — matching the role's description as "read-only across platform"
- Management users no longer need manual permission grants to view quality, production, or maintenance pages; write/delete actions remain off and must still be toggled on per person
- `canAccessQuality` flag now also returns true for `isManagement` so quality appears in the sidebar automatically for all management users
- Updated `management_default` role description in the users page to reflect the new defaults

---

## 2026-07-02 — Alyssa (Capture overview — hierarchical tables, cross-shift totals, spillage rename)

**Files changed:**
- `components/production/capture/CaptureOverview.tsx`
- `components/production/capture/SievingCapture.tsx`
- `app/(app)/production/capture/[section]/page.tsx`

**Changes:**
- Debagging table restructured: rows grouped by lot/batch with expand/collapse, subtotal per lot, bucket elevator and machine spillage shown as separate named rows, total excl. spillage and total incl. spillage at bottom
- Bagging table restructured: 3-level hierarchy (product → lot → individual bag) — tap product row to see lot breakdown with subtotals, tap lot row to see individual bags; product-level totals in each product row header
- Spillage fields renamed: Spillage 1 → "Bucket elevator", Spillage 2 → "Machine spillage" in the capture debagging step
- Production order (from Acumatica shift assignment) now shown at top of overview
- Overview loads the other shift's session and combines it — same variant+grade+lot bags from morning and afternoon shift merge into shared totals
- Mass balance now uses total incl. both spillage types as the "in" figure

---

## 2026-07-02 — Alyssa (Maintenance tech PIN login + unified roster shift highlight)

**Files changed:**
- `supabase/migrations/20260702_001_maintenance_tech_auth.sql` *(new)*
- `lib/maintenance/tech-auth.ts` *(new)*
- `app/api/maintenance/technicians/route.ts` *(new)*
- `app/api/maintenance/technicians/manage/route.ts` *(new)*
- `app/maintenance-login/page.tsx` *(new)*
- `app/(app)/maintenance/technicians/page.tsx` *(new)*
- `app/login/page.tsx`
- `app/floor/page.tsx`
- `components/layout/Sidebar.tsx`

**Changes:**
- Maintenance technicians can now sign in with a 4-digit PIN — mirrors the floor-operator system. New `maintenance.tech_auth` table stores a synthetic Supabase email per tech; PIN derives a deterministic password (`mnt_{pin}_{email}`) that never leaves the server.
- New `/maintenance-login` page: name picker + numeric PIN pad. Techs on the current shift (queried from `production.roster_entries`) are highlighted at the top with an "On shift" badge. After sign-in → `/maintenance/job-cards` (already filtered to assigned cards when role = `maintenance_technician`).
- New `/maintenance/technicians` manager page: shows all maintenance techs grouped by on-shift / off-shift. Maintenance manager can set or reset any tech's PIN (4-digit input, show/hide toggle), toggle active status. Indicates whether a PIN has been provisioned yet.
- New API routes: `GET /api/maintenance/technicians` (public, for login picker), `POST` (provision first-time), `PATCH` (reset PIN or toggle active), `GET /api/maintenance/technicians/manage` (manager-only, enriched with `has_pin` + `on_shift`).
- Login page redesigned: Microsoft button stays at top; two role cards below replace the old footer link — **Maintenance Tech** (orange icon) and **Floor Operator** (green icon), each with name + "Sign in with your PIN" description.
- Floor login updated to use the unified roster: queries `roster_entries` for today's shift, sorts on-shift operators to the top with a badge. Same smart behaviour now across both login pages.
- Sidebar: "Technician PINs" nav item added to Maintenance group, visible to Management + `can_manage_users` only.

---

## 2026-07-02 — Gustav (Sieving: all meshes required for In-Process; no negative values anywhere)

**Files changed:**
- `lib/utils/validation.ts` (new)
- `app/(app)/quality/sieving/page.tsx`
- `app/(app)/quality/pasteuriser/page.tsx`
- `app/(app)/quality/granule/page.tsx`

**Changes:**
- Sieving: an In-Process run now requires every mesh fraction to be filled in before it can be saved (previously only one was required) — applies to both new-run entry and inline row edits.
- Sieving, pasteuriser, granule: no captured value can be saved as negative — grams, sieve %, moisture, bulk density, dryer/hourly temperature, weight checks, needle count, leaf shade, and customer spec thresholds. Enforced both as an HTML `min=0` hint and as a hard save-time check (`lib/utils/validation.ts`), so it can't be bypassed by pasting or typing a leading minus.

---

## 2026-07-02 — Alyssa (Skills Matrix redesign + Staff Directory by department)

**Files changed:**
- `app/(app)/production/staff/matrix/page.tsx`
- `app/(app)/production/staff/page.tsx`
- `components/production/WorkforceTabs.tsx`
- `lib/auth/permissions.ts`
- `lib/auth/permission-registry.ts`

**Changes:**
- Skills Matrix completely redesigned — 3 operational views replace the raw Excel-style grid: **By Person** (dept-grouped collapsibles, competency progress bar, floor-section qualification badges), **By Section** (6 floor section cards each showing qualified/in-training/not-started counts + clickable name chips), **SOP Gaps** (SOPs sorted worst coverage first, coverage bars, <30% flagged red). Summary stats always visible at top.
- Staff Directory redesigned: grouped by department (accordion, all expanded by default), names alphabetical within each dept. Rows show position, employee code, competency chip, leave badge. Full add/edit/delete from here — inline delete confirmation (no modal). Edit modal extended with employee_code, position, position_code, start_date fields.
- New `can_delete_staff` permission key — defaults true for production_supervisor and quality_manager; wired into Users & Roles UI under Staff & Competency.
- WorkforceTabs (Shift Roster page sub-nav): removed Staff Directory tab; replaced with "Staff & Skills →" cross-reference link.

---

## 2026-07-02 — Alyssa (Staff Profiles + Skills/Competency Matrix — Phase 1)

**Files changed:**
- `supabase/migrations/20260702_001_competency_matrix.sql` (new)
- `lib/production/competency-config.ts` (new)
- `lib/auth/permissions.ts`
- `lib/auth/permission-registry.ts`
- `components/layout/Sidebar.tsx`
- `components/production/StaffTabs.tsx` (new)
- `app/(app)/layout.tsx`
- `app/(app)/production/staff/page.tsx`
- `app/(app)/production/staff/[id]/page.tsx` (new)
- `app/(app)/production/staff/matrix/page.tsx` (new)
- `app/(app)/production/staff/sops/page.tsx` (new)
- `app/api/staff/competencies/route.ts` (new)
- `scripts/import-competency-matrix.cjs` (new)

**Changes:**
- New **Staff & Skills** page in the Operations sidebar group (own entry, not under Shift Roster).
- 4 new DB tables: `production.sops`, `production.employee_competencies`, `production.competency_history` (FSSC audit trail), `production.role_required_sops` (Phase-2 allocation).
- `production.employees` extended with profile columns: position, position_code, department_code, employee_code, start_date, years_of_service, email, photo_url.
- Full staff profile page (`/production/staff/[id]`): header with avatar/codes/years, competency panel grouped by SOP area, inline edit modal per SOP, collapsible history feed.
- Skills Matrix page (`/production/staff/matrix`): employees × SOPs grid coloured by status (COMP/TRN/TBA/NC/—), filter by department and SOP area.
- SOP Catalogue page (`/production/staff/sops`): list of all SOPs grouped by area, add/edit gated by `can_manage_sop_catalog`.
- 5 new permission keys wired into Users & Roles: `can_view_staff`, `can_edit_staff_profiles`, `can_manage_competencies`, `can_manage_sop_catalog`, `can_allocate_staff`.
- API route `POST /api/staff/competencies` with server-side permission check, upsert, and dual audit trail (competency_history + axis.audit_log).
- Import script (`scripts/import-competency-matrix.cjs`) reads `Copy of CNTP Employees.xlsx` and `SOP_Matrix_Final.xlsx`, matches names 4 ways, upserts employees/SOPs/competencies idempotently, prints end-of-run report.
- **To activate:** run migration SQL in Supabase SQL editor, then `node scripts/import-competency-matrix.cjs` (with Excel files in `scripts/data/`).

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

## 2026-07-01 — Alyssa (full staff directory sync from employee spreadsheet)

**Files changed:**
- `supabase/migrations/20260623_001_staff_directory.sql` (data only — no schema change)

**Changes:**
- Synced all 125 employees from the canonical CNTP Employees spreadsheet into `production.employees` on both staging and production DBs.
- 48 new employees inserted (staging) / 47 (production); remaining updated with correct name, department, job title, and skill certifications inferred from the roster.
- Fixed 21 name spelling inconsistencies in `roster_entries.person_name` to match the canonical spreadsheet (e.g. "Grant Alexandra" → "Grant Alexander", "Shuaib Davids" → "Shuaib Sentso", "Ezetu Siminga" → "Amoretta Louw", and 18 others).
- Employees not in the spreadsheet (test operators, "Alyssa", "Cyril", etc.) were left untouched.

---

## 2026-07-01 — Alyssa (roster period selector date duplication fix)

**Files changed:**
- `app/(app)/production/roster/page.tsx`

**Changes:**
- Fixed period dropdown showing the date range twice (e.g. "29 Jun – 3 Jul · 29 Jun – 3 Jul 2026") when the period name already matches the formatted date range. Now only appends the range if the name differs.
- Seeded July 2026 roster (4 weekly periods, 286 entries) into production DB.

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
