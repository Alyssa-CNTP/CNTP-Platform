#!/usr/bin/env bash
# Repoint the production nginx site from static files to the running app (:3001).
# Safe: backs up, validates with `nginx -t`, only reloads if valid, else rolls back.
set -euo pipefail
CFG=/etc/nginx/sites-available/cntpplatform
BAK="${CFG}.bak.$(date +%Y%m%d_%H%M%S)"

echo "Backing up ${CFG} -> ${BAK}"
cp "$CFG" "$BAK"

cat > "$CFG" <<'NGINX'
server {
    listen 80;
    server_name cntpplatform.rooibostea.co.za;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name cntpplatform.rooibostea.co.za;

    ssl_certificate /etc/letsencrypt/live/cntpplatform.rooibostea.co.za/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cntpplatform.rooibostea.co.za/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

echo "Validating nginx config..."
if nginx -t; then
    systemctl reload nginx
    echo "✅ DONE — https://cntpplatform.rooibostea.co.za now proxies to the app on :3001"
else
    echo "❌ nginx -t FAILED — restoring previous config (no reload performed)"
    cp "$BAK" "$CFG"
    nginx -t
    exit 1
fi
