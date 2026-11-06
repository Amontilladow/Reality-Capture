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
