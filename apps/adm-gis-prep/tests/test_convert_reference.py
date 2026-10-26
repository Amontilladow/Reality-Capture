"""Conversion of the real M19B first-floor architectural drawing, measured against the DRM-accepted GIS drawing of
the same floor (KHALIFA CITY-SE45_01-C8-1-F1). Files are kept locally in reference/ and never committed; the test
skips itself when they are absent. A good score here is NOT proof of official compliance.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

import pytest

from m4adm.convert import STATUS_DRAFT_LOCAL, STATUS_DRAFT_REVIEW, convert
from m4adm.convert.compare import compare
from m4adm.convert.settings import ConversionSettings
from m4adm.io import sha256_file

REF = Path(os.environ.get("M4ADM_REFERENCE_DIR", Path(__file__).resolve().parents[1] / "reference")) / "DRM_samples"
SOURCE = REF / "Source Files" / "dxf" / "M19B-M4C-L1-AX-SD-00145(00)CAD-FIRST FLOOR OVERALL FINISHING LAYOUT.dxf"
ACCEPTED = REF / "GIS Drawings" / "dxf" / "KHALIFA CITY-SE45_01-C8-1-F1.dxf"
META = {"zone_name": "KHALIFA CITY", "sector_number": "SE45_01", "plot_number": "C8", "building_number": "1",
        "floor_id": "F1"}

pytestmark = pytest.mark.skipif(not (SOURCE.exists() and ACCEPTED.exists()),
                                reason="M19B source / accepted F1 not present (reference/DRM_samples)")


@pytest.fixture(scope="module")
def local_draft(tmp_path_factory):
    before = sha256_file(SOURCE)
    res = convert(SOURCE, ConversionSettings(metadata=META, single_unit_number="1"), tmp_path_factory.mktemp("j"))
    assert sha256_file(SOURCE) == before
    return res


def test_m19b_draft_matches_the_accepted_floor(local_draft):
    res = local_draft
    assert res.status == STATUS_DRAFT_LOCAL and res.report["source"]["unchanged"]
    cmp = compare(res.job_dir, ACCEPTED)
    gen, ref = cmp["feature_counts"]["generated"], cmp["feature_counts"]["reference"]
    assert gen["Space"] == ref["Space"] == 12
    assert gen["Window"] == ref["Window"] == 34
    assert 10 <= gen["Door"] <= 20                                  # accepted drawing: 13
    assert cmp["rooms_matched_by_name"] >= 8
    assert cmp["mean_iou"] >= 0.9
    assert all(r["iou"] >= 0.75 for r in cmp["rooms"])
    office = next(r for r in cmp["rooms"] if r["room"] == "OFFICE AREA")
    assert office["iou"] >= 0.97


def test_m19b_draft_validation_has_no_snapping_errors(local_draft):
    v = local_draft.report["validation"]
    errors = {g["qc_error"] for g in v["qc_style_summary"]}
    assert not any("Snapping" in e for e in errors)
    # what remains is information a floor plan cannot give (plot, roof, owner data, CRS) - never invented
    missing = {(m["block"], m["tag"]) for m in local_draft.report["missing_mandatory"]}
    assert ("UnitDetail", "UNITOWNERNAME") in missing and ("FloorDetail", "FLOORHEIGHT") in missing


def test_m19b_georeferenced_with_control_points(tmp_path, local_draft):
    """Control points here are DERIVED FROM THE ACCEPTED DRAWING for the test only (building corners mapped by the
    evaluation alignment with scale held at 1). In production they come from the affection plan / survey."""
    cmp = compare(local_draft.job_dir, ACCEPTED)
    rot = math.radians(cmp["alignment"]["rotation_deg"])
    feats = {f["id"]: f for f in local_draft.report["features"]}
    floor = feats["FLOOR"]["vertices"]
    xs, ys = [p[0] for p in floor], [p[1] for p in floor]
    corners = [(min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys))]
    # recover the translation from the matched room centroids
    rooms = {f["attributes"]["SPACEUSAGE"]["value"]: f for f in local_draft.report["features"]
             if f["layer"] == "Space" and f["attributes"].get("SPACEUSAGE", {}).get("value")}
    from m4adm.convert.compare import _reference
    _, ref_spaces = _reference(ACCEPTED)
    office_ref = next(p for n, p in ref_spaces if n.strip() == "OFFICE AREA")
    office_gen = rooms["OFFICE AREA"]["vertices"]
    from shapely.geometry import Polygon
    cg, cr = Polygon(office_gen).centroid, office_ref.centroid
    c, s = math.cos(rot), math.sin(rot)
    tx, ty = cr.x - (c * cg.x - s * cg.y), cr.y - (s * cg.x + c * cg.y)
    cps = [((x * 1000, y * 1000), (c * x - s * y + tx, s * x + c * y + ty)) for x, y in corners]
    res = convert(SOURCE, ConversionSettings(metadata=META, single_unit_number="1",
                                             crs={"control_points": cps, "confirm_transformation": True}), tmp_path)
    geo = res.report["georeferencing"]
    assert geo["status"] == "APPLIED", geo["messages"]
    assert 54.5 < geo["diagnostics"]["centre_lonlat"][0] < 54.8          # Masdar / Khalifa City area
    assert res.status in (STATUS_DRAFT_REVIEW,)
    v = res.report["validation"]
    assert not any("coordinate" in g["qc_error"].lower() for g in v["qc_style_summary"])
