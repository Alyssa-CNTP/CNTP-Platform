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

## Deploy on the VPS (one time)

```bash
cd /home/cntpdev/apps/staging/app/cntp-ops

# 1. Ensure Python 3.11 is available
python3.11 --version   # repo pins 3.11.9 (.python-version)

# 2. Create the venv + install pinned deps
bash ml/leafshade/setup.sh

# 3. Register the service with pm2 (localhost:5001, not internet-facing)
pm2 start ml/leafshade/run.sh --name cntp-leafshade
pm2 save
```

On later deploys, re-run `bash ml/leafshade/setup.sh` (no-op unless
`requirements.txt` changed) and `pm2 restart cntp-leafshade`.

## Health check

```bash
curl http://127.0.0.1:5001/health      # {"status":"ok"}
```

If the Next.js tab reports *"Leaf shade service is not running"*, the
`cntp-leafshade` pm2 process is down — check `pm2 logs cntp-leafshade`.
