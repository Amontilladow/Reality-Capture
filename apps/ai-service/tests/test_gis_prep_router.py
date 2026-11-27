"""Targeted coverage for the 30 MB upload-size boundary in routers/gis_prep.py
(GIS_PREP_MEMORY_REMEDIATION.md / GIS_30MB_CAPACITY_VALIDATION.md). The router
is mounted standalone (not via app.main) so this needs none of the other
routers' heavier dependencies (vector store, embeddings, etc.) -- gis_prep.py
itself only imports fastapi and app.config.
"""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.routers import gis_prep


@pytest.fixture
def client(monkeypatch):
    # A small test limit, independent of whatever MB value is configured
    # for production -- this test is about the boundary mechanism, not the
    # specific number (that's apps/adm-gis-prep's own benchmark-driven
    # tests/docs, not this router's job to re-assert).
    monkeypatch.setattr(settings, "gis_prep_max_upload_mb", 1)
    app = FastAPI()
    app.include_router(gis_prep.router)
    with TestClient(app) as c:
        yield c


def _dxf_bytes(size: int) -> bytes:
    # Content doesn't matter for this router -- it never parses the file
    # itself, only streams it to disk and checks its size. "Malformed DXF"
    # specifically (does the ENGINE reject it) is apps/adm-gis-prep's own
    # test surface (test_io.py-style format identification), not this
    # HTTP boundary's.
    return b"0\nSECTION\n" + b"x" * size


async def _never_called(*args, **kwargs):
    raise AssertionError("asyncio.create_subprocess_exec must not be called for a rejected oversized upload")


def test_oversized_upload_rejected_before_subprocess_is_started(client, monkeypatch):
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _never_called)
    oversized = _dxf_bytes(2 * 1024 * 1024)  # 2 MB, over the 1 MB test limit
    res = client.post(
        "/prepare",
        files={"drawing": ("plan.dxf", oversized, "application/octet-stream")},
        data={"settings": "{}"},
    )
    assert res.status_code == 413
    assert "1 MB" in res.text


def _patch_fake_engine(monkeypatch, job_id: str) -> list[tuple]:
    """Fakes the `python -m m4adm.package <source> <settings.json> <package>`
    subprocess: writes an (empty but present) zip at the real `package` path
    the router will read back, and returns the same stdout/headers shape the
    real engine does. Avoids needing the actual m4adm engine installed just
    to test THIS router's upload-boundary behaviour."""
    calls: list[tuple] = []

    class FakeProc:
        pid = 12345
        returncode = 0

        def __init__(self, package_path: str):
            self._package_path = package_path

        async def communicate(self):
            with open(self._package_path, "wb") as fh:
                fh.write(b"PK\x05\x06" + b"\x00" * 18)  # minimal empty-zip end-of-central-directory record
            body = json.dumps({"job_id": job_id, "status": "Ready for review", "label": "PROVISIONAL"}).encode()
            return body, b""

        def kill(self):
            pass

        async def wait(self):
            return 0

    async def fake_create_subprocess_exec(*args, **kwargs):
        calls.append(args)
        return FakeProc(args[5])

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    return calls


def test_upload_within_limit_proceeds_to_processing(client, monkeypatch):
    calls = _patch_fake_engine(monkeypatch, "j1")
    small = _dxf_bytes(10 * 1024)  # 10 KB, well within the 1 MB test limit
    res = client.post(
        "/prepare",
        files={"drawing": ("plan.dxf", small, "application/octet-stream")},
        data={"settings": "{}"},
    )
    assert len(calls) == 1, "a within-limit upload must reach the engine subprocess"
    assert res.status_code == 200
    assert res.headers["x-m4adm-job"] == "j1"


def test_upload_exactly_at_the_limit_is_accepted(client, monkeypatch):
    calls = _patch_fake_engine(monkeypatch, "j2")
    # Exactly settings.gis_prep_max_upload_mb (1 MB): the check is
    # strictly-greater-than, so the limit itself is still accepted.
    exactly_at_limit = b"x" * (1 * 1024 * 1024)
    res = client.post(
        "/prepare",
        files={"drawing": ("plan.dxf", exactly_at_limit, "application/octet-stream")},
        data={"settings": "{}"},
    )
    assert len(calls) == 1
    assert res.status_code == 200
