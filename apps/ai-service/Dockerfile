FROM python:3.12-slim
WORKDIR /app
# poppler-utils backs pdf2image's PDF-to-image rasterization for the OCR
# fallback (Drawing Intelligence & Control, Decision 1) -- used here only
# as an external CLI (pdftoppm/pdftocairo) invoked as a subprocess, never
# linked into this Python process, so its GPL-2.0 license never extends
# to this application's own code (the same "arm's length" reasoning
# site-drawings' SharePointGraphClient applies to poppler on the Node side).
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng poppler-utils libpango-1.0-0 libpangocairo-1.0-0 && rm -rf /var/lib/apt/lists/*
# This container gets 0.5 CPU on Render's starter plan; torch/tokenizers
# default to intra-op thread counts sized off the host's full core count,
# which they can't see is cgroup-limited here, each thread carries its own
# BLAS workspace, so left unbounded this wastes both memory and CPU time
# to context-switching between threads it was never going to get to run.
ENV OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    TOKENIZERS_PARALLELISM=false
# Build context is the repository root (render.yaml dockerContext "."), so
# the GIS Preparation engine (apps/adm-gis-prep) can be installed alongside.
COPY apps/ai-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
# GIS Preparation engine in its OWN virtualenv: its pinned dependencies
# (pydantic, numpy, shapely, pyproj, ezdxf) must not change this service's.
# routers/gis_prep.py runs it as a separate, memory-capped process.
COPY apps/adm-gis-prep/requirements.txt /opt/m4adm-src/requirements.txt
RUN python -m venv /opt/m4adm && /opt/m4adm/bin/pip install --no-cache-dir -r /opt/m4adm-src/requirements.txt
COPY apps/adm-gis-prep/pyproject.toml apps/adm-gis-prep/README.md /opt/m4adm-src/
COPY apps/adm-gis-prep/rules /opt/m4adm-src/rules
COPY apps/adm-gis-prep/src /opt/m4adm-src/src
RUN /opt/m4adm/bin/pip install --no-cache-dir --no-deps /opt/m4adm-src
ENV M4ADM_RULES_DIR=/opt/m4adm-src/rules
COPY apps/ai-service/ .
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
