"""Drawings the converter could not read before: walls on a layer no default pattern matches (a key plan keeps
everything on one layer), and a header that names the wrong unit."""
from __future__ import annotations

import pytest

from m4adm.convert import ConversionSettings, convert
from m4adm.fixtures import arch_floor

META = {"zone_name": "ZZ", "sector_number": "S1", "plot_number": "P1", "building_number": "1", "floor_id": "G"}


def _run(tmp_path, doc, **settings):
    tmp_path.mkdir(parents=True, exist_ok=True)
    src = tmp_path / "plan.dxf"
    doc.saveas(src)
    return convert(src, ConversionSettings(metadata=META, single_unit_number="1", **settings), tmp_path / "jobs")


def _rename_layers(doc, old, new):
    for e in doc.modelspace():
        if e.dxf.layer == old:
            e.dxf.layer = new
    return doc


def test_wall_layer_setting_finds_walls_on_an_unusual_layer(tmp_path):
    doc = _rename_layers(arch_floor(), "A-200-M_WALL", "A-ARCH-KEYPLAN")
    blocked = _run(tmp_path / "a", doc)
    text = " ".join(blocked.report["blockers"])
    assert "No wall geometry found" in text and "A-ARCH-KEYPLAN" in text        # names the layers that hold geometry
    ok = _run(tmp_path / "b", _rename_layers(arch_floor(), "A-200-M_WALL", "A-ARCH-KEYPLAN"),
              wall_layers=[" A-ARCH-KEYPLAN "])
    assert not any("wall" in b.lower() for b in ok.report["blockers"]), ok.report["blockers"]


def test_wrong_header_units_are_called_out_not_reported_as_empty_walls(tmp_path):
    # The plan is 12 x 8 m drawn in millimetres. Declaring metres inflates it 1000-fold, declaring nothing wrong passes.
    res = _run(tmp_path / "big", arch_floor(units=6))                               # header says metres
    assert any("not a plausible building floor" in b for b in res.report["blockers"]), res.report["blockers"]
    fine = _run(tmp_path / "fine", arch_floor(units=4))                             # header says mm, correct
    assert not any("plausible" in b for b in fine.report["blockers"])


def test_declared_units_override_a_wrong_header(tmp_path):
    res = _run(tmp_path, arch_floor(units=6), source_units="mm")
    assert not any("plausible" in b for b in res.report["blockers"]), res.report["blockers"]


def test_wall_layers_do_not_touch_the_other_roles():
    s = ConversionSettings(wall_layers=["X"])
    assert s.roles["wall"] == ["X"] and "*GLAZ*" in s.roles["window"]
    assert "*WALL*" in ConversionSettings().roles["wall"]


def test_level_1_unit_usage_type_is_flagged_like_the_official_qc(tmp_path):
    import json
    for term, expect in (("Residential", True), ("Household Living", False)):
        res = _run(tmp_path / term.replace(" ", "_"), arch_floor(), unit_values={"UnitUsageType": term})
        qc = next(res.job_dir.rglob("qc_report.json"))
        text = qc.read_text(encoding="utf-8")
        assert ("is a Level 1 land-use term" in text) is expect, (term, text[:300])


def test_leftover_wall_layers_entry_is_named_as_the_cause(tmp_path):
    res = _run(tmp_path, arch_floor(), wall_layers=["A-ARCH-KEYPLAN"])             # matches nothing in this drawing
    text = " ".join(res.report["blockers"])
    assert "'Wall layers' entry (A-ARCH-KEYPLAN) matches no layer" in text and "Clear that field" in text


def test_detail_labels_are_centred_on_their_insertion_point_inside_the_room(tmp_path):
    """The stacked attribute text sits in the middle of the polygon (it used to hang down and right of the point)."""
    import ezdxf
    from shapely.geometry import Point, Polygon
    res = _run(tmp_path, arch_floor())
    out = next(res.job_dir.rglob("output/*.dxf"))
    msp = ezdxf.readfile(str(out)).modelspace()
    polys = [Polygon([(p[0], p[1]) for p in e.get_points()]) for e in msp if e.dxftype() == "LWPOLYLINE" and e.dxf.layer == "Space"]
    checked = 0
    for ins in msp.query("INSERT"):
        if ins.dxf.name != "SpaceDetail":
            continue
        at = (ins.dxf.insert.x, ins.dxf.insert.y)
        ys = [a.dxf.align_point.y for a in ins.attribs]
        xs = [a.dxf.align_point.x for a in ins.attribs]
        assert all(abs(x - at[0]) < 1e-6 for x in xs)                      # centred horizontally on the point
        assert abs(sum(ys) / len(ys) - at[1]) < 1e-6                       # stack centred vertically on the point
        assert any(p.contains(Point(at)) for p in polys)                   # and the point is inside a Space
        checked += 1
    assert checked >= 2


def test_drawn_outline_layer_becomes_the_floor_outline_and_facade_pieces_are_not_rooms(tmp_path):
    """A closed polyline on the outline layer is the Floor / BuildingOutline / Roof; regions that touch it are open
    area (not closed by walls), never a Space."""
    import ezdxf
    from shapely.geometry import Polygon
    doc = arch_floor()
    doc.layers.add("BUILDING_OUTLINE")
    # a rectangle 3 m outside the 12 x 8 m building (drawing units are mm)
    doc.modelspace().add_lwpolyline([(-3000, -3000), (15000, -3000), (15000, 11000), (-3000, 11000)], close=True,
                                    dxfattribs={"layer": "BUILDING_OUTLINE"})
    res = _run(tmp_path, doc, outline_layer="BUILDING_OUTLINE")
    out = ezdxf.readfile(str(next(res.job_dir.rglob("output/*.dxf")))).modelspace()
    area = lambda e: Polygon([(p[0], p[1]) for p in e.get_points()]).area
    floors = [area(e) for e in out if e.dxftype() == "LWPOLYLINE" and e.dxf.layer == "Floor"]
    assert floors and abs(floors[0] - 18 * 14) < 0.5                       # 18 m x 14 m, as drawn
    spaces = [e for e in out if e.dxftype() == "LWPOLYLINE" and e.dxf.layer == "Space"]
    assert 2 <= len(spaces) <= 4 and all(area(e) < 0.5 * 18 * 14 for e in spaces)   # the two rooms, not the open ring


def test_outline_layer_without_a_closed_polyline_says_what_to_do(tmp_path):
    doc = arch_floor()
    doc.layers.add("BUILDING_OUTLINE")
    doc.modelspace().add_line((0, 0), (5000, 0), dxfattribs={"layer": "BUILDING_OUTLINE"})
    res = _run(tmp_path, doc, outline_layer="BUILDING_OUTLINE")
    text = " ".join(res.report["blockers"])
    assert "BUILDING_OUTLINE" in text and "none of them closed" in text and "ONE closed polyline" in text
