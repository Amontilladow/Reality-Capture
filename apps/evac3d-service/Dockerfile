# 3D evacuation-plan conversion service (private). Build context: repository
# root (render.yaml dockerContext "."), so the engine in tools/evacuation-3d is
# copied in alongside the service.
#
# The 3D step renders with three.js in headless Chromium, so the base is the
# Playwright image (Node + Chromium + its system libraries) with Python added.
# The npm playwright package below must match the image version exactly.
ARG PLAYWRIGHT_VERSION=1.49.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION

# Fonts used on the sheets: Liberation Sans (Latin) and DejaVu Sans (Arabic).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    OMP_NUM_THREADS=1 \
    ENGINE_DIR=/opt/evac3d-engine \
    ENGINE_PYTHON=/opt/venv/bin/python

COPY tools/evacuation-3d/requirements.txt /opt/evac3d-engine/requirements.txt
COPY apps/evac3d-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY tools/evacuation-3d/render/package.json /opt/evac3d-engine/render/package.json
RUN cd /opt/evac3d-engine/render && npm install --omit=dev --no-audit --no-fund \
    && npm install --no-save --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION}

COPY tools/evacuation-3d/ /opt/evac3d-engine/
COPY apps/evac3d-service/app /app/app
WORKDIR /app
EXPOSE 8003
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8003}"]
