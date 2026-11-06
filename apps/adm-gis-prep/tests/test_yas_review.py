"""DRM review of Yas Island-YS1-P10 (Nov 2026): door/window adjacency (docs/DRM_REVIEW_YAS_ISLAND.md).

The synthetic tests always run. The calibration test reads the client drawings' extracted geometry from
reference/ (git-ignored, never committed) and skips without it."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box

from m4adm.validate.bdms import opening_adjacent

ROOT = Path(__file__).resolve().parents[1]
YAS = ROOT / "reference" / "DRM_reviews" / "yas_island_2026-11" / "json" / "old"
# ErrorIDs 1-11 of the DRM error report (Report.xls): file -> flagged DOOR/WINDOW handles
FLAGGED = {"1-G": {"291", "2C7"}, "1-F1": {"7AB"}, "1-F2": {"BC5", "BD2", "BEC", "BED", "BEE", "BEF", "BF2", "BF3"}}
CONTACT = 0.015


def test_opening_between_two_spaces_or_space_and_floor_edge_is_adjacent():
    a, b = box(0, 0, 5, 5), box(5.2, 0, 10, 5)          # 20 cm wall between two spaces
    floor = box(0, 0, 10, 5)
    assert opening_adjacent(box(5, 1, 5.2, 2), [a, b], [floor], CONTACT)           # across the wall
    assert opening_adjacent(box(-0.0, 3, 0.1, 4), [a, b], [floor], CONTACT)        # space + floor edge


def test_opening_that_stops_short_or_lies_along_the_wall_is_rejected():
    a, b = box(0, 0, 5, 5), box(5.4, 0, 10, 5)
    floor = box(0, 0, 10, 5)
    assert not opening_adjacent(box(5, 1, 5.2, 2), [a, b], [floor], CONTACT)       # 20 cm short of the second space
    assert not opening_adjacent(box(5, 1, 5.385, 2), [a, b], [floor], CONTACT)     # 1.5 cm+ short (door 291 type)
    assert opening_adjacent(box(5, 1, 5.4, 2), [a, b], [floor], CONTACT)
    assert not opening_adjacent(box(2, 2, 3, 2.2), [a, b], [floor], CONTACT)       # one space, no floor edge


def test_multipart_floor_polygon_does_not_crash_the_check():
    """A Floor made of several parts (MultiPolygon) crashed the first version with AttributeError: exterior."""
    from shapely.geometry import MultiPolygon
    a = box(0, 0, 5, 5)
    floor = MultiPolygon([box(0, 0, 10, 5), box(20, 0, 25, 5)])
    assert opening_adjacent(box(-0.1, 1, 0.05, 2), [a], [floor], CONTACT)
    assert not opening_adjacent(box(2, 2, 3, 2.2), [a], [floor], CONTACT)


@pytest.mark.skipif(not YAS.exists(), reason="Yas Island review drawings are client data under reference/")
def test_rule_reproduces_exactly_the_handles_the_drm_review_flagged():
    failing: dict[str, set[str]] = {}
    total = 0
    for f in sorted(YAS.glob("*.json")):
        key = f.stem.replace("Yas Island-YS1-P10-", "")
        d = json.loads(f.read_text(encoding="utf-8"))
        polys = {lay: [(p["handle"], Polygon(p["verts"])) for p in d["polys"] if p["layer"].lower() == lay
                       and len(p["verts"]) >= 3] for lay in ("space", "floor", "door", "window")}
        spaces, floors = [g for _, g in polys["space"]], [g for _, g in polys["floor"]]
        for lay in ("door", "window"):
            for h, g in polys[lay]:
                total += 1
                if not opening_adjacent(g, spaces, floors, CONTACT):
                    failing.setdefault(key, set()).add(h)
    assert total == 294
    assert failing == FLAGGED


# ------------------------------------------------------------------ the real DWG files, through the DWG converter
from m4adm.adapters import STATUS_UNAVAILABLE, DWGConverter  # noqa: E402
from m4adm.models import JobSettings  # noqa: E402
from m4adm.pipeline import prepare  # noqa: E402
from m4adm.rules import load_profile  # noqa: E402

REVIEW = ROOT / "reference" / "DRM_reviews" / "yas_island_2026-11"
needs_files_and_converter = pytest.mark.skipif(
    not (REVIEW / "old").exists() or DWGConverter.from_env().status() == STATUS_UNAVAILABLE,
    reason="Yas Island DWGs (client data under reference/) or a DWG converter (LibreDWG dwg2dxf) not available")


def _errors(dwg: Path, tmp_path: Path) -> list[dict]:
    zone, sector, plot, building, floor = dwg.stem.split("-")
    s = JobSettings(profile="bdms_building", categories=["building"], units_confirmed_metres=True,
                    metadata=dict(zone_name=zone, sector_number=sector, plot_number=plot, building_number=building,
                                  floor_id=floor, contractor_name="M4 Contracting"),
                    crs=dict(source_crs="EPSG:32640", source_confirmed=True))
    res = prepare(dwg, s, tmp_path / "jobs", load_profile("bdms_building"))
    assert res.report["source"]["conversion"], "the DWG must have been converted"
    return [f for f in res.report["findings"] if f["severity"] == "ERROR"]


@needs_files_and_converter
def test_old_dwgs_through_the_converter_reproduce_the_drm_flagged_handles(tmp_path):
    """End to end: DWG -> dwg2dxf -> full validation flags exactly the 11 openings the DRM review flagged."""
    flagged: dict[str, set[str]] = {}
    for dwg in sorted((REVIEW / "old" / "OUT").glob("*.dwg")):
        key = dwg.stem.replace("Yas Island-YS1-P10-", "")
        handles = {f["handle"] for f in _errors(dwg, tmp_path / key) if f["rule_id"] == "DRM-LOG-22"}
        if handles:
            flagged[key] = handles
    assert flagged == FLAGGED


@needs_files_and_converter
def test_rectified_dwgs_have_no_errors_except_two_documented_disagreements(tmp_path):
    """The rectified set is clean, except ground floor of building 1 (DISCREPANCIES B-24, B-25): a door left 2.3 m
    from the Floor polygon DRM redrew, and a room outline with a zero-area self-intersection DRM never flagged."""
    for dwg in sorted((REVIEW / "new" / "OUT").glob("*.dwg")):
        errs = {(f["rule_id"], f["handle"]) for f in _errors(dwg, tmp_path / dwg.stem)}
        if dwg.stem.endswith("-1-G"):
            assert {r for r, _ in errs} == {"DRM-LOG-22", "DRM-GEO-11"}, errs
            assert ("DRM-LOG-22", "2AC") in errs
        else:
            assert errs == set(), (dwg.stem, errs)
