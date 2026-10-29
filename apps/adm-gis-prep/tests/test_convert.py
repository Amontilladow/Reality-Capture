"""CAD-to-GIS conversion (architectural floor plan -> DRM BDMS draft). SYNTHETIC drawings only."""
from __future__ import annotations

import json
import os
import stat

import ezdxf
import pytest

from m4adm.convert import STATUS_BLOCKED, STATUS_DRAFT_BLOCKED, STATUS_DRAFT_LOCAL, STATUS_DRAFT_REVIEW, convert
from m4adm.convert.georef import APPLIED, AWAITING_CONFIRMATION, BLOCKED, NOT_REQUESTED
from m4adm.convert.rooms import HIGH, NOT_GENERATED, REVIEW, UNRESOLVED
from m4adm.convert.settings import ConversionSettings
from m4adm.fixtures import BDMS_META, arch_floor

META = {k: v for k, v in BDMS_META.items() if k != "contractor_name"}
E0, N0 = 257_600.0, 2_708_000.0          # inside the Abu Dhabi window, UTM 40N


def run(tmp_path, doc=None, name="floor.dxf", **settings):
    src = tmp_path / "src" / name
    src.parent.mkdir(exist_ok=True)
    (doc or arch_floor()).saveas(str(src))
    settings.setdefault("single_unit_number", "1")
    s = ConversionSettings(metadata=settings.pop("metadata", META), validate_output=settings.pop("validate", False),
                           **settings)
    return convert(src, s, tmp_path / "jobs"), src


def spaces(res, status=None):
    return [f for f in res.report["features"] if f["layer"] == "Space" and (status is None or f["status"] == status)]


def by_usage(res):
    return {f["attributes"]["SPACEUSAGE"]["value"]: f for f in spaces(res) if f["attributes"].get("SPACEUSAGE")}


# ---------------------------------------------------------------------------------------------- rooms
def test_rooms_sharing_a_wall_separate_at_the_doorway(tmp_path):
    res, _ = run(tmp_path)
    rooms = by_usage(res)
    assert set(rooms) >= {"OFFICE", "STORE"}
    assert rooms["OFFICE"]["status"] == HIGH and rooms["STORE"]["status"] == HIGH
    # 200 mm walls: office interior 5.7 x 7.6 m, store 5.7 x 7.6 m (metres after unit conversion)
    assert rooms["OFFICE"]["area_m2"] == pytest.approx(5.7 * 7.6, rel=0.01)
    assert rooms["STORE"]["area_m2"] == pytest.approx(5.7 * 7.6, rel=0.01)
    doors = [f for f in res.report["features"] if f["layer"] == "Door" and f["status"] == REVIEW]
    assert len(doors) == 1 and "0.90 m" in doors[0]["reasons"][0]


def test_room_name_and_number_attributes_have_provenance(tmp_path):
    res, _ = run(tmp_path)
    office = by_usage(res)["OFFICE"]["attributes"]
    assert office["SPACEUSAGE"] == {"value": "OFFICE", "provenance": "SOURCE", "note": "room name text inside the region"}
    assert office["SPACENUMBER"]["value"] == "1" and office["SPACENUMBER"]["provenance"] == "DERIVED"
    assert "source room number 01-01" in office["SPACENUMBER"]["note"]
    assert office["FLOORNUMBER"]["provenance"] == "USER"


def test_wide_opening_is_not_closed_and_merges_rooms(tmp_path):
    res, _ = run(tmp_path, arch_floor(door_gap=3000))
    merged = [f for f in spaces(res) if f["status"] == REVIEW and "several different room names" in f["reasons"][0]]
    assert len(merged) == 1, "a 3 m gap is not a doorway: the two labels end up in one region, sent to review"


def test_small_drafting_gap_is_closed_but_large_exterior_gap_blocks(tmp_path):
    res, _ = run(tmp_path, arch_floor(small_gap=15))
    assert by_usage(res)["STORE"]["status"] == HIGH
    res, _ = run(tmp_path, arch_floor(exterior_gap=4000))
    feats = {f["id"]: f for f in res.report["features"]}
    assert feats["FLOOR"]["status"] == REVIEW and "gap wider than a doorway" in feats["FLOOR"]["reasons"][0]
    assert any(u["name"] == "OFFICE" for u in res.report["unplaced_labels"]), "the leaked room is reported"


def test_open_wall_network_without_any_closed_outline_blocks(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    for x0, y0, x1, y1 in ((0, 0, 12000, 200), (0, 0, 200, 8000)):          # two walls meeting in an L
        doc.modelspace().add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True,
                                        dxfattribs={"layer": "A-200-M_WALL"})
    res, _ = run(tmp_path, doc)
    assert res.status == STATUS_BLOCKED and any("does not enclose" in b for b in res.report["blockers"])


def test_duplicate_and_overlapping_walls_do_not_break_detection(tmp_path):
    res, _ = run(tmp_path, arch_floor(duplicate_walls=True, second_wall_gap=True))
    assert {"OFFICE", "STORE"} <= set(by_usage(res))


def test_labels_outside_rooms_and_unlabelled_regions(tmp_path):
    labels = {"OFFICE": (2000, 5000), "01-01": (2000, 4600), "STORE": (8500, 3000), "GARDEN": (20000, 3000)}
    res, _ = run(tmp_path, arch_floor(labels=labels, shaft=True))
    unresolved = [f for f in res.report["features"] if f["status"] == UNRESOLVED]
    assert any("GARDEN" in r for f in unresolved for r in f["reasons"])
    shaft = [f for f in spaces(res, REVIEW) if "without a room label" in f["reasons"][0]]
    assert len(shaft) == 1 and shaft[0]["area_m2"] == pytest.approx(1.7 * 1.7, rel=0.1)
    store = by_usage(res)["STORE"]["attributes"]
    # no room-number text: the space still gets the next progressive number (a numbering rule, not a fact)
    assert store["SPACENUMBER"]["provenance"] == "DERIVED" and "source room number" not in store["SPACENUMBER"]["note"]


def test_text_alone_never_creates_geometry(tmp_path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    doc.modelspace().add_text("OFFICE", dxfattribs={"layer": "A-FLOR-IDEN", "insert": (0, 0)})
    res, _ = run(tmp_path, doc)
    assert res.status == STATUS_BLOCKED and not [f for f in spaces(res) if f["vertices"]]


def test_free_standing_column_is_absorbed_and_logged(tmp_path):
    res, _ = run(tmp_path, arch_floor(column=True))
    office = by_usage(res)["OFFICE"]
    assert office["status"] == HIGH and any("free-standing island" in r for r in office["reasons"])


def test_wall_cavities_are_not_rooms(tmp_path):
    res, _ = run(tmp_path)
    assert all(f["status"] == NOT_GENERATED for f in spaces(res) if f["area_m2"] and f["area_m2"] < 0.8)


# ---------------------------------------------------------------------------------------------- units / coordinates
def test_units_unknown_blocks_until_declared(tmp_path):
    res, _ = run(tmp_path, arch_floor(units=0))
    assert res.status == STATUS_BLOCKED and any("units unknown" in b for b in res.report["blockers"])
    res, _ = run(tmp_path, arch_floor(units=0), source_units="mm")
    assert res.status == STATUS_DRAFT_LOCAL
    assert by_usage(res)["OFFICE"]["area_m2"] == pytest.approx(43.32, rel=0.01)


def test_no_control_points_gives_a_local_draft_marked_not_georeferenced(tmp_path):
    res, _ = run(tmp_path)
    assert res.status == STATUS_DRAFT_LOCAL
    assert res.report["georeferencing"]["status"] == NOT_REQUESTED
    doc = ezdxf.readfile(str(res.job_dir / "output" / f"{'-'.join(META.values())}.dxf"))
    assert doc.header.custom_vars.get("M4_GEOREFERENCED").startswith("NO")


def _cps(rot=0.0, scale=1.0):
    import math
    t = math.radians(rot)
    pts = [(0, 0), (12000, 0), (12000, 8000), (0, 8000)]
    out = []
    for x, y in pts:
        X, Y = x / 1000 * scale, y / 1000 * scale
        out.append(((x, y), (E0 + X * math.cos(t) - Y * math.sin(t), N0 + X * math.sin(t) + Y * math.cos(t))))
    return out


def test_georeferencing_requires_confirmation_then_applies(tmp_path):
    res, _ = run(tmp_path, crs={"control_points": _cps(30)})
    assert res.report["georeferencing"]["status"] == AWAITING_CONFIRMATION
    res, _ = run(tmp_path, crs={"control_points": _cps(30), "confirm_transformation": True})
    geo = res.report["georeferencing"]
    assert geo["status"] == APPLIED and geo["transformation"]["rotation_deg"] == pytest.approx(30)
    out = next((res.job_dir / "output").glob("*.dxf"))
    floor = next(e for e in ezdxf.readfile(str(out)).modelspace().query("LWPOLYLINE[layer=='Floor']"))
    xs = [p[0] for p in floor.get_points()]
    assert min(xs) > E0 - 10 and max(xs) < E0 + 20, "written in UTM metres"
    # the preview / features stay in local metres
    assert max(v[0] for v in res.report["features"][0]["vertices"]) < 13


@pytest.mark.parametrize("cps,needle", [
    (_cps(0, scale=1.01), "Fitted scale"),                                  # wrong units / points
    (_cps(0)[:1], "At least two"),
    ([((0, 0), (E0, N0)), ((1000, 0), (E0 + 1, N0))], "span"),             # points too close together
    ([*_cps(0)[:3], ((0, 8000), (E0 + 0.5, N0 + 8.3))], "inconsistent"),
    ([((0, 0), (500_000, 100)), ((12000, 0), (500_012, 100))], "outside the Abu Dhabi"),
])
def test_invalid_control_points_block_georeferencing(tmp_path, cps, needle):
    res, _ = run(tmp_path, crs={"control_points": cps, "confirm_transformation": True, "max_georef_rms": 0.05})
    geo = res.report["georeferencing"]
    assert geo["status"] == BLOCKED and any(needle in m for m in geo["messages"]), geo["messages"]
    assert res.status == STATUS_DRAFT_LOCAL


# ---------------------------------------------------------------------------------------------- mapping / attributes / output
def test_target_layers_blocks_and_missing_mandatory_attributes(tmp_path):
    res, _ = run(tmp_path)
    out = next((res.job_dir / "output").glob("*.dxf"))
    doc = ezdxf.readfile(str(out))
    layers = {e.dxf.layer for e in doc.modelspace()}
    assert {"Floor", "FloorDetail", "Space", "SpaceDetail", "Door", "DoorDetail", "Unit", "UnitDetail",
            "BuildingOutline", "BuildingDetail", "Title"} <= layers
    assert not layers & {"A-200-M_WALL", "A-FLOR-IDEN"}, "source layers never leak into the target"
    tags = {a.dxf.tag for e in doc.modelspace().query("INSERT[layer=='SpaceDetail']") for a in e.attribs}
    assert tags == {"SPACENUMBER", "UNITNUMBER", "FLOORNUMBER", "SPACEUSAGE"}
    missing = {(m["block"], m["tag"]) for m in res.report["missing_mandatory"]}
    assert ("FloorDetail", "FLOORHEIGHT") in missing and ("UnitDetail", "UNITOWNERNAME") in missing
    assert ("BuildingDetail", "USAGETYPE") in missing


def test_user_values_fill_attributes_and_decisions_apply(tmp_path):
    res, _ = run(tmp_path)
    store_id = by_usage(res)["STORE"]["id"]
    res, _ = run(tmp_path, floor_height="3.6", title_values={"DeveloperName": "M4"},
                 feature_decisions={store_id: {"action": "reject"},
                                    "DOOR_001": {"action": "accept", "attributes": {"Type": "wood"}}})
    feats = {f["id"]: f for f in res.report["features"]}
    assert feats[store_id]["status"] == "USER_REJECTED"
    assert feats["DOOR_001"]["status"] == "USER_ACCEPTED"
    assert feats["DOOR_001"]["attributes"]["TYPE"] == {"value": "wood", "provenance": "USER",
                                                        "note": "entered by the engineer"}
    assert feats["FLOOR"]["attributes"]["FLOORHEIGHT"]["value"] == "3.6"
    out = next((res.job_dir / "output").glob("*.dxf"))
    usages = [e.get_attrib_text("SPACEUSAGE") for e in ezdxf.readfile(str(out)).modelspace()
              .query("INSERT[layer=='SpaceDetail']")]
    assert "STORE" not in usages, "rejected features are not written"


def test_source_is_preserved_and_job_is_audited(tmp_path):
    res, src = run(tmp_path)
    before = src.read_bytes()
    assert res.report["source"]["unchanged"] is True
    copy = res.job_dir / "input" / src.name
    assert copy.read_bytes() == before and not os.stat(copy).st_mode & stat.S_IWUSR
    events = [json.loads(line)["event"] for line in (res.job_dir / "audit.jsonl").read_text().splitlines()]
    assert events[0] == "conversion_started" and "detection" in events and events[-1] == "conversion_finished"
    for name in ("conversion_report.json", "conversion_report.html", "features.json", "preview.svg"):
        assert (res.job_dir / name).exists()
    html = (res.job_dir / "conversion_report.html").read_text()
    assert "PROVISIONAL" in html and "approved" not in html.lower()


def test_generated_draft_is_validated_not_the_source(tmp_path):
    res, _ = run(tmp_path, validate=True)
    v = res.report["validation"]
    assert v["status"].startswith("Blocked")                    # CRS unknown, plot/roof missing: honest
    assert not any("Snapping errors" in g["qc_error"] for g in v["qc_style_summary"])
    assert res.status in (STATUS_DRAFT_LOCAL, STATUS_DRAFT_REVIEW)


def test_template_blocks_are_copied_when_given(tmp_path):
    from m4adm.fixtures import bdms_floor
    from m4adm.rules import load_profile
    tpl = tmp_path / "template.dxf"
    bdms_floor(load_profile("bdms_building")).saveas(str(tpl))
    res, _ = run(tmp_path, template_path=str(tpl))
    assert res.report["output"]["block_source"].startswith("template template.dxf")


# ---------------------------------------------------------------------------------------------- ADM QC trial 01 fixes
def test_spaces_are_numbered_progressively_and_openings_link_to_them(tmp_path):
    labels = {"OFFICE": (2000, 5000), "01-07": (2000, 4600), "STORE": (8500, 3000)}   # STORE has no number
    res, _ = run(tmp_path, arch_floor(labels=labels, shaft=True))
    exported = [f for f in spaces(res) if f["status"] in (HIGH, REVIEW)]
    nums = sorted(int(f["attributes"]["SPACENUMBER"]["value"]) for f in exported)
    assert nums == list(range(1, len(exported) + 1)), "1..n, no gaps or blanks"
    office = by_usage(res)["OFFICE"]["attributes"]["SPACENUMBER"]
    assert office["value"] == "1" and "01-07" in office["note"], "source-numbered rooms first; source number kept"
    shaft = next(f for f in exported if not f["attributes"]["SPACEUSAGE"]["value"])
    assert shaft["status"] == REVIEW and shaft["attributes"]["SPACENUMBER"]["value"], "unnamed room still numbered"
    numbers = {f["attributes"]["SPACENUMBER"]["value"] for f in exported}
    doors = [f for f in res.report["features"] if f["layer"] == "Door" and f["status"] == REVIEW]
    assert doors and all(d["attributes"]["SPACENUMBER"]["value"] in numbers for d in doors)
    for f in exported + doors:
        assert f["attributes"]["UNITNUMBER"]["value"] == "1" and f["attributes"]["FLOORNUMBER"]["value"] == "F1"


def test_missing_unit_or_floor_blocks_the_draft_without_inventing(tmp_path):
    res, _ = run(tmp_path, single_unit_number="")
    assert res.status == STATUS_DRAFT_BLOCKED
    assert any("unit number" in m for m in res.report["identifiers_missing"])
    door = next(f for f in res.report["features"] if f["layer"] == "Door")
    assert door["attributes"]["UNITNUMBER"] == {"value": "", "provenance": "MISSING", "note": ""}
    res, _ = run(tmp_path, metadata={**META, "floor_id": ""})
    assert res.status == STATUS_DRAFT_BLOCKED and any("floor ID" in m for m in res.report["identifiers_missing"])
    assert next((res.job_dir / "output").glob("*.dxf")).name == "CONVERSION_DRAFT.dxf"


def test_output_is_named_by_the_bdms_file_name_and_blocks_sit_well_inside(tmp_path):
    from shapely.geometry import Point, Polygon
    res, _ = run(tmp_path, building_number_of_floors="2", floor_height="3.6", building_usage_category="Commercial",
                 building_usage_type="Single-use Commercial")
    out = next((res.job_dir / "output").glob("*.dxf"))
    assert out.name == "SYNTH ZONE-SE01_01-C1-1-F1.dxf"
    msp = ezdxf.readfile(str(out)).modelspace()
    outline = Polygon([p[:2] for p in next(iter(msp.query("LWPOLYLINE[layer=='Floor']"))).get_points()])
    points = []
    for layer in ("FloorDetail", "BuildingDetail", "UnitDetail"):
        ins = next(iter(msp.query(f"INSERT[layer=='{layer}']")))
        pt = Point(ins.dxf.insert.x, ins.dxf.insert.y)
        assert outline.contains(pt) and outline.exterior.distance(pt) >= 0.5, layer
        points.append((pt.x, pt.y))
    assert len(set(points)) == 3, "blocks sharing one outline are not stacked on one point"
    b = next(iter(msp.query("INSERT[layer=='BuildingDetail']")))
    assert b.get_attrib_text("USAGETYPE") == "Single-use Commercial" and b.get_attrib_text("BUILDINGNUMOFFLOORS") == "2"


def test_opening_inside_a_room_is_not_written_as_a_sliver():
    """M19B ground floor: two door openings lay inside a room; clipping left ~0 m2 slivers that crashed noding."""
    from shapely.geometry import box
    from m4adm.convert.features import Feature
    from m4adm.convert.topology import clip_openings, node
    room = Feature("SPACE_1", "Space", HIGH, [], poly=box(0, 0, 5, 5))
    inside = Feature("DOOR_1", "Door", REVIEW, [], poly=box(1, 1, 2, 1.2))
    edge = Feature("DOOR_2", "Door", REVIEW, [], poly=box(4.8, 2, 5.2, 3))
    feats = [room, inside, edge]
    assert clip_openings(feats) == 2
    assert inside.status == NOT_GENERATED and "leaves no opening" in inside.reasons[-1]
    assert edge.exported and abs(edge.poly.area - 0.2) < 1e-6
    node(feats)        # must not raise on what is left
