#!/usr/bin/env bash
# ============================================================
# Leaf Shade Classifier — service entrypoint (run by pm2)
#
# Execs the Flask micro-service from the pinned virtualenv. The service
# listens on 127.0.0.1:$LEAF_SHADE_PORT (default 5001) and is NOT exposed
# to the internet — the Next.js API route proxies to it on localhost.
#
# Register with pm2 (once):
#   pm2 start ml/leafshade/run.sh --name cntp-leafshade
#   pm2 save
#
# Run setup.sh first to create the venv.
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$DIR/.venv"

if [ ! -x "$VENV/bin/python" ]; then
  echo "[leafshade] venv missing — running setup.sh first"
  bash "$DIR/setup.sh"
fi

export LEAF_SHADE_PORT="${LEAF_SHADE_PORT:-5001}"
echo "[leafshade] starting leaf_shade_api.py on 127.0.0.1:$LEAF_SHADE_PORT"
exec "$VENV/bin/python" "$DIR/leaf_shade_api.py"
