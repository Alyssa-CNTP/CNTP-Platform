# Production Deploy Queue — Quality consolidation

Created 2026-06-24. **Production is in use** — schedule this during low-traffic and
verify after each step. The production *database* work is already live; what's
queued here is the production **app code** deploy.

---

## Production environment (reference)
- **Clone:** `/home/cntpdev/apps/production/app/cntp-ops` (tracks the `staging` branch until `main` becomes the prod branch)
- **Process:** pm2 **`cntp-production`** on **port 3001** (staging is `cntp-staging` on 3000)
- **DB:** production Supabase `sxzjjcyuzyfneesnsjna` (separate from staging)
- **URL:** https://cntpplatform.rooibostea.co.za
- SSH: `ssh -p 2022 cntpdev@154.65.97.200`

---

## ✅ Already LIVE on production (no action needed)
Applied directly to the production DB on 2026-06-24:
- `qms.quality_records` = 869 (all `public` + staging captures consolidated)
- `qms.sd_runs` = 2054 · `qms.granule_runs/samples` = 32/255 · `qms.customer_specs` = 48 · `qms.lab_results` = 22
- `qms.quality_records.data_json` converted **text → jsonb** (ALTER already run)
- AXIS `project_requests` 9-column migration (already applied to prod DB)

The production app currently runs **old code** (public dual-read) against this
consolidated DB and works fine — the deploy below just switches it to the clean
qms-only code.

---

## 🚀 Code to deploy to production (all on the `staging` branch)
| PR | What | Notes |
|---|---|---|
| #148 | Pasteuriser per-day averages, sortable History, Gap-A fix, pivot export | emoji in page — fine via `git pull` (UTF-8 safe); only SCP corrupts it |
| #155 | Branded **ExcelJS** exports (all workcenters) | needs `exceljs` in `node_modules` → run `npm install --legacy-peer-deps` BEFORE build |
| #156 | Retire public dual-read — all Quality pages read qms only; legacy routes deleted | sieving paginates `qms.sd_runs` (>1000 rows) |

> ⚠️ Deploying the `staging` branch pulls **everything** merged to staging since the
> prod box was last built — not only these three PRs. Review `git log HEAD..origin/staging`
> on the prod clone first to see the full set.

---

## Deploy steps (zero-downtime, mirrors scripts/staging-deploy.sh)
Run on the VPS against the **production** clone + `cntp-production`:

```bash
ssh -p 2022 cntpdev@154.65.97.200
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
cd /home/cntpdev/apps/production/app/cntp-ops
PM2=/home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2

# 1. review what will ship
git fetch origin staging && git log --oneline HEAD..origin/staging

# 2. sync code (prod clone is clean / no local mods — confirm with `git status`)
git reset --hard origin/staging

# 3. install deps (REQUIRED — exceljs is new)
npm install --legacy-peer-deps 2>&1 | tail -5

# 4. build into a side dir so the live .next is never empty (avoids 502s)
rm -rf .next-build && NEXT_DIST_DIR=.next-build npm run build 2>&1 | tail -6
test -f .next-build/BUILD_ID || { echo "BUILD FAILED — aborting, live site untouched"; exit 1; }

# 5. atomic swap + restart
rm -rf .next-old; [ -d .next ] && mv .next .next-old; mv .next-build .next
$PM2 restart cntp-production

# 6. verify (roll back if any fail: rm -rf .next; mv .next-old .next; pm2 restart)
U=https://cntpplatform.rooibostea.co.za
for p in /quality/pasteuriser /quality/sieving /quality/granule /quality/lab-results /quality/raw-material /quality/customer-specs /dashboard; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' "$U$p")"
done
```

(Optional: copy `scripts/staging-deploy.sh` → `scripts/production-deploy.sh` with
`APP=…/production/…`, `cntp-production`, the prod URL, and add the `npm install` step.)

---

## Post-deploy verification checklist (on https://cntpplatform.rooibostea.co.za)
- [ ] All six Quality pages load (200 above) and show records
- [ ] Pasteuriser History → expand a batch → **📅 Per-day avg** toggle works; sortable columns work
- [ ] ⬇ Export Excel produces a **branded** workbook (logo, green header, conditional fills)
- [ ] Sieving shows the full run list (pagination — not capped at 1000)
- [ ] Raw Material records render (data_json jsonb)
- [ ] No console errors hitting `/api/quality/legacy-*` (routes are gone — should be no calls)

---

## Follow-ups (not blocking the deploy)
- Dedup the ~144 internal duplicate keys in `qms.sd_runs` (legacy junk mirrored from public). Draft in `supabase/migrations/20260624_quality_consolidation_DRAFT.sql`.
- Rotate the production + staging Supabase service-role keys (shared in plaintext during this work).
- Once prod is verified, the `public` quality tables are fully redundant and can be archived/dropped after a backup.
