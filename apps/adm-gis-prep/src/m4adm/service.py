"""Internal HTTP service used by the Reality Capture platform (engineeringos-api).

Private service only - same trust model as apps/ai-service: it has no user authentication of its own,
so every request must carry the shared ``X-Internal-Service-Secret`` header, and the API is what
enforces company/project access before calling it. The service is stateless: each request runs one
job in a temporary directory and returns the complete job package as a zip; nothing is kept after
the response is sent (the platform stores drawings and results in its own object storage).

Run: uvicorn m4adm.service:app --host 0.0.0.0 --port 8002
"""
from __future__ import annotations

import hmac
import io
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError

from m4adm import PROVISIONAL_LABEL, __version__
from m4adm.models import JobSettings
from m4adm.pipeline import prepare
from m4adm.rules import PROFILES, load_profile

MAX_UPLOAD = 500 * 1024 * 1024
PACKAGE_EXCLUDE = {"input", "work"}          # the platform already holds the original drawing
SAFE_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- ")

app = FastAPI(title="M4 GIS Preparation service", docs_url=None, redoc_url=None, openapi_url=None)
_MANIFESTS = {name: load_profile(name) for name in PROFILES}


def _check_secret(header: str | None) -> None:
    expected = os.environ.get("INTERNAL_SERVICE_SECRET", "")
    if not expected:
        if os.environ.get("M4ADM_ALLOW_NO_SECRET") == "1":   # local development only
            return
        raise HTTPException(503, "INTERNAL_SERVICE_SECRET is not configured")
    if not header or not hmac.compare_digest(header, expected):
        raise HTTPException(401, "invalid internal service secret")


@app.get("/health")
def health():
    return {"status": "ok", "version": __version__}


@app.get("/profiles")
def profiles(x_internal_service_secret: str | None = Header(None)):
    _check_secret(x_internal_service_secret)
    return [{"profile": name, "title": m.spec["title"], "version": m.version, "rules": len(m.rules),
             "categories": list(m.categories)} for name, m in _MANIFESTS.items()]


@app.post("/prepare")
async def run_prepare(
    drawing: UploadFile = File(...),
    settings: str = Form(...),
    x_internal_service_secret: str | None = Header(None),
):
    _check_secret(x_internal_service_secret)
    try:
        job_settings = JobSettings(**json.loads(settings))
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, f"invalid settings: {exc}") from exc
    if job_settings.template_path:
        # A server-side path would let a caller make the service read arbitrary files.
        raise HTTPException(422, "template_path is not accepted by the service")
    if job_settings.profile not in _MANIFESTS:
        raise HTTPException(422, f"unknown profile {job_settings.profile!r}")
    name = "".join(c if c in SAFE_CHARS else "_" for c in Path(drawing.filename or "drawing.dxf").name) or "drawing"
    data = await drawing.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "drawing larger than 500 MB")
    tmp = Path(tempfile.mkdtemp(prefix="m4adm-"))
    try:
        src_dir = tmp / "src"
        src_dir.mkdir()
        source = src_dir / name
        source.write_bytes(data)
        try:
            result = prepare(source, job_settings, tmp / "jobs", _MANIFESTS[job_settings.profile])
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(422, str(exc)) from exc
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(result.job_dir.rglob("*")):
                rel = f.relative_to(result.job_dir)
                if f.is_file() and rel.parts[0] not in PACKAGE_EXCLUDE:
                    z.write(f, rel.as_posix())
        headers = {"X-M4ADM-Job": result.job_id, "X-M4ADM-Status": result.status,
                   "X-M4ADM-Label": PROVISIONAL_LABEL}
        return Response(buf.getvalue(), media_type="application/zip", headers=headers)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
