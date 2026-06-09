@AGENTS.md

## How Claude Works on This Project

All code lives and runs on the VPS. Claude edits files **directly on the VPS** via SSH — no local file uploads or SCP unless absolutely necessary.

**Server:** `cntpdev@154.65.97.200` | Port `2022`
**App path:** `/home/cntpdev/apps/staging/app/cntp-ops`
**Staging URL:** https://cntpplatform-staging.rooibostea.co.za

### Standard workflow for every change:

1. Edit the file directly on the VPS using SSH
2. Build and restart via PM2

### Rules:
- **Never `git pull`** on the VPS — it has local modifications
- **Never SCP TSX files from Windows** that contain emoji — PowerShell corrupts UTF-8
- `npm install` requires `--legacy-peer-deps`
- Always `source "$NVM_DIR/nvm.sh"` before running node/npm in SSH sessions

---

## Changelog Rule

At the end of every session where any file is changed, Claude MUST update `CHANGELOG.md` at `/home/cntpdev/apps/staging/app/cntp-ops/CHANGELOG.md`.

Each entry must include:
- **Date** (today's date)
- **Developer** (ask at the start of the session if not already known)
- **Files changed** (exact file paths)
- **Code changes** (clear description of what was added, removed, or modified and why)

Use this format:

## YYYY-MM-DD — [Developer Name]

**Files changed:**
- app/(app)/path/to/file.tsx

**Changes:**
- Description of what changed and why

Never skip this. Even small fixes must be logged.
