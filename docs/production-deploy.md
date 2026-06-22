# Production App Deployment

Status as of 2026-06-22.

## What's done (by the dev session)
- Repo cloned to `/home/cntpdev/apps/production/app/cntp-ops` (currently tracking `staging`).
- Production `.env.local` created — copy of staging's, with Supabase pointed at **production**
  (`https://sxzjjcyuzyfneesnsjna.supabase.co`, prod anon + service_role keys). All other keys shared.
- `npm install --legacy-peer-deps` + `npm run build` succeeded.
- Running under pm2 as **`cntp-production` on port 3001** (staging stays on 3000). `pm2 save` done.
- Local health check `curl http://localhost:3001` → **HTTP 200**.

## REMAINING — Compunique (requires root)
The `cntpplatform` nginx site currently serves **static files** (`root /home/cntpdev/apps/production/app`).
It must reverse-proxy to the Node app instead, exactly like the staging site. In the **443 server block**
for `cntpplatform.rooibostea.co.za`, replace the static `location /` (and the `root` line) with:

```nginx
location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}
```

Then:
```bash
sudo nginx -t && sudo systemctl reload nginx
```
SSL (Let's Encrypt) for the domain is already configured — no cert work needed.

## Redeploy (future, no root needed)
```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
cd /home/cntpdev/apps/production/app/cntp-ops
git pull origin main          # once main is the production branch; until then: staging
npm run build 2>&1 | tail -15
/home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2 restart cntp-production
```

## Notes
- Production app → production Supabase; staging app → staging Supabase. Independent.
- `main` is being established as the production branch (currently the app lives on `staging`);
  the prod clone will switch to `main` once that's done.
