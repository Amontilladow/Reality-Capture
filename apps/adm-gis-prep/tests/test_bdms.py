"""DRM BDMS 4.1 building-floor profile: one test per official QC error class, strict mode, layer-table
hygiene and control-point georeferencing. All drawings are SYNTHETIC, NOT AN OFFICIAL SAMPLE."""
from __future__ import annotations

import math
from collections import Counter
from pathlib import Path

import ezdxf
import pytest

from m4adm.crs import fit_similarity
from m4adm.fixtures import BDMS_META, E0, N0, bdms_floor, detail, finish, poly
from m4adm.models import JobSettings
from m4adm.pipeline import STATUS_BLOCKED_STRICT, STATUS_READY, prepare
from m4adm.rules import load_profile


@pytest.fixture(scope="module")
def bm():
    return load_profile("bdms_building")


@pytest.fixture
def brun(tmp_path, bm):
    def _run(doc, **overrides):
        meta = {**BDMS_META, **overrides.pop("metadata", {})}
        path = tmp_path / f"{meta['zone_name']}-{meta['sector_number']}-{meta['plot_number']}-" \
                          f"{meta['building_number']}-{meta['floor_id']}.dxf"
        finish(doc).saveas(str(path))
        base = dict(profile="bdms_building", categories=["building"], metadata=meta,
                    crs={"source_crs": "EPSG:32640", "source_confirmed": True}, units_confirmed_metres=True)
        base.update(overrides)
        return prepare(path, JobSettings(**base), tmp_path / "jobs", bm)
    return _run


def ids(res, sev=None):
    return Counter(f["rule_id"] for f in res.report["findings"] if sev is None or f["severity"] == sev)


def _set(doc, block, tag, value, nth=0):
    ins = [e for e in doc.modelspace().query("INSERT") if e.dxf.name == block][nth]
    ins.get_attrib(tag.upper()).dxf.text = value
    return ins


def test_clean_floor_is_ready_in_strict_mode(brun, bm):
    res = brun(bdms_floor(bm))
    assert res.status == STATUS_READY
    assert not [f for f in res.report["findings"] if f["severity"] in ("ERROR", "WARNING")]
    assert res.report["strict_mode"] is True and res.report["spec"]["profile"] == "bdms_building"
    out = res.job_dir / "output" / "SYNTH ZONE-SE01_01-C1-1-F1.dxf"
    assert out.exists()


def test_profile_requires_building_category(tmp_path, bm):
    with pytest.raises(ValueError):
        prepare(tmp_path / "x.dxf", JobSettings(profile="bdms_building", categories=["plot"]), tmp_path, bm)


# ----------------------------------------------------------------- QC 4.1 general errors
@pytest.mark.parametrize("meta,rule", [
    ({"floor_id": "F0"}, "DRM-GEN-02"),
    ({"floor_id": "Ground"}, "DRM-GEN-02"),
    ({"building_number": "A"}, "DRM-GEN-01"),
    ({"zone_name": "SYNTH-ZONE"}, "DRM-GEN-01"),   # hyphen inside a part breaks the 5-part structure
])
def test_file_name_errors(brun, bm, meta, rule):
    assert rule in ids(brun(bdms_floor(bm), metadata=meta), "ERROR")


def test_layer_with_polygons_but_no_blocks(brun, bm):
    doc = bdms_floor(bm)
    for e in list(doc.modelspace().query("INSERT[layer=='DoorDetail']")):
        doc.modelspace().delete_entity(e)
    assert "DRM-GEN-07" in ids(brun(doc), "ERROR")


def test_unmapped_layer_and_empty_layers_never_reach_the_output(brun, bm):
    doc = bdms_floor(bm, extra_layers=("A-WALL", "EMPTY-FOREIGN"))
    poly(doc, [(E0 + 50, N0), (E0 + 60, N0)], "A-WALL", closed=False)
    res = brun(doc)
    assert ids(res)["USR-MAP-001"] == 1 and res.status == STATUS_BLOCKED_STRICT
    layers = {l.dxf.name for l in ezdxf.readfile(str(res.job_dir / "output" / res.report["outputs"][0]["file"])).layers}
    assert "A-WALL" not in layers and "EMPTY-FOREIGN" not in layers
    assert "Window" not in layers and "SharedSpace" not in layers      # specified but empty -> not in table
    assert {"Plot", "Space", "Door", "Title"} <= layers


# ----------------------------------------------------------------- QC 4.2 attribute errors
def test_duplicate_space_number(brun, bm):
    doc = bdms_floor(bm)
    _set(doc, "SpaceDetail", "SpaceNumber", "1", nth=1)
    assert "DRM-ATT-05" in ids(brun(doc), "ERROR")


def test_door_refers_to_missing_space_and_unit(brun, bm):
    doc = bdms_floor(bm)
    _set(doc, "DoorDetail", "SpaceNumber", "9")
    _set(doc, "DoorDetail", "UnitNumber", "7")
    got = ids(brun(doc), "ERROR")
    assert got["DRM-ATT-15"] == 1 and got["DRM-ATT-08"] == 1


def test_floor_number_consistency(brun, bm):
    doc = bdms_floor(bm)
    _set(doc, "FloorDetail", "FloorNumber", "F2")
    got = ids(brun(doc), "ERROR")
    assert got["DRM-ATT-31"] == 1 and got["DRM-ATT-11"] >= 3   # unit, spaces and door now disagree


def test_building_number_and_plot_consistency(brun, bm):
    doc = bdms_floor(bm)
    _set(doc, "BuildingRoofDetail", "BuildingNumber", "2")
    _set(doc, "PlotDetail", "ZoneName", "OTHER ZONE")
    _set(doc, "BuildingDetail", "PlotNumber", "C2")
    got = ids(brun(doc), "ERROR")
    assert got["DRM-ATT-19"] == 1 and got["DRM-ATT-06"] == 1 and got["DRM-LOG-04"] == 1


def test_code_lists_and_data_entry(brun, bm):
    doc = bdms_floor(bm)
    _set(doc, "BuildingDetail", "UsageCategoryType", "residential")      # wrong case
    _set(doc, "UnitDetail", "UnitArea", "two hundred")
    _set(doc, "UnitDetail", "UnitUsageType", "Spaceship Hangar")
    _set(doc, "UnitDetail", "UnitClassification", "Loft")
    _set(doc, "DrawingDetail", "DrawingType", "As-Built")
    res = brun(doc)
    got = ids(res)
    assert got["DRM-ATT-45"] == 2
    msgs = [f["message"] for f in res.report["findings"] if f["rule_id"] == "DRM-ATT-26"]
    assert any("not a number" in m for m in msgs) and any("maximum is 10" in m for m in msgs)  # type + Char(10)
    assert got["DRM-ATT-44"] == 1 and got["DRM-ATT-46"] == 1
    sev = {f["rule_id"]: f["severity"] for f in res.report["findings"]}
    assert sev["DRM-ATT-44"] == "WARNING" and sev["DRM-ATT-46"] == "INFO"


def test_mandatory_value_and_tag_structure(brun, bm):
    doc = bdms_floor(bm)
    _set(doc, "UnitDetail", "UnitOwnerName", "")
    ins = [e for e in doc.modelspace().query("INSERT") if e.dxf.name == "SpaceDetail"][0]
    ins.add_attrib("ROOMCOLOUR", "blue", (E0, N0))
    got = ids(brun(doc), "ERROR")
    assert got["DRM-ATT-03"] == 1 and got["DRM-ATT-32"] == 1


def test_title_blocks_required(brun, bm):
    doc = bdms_floor(bm)
    for e in [e for e in doc.modelspace().query("INSERT") if e.dxf.name == "DrawingDetail"]:
        doc.modelspace().delete_entity(e)
    assert any("DrawingDetail" in f["message"] for f in brun(doc).report["findings"]
               if f["rule_id"] == "DRM-SPEC-TITLE")


# ----------------------------------------------------------------- QC 4.3 geometry errors
def test_arc_in_polygon_is_an_error(brun, bm):
    doc = bdms_floor(bm)
    doc.modelspace().add_lwpolyline([(E0 + 25, N0, 0), (E0 + 28, N0, 0.5), (E0 + 28, N0 + 3, 0)],
                                    format="xyb", close=True, dxfattribs={"layer": "Space"})
    assert "DRM-GEO-10" in ids(brun(doc), "ERROR")


def test_space_nesting_one_level_allowed_two_not(brun, bm):
    doc = bdms_floor(bm)
    poly(doc, [(E0 + 1, N0 + 1), (E0 + 4, N0 + 1), (E0 + 4, N0 + 4), (E0 + 1, N0 + 4)], "Space")
    detail(doc, "SpaceDetail", "SpaceDetail", (E0 + 3.5, N0 + 3.5),
           {"SPACENUMBER": "3", "UNITNUMBER": "1", "FLOORNUMBER": "F1", "SPACEUSAGE": "CLOSET"})
    res = brun(doc)
    assert "DRM-GEO-06" not in ids(res) and "DRM-GEO-05" not in ids(res)
    poly(doc, [(E0 + 2, N0 + 2), (E0 + 3, N0 + 2), (E0 + 3, N0 + 3), (E0 + 2, N0 + 3)], "Space")
    detail(doc, "SpaceDetail", "SpaceDetail", (E0 + 2.5, N0 + 2.5),
           {"SPACENUMBER": "4", "UNITNUMBER": "1", "FLOORNUMBER": "F1", "SPACEUSAGE": "SHAFT"})
    assert "DRM-GEO-06" in ids(brun(doc), "ERROR")


def test_prohibited_geometry(brun, bm):
    doc = bdms_floor(bm)
    doc.modelspace().add_line((E0, N0), (E0 + 1, N0 + 1), dxfattribs={"layer": "Space"})
    doc.modelspace().add_text("ROOM", dxfattribs={"layer": "Space", "insert": (E0 + 3, N0 + 3)})
    doc.modelspace().add_text("NOTE", dxfattribs={"layer": "Title", "insert": (E0, N0 + 30)})   # allowed on Title
    res = brun(doc)
    assert ids(res, "ERROR")["DRM-GEO-09"] == 2


# ----------------------------------------------------------------- QC 4.4 logical / 4.5 snapping
def test_missing_required_polygons(brun, bm):
    doc = bdms_floor(bm)
    for e in list(doc.modelspace().query("LWPOLYLINE[layer=='BuildingRoof']")) + \
            list(doc.modelspace().query("INSERT[layer=='BuildingRoofDetail']")):
        doc.modelspace().delete_entity(e)
    assert any("BuildingRoof" in f["message"] for f in brun(doc).report["findings"] if f["rule_id"] == "DRM-LOG-03")


def test_space_outside_unit_with_unit_number(brun, bm):
    doc = bdms_floor(bm)
    poly(doc, [(E0 + 22, N0), (E0 + 25, N0), (E0 + 25, N0 + 3), (E0 + 22, N0 + 3)], "Space")
    detail(doc, "SpaceDetail", "SpaceDetail", (E0 + 23, N0 + 1),
           {"SPACENUMBER": "3", "UNITNUMBER": "1", "FLOORNUMBER": "F1", "SPACEUSAGE": "STORE"})
    res = brun(doc)
    assert "DRM-LOG-15" in ids(res, "ERROR") and "DRM-LOG-21" in ids(res, "WARNING")


def test_snapping_t_junction_is_error(brun, bm):
    res = brun(bdms_floor(bm, door_vertices_on_spaces=False))
    snaps = [f for f in res.report["findings"] if f["rule_id"] == "DRM-SNAP-01"]
    assert snaps and all(f["severity"] == "ERROR" for f in snaps)
    assert {tuple(f["location"]) for f in snaps} >= {(E0 + 9, N0 + 5), (E0 + 10, N0 + 5)}


def test_qc_style_summary_uses_official_wording(brun, bm):
    res = brun(bdms_floor(bm, door_vertices_on_spaces=False))
    names = {g["qc_error"] for g in res.report["qc_style_summary"]}
    assert any(n.startswith("Snapping errors found between layers") for n in names)


# ----------------------------------------------------------------- strict mode
def test_strict_mode_blocks_warnings_and_can_be_relaxed(brun, bm):
    doc = bdms_floor(bm)
    _set(doc, "UnitDetail", "UnitUsageType", "Spaceship Hangar")   # WARNING only
    assert brun(doc).status == STATUS_BLOCKED_STRICT
    assert brun(doc, strict=False).status == "Prepared with warnings"


# ----------------------------------------------------------------- georeferencing
ROT, SCALE, TX, TY = 52.19, 0.001, 257740.0, 2704590.0


def _to_local(doc):
    """Move a UTM-metre drawing into a local millimetre CAD system (inverse of the georeferencing)."""
    t = math.radians(-ROT)

    def inv(x, y):
        x, y = (x - TX) / SCALE, (y - TY) / SCALE
        return x * math.cos(t) - y * math.sin(t), x * math.sin(t) + y * math.cos(t)

    for e in doc.modelspace():
        if e.dxftype() == "LWPOLYLINE":
            e.set_points([(*inv(x, y), 0, 0, b) for x, y, b in e.get_points("xyb")], format="xyseb")
        elif e.dxftype() == "INSERT":
            x, y, z = e.dxf.insert
            nx, ny = inv(x, y)
            for a in e.attribs:
                ax, ay, az = a.dxf.insert
                a.dxf.insert = (*inv(ax, ay), az)
            e.dxf.insert = (nx, ny, z)
            e.dxf.rotation = -ROT
            for k in ("xscale", "yscale", "zscale"):
                e.dxf.set(k, 1 / SCALE)
    return inv


def test_fit_similarity_recovers_parameters():
    t = math.radians(ROT)
    f = lambda x, y: (SCALE * (math.cos(t) * x - math.sin(t) * y) + TX, SCALE * (math.sin(t) * x + math.cos(t) * y) + TY)
    sim = fit_similarity([((x, y), f(x, y)) for x, y in [(0, 0), (64015, 0), (64015, 25315), (0, 25315)]])
    assert sim.scale == pytest.approx(SCALE) and sim.rotation_deg == pytest.approx(ROT)
    assert (sim.tx, sim.ty) == (pytest.approx(TX), pytest.approx(TY)) and sim.rms < 1e-6
    with pytest.raises(ValueError):
        fit_similarity([((0, 0), (1, 1))])


def test_control_point_georeferencing_end_to_end(brun, bm):
    doc = bdms_floor(bm)
    inv = _to_local(doc)
    corners = [(E0 - 10, N0 - 10), (E0 + 30, N0 - 10), (E0 + 30, N0 + 20), (E0 - 10, N0 + 20)]   # plot corners
    pairs = [(inv(*c), c) for c in corners]
    crs = {"source_crs": None, "source_confirmed": True, "control_points": pairs, "confirm_transformation": True}
    res = brun(doc, crs=crs)
    assert res.status == STATUS_READY, [f["message"] for f in res.report["findings"] if f["severity"] != "INFO"]
    fit = res.report["changes"]["transformation"][0]["fit"]
    assert fit["rms_m"] < 1e-6 and fit["rotation_deg"] == pytest.approx(ROT)
    out = ezdxf.readfile(str(res.job_dir / "output" / res.report["outputs"][0]["file"]))
    plot = out.modelspace().query("LWPOLYLINE[layer=='Plot']")[0]
    assert all(math.dist(p, c) < 1e-6 for p, c in zip(plot.get_points("xy"), corners))


def test_georeferencing_not_applied_without_confirmation_or_with_bad_fit(brun, bm):
    doc = bdms_floor(bm)
    inv = _to_local(doc)
    corners = [(E0 - 10, N0 - 10), (E0 + 30, N0 - 10), (E0 + 30, N0 + 20)]
    pairs = [(inv(*c), c) for c in corners]
    res = brun(doc, crs={"source_crs": None, "source_confirmed": True, "control_points": pairs})
    assert any(f["blocking"] for f in res.report["findings"] if f["rule_id"] == "M4-SAFE-CRS")
    assert res.report["changes"]["transformation"] == []
    bad = pairs[:2] + [(pairs[2][0], (pairs[2][1][0] + 0.5, pairs[2][1][1]))]       # 0.5 m typo in one point
    res = brun(doc, crs={"source_crs": None, "source_confirmed": True, "control_points": bad,
                         "confirm_transformation": True})
    assert any(f["blocking"] for f in res.report["findings"] if f["rule_id"] == "ENG-GEOREF-001")
    assert res.report["changes"]["transformation"] == []


def test_detail_blocks_without_polygons(brun, bm):
    doc = bdms_floor(bm)
    detail(doc, "WindowDetail", "WindowDetail", (E0 + 3, N0 + 3),
           {"SPACENUMBER": "1", "UNITNUMBER": "1", "FLOORNUMBER": "F1", "TYPE": "glass"})
    assert "DRM-GEN-08" in ids(brun(doc), "ERROR")


def test_duplicate_unit_number_and_non_positive_ids(brun, bm):
    doc = bdms_floor(bm)
    poly(doc, [(E0 + 22, N0), (E0 + 25, N0), (E0 + 25, N0 + 3), (E0 + 22, N0 + 3)], "Unit")
    detail(doc, "UnitDetail", "UnitDetail", (E0 + 23, N0 + 1),
           {"UNITNUMBER": "1", "FLOORNUMBER": "F1", "UNITTYPE": "Residential", "UNITCLASSIFICATION": "Apartment",
            "UNITAREA": "9", "UNITNUMBEDROOM": "0", "UNITNUMBATHROOM": "0", "UNITUSAGETYPE": "Household Living",
            "UNITOWNERNAME": "Owner", "UNITOWNERNATIOANLITY": "UAE", "UNITOWNERPASSPORT": "P1"})
    _set(doc, "SpaceDetail", "SpaceNumber", "0")
    got = ids(brun(doc), "ERROR")
    assert got["DRM-ATT-04"] == 1 and got["DRM-SPEC-IDS"] == 1


def test_one_floor_per_file(brun, bm):
    doc = bdms_floor(bm)
    poly(doc, [(E0 + 22, N0), (E0 + 25, N0), (E0 + 25, N0 + 3), (E0 + 22, N0 + 3)], "Floor")
    detail(doc, "FloorDetail", "FloorDetail", (E0 + 23, N0 + 1),
           {"FLOORNUMBER": "F2", "BUILDINGNUMBER": "1", "FLOORHEIGHT": "3.6"})
    assert ids(brun(doc), "ERROR")["DRM-SPEC-ONEFLOOR"] >= 1
