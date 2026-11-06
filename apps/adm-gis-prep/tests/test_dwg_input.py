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


# ------------------------------------------------------------------ server guard and the conversion path
def test_converter_that_runs_too_long_or_grows_too_big_is_stopped():
    from m4adm.adapters import ConverterLimitExceeded, run_limited
    with pytest.raises(ConverterLimitExceeded, match="ran longer"):
        run_limited([sys.executable, "-c", "import time; time.sleep(30)"], rss_limit_mb=None, timeout_s=0.5)
    hog = "import time; b = bytearray(200 * 1024 * 1024); b[::4096] = b'x' * len(b[::4096]); time.sleep(30)"
    with pytest.raises(ConverterLimitExceeded, match="more than 60 MB"):
        run_limited([sys.executable, "-c", hog], rss_limit_mb=60, timeout_s=30)
    ok = run_limited([sys.executable, "-c", "print('fine')"], rss_limit_mb=500, timeout_s=30)
    assert ok.returncode == 0 and ok.stdout.strip() == "fine"


def test_dwg_too_large_for_the_server_is_reported_not_crashed(dwg_case, tmp_path, monkeypatch):
    from m4adm.convert import convert
    from m4adm.convert.settings import ConversionSettings
    dwg, _, _ = dwg_case
    monkeypatch.setenv("FAKE_FAIL", "1")
    res = convert(dwg, ConversionSettings(), tmp_path / "jobs")
    assert any("could not be converted to DXF" in b and "cannot decode section" in b for b in res.report["blockers"])
    assert res.report["output"] is None or not res.report["output"].get("path")


def test_dwg_input_converts_to_a_draft_through_the_converter(tmp_path, monkeypatch):
    """A floor plan uploaded as DWG goes through dwg2dxf and then the normal conversion."""
    from m4adm.convert import convert
    from m4adm.convert.settings import ConversionSettings
    from m4adm.fixtures import arch_floor
    dxf = tmp_path / "plan.dxf"
    arch_floor(shaft=True).saveas(str(dxf))
    dwg = tmp_path / "plan.dwg"
    dwg.write_bytes(b"AC1032" + b"\x00" * 512)
    conv = tmp_path / "dwg2dxf"
    conv.write_text(STAND_IN.format(python=sys.executable))
    conv.chmod(conv.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("M4ADM_DWG2DXF", str(conv))
    monkeypatch.setenv("FAKE_DXF", str(dxf))
    monkeypatch.delenv("M4ADM_ODA_CONVERTER", raising=False)
    res = convert(dwg, ConversionSettings(), tmp_path / "jobs")
    assert not res.report["blockers"]
    assert res.report["features"] and next((res.job_dir / "output").glob("*.dxf")).exists()
