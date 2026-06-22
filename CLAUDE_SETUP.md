# Claude Access Setup for Co-Developer

This guide explains how to give Claude the correct access to work on the CNTP staging project.

---

## 1. Install Claude Code

1. Install [Node.js](https://nodejs.org) if not already installed
2. Open PowerShell and run:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
3. Run `claude` and sign in with your Anthropic account

---

## 2. Open the Project

Make sure the project is cloned to:
```
C:\Users\<your-username>\Downloads\cntp-ops
```

If not, get the repo from Alyssa.

---

## 3. Start Claude in the Project

Open PowerShell, navigate to the project folder and start Claude:
```bash
cd C:\Users\<your-username>\Downloads\cntp-ops
claude
```

---

## 4. Give Claude the Right Permissions

When Claude asks for permissions, **allow the following:**

- ✅ Read/write files in the project directory
- ✅ Run `ssh` commands (for deploying to the VPS)
- ✅ Run `scp` commands (for uploading files to the VPS)
- ✅ Run `python` / `python3` commands (for patching emoji files)
- ✅ Run `npm run build` via SSH

> When prompted, select **"Allow for this session"** or **"Always allow"** for the above.

---

## 5. Tell Claude Who You Are

At the start of every session, tell Claude your name so changes are correctly attributed in the changelog:

> *"Hi, I'm [your name], working on the CNTP staging project."*

---

## 6. How Claude Deploys

Claude handles all deployment automatically. You just describe the change you want and Claude will:

1. Edit the file locally
2. Upload it to the VPS (using the correct method — SCP or Python patch)
3. Build the project on the server
4. Restart the staging app
5. Update `CHANGELOG.md` with what was changed

**You never need to run deployment commands yourself.**

---

## 7. Rules to Know

| Rule | Detail |
|---|---|
| Never `git pull` on VPS | The server has local modifications — Claude knows this |
| Quality pages use Python patch | Files with emoji must never be SCP'd directly |
| Always on staging | Claude only has access to staging, not production |
| Changelog is automatic | Claude logs every change to `CHANGELOG.md` at end of session |

---

## 8. Staging URL

https://cntpplatform-staging.rooibostea.co.za

> ⚠️ Does not work on the office network — use mobile hotspot to view.
