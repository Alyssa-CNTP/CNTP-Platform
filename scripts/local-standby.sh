#!/usr/bin/env bash
# ============================================================
# Local WARM STANDBY for cntp-ops — run the production app on the local server
# while the VPS is unreachable. Reached over Tailscale, internal use only.
#
#   bash scripts/local-standby.sh sync  --env ~/cntp-standby.env
#   bash scripts/local-standby.sh start --env ~/cntp-standby.env
#   bash scripts/local-standby.sh stop
#   bash scripts/local-standby.sh status
#
# Full runbook, including the Supabase-Auth / Azure-SSO wiring that has to be
# done BEFORE an outage: docs/ops/local-standby.md
#
# This script NEVER touches the VPS. It reads `main` from GitHub and builds
# locally, so it costs the local machine's CPU and nothing else.
#
# Two things it is deliberately careful about:
#
#   1. The env file. The standby has to point at the PRODUCTION Supabase
#      project. Pointed at staging by mistake it becomes an app that looks
#      like production and writes every capture into the staging database —
#      worse than being down, because it looks fine. So the env file is a
#      required argument (never guessed), and its project ref is echoed on
#      every run for the operator to eyeball.
#   2. The build. It builds into a side directory and only swaps it in once a
#      BUILD_ID exists — same pattern as scripts/production-deploy.sh, and for
#      the same reason: a half-written .next crash-loops the app. Here it
#      matters even more, because the sync you most want to work is the one you
#      run while the VPS is ALREADY down.
# ============================================================
set -euo pipefail

CMD="${1:-}"; shift || true
ENV_FILE=""
PORT="${STANDBY_PORT:-3001}"
APP_NAME="cntp-standby"
BRANCH="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --env)  ENV_FILE="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}";     shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

# ── The env-file guard ───────────────────────────────────────────────────────
# Refuse to run against staging keys, and show which project is in play.
check_env() {
  [ -n "$ENV_FILE" ] || die "--env <path> is required (see docs/ops/local-standby.md)"
  [ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"

  local url ref
  url=$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' \r')
  [ -n "$url" ] || die "NEXT_PUBLIC_SUPABASE_URL missing from $ENV_FILE"
  ref=$(printf '%s' "$url" | sed -E 's#https?://([^.]+)\..*#\1#')

  case "$ref" in
    sxzjjcyuzyfneesnsjna)
      echo "      Supabase project: $ref (PRODUCTION) — correct for a standby" ;;
    qjqkpockmujecjgmdple)
      die "$ENV_FILE points at the STAGING project ($ref).
       A standby on staging keys writes real capture into the staging database.
       Copy the production env file instead — see docs/ops/local-standby.md §2." ;;
    *)
      echo "      Supabase project: $ref — NOT the known production ref."
      echo "      Continuing, but verify this is deliberate." ;;
  esac
}

sync() {
  check_env
  echo "[1/4] fetching origin/$BRANCH"
  git fetch origin "$BRANCH"
  git checkout -q "$BRANCH"
  git reset --hard "origin/$BRANCH"
  echo "      HEAD: $(git log --oneline -1)"

  echo "[2/4] installing dependencies (only if the lockfile moved)"
  if [ ! -d node_modules ] || ! git diff --quiet "HEAD@{1}" HEAD -- package-lock.json 2>/dev/null; then
    npm install --legacy-peer-deps 2>&1 | tail -5
  else
    echo "      lockfile unchanged — skipping"
  fi

  echo "[3/4] building into .next-standby (any working standby stays intact)"
  rm -rf .next-standby
  cp "$ENV_FILE" .env.local
  NEXT_DIST_DIR=.next-standby npm run build 2>&1 | tail -6
  if [ ! -f .next-standby/BUILD_ID ]; then
    rm -rf .next-standby
    die "build failed — BUILD_ID missing. The previous standby build is untouched."
  fi

  echo "[4/4] swapping the new build in"
  rm -rf .next-previous
  [ -d .next ] && mv .next .next-previous
  mv .next-standby .next
  echo "STANDBY READY — $(git log --oneline -1)"
  echo "Not serving yet. Start it with: bash scripts/local-standby.sh start --env $ENV_FILE"
}

start() {
  check_env
  [ -f .next/BUILD_ID ] || die "no build present — run 'sync' first"
  cp "$ENV_FILE" .env.local

  local host
  host=$(tailscale status --json 2>/dev/null | grep -m1 '"DNSName"' | cut -d'"' -f4 | sed 's/\.$//') || true
  [ -n "${host:-}" ] || host="<tailscale-hostname>"

  if command -v pm2 >/dev/null 2>&1; then
    pm2 describe "$APP_NAME" >/dev/null 2>&1 && pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    PORT="$PORT" pm2 start npm --name "$APP_NAME" -- start
    echo "started under pm2 as $APP_NAME"
  else
    echo "pm2 not installed — starting in the foreground (no auto-restart)."
    echo "Ctrl-C stops the standby. Install pm2 for a supervised standby: npm i -g pm2"
    PORT="$PORT" npm start
  fi
  echo
  echo "Standby URL for staff:  http://$host:$PORT"
  echo "Before announcing it, check docs/ops/local-standby.md §5 — especially that"
  echo "a test capture lands in the PRODUCTION Supabase project."
}

stop() {
  if command -v pm2 >/dev/null 2>&1 && pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 delete "$APP_NAME" >/dev/null 2>&1
    echo "standby stopped"
  else
    echo "nothing to stop (not running under pm2)"
  fi
}

status() {
  echo "-- git"
  git log --oneline -1 2>/dev/null || echo "   (not a checkout)"
  echo "-- build"
  if [ -f .next/BUILD_ID ]; then
    echo "   BUILD_ID $(cat .next/BUILD_ID)  built $(date -r .next/BUILD_ID '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?')"
  else
    echo "   no build present — run 'sync'"
  fi
  echo "-- tailscale"
  tailscale status 2>&1 | head -3 || echo "   (tailscale not available)"
  echo "-- process"
  if command -v pm2 >/dev/null 2>&1; then pm2 list 2>/dev/null | grep -E "$APP_NAME|name" || echo "   not running"; else echo "   pm2 not installed"; fi
  echo "-- is the VPS actually down?"
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://cntpplatform.rooibostea.co.za/dashboard || echo 000)
  case "$code" in
    2*|3*) echo "   production answered $code — the VPS is UP; you probably don't need the standby" ;;
    000)   echo "   no answer — VPS unreachable (or this machine has no internet, which the standby can't fix)" ;;
    *)     echo "   production answered $code — degraded" ;;
  esac
}

case "$CMD" in
  sync)   sync ;;
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  *) echo "usage: bash scripts/local-standby.sh {sync|start|stop|status} [--env <path>] [--port 3001]"; exit 2 ;;
esac
