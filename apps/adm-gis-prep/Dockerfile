FROM python:3.13-slim
WORKDIR /app
# Private service for the Reality Capture API (see src/m4adm/service.py). DWG input needs ODA File
# Converter or LibreDWG, neither of which is bundled: DWG uploads are reported as blocked, not guessed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pyproject.toml README.md ./
COPY rules ./rules
COPY src ./src
RUN pip install --no-cache-dir -e .
ENV M4ADM_RULES_DIR=/app/rules
EXPOSE 8002
CMD ["uvicorn", "m4adm.service:app", "--host", "0.0.0.0", "--port", "8002"]
