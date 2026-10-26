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
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response

from m4adm import __version__
from m4adm.package import InputRejected, build_package, parse_settings
from m4adm.rules import PROFILES, load_profile

MAX_UPLOAD = 500 * 1024 * 1024
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
        job_settings = parse_settings(settings)
    except InputRejected as exc:
        raise HTTPException(422, str(exc)) from exc
    name = "".join(c if c in SAFE_CHARS else "_" for c in Path(drawing.filename or "drawing.dxf").name) or "drawing"
    data = await drawing.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "drawing larger than 500 MB")
    tmp = Path(tempfile.mkdtemp(prefix="m4adm-"))
    try:
        source = tmp / name
        source.write_bytes(data)
        try:
            meta = build_package(source, job_settings, tmp / "package.zip", _MANIFESTS[job_settings.profile])
        except InputRejected as exc:
            raise HTTPException(422, str(exc)) from exc
        headers = {"X-M4ADM-Job": meta["job_id"], "X-M4ADM-Status": meta["status"], "X-M4ADM-Label": meta["label"]}
        return Response((tmp / "package.zip").read_bytes(), media_type="application/zip", headers=headers)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
