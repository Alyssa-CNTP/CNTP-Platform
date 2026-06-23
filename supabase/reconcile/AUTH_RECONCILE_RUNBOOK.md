# Auth reconcile — align PRODUCTION users & roles to the STAGING model

Goal: production's Supabase auth should match the model we run on staging —
real staff signing in with their **Azure work account** (`@rooibostea.co.za`),
each with the right **role** (`shared.app_roles`), plus the existing `@floor`
PIN operators. Remove the early placeholder `@cntp.local` accounts.

Runs through the existing **DB Reconcile** GitHub Action (`.github/workflows/db-reconcile.yml`):
backs up BOTH databases to the VPS first, then applies one phase (named in
`supabase/reconcile/CONFIRMED`) against production in a single transaction.
Required repo secrets `STAGING_DB_URL` / `PRODUCTION_DB_URL` (Session Pooler URIs)
are already set from the earlier buckets.

Prerequisite already met: **Azure provider is enabled on the prod Supabase project.**

---

## Phase A — `auth-add-staff` (additive, safe)

Copies the real-staff accounts from staging → prod:
`auth.users` + their `auth.identities` (so Azure SSO matches the same account) +
their `shared.app_roles` row. **`ON CONFLICT DO NOTHING`** — never overwrites,
never deletes. UUIDs are preserved, so each role binds to the right user.

- Staff = `email LIKE '%@rooibostea.co.za'`, excluding `@floor.*` and `@cntp.local`.
- The 3 accounts already in prod (Alyssa / Gustav / Jan — identical UUIDs) are skipped.
- `@floor` PIN operators are NOT touched here (separate PIN-provisioning flow).

## Phase B — `auth-prune-cntp-local` (deletion, FK-checked)

Deletes the placeholder `@cntp.local` accounts — but only those with **zero
references from real data tables**. An account referenced by production data
(capture/scan/count entries, audit logs, `created_by`, …) is **kept** and logged.
The account's own ancillary rows (its `shared.app_roles` row, its
`production.operators` row, `auth.*`) are removed with it and do not count as
blocking references. Runs via `MODE=sqlfile` → `supabase/reconcile/auth_prune_cntp_local.sql`.
A full KEEP/DELETE report is printed (RAISE NOTICE) before any row is removed.

---

## How to run

### 0. Preview (read-only, recommended)
Push the current commit to `reconcile/diff`. The **Auth reconcile preview** step
prints the staff that would be copied and the `@cntp.local` accounts with their
references. Download the `reconcile-diff` artifact (`auth_preview.txt`). No writes.

```bash
git push origin HEAD:reconcile/diff
```

### 1. Apply Phase A
Set the phase and push to `reconcile/apply`:

```bash
echo auth-add-staff > supabase/reconcile/CONFIRMED
git commit -am "reconcile: auth-add-staff phase"
git push origin HEAD:reconcile/apply
```

Verify in the run log (`=== PROD @rooibostea.co.za staff after copy ===`) and by
having a couple of staff sign in via "Continue with work account" on
https://cntpplatform.rooibostea.co.za.

### 2. Apply Phase B (only after A is verified)

```bash
echo auth-prune-cntp-local > supabase/reconcile/CONFIRMED
git commit -am "reconcile: auth-prune-cntp-local phase"
git push origin HEAD:reconcile/apply
```

Read the KEEP/DELETE report in the run log. Referenced `@cntp.local` accounts are
intentionally retained.

---

## Rollback
Every run uploads `prod_full_<stamp>.dump` to `/home/cntpdev/apps/backups` on the
VPS before touching prod. `auth.*` is included in that dump, so a bad phase can be
restored from there.

## Notes / not covered
- New staff who later join: just have them sign in via Azure (auto-provisioned),
  then assign their role in-app (`/admin/users`) — same as staging.
- `@floor` operator PIN logins on prod are provisioned in-app by an admin setting
  PINs on the seeded `production.operators` rows (separate from this runbook).
