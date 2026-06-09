# Alara — Production VPS Deployment Guide

> **Ollama question answered first:** `gather_v2.py` does **NOT** use Ollama.
> It calls the **Gemini API** directly for signal classification.
> Ollama is only used by `lib/intelligence.ts` — the Research → Chat tab.
> You can skip Ollama entirely if you don't need that local chat feature.

---

## Architecture Overview

```
Internet
    │
    ▼
  nginx (443/80)
    ├── yourdomain.com      → Next.js :3000  (systemd: alara-app)
    └── n8n.yourdomain.com  → n8n Docker :5678

Docker Compose (research-engine/)
    ├── chromadb   :8000  (localhost only — signals + vault vectors)
    ├── ollama     :11434 (localhost only — optional, research chat)
    └── n8n        :5678  (proxied by nginx — social pipeline workflows)

Systemd Services
    ├── alara-app      — Next.js production server
    ├── alara-watcher  — vault file monitor daemon (always running)
    └── alara-gather.timer → alara-gather.service (every 30 min)
```

---

## Step 1 — Server Prerequisites

```bash
# Ubuntu 22.04 LTS assumed
sudo apt update && sudo apt upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Python 3.11
sudo apt install -y python3.11 python3.11-venv python3-pip

# nginx
sudo apt install -y nginx

# Docker + Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy   # replace 'deploy' with your user
newgrp docker

# Certbot
sudo apt install -y certbot python3-certbot-nginx

# Create deploy user (if not already)
sudo useradd -m -s /bin/bash deploy
```

---

## Step 2 — Clone and Build the App

```bash
# As deploy user
sudo su - deploy

git clone https://github.com/yourorg/cntp-ops.git /home/deploy/cntp-ops
cd /home/deploy/cntp-ops

# Install dependencies
npm ci --omit=dev

# Create production env file
cp .env.local .env.production
# Edit .env.production — set all production values (real API keys, VPS URLs)
nano .env.production

# Build Next.js
npm run build
```

---

## Step 3 — Python Environment

```bash
cd /home/deploy/cntp-ops/research-engine

# Create venv
python3.11 -m venv venv

# Install Python deps
source venv/bin/activate
pip install -r requirements.txt
deactivate

# Create Python env file (subset of .env.production — Python keys only)
cat > /home/deploy/cntp-ops/research-engine/.env << 'EOF'
GEMINI_API_KEY=your_gemini_key
YOUTUBE_DATA_API_KEY=your_youtube_key
REDDIT_CLIENT_ID=your_reddit_id
REDDIT_CLIENT_SECRET=your_reddit_secret
REDDIT_USER_AGENT=Alara/1.0 by your_reddit_username
EXA_API_KEY=your_exa_key
APIFY_API_TOKEN=your_apify_token
PIPELINE_INGEST_URL=https://yourdomain.com/api/ingest
PIPELINE_INGEST_SECRET=your_ingest_secret
CHROMA_HOST=localhost
CHROMA_PORT=8000
VAULT_ENCRYPTION_KEY=your_32_char_hex_key
EOF
chmod 600 /home/deploy/cntp-ops/research-engine/.env
```

---

## Step 4 — Docker Services (ChromaDB + n8n)

```bash
cd /home/deploy/cntp-ops/research-engine

# Create Docker env file for n8n
cat > .env.docker << 'EOF'
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=choose_a_strong_password
N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
N8N_HOST=n8n.yourdomain.com
YOUTUBE_DATA_API_KEY=your_youtube_key
EXA_API_KEY=your_exa_key
APIFY_API_TOKEN=your_apify_token
N8N_WEBHOOK_SECRET=your_webhook_secret
PIPELINE_INGEST_URL=https://yourdomain.com/api/ingest
PIPELINE_INGEST_SECRET=your_ingest_secret
TZ=Africa/Johannesburg
EOF

# Start all services
docker compose --env-file .env.docker up -d

# Check they're running
docker compose ps
docker compose logs chromadb   # should show "Chroma is running!"
docker compose logs n8n        # should show "Editor is now accessible"
```

---

## Step 5 — nginx + SSL

```bash
# Copy config
sudo cp /home/deploy/cntp-ops/deploy/nginx.conf /etc/nginx/sites-available/alara

# Edit: replace ALL instances of "yourdomain.com" with your real domain
sudo nano /etc/nginx/sites-available/alara

# Enable site
sudo ln -s /etc/nginx/sites-available/alara /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # remove default site

# Test config
sudo nginx -t

# Get SSL certificates (do this BEFORE removing the http redirect)
# First, temporarily allow port 80:
sudo certbot --nginx -d yourdomain.com -d n8n.yourdomain.com

# Reload nginx
sudo systemctl reload nginx
```

---

## Step 6 — systemd Services

```bash
# Install service files
sudo cp /home/deploy/cntp-ops/deploy/alara-app.service     /etc/systemd/system/
sudo cp /home/deploy/cntp-ops/deploy/alara-watcher.service /etc/systemd/system/
sudo cp /home/deploy/cntp-ops/deploy/alara-gather.service  /etc/systemd/system/
sudo cp /home/deploy/cntp-ops/deploy/alara-gather.timer    /etc/systemd/system/

sudo systemctl daemon-reload

# Start and enable all
sudo systemctl enable --now alara-app
sudo systemctl enable --now alara-watcher
sudo systemctl enable --now alara-gather.timer   # starts the 30-min timer

# Check status
sudo systemctl status alara-app
sudo systemctl status alara-watcher
sudo systemctl list-timers alara-gather.timer
```

---

## Step 7 — ChromaDB Collection IDs

After the first gather run, you need to capture ChromaDB collection IDs:

```bash
# After first successful gather_v2.py run:
curl http://localhost:8000/api/v1/collections | python3 -m json.tool

# You'll see output like:
# [{"id": "abc123...", "name": "alara_signals"}, {"id": "def456...", "name": "alara_vault"}]

# Add these to your .env.production:
echo "CHROMA_COLLECTION_ID=abc123..." >> /home/deploy/cntp-ops/.env.production
echo "CHROMA_VAULT_COLLECTION_ID=def456..." >> /home/deploy/cntp-ops/.env.production

# Restart the app to pick up new env vars
sudo systemctl restart alara-app
```

---

## Step 8 — n8n Workflow Import

1. Open `https://n8n.yourdomain.com` (login with the admin password you set)
2. Go to **Settings → Import Workflow**
3. Import `research-engine/n8n/workflow-config.json`
4. Open the imported workflow, click each node, verify API keys are loaded from env
5. Activate the workflow (toggle in top-right)

The workflow runs every 15 minutes and POSTs classified signals to `/api/ingest`.

---

## Ongoing Operations

```bash
# View live app logs
sudo journalctl -fu alara-app

# View gather logs (last run)
sudo journalctl -u alara-gather --since "1 hour ago"

# Watch watcher logs
sudo journalctl -fu alara-watcher

# View n8n execution logs
docker logs -f alara_n8n

# Manual gather run (test)
sudo systemctl start alara-gather

# Deploy new app version
cd /home/deploy/cntp-ops
git pull
npm ci --omit=dev
npm run build
sudo systemctl restart alara-app

# Restart everything after env changes
sudo systemctl restart alara-app alara-watcher
```

---

## Firewall (ufw)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw deny 8000    # ChromaDB — internal only
sudo ufw deny 11434   # Ollama — internal only
sudo ufw deny 5678    # n8n — proxied by nginx only
sudo ufw enable
sudo ufw status
```

---

## Security Checklist

- [ ] `.env.production` has `chmod 600` and is owned by `deploy`
- [ ] `research-engine/.env` has `chmod 600`
- [ ] ChromaDB port 8000 bound to `127.0.0.1` in docker-compose.yml ✅
- [ ] Ollama port 11434 bound to `127.0.0.1` ✅
- [ ] n8n port 5678 bound to `127.0.0.1` ✅
- [ ] n8n has basic auth enabled ✅
- [ ] ufw blocks ports 8000, 11434, 5678 externally
- [ ] SSL certificates auto-renew via Certbot (`certbot renew --dry-run` to test)
- [ ] `VAULT_ENCRYPTION_KEY` is set (generate: `openssl rand -hex 16`)
- [ ] `PIPELINE_INGEST_SECRET` is a strong random string
- [ ] n8n `N8N_ENCRYPTION_KEY` is stored somewhere safe (losing it = losing all credentials)
