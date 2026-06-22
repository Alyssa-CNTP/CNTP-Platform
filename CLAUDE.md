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

## Changelog Rule
At the end of every session update `CHANGELOG.md` with:
- **Date**
- **Developer** (ask at start of session if not known)
- **Files changed**
- **Changes** — what was added, removed or modified and why

Never skip this. Even small fixes must be logged.
