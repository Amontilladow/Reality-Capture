"""DWG input through an external converter. The converter here is a stand-in script (it copies a known
DXF), so this tests the tool's handling of conversion - not the fidelity of any real converter (that is
covered by tests/test_reference_drm.py when ODA File Converter or LibreDWG is installed)."""
from __future__ import annotations

import stat
import sys

import pytest

from m4adm.fixtures import BDMS_META, bdms_floor, finish
from m4adm.models import JobSettings
from m4adm.pipeline import STATUS_READY, prepare
from m4adm.rules import load_profile

STAND_IN = """#!{python}
import shutil, sys, os
args = sys.argv[1:]
out = args[args.index("-o") + 1]
if os.environ.get("FAKE_FAIL"):
    sys.stderr.write("cannot decode section"); sys.exit(1)
shutil.copyfile(os.environ["FAKE_DXF"], out)
"""


@pytest.fixture
def dwg_case(tmp_path, monkeypatch):
    bm = load_profile("bdms_building")
    dxf = tmp_path / "converted.dxf"
    finish(bdms_floor(bm)).saveas(str(dxf))
    dwg = tmp_path / "SYNTH ZONE-SE01_01-C1-1-F1.dwg"
    dwg.write_bytes(b"AC1032" + b"\x00" * 512)          # synthetic DWG header, content irrelevant to the stand-in
    conv = tmp_path / "dwg2dxf"
    conv.write_text(STAND_IN.format(python=sys.executable))
    conv.chmod(conv.stat().st_mode | stat.S_IEXEC)
    monkeypatch.delenv("M4ADM_ODA_CONVERTER", raising=False)
    monkeypatch.setenv("M4ADM_DWG2DXF", str(conv))
    monkeypatch.setenv("FAKE_DXF", str(dxf))
    settings = JobSettings(profile="bdms_building", categories=["building"], metadata=BDMS_META,
                           crs={"source_crs": "EPSG:32640", "source_confirmed": True}, units_confirmed_metres=True)
    return dwg, settings, bm


def test_dwg_is_converted_then_checked(dwg_case, tmp_path):
    dwg, settings, bm = dwg_case
    res = prepare(dwg, settings, tmp_path / "jobs", bm)
    assert res.report["source"]["format"] == "DWG"
    conv = res.report["source"]["conversion"]
    assert conv["kind"] == "libredwg" and conv["dxf_version"]
    assert res.status == STATUS_READY
    note = [f for f in res.report["findings"] if f["rule_id"] == "M4-IN-001"]
    assert note and note[0]["severity"] == "INFO"


def test_failed_conversion_blocks(dwg_case, tmp_path, monkeypatch):
    dwg, settings, bm = dwg_case
    monkeypatch.setenv("FAKE_FAIL", "1")
    res = prepare(dwg, settings, tmp_path / "jobs", bm)
    f = [f for f in res.report["findings"] if f["rule_id"] == "M4-IN-001"]
    assert f and f[0]["blocking"] and "cannot decode section" in f[0]["message"]
    assert res.report["outputs"] == []
