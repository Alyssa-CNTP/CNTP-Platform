# Production schema catch-up — 2026-08-21

Live production (`sxzjjcyuzyfneesnsjna`, https://cntpplatform.rooibostea.co.za) is
missing objects the app queries. The browser console shows them as PostgREST
`404`s and one `400`, each swallowed by a best-effort `catch`, so the affected
features render empty rather than failing visibly — nothing on screen says the
data can't be reached.

## What was checked

Every failing call **does** send the right schema, so this is database drift, not
a client bug:

| Console symptom | Called from | Schema sent | Object |
|---|---|---|---|
| `count_drafts` 404 | `lib/store/countStore.ts` | `public` (default) | `public.count_drafts` |
| `employee_leave_active` 404 | `app/(app)/supervisor/roster/page.tsx:102` (`db() = getDb().schema('production')`) | `production` | `production.employee_leave_active` |
| `roster_change_log` 404 | `app/(app)/supervisor/roster/page.tsx:110` | `production` | `production.roster_change_log` |
| `shift_reports` 404 | `app/(app)/supervisor/signoff/page.tsx:130` | `production` | `production.shift_reports` |
| `job_cards_pasteuriser` 400 | `app/(app)/production/capture/assign/page.tsx:620` | `public` | missing **column**, not table |

A PostgREST `404` means the object isn't in the schema cache — either it doesn't
exist, **or** it exists with no privilege for an API role, which keeps it out of
the cache entirely. A `400` is a different failure: the table is there but a
column in the select list isn't, and PostgREST rejects the whole query, so one
missing column takes out the entire pasteuriser approval queue.

`docs/ops/prod-drift-audit.sql` distinguishes those cases. Run it on production
first — it is read-only — and let the output decide which column of the table
below applies.

## What each symptom costs, and what closes it

| Object | Effect while missing | Closed by |
|---|---|---|
| `public.count_drafts` | Every stock-count draft load/save 404s. `countStore` swallows it, so a counter's in-progress work lives in browser memory only — gone on reload or device swap. | **`20260821_001_count_drafts.sql` (new in this commit)** — the table was never in the repo at all, so it only exists where someone made it by hand. Apply to **both** databases. |
| `production.employee_leave` + `employee_leave_active` | Nothing knows who's on leave: the Shift Roster doesn't flag them, capture section-assign offers them, and `shift-report-builder` counts them as available. | `20260623_003_employee_leave.sql` |
| `production.roster_change_log` | Post-publish roster changes aren't recorded — the Production Manager has no history of who was moved, added or removed after sign-off. Also adds the `changes_pending` status to `roster_section_status`. | `20260730_002_roster_daily_changes.sql` |
| `production.shift_reports` (+ `shift_report_audit`, `capture_ratings`, `capture_rating_audit`, `v_capture_scoreboard`) | Supervisor Hub Sign-off shows no shift reports; no report can be generated, submitted or approved; capture ratings have nowhere to land. | `20260730_001_shift_report_and_capture_ratings.sql` |
| `public.job_cards_pasteuriser` workflow columns | The pasteuriser job-card approval queue 400s and shows nothing. The audit's section 2 says which of `status`, `sent_for_approval_at`, `blend_ratio_lines`, `final_ratio_lines`, … are absent. | `20260729_002_job_cards_pasteuriser_workflow.sql` (fully additive — `ADD COLUMN IF NOT EXISTS`) |

## Apply order (production SQL editor)

Dependencies resolve at apply time, so a missing prerequisite makes the file
error rather than partially apply. Audit section 1 reports each prerequisite —
confirm the `dependency` rows are all `present` before starting.

1. `20260623_003_employee_leave.sql` — needs `production.employees`
   (`20260623_001_staff_directory.sql`) and `production.set_updated_at()`.
2. `20260730_001_shift_report_and_capture_ratings.sql` — needs
   `production.set_updated_at()`. Self-contained otherwise; carries its own
   grants and policies.
3. `20260730_002_roster_daily_changes.sql` — needs `production.roster_periods`
   (`20260622_001_roster.sql`) and `production.roster_section_status`
   (`20260706_003_roster_section_status.sql`).
4. `20260729_002_job_cards_pasteuriser_workflow.sql` — no prerequisites.
5. `20260821_001_count_drafts.sql` — no prerequisites. **Also apply on staging**,
   where the table exists only by hand (if the audit shows staging's copy has a
   different shape, match staging rather than this file, and say so — the file
   was written from the three calls `countStore` makes, not from staging's copy).

Then, regardless of which files ran:

```sql
NOTIFY pgrst, 'reload schema';
```

`20260623_003` grants nothing (it predates the convention), and its view needs
its own grant — the `ALTER DEFAULT PRIVILEGES` in `20260611_005_grants.sql` only
covers tables created by the same role that ran it. If audit section 1 comes
back `present` but `auth_select` false for anything, that is the whole fault, and
this is the fix — no re-creating required:

```sql
GRANT ALL    ON production.employee_leave        TO authenticated, service_role;
GRANT SELECT ON production.employee_leave_active TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
```

## After applying

- Reload the production site and re-check the console on `/supervisor/roster`,
  `/supervisor/signoff`, `/production/capture/assign` and the count screen —
  those five entries should be gone.
- Audit sections 3 and 4 dump every object and column in `public`, `production`,
  `qms`, `sales` and `hr`. Run them on **both** databases and diff the output:
  that catches the drift nobody has hit in a browser yet, rather than only the
  five symptoms already seen.

## Separate finding — no shift-report cron on production

`.github/workflows/shift-report-generate.yml` pings
`vars.SHIFT_REPORT_CRON_URL`, falling back to the **staging** URL. The repo has
no Actions variables set (`total_count: 0`), so the 16:00 / 01:00 SAST shift
report generation has only ever run against staging. Creating
`production.shift_reports` does not change that — production reports would only
appear when a supervisor generates one in the UI.

Two ways to close it, both a decision rather than a fix: set
`SHIFT_REPORT_CRON_URL` to the production URL (which moves the cron off staging
entirely), or add a production variant workflow alongside
`roster-rotate-production.yml` and `energy-capture-production.yml`, which is the
pattern the other production crons already use.
