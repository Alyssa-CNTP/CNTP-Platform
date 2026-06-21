# Production DB Reconciliation Runbook

One-time job: make **production** (`sxzjjcyuzyfneesnsjna`) match **staging**
(`qjqkpockmujecjgmdple`) — full `qms` schema + users + roles — then turn on the
ongoing **schema-up / data-down** flow.

> **You run every command in this file.** Your DB passwords go into your own
> shell (`$STAGING_DB_URL` / `$PROD_DB_URL`) and into GitHub secrets — never into
> chat. Paste command *output* back to Claude for review at the checkpoints.

---

## 0. Prerequisites (once)

```bash
# Supabase CLI (https://supabase.com/docs/guides/cli) and Docker must be installed.
supabase --version
docker --version

# Put the connection strings in your shell session ONLY (don't commit, don't paste these):
#   bash / git-bash:
export STAGING_DB_URL='postgresql://postgres:REAL_PW@db.qjqkpockmujecjgmdple.supabase.co:5432/postgres'
export PROD_DB_URL='postgresql://postgres:REAL_PW@db.sxzjjcyuzyfneesnsjna.supabase.co:5432/postgres'
#   PowerShell:
#   $env:STAGING_DB_URL = 'postgresql://postgres:REAL_PW@db.qjqkpockmujecjgmdple.supabase.co:5432/postgres'
#   $env:PROD_DB_URL    = 'postgresql://postgres:REAL_PW@db.sxzjjcyuzyfneesnsjna.supabase.co:5432/postgres'
```

---

## 1. BACK UP BOTH DATABASES FIRST  ⛔ do not skip

These are your rollback. The prod backup also preserves the old `public`
quality records permanently, so abandoning them is safe.

```bash
mkdir -p backups
supabase db dump --db-url "$PROD_DB_URL"    -f backups/prod_full_$(date +%Y%m%d).sql
supabase db dump --db-url "$PROD_DB_URL" --data-only -f backups/prod_data_$(date +%Y%m%d).sql
supabase db dump --db-url "$STAGING_DB_URL" -f backups/staging_full_$(date +%Y%m%d).sql
```

✅ **Checkpoint A** — confirm all three files exist and are non-empty.

---

## 2. Diff the two databases (read-only)

```bash
# schemas + tables + row counts on each, side by side
for url in "$STAGING_DB_URL" "$PROD_DB_URL"; do
  psql "$url" -c "
    SELECT schemaname, relname AS table, n_live_tup AS rows
    FROM pg_stat_user_tables
    WHERE schemaname IN ('public','qms','acumatica')
    ORDER BY schemaname, relname;"
done
```

✅ **Checkpoint B** — paste both outputs to Claude. Together we confirm exactly
which old `public` quality tables get dropped and which `qms` tables/data carry over.

---

## 3. Capture staging as the source-of-truth baseline

Staging has drifted ahead of `supabase/migrations` (it has `qms`; the repo
doesn't). Capture staging's real schema as one baseline migration:

```bash
supabase login          # browser auth, no DB password
supabase init           # creates supabase/config.toml if missing — commit it later

# full current schema of staging -> a baseline migration file
supabase db dump --db-url "$STAGING_DB_URL" \
  -f supabase/migrations/$(date +%Y%m%d)000000_baseline_from_staging.sql
```

✅ **Checkpoint C** — paste the generated file (or its table-of-contents) to
Claude to review before it touches production.

---

## 4. Extract the data to carry into production

```bash
# users + their logins/roles (auth schema data)
supabase db dump --db-url "$STAGING_DB_URL" --data-only --schema auth -f backups/auth_data.sql
# database roles / grants
supabase db dump --db-url "$STAGING_DB_URL" --role-only -f backups/roles.sql
# qms historical data + reference/spec tables (granule_specs, customer_specs, lab specs, ...)
supabase db dump --db-url "$STAGING_DB_URL" --data-only --schema qms -f backups/qms_data.sql
```

---

## 5. ⛔ STOP — review the apply plan with Claude before this point

Everything below **changes production** and is gated on Checkpoints A–C.
Claude will hand you the finalized drop/apply SQL based on the real diff. The
shape will be:

1. `DROP` the abandoned old `public.*` quality tables (preserved in the backup).
2. Apply the baseline schema → creates `qms` (+ `acumatica`) in production.
3. Load `roles.sql`, then `auth_data.sql` (users), then `qms_data.sql`.
4. Reset sequences, re-enable RLS, verify grants.

> Cloning users across projects: bcrypt password hashes are portable, so users
> keep their passwords. Only existing login *sessions* drop (different JWT
> secret) — everyone just signs in again.

---

## 6. Verify

```bash
# re-run the Checkpoint B query against PROD — structure should now match staging
psql "$PROD_DB_URL" -c "
  SELECT schemaname, relname AS table, n_live_tup AS rows
  FROM pg_stat_user_tables
  WHERE schemaname IN ('public','qms','acumatica')
  ORDER BY schemaname, relname;"
```

- [ ] prod schema list == staging schema list (minus dropped `public` tables)
- [ ] a cloned user can log in to the production app
- [ ] app can read **and write** a `qms` table (e.g. create a granule run)

---

## 7. Turn on the ongoing flow

1. In GitHub → **Settings → Secrets and variables → Actions**, add:
   - `STAGING_DB_URL`, `PRODUCTION_DB_URL` (full connection strings, incl. password)
   - `SUPABASE_ACCESS_TOKEN` (from `supabase login` → Account → Access Tokens)
2. Mark the baseline as already-applied on **both** DBs so it isn't re-run:
   ```bash
   supabase migration repair --status applied <baseline_version> --db-url "$STAGING_DB_URL"
   supabase migration repair --status applied <baseline_version> --db-url "$PROD_DB_URL"
   ```
3. Commit `supabase/config.toml` + the baseline migration. From now on:
   - **Schema up:** edit a migration → merge to `staging` (auto-push to staging
     DB) → test → merge to `main` (auto-push to prod DB). → `.github/workflows/db-migrate.yml`
   - **Data down:** nightly job refreshes staging's `qms` data from prod.
     → `.github/workflows/staging-data-refresh.yml`
