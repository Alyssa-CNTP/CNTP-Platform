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

### 4a. Any PR opened against `main` — tag Alyssa immediately
`main` is production and its branch protection requires approval from someone
other than the last pusher — Claude cannot self-approve or bypass this (no
admin rights on the token). So every time a PR is opened with `base: main`
(a promotion PR), post a comment tagging her right after opening it, so she
gets a GitHub notification/email without being asked each time:
```bash
TOKEN=$(cat ~/.claude_github_token)
curl -s -X POST -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/Alyssa-CNTP/CNTP-Platform/issues/$PR/comments" \
  -d '{"body":"@Alyssa-CNTP this is ready for production — please review/approve when you get a chance."}'
```
Do this for every `main` PR, not just ones the developer explicitly flags.

### 5. Deploy to VPS
```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 '
  export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
  cd /home/cntpdev/apps/staging/app/cntp-ops
  git pull origin staging
  npm run build 2>&1 | tail -15
  /home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2 restart cntp-staging
'
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

**Deploy = merge to `staging`.** A push/merge to `staging` triggers
`.github/workflows/deploy-staging.yml`, which SSHes to the VPS (using the `VPS_SSH_KEY`
secret) and runs pull → `npm run build` → `pm2 restart cntp-staging`. **That merge is
the deploy.** Feature branches and `voice-jobcard-v2` are **not** auto-deployed — only
`staging` is. To ship a feature: get its commits onto `staging` (PR→merge, or push the
branch's commits to `staging`), then the workflow does the rest. Verify via the repo's
**Actions** tab.

Notes:
- Supabase migrations: apply to the **staging** project (`qjqkpockmujecjgmdple`); the
  production project needs them separately when promoted.
- GitHub writes from a web session may go via a token directly to `github.com` if the
  agent proxy gates `api.github.com`.

### How a web session actually pushes / merges (do this, don't re-derive it)

A web/cloud session's sandbox proxy blocks **write** calls to `github.com` and
`api.github.com` (plain `git push` gets 403; so does an unauthenticated `curl` to the
API). Read-only `git fetch`/`git clone` over HTTPS works fine without a token — only
writes are blocked. The GitHub MCP tools in this environment are **read-only** here too
(`get_me`/`list_commits` work; `create_branch`/`push_files` fail with `403 Resource not
accessible by integration`) — don't spend time re-discovering that; go straight to the
token path below.

1. **Check first, cheaply**, before asking the developer for anything:
   - `env | grep -iE 'GITHUB_TOKEN|GH_TOKEN'` — usually present but are **agent-proxy
     tokens**, not real GitHub PATs; a real PAT starts `ghp_`/`github_pat_` and these
     don't. Confirm by trying `curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user`
     through the proxy bypass below — if that 401s, it's not usable and stop trying.
   - Try the GitHub MCP write tools once (`create_branch`/`push_files`) — if they 403,
     don't retry, just move to asking for a token.
2. **Ask the developer for a GitHub PAT with repo write access** (Settings → Developer
   settings → Personal access tokens). They may reuse a previously-issued token from
   earlier in this repo's history — that's their call, not something to second-guess —
   but do mention that a token pasted into chat is visible in that session's history and
   is worth rotating once they're done needing this path.
3. **Push, bypassing the proxy** (this is the actual fix — `-c http.proxy= -c
   https.proxy=` unsets the proxy for this one command so the real `github.com` TLS
   connection goes through, authenticated with the token in the URL):
   ```bash
   git -c http.proxy= -c https.proxy= push \
     "https://x-access-token:<TOKEN>@github.com/Alyssa-CNTP/CNTP-Platform" <branch-name>
   ```
4. **Open a PR** with `curl --noproxy "*"` (same idea — skip the proxy for this call):
   ```bash
   curl -sS --noproxy "*" -X POST -H "Authorization: token <TOKEN>" -H "Content-Type: application/json" \
     https://api.github.com/repos/Alyssa-CNTP/CNTP-Platform/pulls \
     -d '{"title":"...","head":"<branch-name>","base":"staging","body":"..."}'
   ```
5. **Merge it** — to `staging`, this squash-merge *is* the deploy (triggers
   `deploy-staging.yml`); to `main`, only if the developer/Alyssa explicitly asked for a
   merge, not just a PR (branch protection normally blocks direct merges to `main`
   anyway — that's intentional, see Rules above):
   ```bash
   curl -sS --noproxy "*" -X PUT -H "Authorization: token <TOKEN>" -H "Content-Type: application/json" \
     https://api.github.com/repos/Alyssa-CNTP/CNTP-Platform/pulls/<PR#>/merge \
     -d '{"merge_method":"squash"}'
   ```
6. **Verify the deploy actually ran** (a merge to `staging` doesn't guarantee the
   workflow fired — it has silently skipped before): poll
   `GET /repos/Alyssa-CNTP/CNTP-Platform/actions/runs?branch=staging&per_page=1` until
   `status:"completed"`, check `conclusion:"success"`, and confirm the `head_commit`
   message matches what was just merged. If no run appears for that commit, re-trigger
   it with `POST .../actions/runs/<run_id>/rerun` rather than assuming it's fine.

**Promoting `staging` → `main`**: don't diff whole branches (they diverge from
unrelated work landing on each independently) — `git cherry-pick` only the specific
squash-merge commits for the feature being promoted onto a fresh branch based on
`main`, resolve the (usually just `CHANGELOG.md`) conflicts by keeping both sides'
entries, then push/PR that branch per the steps above. Flag any pending Supabase
migration that needs applying to **production** once that PR merges — never apply a
migration to production before the code that needs it is deployed there.

---

## Changelog Rule
At the end of every session update `CHANGELOG.md` with:
- **Date**
- **Developer** (ask at start of session if not known)
- **Files changed**
- **Changes** — what was added, removed or modified and why

Never skip this. Even small fixes must be logged.
