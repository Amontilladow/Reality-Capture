"""Mapping decisions: deterministic only when unambiguous; everything else is queued."""
from __future__ import annotations

import ezdxf

from m4adm import fixtures as fx
from m4adm.classify import classify_layout
from m4adm.fixtures import E0, N0, PLOT_VALUES, detail, new_doc, poly, square, title
from m4adm.mapping import EXCLUDE, build_mapping

from conftest import findings


def _decisions(manifest, doc, categories, layer_mapping=None, handle_mapping=None):
    res = build_mapping(classify_layout(doc), manifest, categories, layer_mapping or {}, handle_mapping or {})
    return {d.source_layer: d for d in res.decisions}, res


def test_exact_alias_case_and_unknown(manifest):
    doc = new_doc(manifest, ("roads",), spec_layers=False)
    for name in ("RoadEdge", "RoadCentreLine", "roadedgedetail", "Underpass", "EDGE-OF-ROAD"):
        poly(doc, [(0, 0), (1, 0)], name, closed=False)
    d, _ = _decisions(manifest, doc, ["roads"])
    assert d["RoadEdge"].status == "VERIFIED_NAME"
    assert (d["RoadCentreLine"].status, d["RoadCentreLine"].target_layer) == ("ALIAS", "RoadCenterLine")
    assert (d["roadedgedetail"].status, d["roadedgedetail"].target_layer) == ("CASE_VARIANT", "RoadEdgeDetail")
    assert d["Underpass"].target_layer == "UnderPass"
    assert d["EDGE-OF-ROAD"].status == "UNRESOLVED" and d["EDGE-OF-ROAD"].target_layer is None


def test_meaning_is_never_taken_from_colour(manifest):
    doc = new_doc(manifest, ("plot",), spec_layers=False)
    doc.layers.add("BOUNDARY", color=51)  # same colour as the ADM Plot layer
    poly(doc, square(0, 0, 10), "BOUNDARY", color=51)
    d, _ = _decisions(manifest, doc, ["plot"])
    assert d["BOUNDARY"].status == "UNRESOLVED"


def test_suggestions_are_hints_only(manifest):
    doc = new_doc(manifest, ("roads",), spec_layers=False)
    poly(doc, [(0, 0), (1, 0)], "Road_Edge", closed=False)
    d, res = _decisions(manifest, doc, ["roads"])
    assert "RoadEdge" in d["Road_Edge"].suggestions
    assert all(t is None for t in res.entity_target.values())


def test_other_category_layers_are_out_of_scope(manifest):
    doc = fx.mixed(manifest)
    d, _ = _decisions(manifest, doc, ["plot"])
    assert d["RoadEdge"].status == "OUT_OF_SCOPE"
    assert d["Title"].status == "VERIFIED_NAME"


def test_accepted_layer_mapping_moves_entities_and_is_logged(run, manifest):
    doc = new_doc(manifest, ("plot",))
    title(doc)
    doc.layers.add("C-PLOT-BNDY")
    doc.layers.add("C-PLOT-TAG")
    poly(doc, square(E0, N0, 30), "C-PLOT-BNDY")
    detail(doc, "PlotDetail", "C-PLOT-TAG", (E0 + 15, N0 + 15), PLOT_VALUES)
    res = run(doc)
    assert {d["source_layer"] for d in res.report["review_queue"]["unresolved_layers"]} == {"C-PLOT-BNDY", "C-PLOT-TAG"}
    plot_out = next(o for o in res.report["outputs"] if o["dataset"] == "plot")
    assert plot_out["entities"] == 2  # title border + title block only

    res2 = run(doc, layer_mapping={"C-PLOT-BNDY": "Plot", "C-PLOT-TAG": "PlotDetail"})
    assert res2.status == "Ready for review"
    moved = res2.report["changes"]["layer_mapping"]
    assert {(m["from"], m["to"], m["basis"]) for m in moved} == {
        ("C-PLOT-BNDY", "Plot", "USER_ACCEPTED"), ("C-PLOT-TAG", "PlotDetail", "USER_ACCEPTED")}
    out = next(o["file"] for o in res2.report["outputs"] if o["dataset"] == "plot")
    layers = {e.dxf.layer for e in ezdxf.readfile(str(res2.job_dir / "output" / out)).modelspace()}
    assert layers == {"Plot", "PlotDetail", "Title"}


def test_invalid_user_mapping_is_an_error(run, manifest):
    doc = fx.valid_plot(manifest)
    poly(doc, square(E0 + 100, N0, 5), "MISC")
    res = run(doc, layer_mapping={"MISC": "RoadEdge"})  # roads not selected
    assert any(f["severity"] == "ERROR" for f in findings(res, "USR-MAP-001"))


def test_handle_mapping_can_exclude_single_entity(run, manifest, save):
    doc = fx.valid_plot(manifest)
    extra = poly(doc, square(E0 + 100, N0, 5), "Plot")
    path = save(doc)
    handle = ezdxf.readfile(str(path)).modelspace().query("LWPOLYLINE")[-1].dxf.handle
    assert handle == extra.dxf.handle
    res = run(path, handle_mapping={handle: EXCLUDE})
    plot_out = next(o for o in res.report["outputs"] if o["dataset"] == "plot")
    add_out = next(o for o in res.report["outputs"] if o["dataset"] == "additional")
    assert add_out["entities"] == 1
    assert handle not in {e.dxf.handle for e in ezdxf.readfile(
        str(res.job_dir / "output" / plot_out["file"])).modelspace()}
