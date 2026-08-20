@AGENTS.md

## Project

**Repo:** https://github.com/Alyssa-CNTP/CNTP-Platform
**VPS:** `cntpdev@154.65.97.200` | Port `2022`
**App path:** `/home/cntpdev/apps/staging/app/cntp-ops`
**Staging URL:** https://cntpplatform-staging.rooibostea.co.za
**GitHub token:** stored in `~/.claude_github_token` on the VPS

---

## Workflow — Every Change

### 1. Start of session
Ask the developer their name if not already known. Then create a branch:
```bash
git checkout staging
git pull origin staging
git checkout -b alyssa/description-of-change
# For Gustav: git checkout -b gustav/description-of-change
```

### 2. Make changes
Edit files in the local project folder.

### 3. Commit and push branch
```bash
git add -A
git commit -m "clear description of what changed and why"
git push origin HEAD
```

### 4. Open and merge PR to staging
```bash
TOKEN=$(cat ~/.claude_github_token)
PR=$(curl -s -X POST -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/Alyssa-CNTP/CNTP-Platform/pulls \
  -d "{\"title\":\"description\",\"head\":\"branch-name\",\"base\":\"staging\",\"body\":\"\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['number'])")
curl -s -X PUT -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/Alyssa-CNTP/CNTP-Platform/pulls/$PR/merge \
  -d "{\"merge_method\":\"squash\"}"
```

### 5. Deploy to VPS  — **MANUAL ONLY** (auto-deploy is disabled)

Merging to `staging`/`main` no longer deploys anything. Deploy with the safe
atomic script (side-dir build → verify → auto-rollback). **See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full runbook.**

> ⚠️ **One build on the box at a time.** Never run a staging and a production
> deploy (or two of either) concurrently — two `next build`s OOM the VPS and
> take production down (2026-08-19 outage). Wait for `DEPLOY OK` before the next.

Staging:
```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 'bash /home/cntpdev/apps/staging/app/cntp-ops/scripts/staging-deploy.sh'
```
Production (off-peak only):
```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 'bash /home/cntpdev/apps/production/app/cntp-ops/scripts/production-deploy.sh'
```

### 6. Update CHANGELOG
Update `CHANGELOG.md` with date, developer name, files changed, and description of code changes.

---

## Rules
- Always branch from `staging` — never work directly on `staging` or `main`
- Branch naming: `alyssa/feature-name` or `gustav/feature-name`
- Never force push to `staging` or `main`
- `npm install` requires `--legacy-peer-deps`
- Always `source "$NVM_DIR/nvm.sh"` before running node/npm in SSH sessions
- `main` = production — never touch without explicit instruction

---

## Deploying — Claude Code on the web (read this; don't re-ask the developer)

A Claude Code web/cloud session **cannot deploy via SSH**: the container has no `ssh`
client or VPS key, and the network egress allowlist blocks the VPS host *and* the
staging URL. So the manual SSH step above is **not runnable from a web session** — do
not ask the developer to run it, and do not ask which deploy method to use.

**⚠️ Auto-deploy is DISABLED (2026-08-19).** Both `deploy-staging.yml` and
`deploy-production.yml` are turned off — **merging to `staging` or `main` no
longer deploys anything.** The old "merge = deploy" flow is gone. Every deploy
is now a **manual** run of a deploy script over SSH (see step 5 above and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)), and **only one build may run on the
VPS at a time** (two concurrent builds OOM the box — that's what caused the
2026-08-19 production outage).

**A web/cloud session cannot deploy at all** (no SSH client/key, egress blocked).
From a web session: get the commits onto the branch (PR→merge), then tell the
developer to run the deploy script manually — do not expect a merge to deploy.

Notes:
- Supabase migrations: apply to the **staging** project (`qjqkpockmujecjgmdple`); the
  production project needs them separately when promoted.
- GitHub writes from a web session may go via a token directly to `github.com` if the
  agent proxy gates `api.github.com`.

---

## Changelog Rule
At the end of every session update `CHANGELOG.md` with:
- **Date**
- **Developer** (ask at start of session if not known)
- **Files changed**
- **Changes** — what was added, removed or modified and why

Never skip this. Even small fixes must be logged.
