#!/usr/bin/env bash
# ============================================================
# Leaf Shade Classifier — one-time / on-deploy environment setup
#
# Creates a Python 3.11 virtualenv next to this script and installs the
# pinned dependencies (requirements.txt). Idempotent — safe to re-run on
# every deploy; pip only does work when requirements change.
#
# Run ON the VPS (from the repo root or anywhere):
#   bash ml/leafshade/setup.sh
#
# Requires python3.11 on the host. Check with: python3.11 --version
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$DIR/.venv"

# Prefer python3.11 (model was saved against 3.11); fall back to python3.
PY=python3.11
command -v "$PY" >/dev/null 2>&1 || PY=python3
echo "[leafshade-setup] using $($PY --version 2>&1) at $(command -v $PY)"

if [ ! -d "$VENV" ]; then
  echo "[leafshade-setup] creating venv at $VENV"
  "$PY" -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --quiet --upgrade pip
echo "[leafshade-setup] installing pinned requirements…"
pip install --quiet -r "$DIR/requirements.txt"

echo "[leafshade-setup] verifying model loads under pinned scikit-learn…"
python - <<'PY'
import warnings, joblib, os
warnings.simplefilter("ignore")
d = os.path.join(os.path.dirname(os.path.abspath("__file__")), "leaf_shade_models")
PY
echo "[leafshade-setup] ✅ done"
