"""Local web UI and CLI end-to-end."""
from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient

from m4adm import fixtures as fx
from m4adm.cli import main
from m4adm.fixtures import finish
from m4adm.ui import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "ws"))


def _upload(client, manifest, tmp_path, name="valid_plot", **form):
    path = tmp_path / f"SYNTHETIC_{name}.dxf"
    finish(fx.ALL[name](manifest)).saveas(str(path))
    data = {"category": ["plot"], "project_id": "P101", "submission_date": "20261025", "drawing_type": "AP",
            "consultant_name": "Synthetic", "source_crs": "EPSG:32640", "source_confirmed": "1",
            "units_confirmed": "1", **form}
    with open(path, "rb") as fh:
        return client.post("/prepare", data=data, files={"drawing": (path.name, fh, "application/dxf")},
                           follow_redirects=False)


def test_index_has_primary_button_and_label(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Prepare for ADM GIS" in r.text and "PROVISIONAL: NOT ADM-VALIDATED" in r.text


def test_prepare_via_upload_and_review_page(client, manifest, tmp_path):
    r = _upload(client, manifest, tmp_path)
    assert r.status_code == 303 and r.headers["location"].startswith("/jobs/")
    page = client.get(r.headers["location"])
    assert page.status_code == 200
    assert "Ready for review" in page.text and "Official QC not yet performed" in page.text
    job_id = r.headers["location"].rsplit("/", 1)[1]
    assert client.get(f"/jobs/{job_id}/files/qc_report.html").status_code == 200
    assert client.get(f"/jobs/{job_id}/files/../../../etc/passwd").status_code == 404
    assert client.get("/jobs/../../etc").status_code == 404
    assert client.get("/api/jobs").json()[0]["job_id"] == job_id


def test_validation_messages_state_next_action(client):
    r = client.post("/prepare", data={"category": ["plot"]}, follow_redirects=False)
    assert r.status_code == 303 and "Select%20a%20drawing" in r.headers["location"]


def test_rerun_with_mapping_from_review_queue(client, manifest, tmp_path):
    r = _upload(client, manifest, tmp_path, name="ambiguous_line", category=["roads"])
    job = r.headers["location"].rsplit("/", 1)[1]
    report = client.get(f"/api/jobs/{job}").json()
    assert report["status"]["counts"]["unresolved_layers"] == 3
    r2 = client.post(f"/jobs/{job}/rerun", data={"map::C-ROAD-EDGE": "RoadEdge", "map::KERB": "__exclude__"},
                     follow_redirects=False)
    job2 = r2.headers["location"].rsplit("/", 1)[1]
    rep2 = client.get(f"/api/jobs/{job2}").json()
    assert rep2["job"]["parent_job"] == job
    assert rep2["status"]["counts"]["unresolved_layers"] == 1  # layer "0" still unresolved
    assert {c["from"] for c in rep2["changes"]["layer_mapping"]} == {"C-ROAD-EDGE"}


def test_export_requires_ack(client, manifest, tmp_path):
    job = _upload(client, manifest, tmp_path).headers["location"].rsplit("/", 1)[1]
    r = client.post(f"/jobs/{job}/export", data={"by": "Eng"}, follow_redirects=False)
    assert "acknowledgement" in r.headers["location"]
    r = client.post(f"/jobs/{job}/export", data={"by": "Eng", "acknowledge": "1"}, follow_redirects=False)
    assert "Package" in r.headers["location"]
    assert ".zip" in client.get(f"/jobs/{job}").text


def test_official_qc_attach_via_ui(client, manifest, tmp_path):
    job = _upload(client, manifest, tmp_path).headers["location"].rsplit("/", 1)[1]
    client.post(f"/jobs/{job}/official-qc", data={"outcome": "PASSED", "by": "Eng"},
                files={"report": ("qc.txt", b"official tool output", "text/plain")})
    assert "Official QC passed (official tool output attached)" in client.get(f"/jobs/{job}").text


# --------------------------------------------------------------------------- CLI
def test_cli_check_name(capsys):
    assert main(["check-name", "P11_20130707_AP_Plot_ADM.dwg"]) == 0
    assert main(["check-name", "P11_2013_AP_Plot_ADM.dwg"]) == 3
    assert "ADM-NAME-003" in capsys.readouterr().out


def test_cli_prepare_exit_codes(tmp_path, manifest, capsys):
    good = tmp_path / "SYNTHETIC_valid.dxf"
    finish(fx.valid_plot(manifest)).saveas(str(good))
    base = ["prepare", str(good), "-c", "plot", "--project-id", "P101", "--date", "20261025",
            "--drawing-type", "AP", "--consultant", "X", "--jobs", str(tmp_path / "jobs")]
    assert main(base + ["--source-crs", "EPSG:32640", "--crs-confirmed", "--units-confirmed"]) == 0
    out = capsys.readouterr().out
    assert "specification v1.18.2" in out and "Ready for review" in out and "source unchanged (SHA-256 verified): True" in out
    assert main(base) == 3  # CRS unknown + units unconfirmed -> blocked
    assert main(["prepare", str(tmp_path / "missing.dxf")] + base[2:]) == 1


def test_cli_mapping_file_and_fix_acceptance(tmp_path, manifest, capsys):
    src = tmp_path / "SYNTHETIC_fixable.dxf"
    finish(fx.fixable(manifest)).saveas(str(src))
    mapping = tmp_path / "map.yaml"
    mapping.write_text("layers:\n  SOMETHING: Plot\n")
    rc = main(["prepare", str(src), "-c", "plot", "--project-id", "P1", "--date", "20261025", "--drawing-type", "AP",
               "--consultant", "X", "--source-crs", "EPSG:32640", "--crs-confirmed", "--units-confirmed",
               "--accept-fix", "all:CLOSE_FLAG", "--accept-fix", "all:TO_LWPOLYLINE",
               "--accept-fix", "all:DENSIFY_BULGES", "--accept-fix", "all:BYLAYER",
               "--mapping", str(mapping), "--tolerance", "arc_sagitta=0.005", "--jobs", str(tmp_path / "jobs")])
    assert rc == 0
    job_dir = next(p for p in (tmp_path / "jobs").iterdir() if p.is_dir())
    rep = json.loads((job_dir / "qc_report.json").read_text())
    assert len(rep["changes"]["fixes"]) == 4 and rep["tolerances"]["arc_sagitta"] == 0.005


def test_cli_matrix_check_and_rules(capsys):
    assert main(["matrix", "--check"]) == 0
    assert main(["rules"]) == 0
    assert re.search(r"ADM-CAP-003\s+VERIFIED_SPEC", capsys.readouterr().out)


def test_cli_fixtures_and_inspect(tmp_path, capsys):
    assert main(["fixtures", str(tmp_path / "fx")]) == 0
    assert (tmp_path / "fx" / "README.md").read_text().count("SYNTHETIC") >= 1
    assert main(["inspect", str(tmp_path / "fx" / "SYNTHETIC_mixed.dxf"), "-c", "plot"]) == 0
    out = capsys.readouterr().out
    assert '"format": "DXF-ASCII"' in out and "OUT_OF_SCOPE" in out
