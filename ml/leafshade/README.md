# Leaf Shade Classifier

Ported from the old `CNTPquality` Express app (`server/leafShade.js` +
`server/leaf_shade_api.py`). Predicts the leaf shade (Shade 0–11) of a Rooibos
sample from a Canon **CR3** RAW photo.

## How it fits together

```
Browser (Raw Material → 🍃 Leaf Shade tab)
   │  multipart CR3
   ▼
Next.js route  app/api/leaf-shade/predict/route.ts
   │  proxy → 127.0.0.1:5001/predict
   ▼
Python Flask micro-service  ml/leafshade/leaf_shade_api.py
   │  rawpy → OpenCV features (30) → StandardScaler → MLPClassifier
   ▼
prediction (shade + confidence + top-5 + camera compliance)
```

Records are saved to `qms.quality_records` with `workcenter='rawMaterial'`,
`workflow='leaf_shade'` — exactly like the old app, so they appear in the
Leaf Shade history table.

## The model

`leaf_shade_models/` holds three pickles saved with **scikit-learn 1.7.2**:

- `leaf_shade_mlp_28feat_balanced_2026v1.pkl` — MLPClassifier (30 input features)
- `leaf_shade_scaler_28feat_balanced_2026v1.pkl` — StandardScaler
- `leaf_shade_label_encoder_28feat_balanced_2026v1.pkl` — LabelEncoder

> The `28feat` in the filenames is a legacy label — the model actually takes the
> 30 features produced by `extract_features()`. Verified: `n_features_in_ == 30`.

**Do not change `scikit-learn==1.7.2`** without retraining and re-saving all
three files. The other Python pins are in `requirements.txt`. None of this
touches the Next.js `package.json`.

## Deploy on the VPS (recommended: Docker)

The VPS (Ubuntu 26.04) has Docker but **not** Python 3.11, so run the service
in a container — it bundles Python 3.11 + the pinned deps and never touches the
host Python. One time:

```bash
cd /home/cntpdev/apps/staging/app/cntp-ops/ml/leafshade
docker compose up -d --build
```

`network_mode: host` means the service listens on `127.0.0.1:5001` of the host
(localhost only — the UFW firewall opens just 2022/80/443, so it is never
internet-facing). `restart: unless-stopped` keeps it up across reboots/crashes.

On later deploys, only re-run the build if the model or `leaf_shade_api.py`
changed:

```bash
cd /home/cntpdev/apps/staging/app/cntp-ops/ml/leafshade
docker compose up -d --build
```

Check it:

```bash
docker compose ps
curl http://127.0.0.1:5001/health      # {"status":"ok"}
docker compose logs --tail=30
```

## Alternative: host virtualenv (if Python 3.11 is installed instead)

```bash
cd /home/cntpdev/apps/staging/app/cntp-ops
python3.11 --version                 # repo pins 3.11.9 (.python-version)
bash ml/leafshade/setup.sh           # creates venv + installs pinned deps
pm2 start ml/leafshade/run.sh --name cntp-leafshade
pm2 save
```

## Health check

```bash
curl http://127.0.0.1:5001/health      # {"status":"ok"}
```

If the Next.js tab reports *"Leaf shade service is not running"*, the service
is down:
- Docker:  `docker compose -f ml/leafshade/docker-compose.yml logs --tail=50`
- venv/pm2: `pm2 logs cntp-leafshade`
