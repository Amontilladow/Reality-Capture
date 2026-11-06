"""The desktop screen's conversion page, and the behaviour of the packaged program (no command line, rules and DWG
reader unpacked beside it)."""
from __future__ import annotations

import socket
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from m4adm import cli
from m4adm.adapters import DWGConverter
from m4adm.fixtures import arch_floor
from m4adm.rules import rules_dir
from m4adm.ui import create_app

FULL = {"zone_name": "synth zone", "sector_number": "se01_01", "plot_number": "c1", "building_number": "1",
        "floor_id": "f1", "single_unit_number": "1", "floor_height": "3.6", "building_number_of_floors": "2",
        "building_height": "15", "building_usage_category": "Commercial", "building_usage_type": "Single-use Commercial",
        "developer_name": "M4 TEST", "title_drawing_type": "As Built", "date_of_drawing": "29-oct-2026"}


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "ws"))


@pytest.fixture
def plan(tmp_path):
    p = tmp_path / "plan.dxf"
    arch_floor(shaft=True).saveas(str(p))
    return p


def _post(client, plan, **form):
    with open(plan, "rb") as fh:
        return client.post("/convert", data=form, files={"drawing": (plan.name, fh, "application/dxf")},
                           follow_redirects=False)


def test_form_offers_the_official_code_lists(client):
    page = client.get("/convert")
    assert page.status_code == 200 and "Convert to GIS draft" in page.text
    for value in ("Single-use Commercial", "CommercialResidential", "As Built", "Modification"):
        assert value in page.text
    assert "PROVISIONAL: NOT ADM-VALIDATED" in page.text


def test_filled_form_gives_a_named_draft_and_an_official_terms_summary(client, plan):
    r = _post(client, plan, **FULL)
    assert r.status_code == 303 and r.headers["location"].startswith("/conversions/")
    page = client.get(r.headers["location"])
    assert page.status_code == 200
    assert "SYNTH ZONE-SE01_01-C1-1-F1.dxf" in page.text          # capitals applied, file named by the BDMS pattern
    assert "No Plot or PlotDetail found" in page.text and "Still to enter" not in page.text
    job = r.headers["location"].rsplit("/", 1)[1]
    dxf = client.get(f"/conversions/{job}/files/output/SYNTH ZONE-SE01_01-C1-1-F1.dxf")
    assert dxf.status_code == 200 and dxf.content.startswith(b"  0\r\nSECTION") or b"SECTION" in dxf.content[:40]


def test_missing_identifiers_are_listed_not_guessed(client, plan):
    page = client.get(_post(client, plan).headers["location"])
    assert "Still to enter" in page.text and "unit number" in page.text and "CONVERSION_DRAFT.dxf" in page.text


def test_bad_input_and_unsafe_paths_are_refused(client, plan):
    bad = _post(client, plan, control_points="1 2 3")
    assert bad.status_code == 303 and "needs 4 numbers" in client.get(bad.headers["location"]).text
    assert client.get("/convert", params={"error": "x"}).status_code == 200
    job = _post(client, plan, **FULL).headers["location"].rsplit("/", 1)[1]
    assert client.get(f"/conversions/{job}/files/..%2F..%2Fsecret").status_code == 404
    assert client.get("/conversions/20260101T000000Z-deadbeef").status_code == 404
    assert client.get("/conversions/not-a-job").status_code == 404
    nothing = client.post("/convert", data=FULL, follow_redirects=False)
    assert "Select a drawing" in client.get(nothing.headers["location"]).text


# ------------------------------------------------------------------ the packaged program
def test_packaged_program_finds_its_rules_beside_itself(monkeypatch, tmp_path):
    monkeypatch.delenv("M4ADM_RULES_DIR", raising=False)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert rules_dir() == tmp_path / "rules"


def test_packaged_program_finds_dwg2dxf_beside_itself(monkeypatch, tmp_path):
    exe = tmp_path / ("dwg2dxf.exe" if sys.platform == "win32" else "dwg2dxf")
    exe.write_text("x")
    monkeypatch.delenv("M4ADM_DWG2DXF", raising=False)
    monkeypatch.delenv("M4ADM_ODA_CONVERTER", raising=False)
    monkeypatch.setenv("PATH", "")
    assert DWGConverter.from_env().executable is None                    # not packaged: nothing beside the program
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "m4adm.exe"))
    found = DWGConverter.from_env()
    assert found.kind == "libredwg" and Path(found.executable) == exe


def test_double_click_starts_the_screen_and_opens_the_browser(monkeypatch):
    seen = {}
    monkeypatch.setattr(cli, "cmd_ui", lambda a: seen.update(open=a.open, workspace=a.workspace) or 0)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert cli.main([]) == 0
    assert seen["open"] is True and Path(seen["workspace"]).name == "M4-GIS-Prep"
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    with pytest.raises(SystemExit):                                       # from source, a command is still required
        cli.main([])


def test_a_busy_port_falls_back_to_a_free_one():
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        taken = busy.getsockname()[1]
        assert cli._free_port(taken) not in (taken, 0)
    assert cli._free_port(0) > 0
