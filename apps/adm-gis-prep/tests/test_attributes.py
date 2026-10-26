"""Attribute-block checks (spec §4.5, §6) and Services-specific rules."""
from __future__ import annotations

import pytest

from m4adm import fixtures as fx
from m4adm.fixtures import E0, N0, PLOT_VALUES, detail, new_doc, poly, square, title

from conftest import findings, rule_ids


def _plot_with(manifest, values=None, block="PlotDetail", mutate=None):
    doc = new_doc(manifest, ("plot",))
    title(doc)
    poly(doc, square(E0, N0, 30), "Plot")
    ref = detail(doc, block, "PlotDetail", (E0 + 15, N0 + 15), values if values is not None else PLOT_VALUES)
    if mutate:
        mutate(ref)
    return doc


def test_domain_values_are_case_sensitive(run, manifest):
    res = run(_plot_with(manifest, {**PLOT_VALUES, "UsageCategoryType": "Residential"}))
    f = findings(res, "ADM-ATT-004")
    assert f and "did you mean 'residential'" in f[0]["message"]


def test_usage_type_must_belong_to_category(run, manifest):
    res = run(_plot_with(manifest, {**PLOT_VALUES, "UsageType": "mall"}))  # mall is commercial, not residential
    assert findings(res, "ADM-ATT-009")
    res = run(_plot_with(manifest, {**PLOT_VALUES, "UsageCategoryType": "commercial", "UsageType": "mall"}))
    assert not findings(res, "ADM-ATT-009")


def test_mandatory_empty_and_missing_tags(run, manifest):
    res = run(_plot_with(manifest, {**PLOT_VALUES, "PlotNumber": "  "}))
    assert any("PlotNumber is empty" in f["message"] for f in findings(res, "ADM-ATT-003"))
    res = run(_plot_with(manifest, mutate=lambda ref: ref.delete_attrib("SectorNumber")))
    assert any("SectorNumber is missing" in f["message"] for f in findings(res, "ADM-ATT-003"))


def test_extra_tag_and_wrong_block_name(run, manifest):
    res = run(_plot_with(manifest, mutate=lambda ref: ref.add_attrib("OWNER", "x", (E0, N0))))
    assert any(f["details"].get("tag") == "OWNER" for f in findings(res, "ADM-ATT-002"))
    res = run(_plot_with(manifest, values={"SectorNumber": "1", "SectorNameEnglish": "A", "SectorNameArabic": "ب"},
                         block="SectorDetail"))
    assert findings(res, "ADM-ATT-013")


def _roads_doc(manifest):
    doc = new_doc(manifest, ("roads",))
    title(doc)
    return doc


def test_numeric_types_and_conditional_and_length(run, manifest):
    doc = _roads_doc(manifest)
    poly(doc, square(E0, N0, 30), "ParkingArea")
    detail(doc, "ParkingAreaDetail", "ParkingAreaDetail", (E0 + 15, N0 + 15),
           {"Medium": "surface", "RoadSurfaceType": "tarmac", "NumOfParkings": "ten", "ParkingFor": "Car",
            "ParkingBayType": "parallel"})
    poly(doc, square(E0 + 40, N0, 30), "RoadHump")
    detail(doc, "RoadHumpDetail", "RoadHumpDetail", (E0 + 55, N0 + 15),
           {"GroundLevelHeight": "1.2.3", "RoadHumpType": "hump"})
    poly(doc, [(E0, N0 - 10), (E0 + 60, N0 - 10)], "RoadCenterLine", closed=False)
    detail(doc, "RoadCentreLineDetail", "RoadCenterLineDetail", (E0, N0 - 10),
           {"Medium": "surface", "RoadSurfaceType": "tarmac", "RoadType": "street",
            "RoadNameEnglish": "Khalifa Street", "RoadNameArabic": ""})
    poly(doc, [(E0, N0 - 30), (E0 + 60, N0 - 30)], "RailRoadCenterline", closed=False)
    detail(doc, "RailRoadCenterlineDetail", "RailRoadCenterlineDetail", (E0, N0 - 30),
           {"Type": "tram", "Medium": "surface", "TrackNumber": "TRK-0000000001"})
    res = run(doc, ["roads"])
    ids = rule_ids(res, "ERROR")
    assert ids["ADM-ATT-005"] == 2      # integer and float
    assert ids["ADM-ATT-007"] == 1      # RoadNameArabic required once English is given
    assert ids["ADM-ATT-008"] == 1      # TrackNumber > 10 characters


@pytest.mark.parametrize("value,severity", [("05-DEC-2013", None), ("05-Dec-2013", "WARNING"),
                                            ("2013-12-05", "ERROR"), ("31-FEB-2024", "ERROR")])
def test_date_format(run, manifest, value, severity):
    doc = new_doc(manifest, ("services",))
    title(doc)
    poly(doc, square(E0, N0, 20), "ServiceWorkArea")
    detail(doc, "ServiceWorkAreaDetail", "ServiceWorkAreaDetail", (E0 + 10, N0 + 10),
           {"ExpectedStartDate": value, "ExpectedEndDate": "05-DEC-2025", "WorkAreaFor": "Telecom"})
    res = run(doc, ["services"])
    sev = {f["severity"] for f in findings(res, "ADM-ATT-006")}
    assert sev == ({severity} if severity else set())


def test_each_polygon_needs_exactly_one_block(run, manifest):
    doc = _plot_with(manifest)
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 5, N0 + 5), {**PLOT_VALUES, "PlotNumber": "dup"})
    poly(doc, square(E0 + 40, N0, 10), "Plot")
    res = run(doc)
    msgs = [f["message"] for f in findings(res, "ADM-ATT-001")]
    assert any("has 2 PlotDetail" in m for m in msgs) and any("has no PlotDetail" in m for m in msgs)


def test_attribute_on_boundary_is_warning(run, manifest):
    doc = new_doc(manifest, ("plot",))
    title(doc)
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0, N0 + 10), PLOT_VALUES)
    res = run(doc)
    assert findings(res, "ENG-GEO-008") and not findings(res, "ADM-CAP-006")


def test_title_block_required_and_needs_a_name(run, manifest):
    doc = new_doc(manifest, ("plot",))
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)
    res = run(doc)
    assert findings(res, "ADM-TTL-001")
    doc = new_doc(manifest, ("plot",))
    title(doc, consultant="", contractor="")
    res = run(doc)
    assert any(f["handle"] for f in findings(res, "ADM-TTL-002"))


def test_text_outside_title_is_error_inside_title_allowed(run, manifest):
    doc = fx.valid_plot(manifest)
    doc.modelspace().add_text("PROJECT TITLE", dxfattribs={"layer": "Title", "insert": (E0 - 45, N0 - 45)})
    doc.modelspace().add_text("PLOT 1", dxfattribs={"layer": "Plot", "insert": (E0 + 5, N0 + 5)})
    res = run(doc)
    f = findings(res, "ADM-ATT-010")
    assert len(f) == 1 and f[0]["layer"] == "Plot"


# --------------------------------------------------------------------------- services
def _services(manifest, corridor):
    doc = new_doc(manifest, ("plot", "services"))
    title(doc)
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)
    poly(doc, corridor, "ServiceCorridor")
    cx = sum(p[0] for p in corridor) / 4
    cy = sum(p[1] for p in corridor) / 4
    detail(doc, "ServiceCorridorDetail", "ServiceCorridorDetail", (cx, cy),
           {"CorridorType": "roadServiceReservation", "CorridorWidth": "5"})
    return doc


def test_corridor_overlapping_plot_is_error_touching_is_allowed(run, manifest):
    res = run(_services(manifest, [(E0 + 25, N0 - 5), (E0 + 60, N0 - 5), (E0 + 60, N0), (E0 + 25, N0 + 3)]),
              ["plot", "services"])
    assert findings(res, "ADM-SRV-002")
    res = run(_services(manifest, [(E0, N0 - 5), (E0 + 30, N0 - 5), (E0 + 30, N0), (E0, N0)]),
              ["plot", "services"])
    assert not findings(res, "ADM-SRV-002")


def test_services_without_plot_geometry_warns(run, manifest):
    doc = new_doc(manifest, ("services",))
    title(doc)
    poly(doc, square(E0, N0, 10), "ServiceCorridor")
    res = run(doc, ["services"])
    assert findings(res, "ADM-SRV-001")


def test_plot_layer_used_for_corridor_check_even_if_plot_not_selected(run, manifest):
    doc = _services(manifest, [(E0 + 25, N0 - 5), (E0 + 60, N0 - 5), (E0 + 60, N0 + 3), (E0 + 25, N0 + 3)])
    res = run(doc, ["services"])
    assert findings(res, "ADM-SRV-002") and not findings(res, "ADM-SRV-001")


def test_borehole_must_be_inside_activity_area(run, manifest):
    doc = new_doc(manifest, ("services",))
    title(doc)
    bh = {"WaterTableDepth": "3.2", "WaterTableLevel": "1.1", "GroundLevel": "4.3", "AsphaltLevel": "4.5"}
    detail(doc, "Borehole", "BoreHole", (E0, N0), bh)
    res = run(doc, ["services"])
    assert any("no ServiceActivityArea" in f["message"] for f in findings(res, "ADM-ATT-012"))
    poly(doc, square(E0 + 10, N0 + 10, 10), "ServiceActivityArea")
    detail(doc, "Borehole", "BoreHole", (E0 + 15, N0 + 15), bh)
    res = run(doc, ["services"])
    f = findings(res, "ADM-ATT-012")
    assert len(f) == 1 and f[0]["location"] == [E0, N0]


def test_reserved_strip_outside_corridor(run, manifest):
    doc = _services(manifest, [(E0, N0 - 10), (E0 + 30, N0 - 10), (E0 + 30, N0), (E0, N0)])
    poly(doc, square(E0 + 100, N0, 2), "ReservedStrip")
    res = run(doc, ["plot", "services"])
    assert findings(res, "ENG-SRV-003")
