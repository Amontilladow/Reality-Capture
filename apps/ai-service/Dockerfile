# ---- Stage 1: LibreDWG's dwg2dxf, built from a pinned commit (libredwg-tools is not packaged for this Debian
# release). JSON import is switched off (it needs a bundled library the commit fetch does not include) and the
# result is one static program, so it runs in the final image unchanged. Tested on this exact commit against
# AutoCAD's own DXF of the same drawing (apps/adm-gis-prep tests/test_reference_drm.py). A failed build leaves /out
# empty and the image still builds.
FROM python:3.12-slim AS dwgbuild
ARG LIBREDWG_COMMIT=b2a8b7ff1dcc6558acea290d54c90e0c3236e219
RUN mkdir -p /out \
    && ( apt-get update \
         && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates \
         && git init -q /src \
         && git -C /src remote add origin https://github.com/LibreDWG/libredwg \
         && git -C /src fetch -q --depth 1 origin "$LIBREDWG_COMMIT" \
         && git -C /src checkout -q FETCH_HEAD \
         && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DLIBREDWG_DISABLE_JSON=ON -DBUILD_SHARED_LIBS=OFF \
                  -DENABLE_LTO=OFF -DDISABLE_WERROR=ON \
         && cmake --build /build --target dwg2dxf -j2 \
         && cp /build/dwg2dxf /out/dwg2dxf ) \
    || echo "WARNING: dwg2dxf could not be built; DWG input stays disabled"

# ---- Stage 2: the service
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
# DWG reader for GIS Preparation: LibreDWG's dwg2dxf, built in the stage above. Optional on purpose: if that stage could
# not build it, /out is empty, DXF input keeps working and a DWG upload is blocked with a clear message.
# M4ADM_DWG_MEMORY_MB caps the converter's resident memory (this service shares 512 MB with everything else).
COPY --from=dwgbuild /out/ /usr/local/bin/
# Measured on the M19B drawings: dwg2dxf needs ~25x the DWG size (6 MB DWG: 146 MB), and loading a DXF needs ~100 MB plus
# ~9 MB per MB of file. The service itself uses ~210 of the 512 MB, so: converter at most 150 MB (the OS refuses more),
# and a DXF larger than 18 MB (about a 3 MB DWG) is refused with a clear message instead of killing the service.
ENV M4ADM_DWG_MEMORY_MB=150 \
    M4ADM_MAX_DXF_MB=18
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
