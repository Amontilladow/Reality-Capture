"""Drawing-level rules, entity-role edge cases and adapter interfaces."""
from __future__ import annotations

import ezdxf

from m4adm import fixtures as fx
from m4adm.adapters import STATUS_LOADED, STATUS_PENDING, STATUS_UNAVAILABLE, DWGConverter, OfficialQC, OfficialTemplate
from m4adm.fixtures import E0, N0, PLOT_VALUES, detail, new_doc, poly, square, title

from conftest import findings


def test_units_must_be_metres_and_confirmed(run, manifest):
    doc = fx.valid_plot(manifest)
    doc.header["$INSUNITS"] = 4
    doc.header["$LUNITS"] = 4
    res = run(doc, units_confirmed_metres=False)
    assert findings(res, "ADM-UNIT-001") and findings(res, "ADM-UNIT-002")
    assert any(f["blocking"] for f in findings(res, "USR-UNIT-001"))
    out = res.job_dir / "output" / res.report["outputs"][0]["file"]
    assert ezdxf.readfile(str(out)).header["$INSUNITS"] == 4  # not changed without confirmation
    res = run(doc)
    out = res.job_dir / "output" / res.report["outputs"][0]["file"]
    assert ezdxf.readfile(str(out)).header["$INSUNITS"] == 6 and not findings(res, "USR-UNIT-001")


def test_split_into_dataset_files_and_additional(run, manifest):
    res = run(fx.mixed(manifest), ["plot"])
    datasets = [o["dataset"] for o in res.report["outputs"]]
    assert datasets == ["plot", "additional"]                      # ADM-FMT-002 / ADM-FMT-003
    assert findings(res, "ADM-LYR-001") and all(f["severity"] == "INFO" for f in findings(res, "ADM-LYR-001"))
    res = run(fx.mixed(manifest), ["plot", "roads", "services"], metadata={"drawing_type": "MP"})
    assert [o["dataset"] for o in res.report["outputs"]] == ["plot", "roads", "services", "additional"]
    assert findings(res, "ENG-SHARED-001")


def test_dimension_line_layer_holds_dimensions_only(run, manifest):
    doc = fx.valid_plot(manifest)
    poly(doc, [(E0, N0 - 10), (E0 + 30, N0 - 10)], "DimensionLine", closed=False)
    doc.modelspace().add_linear_dim(base=(E0, N0 - 5), p1=(E0, N0), p2=(E0 + 30, N0),
                                    dxfattribs={"layer": "DimensionLine"}).render()
    res = run(doc)
    f = findings(res, "ADM-LYR-003")
    assert len(f) == 1 and f[0]["entity_type"] == "LWPOLYLINE"


def test_alias_layer_is_flagged_pending(run, manifest):
    doc = new_doc(manifest, ("roads",))
    title(doc)
    doc.layers.add("RoadCentreLine")
    poly(doc, [(E0, N0), (E0 + 30, N0)], "RoadCentreLine", closed=False)
    res = run(doc, ["roads"])
    f = findings(res, "ADM-LYR-007")
    assert f and f[0]["evidence"] == "PENDING_OFFICIAL_CONFIRMATION"
    assert res.report["changes"]["layer_mapping"][0]["to"] == "RoadCenterLine"


def test_unused_blocks_reported_and_omitted_from_output(run, manifest, tmp_path):
    doc = fx.valid_plot(manifest)
    path = tmp_path / "SYNTHETIC_unused.dxf"
    doc.blocks.new("OLD_NORTH_ARROW").add_circle((0, 0), 1)
    doc.saveas(str(path))  # saved without fixtures.finish so the unused block stays
    res = run(path)
    assert any("OLD_NORTH_ARROW" in f["message"] for f in findings(res, "ADM-CAP-007B"))
    out = res.job_dir / "output" / res.report["outputs"][0]["file"]
    assert ezdxf.readfile(str(out)).blocks.get("OLD_NORTH_ARROW") is None
    assert "OLD_NORTH_ARROW" in ezdxf.readfile(str(path)).blocks  # source untouched


def test_insert_of_missing_block_is_proxy_rule(run, manifest):
    doc = fx.valid_plot(manifest)
    doc.modelspace().add_blockref("NOT_DEFINED", (E0 + 5, N0 + 5), dxfattribs={"layer": "Plot"})
    res = run(doc)
    f = findings(res, "ADM-CAP-010")
    assert f and f[0]["severity"] == "ERROR" and "left it out" in f[0]["message"]
    assert res.report["changes"]["reader_removed"]
    import json
    log = json.loads((res.job_dir / "geometry_log.json").read_text())
    assert any("removed by the DXF reader" in r["reason"] for r in log["rejected_from_adm_files"])


def test_data_entry_heuristics(run, manifest):
    doc = new_doc(manifest, ("plot",))
    title(doc, consultant="شركة")
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), {**PLOT_VALUES, "PlotNumber": "P-001!!"})
    poly(doc, [(E0 - 5, N0 - 5), (E0 + 35, N0 - 5), (E0 + 35, N0 + 35), (E0 - 5, N0 + 35)], "Sector")
    detail(doc, "SectorDetail", "SectorDetail", (E0 + 33, N0 + 33),
           {"SectorNumber": "S1", "SectorNameEnglish": "Sector One", "SectorNameArabic": "Sector One"})
    res = run(doc)
    msgs = " ".join(f["message"] for f in findings(res, "ADM-ATT-011"))
    assert "special or repeated" in msgs and "no Arabic script" in msgs
    assert findings(res, "ADM-TTL-003")


def test_engineering_geometry_checks(run, manifest):
    doc = fx.valid_plot(manifest)
    msp = doc.modelspace()
    msp.add_lwpolyline(square(-E0 - 100, N0 + 100, 10), close=True,
                       dxfattribs={"layer": "Plot", "extrusion": (0, 0, -1)})     # mirrored OCS
    poly(doc, [(E0 + 100, N0), (E0 + 100, N0), (E0 + 110, N0), (E0 + 120, N0)], "Plot")  # repeated + no area
    msp.add_point((E0 + 2, N0 + 2), dxfattribs={"layer": "Plot"})
    doc.layouts.get("Layout1").add_line((0, 0), (1, 1))
    res = run(doc)
    assert findings(res, "ENG-GEO-002")
    assert findings(res, "ENG-GEO-004")
    assert findings(res, "ENG-GEO-007")
    assert any(f["entity_type"] == "POINT" for f in findings(res, "ENG-GEO-005"))
    assert findings(res, "ENG-GEO-006")[0]["severity"] == "INFO"


def test_declared_adm_crs_with_implausible_extents(run, manifest):
    res = run(fx.unknown_crs(manifest))  # declared EPSG:32640 but local coordinates
    assert findings(res, "ENG-CRS-003") and findings(res, "ADM-CRS-002")


def test_template_adapter_pending_and_comparison(manifest, tmp_path):
    cmp = OfficialTemplate(None).compare(manifest, "plot")
    assert cmp.status == STATUS_PENDING  # PND-TPL-001
    tpl = fx.new_doc(manifest, ("plot",))
    tpl.layers.get("Zone").color = 1
    tpl.layers.add("TemplateOnly")
    path = tmp_path / "SYNTHETIC_template.dxf"
    tpl.saveas(str(path))
    cmp = OfficialTemplate(path).compare(manifest, "plot")
    assert cmp.status == STATUS_LOADED
    assert any("Zone: colour 1" in d for d in cmp.layer_property_differences)
    assert "TemplateOnly" in cmp.extra_layers and not cmp.missing_blocks


def test_official_qc_and_dwg_converter_are_not_claimed(monkeypatch, tmp_path):
    assert OfficialQC.availability() == STATUS_UNAVAILABLE  # PND-QC-001
    monkeypatch.delenv("M4ADM_ODA_CONVERTER", raising=False)
    conv = DWGConverter(None)
    assert conv.status() == STATUS_UNAVAILABLE
    try:
        conv.convert(tmp_path, tmp_path, "DWG", "*.DXF")
        raise AssertionError("conversion must refuse when no converter is installed")
    except RuntimeError as exc:
        assert "unavailable" in str(exc)
    cmd = DWGConverter("/opt/oda/ODAFileConverter").command(tmp_path, tmp_path / "o", "DWG")
    assert cmd[3:6] == ["ACAD2010", "DWG", "0"]


def test_output_verification_detects_incomplete_file(tmp_path, manifest):
    # ENG-FILE-001: an output whose re-read handle set differs is reported as not verified
    from m4adm.export import verify_output
    path = tmp_path / "SYNTHETIC_out.dxf"
    fx.finish(fx.valid_plot(manifest)).saveas(str(path))
    handles = {e.dxf.handle for e in ezdxf.readfile(str(path)).modelspace()}
    assert verify_output(path, handles)["ok"]
    bad = verify_output(path, handles | {"FFFF"})
    assert not bad["ok"] and bad["missing_handles"] == ["FFFF"]
