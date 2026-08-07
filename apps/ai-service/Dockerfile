FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr libpango-1.0-0 libpangocairo-1.0-0 && rm -rf /var/lib/apt/lists/*
# This container gets 0.5 CPU on Render's starter plan; torch/tokenizers
# default to intra-op thread counts sized off the host's full core count,
# which they can't see is cgroup-limited here, each thread carries its own
# BLAS workspace, so left unbounded this wastes both memory and CPU time
# to context-switching between threads it was never going to get to run.
ENV OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    TOKENIZERS_PARALLELISM=false
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
COPY . .
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
