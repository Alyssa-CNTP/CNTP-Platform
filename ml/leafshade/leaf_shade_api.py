"""
leaf_shade_api.py  —  Leaf Shade Classifier micro-service
==========================================================
Runs as a subprocess spawned by server.js on startup (same Render service,
same machine, no separate URL or env var needed).
Listens on localhost:5001 — not exposed to the internet.

Accepts ONLY Canon CR3 RAW files.
Returns predicted shade + confidence + top-5.

Endpoints
---------
GET  /health   — health check (polled by server.js before forwarding requests)
POST /predict  — multipart/form-data, field: "cr3"
"""

import os, sys, tempfile, warnings, logging
import cv2, numpy as np, rawpy, joblib
try:
    import exifread
    HAS_EXIFREAD = True
except ImportError:
    HAS_EXIFREAD = False
    log.warning("exifread not available — camera EXIF will not be extracted")
from flask import Flask, request, jsonify

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Model paths (always next to this script: server/leaf_shade_models/) ───────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR  = os.path.join(BASE_DIR, "leaf_shade_models")
MODEL_PATH  = os.path.join(MODEL_DIR, "leaf_shade_mlp_28feat_balanced_2026v1.pkl")
SCALER_PATH = os.path.join(MODEL_DIR, "leaf_shade_scaler_28feat_balanced_2026v1.pkl")
LE_PATH     = os.path.join(MODEL_DIR, "leaf_shade_label_encoder_28feat_balanced_2026v1.pkl")

for p, lbl in [(MODEL_PATH,"Model"),(SCALER_PATH,"Scaler"),(LE_PATH,"LabelEncoder")]:
    if not os.path.exists(p):
        log.error(f"{lbl} not found: {p}")
        sys.exit(1)

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    model  = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    le     = joblib.load(LE_PATH)

shade_classes = le.classes_
log.info(f"Models loaded — classes: {list(shade_classes)}")

FEATURE_NAMES = [
    "Rn255","Gn255","Bn255","R_mean","G_mean","B_mean","R_std","G_std","B_std",
    "HSV_H_mean","HSV_S_mean","HSV_V_mean",
    "Lab_L_mean","Lab_a_mean","Lab_b_mean","Lab_a_std","Lab_b_std","Lab_Chroma_mean",
    "R_p10","R_p50","R_p90","G_p10","G_p50","G_p90","B_p10","B_p50","B_p90",
    "Colorfulness","Contrast","Color_Temp",
]

EXPECTED_CAMERA = {
    "FocalLength": 42,
    "ISO": 160,
    "ExposureTime": 0.2,
    "WhiteBalance": 1,
    "PictureStyle": "Faithful",
}

def _frac_to_float(tag_str):
    try:
        parts = str(tag_str).split("/")
        if len(parts) == 2:
            return float(parts[0]) / float(parts[1])
        return float(parts[0])
    except Exception:
        return None

def extract_camera_info(path):
    result = {k: "N/A" for k in ["FocalLength", "ISO", "ExposureTime", "WhiteBalance", "PictureStyle"]}
    if not HAS_EXIFREAD:
        return result
    try:
        with open(path, "rb") as f:
            tags = exifread.process_file(f, stop_tag="UNDEF", details=False)
        fl  = tags.get("EXIF FocalLength")
        iso = tags.get("EXIF ISOSpeedRatings") or tags.get("EXIF PhotographicSensitivity")
        exp = tags.get("EXIF ExposureTime")
        wb  = tags.get("EXIF WhiteBalance")
        if fl:  result["FocalLength"] = round(_frac_to_float(fl) or 0)
        if iso: result["ISO"] = int(str(iso))
        if exp:
            v = _frac_to_float(exp)
            result["ExposureTime"] = round(v, 4) if v is not None else "N/A"
        if wb:  result["WhiteBalance"] = int(str(wb))
    except Exception as e:
        log.warning(f"EXIF extraction failed: {e}")
    return result

def check_camera_compliance(actual):
    issues = []
    for key, exp_val in EXPECTED_CAMERA.items():
        act_val = actual.get(key, "N/A")
        if act_val == "N/A":
            continue
        if key == "ExposureTime":
            if abs(float(act_val) - float(exp_val)) > 0.001:
                issues.append(f"{key}: {act_val} (expected {exp_val})")
        elif str(act_val) != str(exp_val):
            issues.append(f"{key}: {act_val} (expected {exp_val})")
    compliant = len(issues) == 0
    return compliant, issues if issues else ["Compliant"]

def load_cr3(file_bytes: bytes):
    """Returns (img16_ndarray, camera_info_dict)."""
    with tempfile.NamedTemporaryFile(suffix=".cr3", delete=False) as tmp:
        tmp.write(file_bytes)
        path = tmp.name
    try:
        cam_actual = extract_camera_info(path)
        with rawpy.imread(path) as raw:
            # Full-resolution demosaic — MUST match the desktop training pipeline
            # (Blackheath_Code.txt). half_size=True changes the colour features and
            # produces a different (wrong) shade, so it is intentionally omitted.
            img16 = raw.postprocess(use_camera_wb=True, no_auto_bright=True,
                                    output_bps=16)
    finally:
        try: os.remove(path)
        except OSError: pass
    return img16, cam_actual

def letterbox_224(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    scale = 224 / max(h, w)
    nw, nh = int(w * scale), int(h * scale)
    nw += nw % 2; nh += nh % 2
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.full((224, 224, 3), np.uint16(32896), dtype=np.uint16)
    t, l = (224 - nh) // 2, (224 - nw) // 2
    canvas[t:t+nh, l:l+nw] = resized
    return canvas

def extract_features(img: np.ndarray) -> np.ndarray:
    r16, g16, b16 = cv2.split(img)
    Rm, Gm, Bm = float(np.mean(r16)), float(np.mean(g16)), float(np.mean(b16))
    Rs, Gs, Bs = float(np.std(r16)),  float(np.std(g16)),  float(np.std(b16))
    total = Rm + Gm + Bm + 1e-6
    Rn, Gn, Bn = Rm/total, Gm/total, Bm/total
    i8 = (img.astype(np.float32) * (255.0/65535.0)).clip(0,255).astype(np.uint8)
    hsv = cv2.cvtColor(i8, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(i8, cv2.COLOR_RGB2LAB)
    chroma = float(np.mean(np.sqrt(
        (lab[...,1].astype(float)-128)**2 + (lab[...,2].astype(float)-128)**2)))
    rp = np.percentile(i8[...,0],[10,50,90])
    gp = np.percentile(i8[...,1],[10,50,90])
    bp = np.percentile(i8[...,2],[10,50,90])
    rg = np.abs(i8[...,0].astype(float) - i8[...,1].astype(float))
    yb = 0.5*(i8[...,0].astype(float)+i8[...,1].astype(float)) - i8[...,2].astype(float)
    colorfulness = float(
        np.sqrt(np.std(rg)**2+np.std(yb)**2) +
        0.3*np.sqrt(np.mean(rg)**2+np.mean(yb)**2))
    gray = cv2.cvtColor(i8, cv2.COLOR_RGB2GRAY)
    return np.array([
        Rn*255,Gn*255,Bn*255,Rm,Gm,Bm,Rs,Gs,Bs,
        float(np.mean(hsv[...,0])),float(np.mean(hsv[...,1])),float(np.mean(hsv[...,2])),
        float(np.mean(lab[...,0])),float(np.mean(lab[...,1])),float(np.mean(lab[...,2])),
        float(np.std(lab[...,1])),float(np.std(lab[...,2])),chroma,
        *rp, *gp, *bp,
        colorfulness, float(np.std(gray)), 2000.0+(Rn-Bn)*4000.0,
    ], dtype=np.float32)

app = Flask(__name__)

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/predict", methods=["POST"])
def predict():
    if "cr3" not in request.files:
        return jsonify({"error": "Field name must be 'cr3'"}), 400
    f = request.files["cr3"]
    if not (f.filename or "").lower().endswith(".cr3"):
        return jsonify({"error": f"Only CR3 files accepted, got: {f.filename}"}), 415
    data = f.read()
    if not data:
        return jsonify({"error": "Empty file"}), 400
    log.info(f"CR3 received: {f.filename}  ({len(data):,} bytes)")
    try:
        img16, cam_actual  = load_cr3(data)
        img224 = letterbox_224(img16)
        feats  = extract_features(img224)
        scaled = scaler.transform(feats.reshape(1,-1))
        proba  = model.predict_proba(scaled)[0]
        cam_compliant, cam_issues = check_camera_compliance(cam_actual)
        camera = {"actual": cam_actual, "expected": EXPECTED_CAMERA,
                  "compliant": cam_compliant, "issues": cam_issues}
    except Exception as e:
        log.error(f"Pipeline error: {e}")
        return jsonify({"error": str(e)}), 422
    idx   = int(np.argmax(proba))
    shade = le.inverse_transform([idx])[0]
    conf  = float(proba[idx])
    top5  = [
        {"rank": i+1, "shade": shade_classes[int(j)],
         "confidence": round(float(proba[j])*100, 2)}
        for i, j in enumerate(np.argsort(proba)[-5:][::-1])
    ]
    log.info(f"Result: {shade}  {conf*100:.1f}%")
    return jsonify({
        "filename":        f.filename,
        "predicted_shade": shade,
        "confidence_pct":  round(conf*100, 2),
        "top5":            top5,
        "features":        {n: round(float(v),4) for n,v in zip(FEATURE_NAMES, feats)},
        "camera":          camera,
        "model_version":   "leaf_shade_mlp_28feat_balanced_2026v1",
    })

if __name__ == "__main__":
    port = int(os.environ.get("LEAF_SHADE_PORT", 5001))
    log.info(f"Starting leaf_shade_api on port {port}")
    app.run(host="127.0.0.1", port=port, debug=False)
