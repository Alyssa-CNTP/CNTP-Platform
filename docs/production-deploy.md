# Production Deployment

**Status: LIVE** at https://cntpplatform.rooibostea.co.za (since 2026-06-22), serving the
production app on the **production** Supabase database (`sxzjjcyuzyfneesnsjna`).

## Architecture / flow
```
feature branches ──> staging branch ──[deploy-staging.yml]──> Staging VPS  :3000 ──> Staging DB
                          │  (test here)
                          └──> main branch ──[deploy-production.yml]──> Production VPS :3001 ──> Production DB
```
- Staging app: `/home/cntpdev/apps/staging/app/cntp-ops`, pm2 `cntp-staging` (:3000), staging Supabase.
- Production app: `/home/cntpdev/apps/production/app/cntp-ops`, pm2 `cntp-production` (:3001), production Supabase.
- Each app's Supabase target is set in its own `.env.local` (untracked). The URL/anon key is
  compiled into the client bundle at build time — verified the prod build references only the
  prod project ref.

## nginx
- Production site config: `docs/ops/nginx-cntpplatform-production.conf`
  (live at `/etc/nginx/sites-available/cntpplatform`, symlinked in `sites-enabled`).
- It reverse-proxies the domain to `localhost:3001`. SSL = Let's Encrypt (Certbot).
- The go-live change was applied with `docs/ops/cntp_nginx_go_live.sh` (backs up, writes the
  config, runs `nginx -t`, reloads only if valid, else rolls back). Needs `sudo`.

## Redeploy (production)
Automatic: merge to `main` → `deploy-production.yml` pulls `main`, rebuilds, restarts `cntp-production`.
Manual fallback (on the VPS):
```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
cd /home/cntpdev/apps/production/app/cntp-ops
git fetch origin main && git checkout main && git reset --hard origin/main
npm install --legacy-peer-deps 2>&1 | tail -5
npm run build 2>&1 | tail -20
PORT=3001 /home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2 restart cntp-production --update-env
```

## Auth / registration (verify on the PRODUCTION Supabase project)
New user registrations on the live site go to the **production** database's `auth.users`
(the app is built against the prod Supabase). For registration/login to work cleanly on the
live domain, confirm on the prod project (Dashboard → Authentication):
- **URL Configuration**: Site URL = `https://cntpplatform.rooibostea.co.za`; Redirect URLs include it.
- **Providers**: the "work account" (Microsoft/Azure) provider is enabled with the prod
  callback `https://sxzjjcyuzyfneesnsjna.supabase.co/auth/v1/callback` (and that URL is allowed
  in the Azure app registration).
