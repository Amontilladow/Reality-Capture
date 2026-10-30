"""Service tests with a stand-in engine (the real conversion takes minutes per sheet)."""
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path

import pytest

FAKE_ENGINE = '''
import json, os, sys
job = sys.argv[2]
inp = os.path.join(job, "input")
pdfs = [f for f in os.listdir(inp) if f.endswith(".pdf")]
if any("reject" in f for f in pdfs):
    print("None of the uploaded PDFs could be read as an evacuation plan.", file=sys.stderr)
    sys.exit(2)
res = os.path.join(job, "result")
os.makedirs(os.path.join(res, "sheets"), exist_ok=True)
open(os.path.join(res, "evacuation_plans.pdf"), "wb").write(b"%PDF-1.4 fake")
json.dump({"kind": "evacuation-plans", "status": "READY_FOR_REVIEW", "sheets": [{"code": "GF-01"}],
           "logo": os.path.exists(os.path.join(inp, "logo.png"))}, open(os.path.join(res, "report.json"), "w"))
json.dump({"stage": "done", "total": 1, "done": 1}, open(os.path.join(job, "progress.json"), "w"))
'''


@pytest.fixture()
def client(tmp_path, monkeypatch):
    engine = tmp_path / "engine"
    engine.mkdir()
    (engine / "convert.py").write_text(FAKE_ENGINE)
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "s3cret")
    monkeypatch.setenv("ENGINE_DIR", str(engine))
    monkeypatch.setenv("ENGINE_PYTHON", sys.executable)
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "jobs"))
    for m in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[m]
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


H = {"X-Internal-Service-Secret": "s3cret"}
PDF = b"%PDF-1.7\n%fake\n"


def wait_done(client, job_id):
    for _ in range(200):
        s = client.get(f"/jobs/{job_id}", headers=H).json()
        if s["status"] in ("done", "failed"):
            return s
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_rejects_without_secret(client):
    assert client.post("/jobs", files=[("drawings", ("a.pdf", PDF))]).status_code == 401
    assert client.post("/jobs", headers={"X-Internal-Service-Secret": "wrong"},
                       files=[("drawings", ("a.pdf", PDF))]).status_code == 401


def test_full_job_with_logo(client):
    r = client.post("/jobs", headers=H, files=[("drawings", ("Ground_Floor-Plan-01.pdf", PDF)),
                                              ("logo", ("logo.png", b"\x89PNG fake"))],
                    data={"settings": json.dumps({"revision": "P01"})})
    assert r.status_code == 200, r.text
    s = wait_done(client, r.json()["id"])
    assert s["status"] == "done"
    z = client.get(f"/jobs/{r.json()['id']}/result", headers=H)
    assert z.headers["X-Evac3d-Status"] == "READY_FOR_REVIEW"
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert "report.json" in names and "evacuation_plans.pdf" in names
    report = json.loads(zipfile.ZipFile(io.BytesIO(z.content)).read("report.json"))
    assert report["logo"] is True
    assert client.delete(f"/jobs/{r.json()['id']}", headers=H).status_code == 200
    assert client.get(f"/jobs/{r.json()['id']}", headers=H).status_code == 404


def test_rejected_input_is_final(client):
    r = client.post("/jobs", headers=H, files=[("drawings", ("reject-me.pdf", PDF))])
    s = wait_done(client, r.json()["id"])
    assert s["status"] == "failed" and s["rejected"] is True
    assert "evacuation plan" in s["error"]
    assert client.get(f"/jobs/{r.json()['id']}/result", headers=H).status_code == 409


def test_non_pdf_and_bad_logo_refused(client):
    assert client.post("/jobs", headers=H, files=[("drawings", ("a.dwg", PDF))]).status_code == 422
    assert client.post("/jobs", headers=H, files=[("drawings", ("a.pdf", b"not a pdf"))]).status_code == 422
    assert client.post("/jobs", headers=H, files=[("drawings", ("a.pdf", PDF)),
                                                  ("logo", ("logo.gif", b"GIF89a"))]).status_code == 422


def test_unknown_job_404(client):
    assert client.get("/jobs/not-a-uuid", headers=H).status_code == 404
    assert client.get("/jobs/00000000-0000-0000-0000-000000000000", headers=H).status_code == 404
