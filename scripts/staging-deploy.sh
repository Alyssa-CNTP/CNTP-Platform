#!/usr/bin/env bash
# ============================================================
# Zero-(near)-downtime staging deploy for cntp-ops.
#
# Run ON the VPS:
#   ssh -p 2022 cntpdev@154.65.97.200 'bash /home/cntpdev/apps/staging/app/cntp-ops/scripts/staging-deploy.sh'
#
# Why this exists: `next build` clears the build dir at the START. If a restart
# (or an overlapping build) hit while the live `.next` was empty, the server
# came up with no BUILD_ID -> "Could not find a production build" -> 502s for
# minutes. This script builds into a SIDE dir (`.next-build`) so the live
# `.next` is never touched until a complete build exists, then atomically swaps
# and restarts, and ROLLS BACK if the new build doesn't serve.
# ============================================================
set -euo pipefail

export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"
APP=/home/cntpdev/apps/staging/app/cntp-ops
PM2=/home/cntpdev/.nvm/versions/node/v24.16.0/bin/pm2
URL=https://cntpplatform-staging.rooibostea.co.za
CHECK_PATHS=(/production/roster /production/staff /production/capture/assign /dashboard)
cd "$APP"

echo "[1/6] clearing any stale deploy loops (pgrep self-match zombies)"
pkill -f 'while [p]grep -f' 2>/dev/null || true

echo "[2/6] waiting for any in-flight 'next build' to finish (bounded ~7.5 min)"
for _ in $(seq 1 90); do
  if ps -eo cmd | grep -q "[n]ext build"; then sleep 5; else break; fi
done

echo "[3/6] syncing to origin/staging"
git fetch origin staging
git reset --hard origin/staging
echo "      HEAD: $(git log --oneline -1)"

echo "[4/6] building into .next-build (live .next untouched)"
rm -rf .next-build
NEXT_DIST_DIR=.next-build npm run build 2>&1 | tail -6
if [ ! -f .next-build/BUILD_ID ]; then
  echo "      BUILD FAILED — .next-build/BUILD_ID missing. Live site untouched. Aborting."
  rm -rf .next-build
  exit 1
fi

echo "[5/6] atomic swap + restart"
rm -rf .next-old
[ -d .next ] && mv .next .next-old
mv .next-build .next
# pm2 restart sometimes prints a transient "Process N not found" yet still
# restarts; and a genuinely-absent process needs a fresh start (npm start, fork
# mode, from the app dir — how cntp-staging is defined). Tolerate both so the
# deploy never aborts before the verify/rollback below — the HTTP check is the
# real gate.
if $PM2 describe cntp-staging >/dev/null 2>&1; then
  $PM2 restart cntp-staging --update-env >/dev/null 2>&1 || echo "      (pm2 restart returned an error — verifying anyway)"
else
  echo "      cntp-staging not registered — starting it"
  $PM2 start npm --name cntp-staging -- start >/dev/null 2>&1 || true
fi
sleep 4

echo "[6/6] verifying"
ok=1
for path in "${CHECK_PATHS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$URL$path" || echo 000)
  echo "      $path -> $code"
  case "$code" in 2*|3*) ;; *) ok=0 ;; esac
done

if [ "$ok" = 1 ]; then
  rm -rf .next-old
  echo "DEPLOY OK"
else
  echo "VERIFY FAILED — rolling back to previous build"
  rm -rf .next
  [ -d .next-old ] && mv .next-old .next
  $PM2 restart cntp-staging --update-env >/dev/null 2>&1 || $PM2 start npm --name cntp-staging -- start >/dev/null 2>&1 || true
  echo "ROLLED BACK"
  exit 1
fi
