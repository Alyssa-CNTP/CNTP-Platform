# Leaf Shade Classifier — containerised Python micro-service
# ===========================================================
# Pinned to Python 3.11 so the scikit-learn 1.7.2 model pickles load exactly
# as trained. Runs the Flask service from leaf_shade_api.py.
#
# The VPS (Ubuntu 26.04) ships Docker but not Python 3.11 — running this in a
# container avoids touching the host Python entirely.

FROM python:3.11-slim

# Runtime libs needed by opencv-python-headless / numpy (OpenMP) and rawpy.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pinned deps first (better layer caching). scikit-learn MUST stay 1.7.2.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App + model files
COPY leaf_shade_api.py .
COPY leaf_shade_models/ ./leaf_shade_models/

ENV LEAF_SHADE_PORT=5001
EXPOSE 5001

# leaf_shade_api.py binds 127.0.0.1:$LEAF_SHADE_PORT. The container is run with
# network_mode: host (see docker-compose.yml), so that bind lands directly on
# the host loopback — reachable by the Next.js route, not exposed to the internet.
CMD ["python", "leaf_shade_api.py"]
