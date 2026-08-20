# Deployment Runbook (manual)

**As of 2026-08-19, both auto-deploy GitHub Actions are disabled** (`Deploy to
Staging` and `Deploy to Production`). Merging to `staging` or `main` no longer
builds or deploys anything. **Every deploy is now a deliberate, manual step**
run from a machine that can SSH to the VPS.

Why: on 2026-08-19 a merge to `main` auto-triggered `deploy-production.yml`
while a manual deploy was already building on the box — **two Next builds at
once** exhausted the 3.8 GB VPS (OOM/swap death-spiral) and took production down
for ~40 minutes. The rule that prevents it: **one build on the box at a time.**

---

## The one rule

> **Never run two builds on the VPS at the same time.** Not staging + production,
> not two of either, not a manual deploy while a GitHub Action (or another
> person's deploy) is building. Wait for one to print `DEPLOY OK` before
> starting the next.

The box hosts *both* staging and production plus their builds; it cannot survive
two concurrent `next build`s.

---

## How to deploy

Both environments use a **safe atomic deploy script**: it waits for any
in-flight build, builds into a **side directory** (the live `.next` is never
touched mid-build), atomically swaps it in, restarts, HTTP-verifies a few
routes, and **rolls back to the previous build if the new one fails**. A failed
build therefore leaves the site exactly as it was — never a broken `.next`.

### Staging

Merge your work to `staging` first, then:

```bash
ssh -p 2022 cntpdev@154.65.97.200 'bash /home/cntpdev/apps/staging/app/cntp-ops/scripts/staging-deploy.sh'
```

- Syncs to `origin/staging`, builds, swaps, restarts `cntp-staging` (port 3000).
- Verify: it ends with `DEPLOY OK`. If it prints `BUILD FAILED` or `ROLLED BACK`,
  the previous build is still live — fix the cause before retrying.

### Production

Merge your work to `main` first (via PR), pick an **off-peak** moment (not
mid-shift — the build briefly loads the box), then:

```bash
ssh -p 2022 cntpdev@154.65.97.200 'bash /home/cntpdev/apps/production/app/cntp-ops/scripts/production-deploy.sh'
```

- Syncs to `origin/main`, builds, swaps, restarts `cntp-production` (port 3001).
- Same `DEPLOY OK` / rollback behaviour as staging.

---

## Database migrations (separate, still manual)

The deploy scripts do **not** run migrations. Apply SQL to the target Supabase
project yourself, in order, **before** deploying the code that needs it:

- Staging DB: `qjqkpockmujecjgmdple`
- Production DB: `sxzjjcyuzyfneesnsjna`

Run migrations from `supabase/migrations/` via the Supabase SQL editor (or a
`psql`/`supabase` session with the DB URL). Never apply a prod migration before
the code that needs it is deployed there.

---

## Standard flow, start to finish

1. Branch from `staging`, make the change, commit, push, open a PR to `staging`.
2. Merge the PR (this does **not** deploy anything now).
3. Deploy staging with the script above; verify `DEPLOY OK` and test on
   `https://cntpplatform-staging.rooibostea.co.za`.
4. Promote: PR from the change onto `main` (cherry-pick the specific commits —
   `main` and `staging` diverge), merge it.
5. Apply any pending migration to the **production** DB.
6. Deploy production with the script above, **off-peak**, and only when no other
   build is running. Verify `DEPLOY OK` and the live site.

---

## If a deploy goes wrong

- **Script says `ROLLED BACK` / `BUILD FAILED`:** the previous build is still
  serving. Read the build output (it tails the last lines), fix, redeploy.
- **502 after a deploy / crash-loop (`Could not find a production build`):** the
  live `.next` is incomplete (only happens if a build was killed mid-write —
  e.g. two concurrent builds). Recover with a single clean rebuild:
  ```bash
  ssh -p 2022 cntpdev@154.65.97.200 'cd /home/cntpdev/apps/production/app/cntp-ops && export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && npm run build 2>&1 | tail -15 && pm2 restart cntp-production'
  ```
- **Box unreachable / SSH hangs after auth (no shell):** the box is
  resource-starved (a runaway build). Kill it if you can get a shell
  (`pkill -9 -f "next build"`); if SSH won't spawn a shell at all, **reboot from
  the VPS provider control panel** — pm2 auto-starts both apps on boot, on their
  intact builds. All data is in Supabase, so a reboot loses nothing.

---

## Re-enabling auto-deploy later (optional)

If auto-deploy is ever turned back on, it **must not** be able to collide with a
manual deploy or with the other environment's build. Before re-enabling:

- Add a shared build lock on the box (e.g. `flock`/lockfile) that both the
  workflow and the scripts acquire, so a second build waits instead of running.
- Or keep exactly one deploy path per environment (workflow *or* script, never
  both), and gate the two environments so they can't build simultaneously.

Until that exists, **leave both workflows disabled and deploy manually.**
