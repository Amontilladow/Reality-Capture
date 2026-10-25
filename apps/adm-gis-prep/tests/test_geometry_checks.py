"""Geometry checks (spec §5) on synthetic drawings, including tolerance boundary cases."""
from __future__ import annotations

import math

import pytest

from m4adm import fixtures as fx
from m4adm.fixtures import E0, N0, PLOT_VALUES, detail, new_doc, poly, square, title
from m4adm.geometry import arc_points, densify_xyb

from conftest import findings, rule_ids


# --------------------------------------------------------------------------- fixtures (spec H2)
@pytest.mark.parametrize("name,cats,expected", [
    ("valid_plot", ["plot"], set()),
    ("open_polygon", ["plot"], {"ADM-LYR-006"}),
    ("self_intersecting", ["plot"], {"ADM-CAP-001F"}),
    ("zero_length", ["roads"], {"ADM-CAP-001B"}),
    ("duplicate_geometry", ["plot"], {"ADM-CAP-001G"}),
    ("attribute_outside", ["plot"], {"ADM-CAP-006", "ADM-ATT-001"}),
    ("unsupported_3d", ["plot"], {"ADM-CAP-009", "ADM-CAP-008"}),
    ("prohibited_entities", ["plot", "roads"], {"ADM-CAP-007", "ADM-CAP-005", "ADM-ATT-010"}),
    ("fixable", ["plot"], {"ADM-LYR-006", "ADM-CAP-003"}),
])
def test_fixture_errors(run, manifest, name, cats, expected):
    res = run(fx.ALL[name](manifest), cats)
    errors = set(rule_ids(res, "ERROR"))
    assert expected <= errors, f"missing {expected - errors}; got {errors}"
    if not expected:
        assert not errors and res.status == "Ready for review"
    else:
        assert res.status == "Blocked by errors"


def test_valid_fixture_has_no_warnings(run, manifest):
    res = run(fx.valid_plot(manifest))
    assert rule_ids(res, "WARNING") == {}


def test_ambiguous_lines_are_queued_not_classified(run, manifest):
    res = run(fx.ambiguous_line(manifest), ["roads"])
    queued = {d["source_layer"] for d in res.report["review_queue"]["unresolved_layers"]}
    assert {"C-ROAD-EDGE", "KERB", "0"} <= queued
    assert res.report["changes"]["layer_mapping"] == []
    assert all(o["entities"] == 2 for o in res.report["outputs"] if o["dataset"] == "roads")  # title only


def test_prohibited_entity_types_individually(run, manifest):
    res = run(fx.prohibited_entities(manifest), ["plot", "roads"])
    by_type = {(f["rule_id"], f["entity_type"]) for f in res.report["findings"]}
    for t in ("LINE", "XLINE", "SOLID", "HATCH"):
        assert ("ADM-CAP-007", t) in by_type
    for t in ("ARC", "SPLINE", "ELLIPSE"):
        assert ("ADM-CAP-005", t) in by_type
    assert ("ENG-GEO-001", "CIRCLE") in by_type
    assert any(f["rule_id"] == "ADM-CAP-007" and "group" in f["message"] for f in res.report["findings"])


def test_polyline_structures_are_distinguished(run, manifest):
    doc = new_doc(manifest, ("plot",))
    title(doc)
    msp = doc.modelspace()
    msp.add_polyline2d(square(E0, N0, 30), close=True, dxfattribs={"layer": "Plot"})
    msp.add_polyline3d([(E0 + 40, N0, 0), (E0 + 70, N0, 0), (E0 + 70, N0 + 30, 0)], close=True,
                       dxfattribs={"layer": "Plot"})
    mesh = msp.add_polymesh((2, 2), dxfattribs={"layer": "Plot"})
    for i, (m, n) in enumerate([(0, 0), (0, 1), (1, 0), (1, 1)]):
        mesh.set_mesh_vertex((m, n), (E0 + 80 + m, N0 + n, 0))
    res = run(doc)
    types = {(f["rule_id"], f["entity_type"]) for f in res.report["findings"]}
    assert ("ADM-CAP-003", "POLYLINE2D") in types       # wrong polyline type, not "prohibited"
    assert ("ADM-CAP-009", "POLYLINE3D") in types
    assert ("ADM-CAP-009", "POLYMESH") in types


def test_attribute_inserts_evaluated_by_role(run, manifest):
    doc = fx.valid_plot(manifest)
    detail(doc, "PlotDetail", "Plot", (E0 + 10, N0 + 10), PLOT_VALUES)  # block on the geometry layer
    res = run(doc)
    lyr5 = findings(res, "ADM-LYR-005")
    assert len(lyr5) == 1 and lyr5[0]["layer"] == "Plot"
    assert not any(f["rule_id"] == "ADM-CAP-007" and f["entity_type"] == "INSERT" for f in res.report["findings"])


# --------------------------------------------------------------------------- tolerance boundaries
def _two_plots(manifest, d):
    doc = new_doc(manifest, ("plot",))
    title(doc)
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)
    poly(doc, [(E0 + 30 + d, N0), (E0 + 60, N0), (E0 + 60, N0 + 30), (E0 + 30, N0 + 30)], "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 45, N0 + 15), {**PLOT_VALUES, "PlotNumber": "P-2"})
    return doc


@pytest.mark.parametrize("d,flagged", [(0.0009, False), (0.002, True), (0.049, True), (0.06, False)])
def test_snapping_tolerance_boundaries(run, manifest, d, flagged):
    res = run(_two_plots(manifest, d))
    assert bool(findings(res, "ADM-CAP-001D")) is flagged
    assert res.report["tolerances"]["coincidence"] == 0.001 and res.report["tolerances"]["snap_search"] == 0.05


def test_tolerances_are_configurable(run, manifest):
    tol = {**manifest.tolerances.model_dump(), "coincidence": 0.005}
    res = run(_two_plots(manifest, 0.002), tolerances=tol)
    assert not findings(res, "ADM-CAP-001D")
    assert res.report["tolerances"]["coincidence"] == 0.005


@pytest.mark.parametrize("length,flagged", [(0.0005, True), (0.001, True), (0.002, False)])
def test_zero_length_boundary(run, manifest, length, flagged):
    doc = new_doc(manifest, ("roads",))
    title(doc)
    poly(doc, [(E0, N0), (E0 + length, N0)], "RoadEdge", closed=False)
    res = run(doc, ["roads"])
    assert bool(findings(res, "ADM-CAP-001B")) is flagged


@pytest.mark.parametrize("gap,proposal", [(0.0, True), (0.0009, True), (0.01, False)])
def test_closure_gap_boundary(run, manifest, gap, proposal):
    doc = new_doc(manifest, ("plot",))
    title(doc)
    poly(doc, square(E0, N0, 30) + [(E0 + gap, N0)], "Plot", closed=False)
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)
    res = run(doc)
    assert findings(res, "ADM-LYR-006")
    kinds = {p["kind"] for p in res.report["review_queue"]["fix_proposals"]}
    assert ("CLOSE_FLAG" in kinds) is proposal


# --------------------------------------------------------------------------- polygon topology
def test_overlapping_polygons(run, manifest):
    doc = _two_plots(manifest, 0.0)
    poly(doc, [(E0 + 25, N0 + 40), (E0 + 60, N0 + 40), (E0 + 60, N0 + 70), (E0 + 25, N0 + 70)], "Plot")
    poly(doc, square(E0, N0 + 40, 30), "Plot")
    res = run(doc)
    ov = findings(res, "ADM-CAP-001C")
    assert len(ov) == 1 and math.isclose(ov[0]["details"]["overlap_area"], 150.0)


def test_island_is_error_but_tobeclipped_pavement_is_review(run, manifest):
    doc = fx.valid_plot(manifest)
    poly(doc, square(E0 + 5, N0 + 5, 5), "Plot")
    res = run(doc)
    assert any(f["severity"] == "ERROR" for f in findings(res, "ADM-CAP-004"))

    doc = new_doc(manifest, ("roads",))
    title(doc)
    pav = {"Medium": "surface", "PavementType": "tiled", "AccessType": "public"}
    poly(doc, square(E0, N0, 30), "Pavement")
    detail(doc, "PavementDetail", "PavementDetail", (E0 + 2, N0 + 2), {**pav, "ToBeClipped": "No"})
    poly(doc, square(E0 + 10, N0 + 10, 5), "Pavement")
    detail(doc, "PavementDetail", "PavementDetail", (E0 + 12, N0 + 12), {**pav, "ToBeClipped": "Yes"})
    res = run(doc, ["roads"])
    isl = findings(res, "ADM-CAP-004")
    assert len(isl) == 1 and isl[0]["severity"] == "WARNING"


def test_vertex_snapped_on_edge(run, manifest):
    doc = new_doc(manifest, ("plot",))
    title(doc)
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)
    # neighbour has a vertex in the middle of the shared edge (T-junction)
    poly(doc, [(E0 + 30, N0), (E0 + 60, N0), (E0 + 60, N0 + 15), (E0 + 30, N0 + 15)], "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 45, N0 + 7), {**PLOT_VALUES, "PlotNumber": "P-2"})
    res = run(doc)
    edge = findings(res, "ADM-CAP-002")
    assert edge and edge[0]["location"] == [E0 + 30, N0 + 15]


# --------------------------------------------------------------------------- linear topology
def _roads(manifest, *lines):
    doc = new_doc(manifest, ("roads",))
    title(doc)
    for pts in lines:
        poly(doc, pts, "RoadEdge", closed=False)
    return doc


def test_undershoot(run, manifest):
    res = run(_roads(manifest, [(E0, N0), (E0 + 50, N0)], [(E0 + 25, N0 + 20), (E0 + 25, N0 + 0.02)]), ["roads"])
    us = [f for f in findings(res, "ADM-CAP-001A") if "Undershoot" in f["message"]]
    assert us and math.isclose(us[0]["details"]["gap"], 0.02, abs_tol=1e-9)


def test_overshoot(run, manifest):
    res = run(_roads(manifest, [(E0, N0), (E0 + 50, N0)], [(E0 + 25, N0 + 20), (E0 + 25, N0 - 0.03)]), ["roads"])
    assert any("Overshoot" in f["message"] for f in findings(res, "ADM-CAP-001A"))


def test_crossing_without_vertex_and_noded_crossing(run, manifest):
    res = run(_roads(manifest, [(E0, N0), (E0 + 50, N0)], [(E0 + 25, N0 + 20), (E0 + 25, N0 - 20)]), ["roads"])
    assert findings(res, "ADM-CAP-001E")
    res = run(_roads(manifest, [(E0, N0), (E0 + 25, N0), (E0 + 50, N0)],
                     [(E0 + 25, N0 + 20), (E0 + 25, N0), (E0 + 25, N0 - 20)]), ["roads"])
    assert not findings(res, "ADM-CAP-001E") and not findings(res, "ADM-CAP-001A")


def test_linear_attribute_block_on_vertex_rules(run, manifest):
    vals = {"Medium": "surface", "RoadSurfaceType": "tarmac"}
    doc = _roads(manifest, [(E0, N0), (E0 + 25, N0), (E0 + 50, N0)],
                 [(E0 + 25, N0 + 20), (E0 + 25, N0), (E0 + 25, N0 - 20)],
                 [(E0, N0 + 40), (E0 + 50, N0 + 40)])
    detail(doc, "RoadEdgeDetail", "RoadEdgeDetail", (E0 + 25, N0), vals)        # on the shared vertex
    detail(doc, "RoadEdgeDetail", "RoadEdgeDetail", (E0, N0 + 40), vals)        # fine
    detail(doc, "RoadEdgeDetail", "RoadEdgeDetail", (E0 + 50, N0 + 40), vals)   # second block on same line
    res = run(doc, ["roads"])
    msgs = [f["message"] for f in findings(res, "ADM-CAP-006B")]
    assert any("shared by 2 lines" in m for m in msgs)
    assert any("RoadEdgeDetail attribute blocks; one is required" in f["message"] for f in findings(res, "ADM-ATT-001"))


# --------------------------------------------------------------------------- curves
def test_arc_densification_respects_sagitta():
    for bulge in (0.1, 0.4, 1.0, -0.7):
        for sag in (0.001, 0.01, 0.1):
            pts, dev = arc_points((0.0, 0.0), (30.0, 0.0), bulge, sag)
            assert dev <= sag + 1e-12
            # every generated point lies on the true arc
            r = 30 / (2 * math.sin(abs(4 * math.atan(bulge)) / 2))
            from ezdxf.math import bulge_center
            c = bulge_center((0, 0), (30, 0), bulge)
            assert all(math.isclose(math.dist(p, (c.x, c.y)), r, rel_tol=1e-9) for p in pts)


def test_densify_keeps_original_vertices():
    raw = [(0.0, 0.0, 0.0), (10.0, 0.0, 0.5), (10.0, 10.0, 0.0), (0.0, 10.0, 0.0)]
    out, dev = densify_xyb(raw, True, 0.01)
    for x, y, _ in raw:
        assert (x, y) in out
    assert dev <= 0.01


def test_curves_are_never_flattened_silently(run, manifest, tmp_path):
    import ezdxf
    res = run(fx.fixable(manifest))
    plot_file = next(o["file"] for o in res.report["outputs"] if o["dataset"] == "plot")
    doc = ezdxf.readfile(str(res.job_dir / "output" / plot_file))
    bulged = [e for e in doc.modelspace().query("LWPOLYLINE") if any(b for *_, b in e.get_points("xyb"))]
    assert len(bulged) == 1, "arc segment must survive unless the DENSIFY_BULGES fix is accepted"
