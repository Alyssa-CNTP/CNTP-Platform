# CNTP Staging Deployment Guide

**Server:** `cntpdev@154.65.97.200` | Port `2022` | User: `cntpdev`  
**App path:** `/home/cntpdev/apps/staging/app/cntp-ops`  
**Staging URL:** https://cntpplatform-staging.rooibostea.co.za  
> ⚠️ **Never run `git pull`** — the VPS has local modifications that will be overwritten.

---

## VS Code Remote SSH Setup

1. Install VS Code + the **Remote - SSH** extension
2. Create or edit `C:\Users\<username>\.ssh\config`:
   ```
   Host cntp-vps
       HostName 154.65.97.200
       User cntpdev
       Port 2022
   ```
3. Copy the SSH private key into `C:\Users\<username>\.ssh\`
4. In VS Code: `Ctrl+Shift+P` → **Remote-SSH: Connect to Host** → **cntp-vps**
5. Once connected, **File → Open Folder** → `/home/cntpdev/apps/staging/app/cntp-ops`

---

## Deployment Methods

### Method A — Regular files (no emoji in the file)

Use for: API routes, lib files, config files, components without emoji.

```bash
# 1. Upload file
scp -P 2022 -o StrictHostKeyChecking=no \
  "C:/Users/<username>/Downloads/cntp-ops/PATH/TO/FILE" \
  cntpdev@154.65.97.200:"/home/cntpdev/apps/staging/app/cntp-ops/PATH/TO/FILE"

# Create new directory first if needed
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 \
  'mkdir -p /home/cntpdev/apps/staging/app/cntp-ops/NEW/DIR'

# 2. Build
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 '
  export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
  cd /home/cntpdev/apps/staging/app/cntp-ops
  npm run build 2>&1 | tail -15
'

# 3. Restart PM2
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 '
  export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
  /home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2 restart cntp-staging
'
```

---

### Method B — Files with emoji (quality pages, TSX with icons)

> ⚠️ **Never SCP these files.** PowerShell corrupts UTF-8 encoding and breaks emoji in the browser.  
> Use for: all files under `app/(app)/quality/`, any component with emoji icons.

**Step 1:** Write a patch script locally and save as `patch_xxx.py` in `C:\Users\<username>\Downloads\cntp-ops\`

```python
f = '/home/cntpdev/apps/staging/app/cntp-ops/app/(app)/quality/PAGE/page.tsx'
txt = open(f, encoding='utf-8').read()
old = """exact string to replace"""
new = """replacement string"""
if old in txt:
    open(f, 'w', encoding='utf-8').write(txt.replace(old, new, 1))
    print('OK patched')
else:
    print('MISS — string not found, check old string is exact')
```

**Step 2:** Upload and run the patch:

```bash
# Upload
scp -P 2022 -o StrictHostKeyChecking=no \
  "C:/Users/<username>/Downloads/cntp-ops/patch_xxx.py" \
  cntpdev@154.65.97.200:/tmp/patch_xxx.py

# Run
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 'python3 /tmp/patch_xxx.py'
```

**Step 3:** Build + restart (same as Method A steps 2–3)

---

### Restoring a corrupted file before patching

If a file already shows broken characters (mojibake) in the browser, restore from git first:

```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 '
  cd /home/cntpdev/apps/staging/app/cntp-ops
  git checkout HEAD -- "app/(app)/quality/PAGE/page.tsx"
'
```
Then apply the Python patch.

---

## Viewing Logs

### PM2 app logs (live)
```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 '
  export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
  /home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2 logs cntp-staging --lines 50
'
```

### PM2 app logs (stream in real time)
```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 '
  export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
  /home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2 logs cntp-staging
'
```

### PM2 process status
```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 '
  export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
  /home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2 status
'
```

### Nginx access logs
```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 \
  'sudo tail -f /var/log/nginx/access.log'
```

### Nginx error logs
```bash
ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 \
  'sudo tail -f /var/log/nginx/error.log'
```

---

## Known Quirks

| Issue | Fix |
|---|---|
| Office network can't reach staging URL | Use mobile hotspot |
| `npm install` fails | Add `--legacy-peer-deps` flag |
| PM2 not found in PATH | Use full path: `/home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2` |
| Node/npm not found in SSH session | Run `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"` first |
| TS errors blocking build | Already disabled via `typescript: { ignoreBuildErrors: true }` in `next.config.js` |

---

## Working with Claude

Claude handles all deployment steps automatically each session.  
Ensure the local project is cloned to `C:\Users\<username>\Downloads\cntp-ops` so file paths match.
