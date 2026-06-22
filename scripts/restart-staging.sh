#!/bin/bash
# Restart the cntp-staging app on the VPS
# Usage: bash scripts/restart-staging.sh

ssh -p 2022 -o StrictHostKeyChecking=no cntpdev@154.65.97.200 '
  export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
  cd /home/cntpdev/apps/staging/app/cntp-ops
  echo "📦 Pulling latest staging..."
  git pull origin staging
  echo "🔨 Building..."
  npm run build 2>&1 | tail -15
  echo "🔄 Restarting PM2..."
  /home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2 restart cntp-staging
  echo "✅ cntp-staging restarted"
'
