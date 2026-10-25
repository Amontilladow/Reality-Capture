"""Coordinate handling: declaration is not transformation; nothing moves without explicit confirmation."""
from __future__ import annotations

import ezdxf
import pytest

from m4adm import fixtures as fx
from m4adm.audit import AuditLog
from m4adm.crs import plausibility_window
from m4adm.fixtures import E0, N0

from conftest import findings


def _plot_coords(res):
    f = next(o["file"] for o in res.report["outputs"] if o["dataset"] == "plot")
    doc = ezdxf.readfile(str(res.job_dir / "output" / f))
    return sorted(tuple(round(c, 6) for c in p[:2]) for e in doc.modelspace().query("LWPOLYLINE[layer=='Plot']")
                  for p in e.get_points("xy"))


def test_unknown_crs_blocks_and_moves_nothing(run, manifest):
    res = run(fx.unknown_crs(manifest), crs={"source_crs": None, "source_confirmed": False})
    blocking = [f for f in findings(res, "USR-CRS-001") if f["blocking"]]
    assert blocking and res.status == "Blocked by errors"
    assert findings(res, "ENG-CRS-003"), "local coordinates must be flagged as implausible"
    assert _plot_coords(res) == [(0, 0), (0, 30), (30, 0), (30, 30)]
    assert res.report["changes"]["transformation"] == []


def test_declared_but_unconfirmed_crs_blocks(run, manifest):
    res = run(fx.valid_plot(manifest), crs={"source_crs": "EPSG:32640", "source_confirmed": False})
    assert any(f["blocking"] for f in findings(res, "USR-CRS-001"))


def test_confirmed_adm_crs_is_assignment_only(run, manifest):
    res = run(fx.valid_plot(manifest))
    assert "no transformation performed" in res.report["crs"]["summary"]
    assert not findings(res, "USR-CRS-001") and not findings(res, "ENG-CRS-003")


def test_other_crs_is_flagged_and_not_transformed_without_confirmation(run, manifest):
    res = run(fx.valid_plot(manifest),
              crs={"source_crs": "EPSG:32639", "source_confirmed": True, "transform_pipeline": "EPSG:32640"})
    assert any(f["blocking"] for f in findings(res, "ADM-CRS-001"))
    assert any(f["blocking"] for f in findings(res, "M4-SAFE-CRS"))
    assert (E0, N0) in _plot_coords(res)


def test_confirmed_explicit_transformation_is_logged(run, manifest):
    doc = fx.unknown_crs(manifest)
    pipeline = "+proj=pipeline +step +proj=affine +xoff=233000 +yoff=2705000"
    res = run(doc, crs={"source_crs": "EPSG:32640", "source_confirmed": True, "transform_pipeline": pipeline,
                        "confirm_transformation": True})
    t = res.report["changes"]["transformation"]
    assert len(t) == 1 and t[0]["pipeline"] == pipeline
    assert t[0]["before"][0] == pytest.approx(-50) and t[0]["after"][0] == pytest.approx(232950)
    assert (233000.0, 2705000.0) in _plot_coords(res)
    events = [e["event"] for e in AuditLog.read(res.job_dir / "audit.jsonl")]
    assert "coordinates_transformed" in events


def test_transformation_refused_for_curves(run, manifest):
    doc = fx.fixable(manifest)  # contains an arc segment
    res = run(doc, crs={"source_crs": "EPSG:32640", "source_confirmed": True,
                        "transform_pipeline": "+proj=pipeline +step +proj=affine +xoff=1",
                        "confirm_transformation": True})
    assert any("arc segments" in f["message"] for f in findings(res, "M4-SAFE-CRS"))
    assert res.report["changes"]["transformation"] == []


def test_plausibility_window_covers_abu_dhabi(manifest):
    from pyproj import CRS
    x0, y0, x1, y1 = plausibility_window(manifest.crs["plausibility_window_lonlat"], CRS.from_epsg(32640))
    assert x0 < E0 < x1 and y0 < N0 < y1
