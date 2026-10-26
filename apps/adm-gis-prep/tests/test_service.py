"""Internal service used by the Reality Capture platform."""
from __future__ import annotations

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from m4adm.fixtures import BDMS_META, bdms_floor, finish
from m4adm.rules import load_profile
from m4adm.service import app

SECRET = "test-secret"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", SECRET)
    monkeypatch.delenv("M4ADM_ALLOW_NO_SECRET", raising=False)
    return TestClient(app)


def _drawing(tmp_path):
    path = tmp_path / "SYNTH ZONE-SE01_01-C1-1-F1.dxf"
    finish(bdms_floor(load_profile("bdms_building"))).saveas(str(path))
    return path


SETTINGS = {"profile": "bdms_building", "categories": ["building"], "metadata": BDMS_META,
            "crs": {"source_crs": "EPSG:32640", "source_confirmed": True}, "units_confirmed_metres": True}


def test_requires_the_shared_secret(client, tmp_path):
    assert client.get("/profiles").status_code == 401
    assert client.get("/profiles", headers={"X-Internal-Service-Secret": "wrong"}).status_code == 401
    assert client.get("/health").status_code == 200


def test_refuses_to_run_without_a_configured_secret(monkeypatch):
    monkeypatch.delenv("INTERNAL_SERVICE_SECRET", raising=False)
    monkeypatch.delenv("M4ADM_ALLOW_NO_SECRET", raising=False)
    assert TestClient(app).get("/profiles", headers={"X-Internal-Service-Secret": ""}).status_code == 503


def test_profiles(client):
    r = client.get("/profiles", headers={"X-Internal-Service-Secret": SECRET})
    assert {p["profile"] for p in r.json()} == {"sdd_planning", "bdms_building"}


def test_prepare_returns_the_job_package(client, tmp_path):
    path = _drawing(tmp_path)
    with open(path, "rb") as fh:
        r = client.post("/prepare", headers={"X-Internal-Service-Secret": SECRET},
                        files={"drawing": (path.name, fh, "application/dxf")}, data={"settings": json.dumps(SETTINGS)})
    assert r.status_code == 200 and r.headers["x-m4adm-status"] == "Ready for review"
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert {"qc_report.json", "qc_report.html", "processing_manifest.json", "audit.jsonl"} <= set(names)
    assert "output/SYNTH ZONE-SE01_01-C1-1-F1.dxf" in names
    assert not [n for n in names if n.startswith(("input/", "work/"))], "the original drawing is not sent back"


def test_prepare_rejects_bad_settings(client, tmp_path):
    path = _drawing(tmp_path)
    with open(path, "rb") as fh:
        r = client.post("/prepare", headers={"X-Internal-Service-Secret": SECRET},
                        files={"drawing": (path.name, fh)}, data={"settings": json.dumps({"categories": []})})
    assert r.status_code == 422


def test_prepare_refuses_server_side_template_paths(client, tmp_path):
    path = _drawing(tmp_path)
    with open(path, "rb") as fh:
        r = client.post("/prepare", headers={"X-Internal-Service-Secret": SECRET}, files={"drawing": (path.name, fh)},
                        data={"settings": json.dumps({**SETTINGS, "template_path": "/etc/passwd"})})
    assert r.status_code == 422
