"""Calibration against real DRM material (kept locally in reference/, never committed).

Self-skips when the files are absent. Expectations:
  * every ADM-approved (official-QC-passed) sample yields 0 ERROR findings - parity with the official QC;
  * the prepared file is the approved geometry unchanged, with a layer table no larger than the sample's;
  * an original M4 architectural drawing is blocked with the specific missing-structure findings;
  * no reference file is modified.
"""
from __future__ import annotations

import os
from pathlib import Path

import ezdxf
import pytest

from m4adm.io import sha256_file
from m4adm.models import JobSettings
from m4adm.pipeline import STATUS_BLOCKED, prepare
from m4adm.rules import load_profile

REF = Path(os.environ.get("M4ADM_REFERENCE_DIR", Path(__file__).resolve().parents[1] / "reference")) / "DRM_samples"
APPROVED = sorted((REF / "GIS Drawings" / "dxf").glob("*.dxf")) if REF.exists() else []
SOURCES = sorted((REF / "Source Files" / "dxf").glob("*.dxf")) if REF.exists() else []

pytestmark = pytest.mark.skipif(not APPROVED, reason="DRM reference samples not present (reference/DRM_samples)")


def _settings(stem: str, **kw) -> JobSettings:
    zone, sector, plot, building, floor = stem.split("-")
    base = dict(profile="bdms_building", categories=["building"],
                metadata=dict(zone_name=zone, sector_number=sector, plot_number=plot, building_number=building,
                              floor_id=floor, contractor_name="M4 Contracting"),
                crs=dict(source_crs="EPSG:32640", source_confirmed=True), units_confirmed_metres=True)
    base.update(kw)
    return JobSettings(**base)


@pytest.mark.parametrize("path", APPROVED, ids=lambda p: p.stem)
def test_approved_sample_has_no_errors(path, tmp_path):
    before = sha256_file(path)
    res = prepare(path, _settings(path.stem), tmp_path / "jobs", load_profile("bdms_building"))
    errors = [f"{f['rule_id']}: {f['message']}" for f in res.report["findings"] if f["severity"] == "ERROR"]
    assert errors == [], "official-QC-passed sample must not produce errors"
    assert sha256_file(path) == before
    src = ezdxf.readfile(str(path))
    out = ezdxf.readfile(str(res.job_dir / "output" / res.report["outputs"][0]["file"]))
    assert {e.dxf.handle for e in out.modelspace()} == {e.dxf.handle for e in src.modelspace()}
    assert {l.dxf.name for l in out.layers} <= {l.dxf.name for l in src.layers}
    assert res.report["outputs"][0]["changes"] == [], "an accepted drawing needs no table/header changes"


@pytest.mark.skipif(not SOURCES, reason="source drawings not present")
def test_original_architectural_drawing_is_blocked_with_precise_reasons(tmp_path):
    path = next(p for p in SOURCES if "-L1-" in p.name)
    before = sha256_file(path)
    res = prepare(path, _settings("KHALIFA CITY-SE45_01-C8-1-F1", crs=dict(source_crs=None),
                                  units_confirmed_metres=False), tmp_path / "jobs", load_profile("bdms_building"))
    assert res.status == STATUS_BLOCKED
    rules = {f["rule_id"] for f in res.report["findings"]}
    assert {"DRM-LOG-03", "DRM-SPEC-TITLE", "USR-CRS-001", "USR-UNIT-001", "USR-MAP-001"} <= rules
    assert res.report["status"]["counts"]["unresolved_layers"] > 20
    ref_out = next(o for o in res.report["outputs"] if o["dataset"] == "additional")
    assert ref_out["entities"] == len(ezdxf.readfile(str(path)).modelspace()), "nothing lost"
    assert sha256_file(path) == before
