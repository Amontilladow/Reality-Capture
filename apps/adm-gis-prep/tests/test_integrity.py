"""Safety guarantees: source never changes, outputs are complete and verified, failures never
look like success, every change is audited, and nothing is labelled as ADM approval."""
from __future__ import annotations

import json
import os
import re
import stat

import ezdxf
import pytest

from m4adm import PROVISIONAL_LABEL
from m4adm import fixtures as fx
from m4adm.audit import AuditLog
from m4adm.io import identify, sha256_file
from m4adm.jobs import attach_official_qc, export_package, list_jobs, official_qc_status

from conftest import findings, make_settings

FORBIDDEN = re.compile(r"ADM[- ]compliant|ADM[- ]approved|passed ADM QC|\bapproved by ADM\b", re.I)


def _msp_signature(path):
    doc = ezdxf.readfile(str(path))
    return sorted((e.dxftype(), e.dxf.handle, e.dxf.get("layer")) for e in doc.modelspace())


@pytest.mark.parametrize("name", sorted(fx.ALL))
def test_failed_checks_never_touch_the_source(run, manifest, save, name):
    path = save(fx.ALL[name](manifest), f"SYNTHETIC_{name}.dxf")
    before_hash, before_sig, before_mtime = sha256_file(path), _msp_signature(path), path.stat().st_mtime_ns
    res = run(path, ["plot", "roads", "services"], metadata={"drawing_type": "MP"},
              accepted_fixes=["all:CLOSE_FLAG", "all:TO_LWPOLYLINE", "all:DENSIFY_BULGES", "all:BYLAYER"])
    assert sha256_file(path) == before_hash
    assert _msp_signature(path) == before_sig
    assert path.stat().st_mtime_ns == before_mtime
    assert res.report["source"]["unchanged"] is True
    assert res.report["source"]["sha256_before"] == res.report["source"]["sha256_after"] == before_hash


def test_input_copy_is_read_only_and_identical(run, manifest, save):
    path = save(fx.valid_plot(manifest))
    res = run(path)
    copy = res.job_dir / res.report["source"]["path"]
    assert sha256_file(copy) == sha256_file(path)
    assert not os.stat(copy).st_mode & stat.S_IWUSR


def test_entities_conserved_across_outputs(run, manifest, save):
    path = save(fx.mixed(manifest))
    res = run(path, ["plot"])
    source_handles = {h for _, h, _ in _msp_signature(path)}
    out_handles = set()
    for o in res.report["outputs"]:
        assert o["verification"]["ok"]
        out_handles |= {e.dxf.handle for e in ezdxf.readfile(str(res.job_dir / "output" / o["file"])).modelspace()}
    assert out_handles == source_handles, "every source entity is in exactly one place (ADM file or additional)"


def test_outputs_are_r2010_and_labelled_provisional(run, manifest):
    res = run(fx.valid_plot(manifest))
    for o in res.report["outputs"]:
        p = res.job_dir / "output" / o["file"]
        assert identify(p).version_code == "AC1024"
        doc = ezdxf.readfile(str(p))
        assert doc.header.custom_vars.get("M4ADM_STATUS") == PROVISIONAL_LABEL
        assert doc.header.custom_vars.get("M4ADM_SPEC_VERSION") == "1.18.2"
        assert p.name.endswith(".dxf") and p.stem == "P101_20261025_AP_Plot_ADM"


def test_layer_table_normalised_in_output_only(run, manifest, save):
    doc = fx.valid_plot(manifest)
    doc.layers.get("Plot").color = 1
    path = save(doc)
    res = run(path)
    assert any("colour 1" in f["message"] for f in findings(res, "ADM-LYR-002"))
    out = res.job_dir / "output" / res.report["outputs"][0]["file"]
    assert ezdxf.readfile(str(out)).layers.get("Plot").color == 51
    assert ezdxf.readfile(str(path)).layers.get("Plot").color == 1


def test_fixes_only_when_accepted_and_logged(run, manifest, save):
    path = save(fx.fixable(manifest))
    res = run(path)
    assert res.report["changes"]["fixes"] == []
    ids = [p["id"] for p in res.report["review_queue"]["fix_proposals"]]
    assert {i.split(":")[0] for i in ids} == {"CLOSE_FLAG", "TO_LWPOLYLINE", "DENSIFY_BULGES", "BYLAYER"}

    res2 = run(path, accepted_fixes=ids, parent_job=res.job_id)
    applied = {a["kind"]: a for a in res2.report["changes"]["fixes"]}
    assert set(applied) == {"CLOSE_FLAG", "TO_LWPOLYLINE", "DENSIFY_BULGES", "BYLAYER"}
    assert applied["CLOSE_FLAG"]["max_shape_change_m"] == 0.0
    assert applied["DENSIFY_BULGES"]["max_shape_change_m"] <= res2.report["tolerances"]["arc_sagitta"]
    assert applied["TO_LWPOLYLINE"]["source_handle"] != applied["TO_LWPOLYLINE"]["handle"]
    assert not findings(res2, "ADM-LYR-006") and not findings(res2, "ADM-CAP-003")
    assert not findings(res2, "ADM-CAP-005B") and not findings(res2, "ENG-GEO-003")
    assert res2.status == "Ready for review"
    events = [e["event"] for e in AuditLog.read(res2.job_dir / "audit.jsonl")]
    assert events.count("fix_applied") == 4
    log = json.loads((res2.job_dir / "geometry_log.json").read_text())
    assert len([m for m in log["modified"] if "fix" in m]) == 4


def test_failure_never_looks_like_success(tmp_path, manifest, save, monkeypatch):
    import m4adm.pipeline as pl

    def boom(*a, **k):
        raise RuntimeError("disk full (simulated)")

    monkeypatch.setattr(pl, "build_output", boom)
    path = save(fx.valid_plot(manifest))
    with pytest.raises(RuntimeError):
        pl.prepare(path, make_settings(), tmp_path / "jobs", manifest)
    dirs = [p.name for p in (tmp_path / "jobs").iterdir()]
    assert len(dirs) == 1 and dirs[0].endswith(".failed")
    failed = tmp_path / "jobs" / dirs[0]
    assert (failed / "error.json").exists() and not (failed / "qc_report.json").exists()
    assert list((failed / "output").glob("*.dxf")) == []
    assert "job_failed" in [e["event"] for e in AuditLog.read(failed / "audit.jsonl")]
    assert list_jobs(tmp_path / "jobs")[0]["status"].startswith("Failed")


def test_no_temp_files_left_behind(run, manifest):
    res = run(fx.mixed(manifest), ["plot", "roads", "services"], metadata={"drawing_type": "MP"})
    assert not [p for p in res.job_dir.rglob("*") if ".tmp-" in p.name or p.name.endswith(".partial")]
    assert not list(res.job_dir.parent.glob("*.partial"))


def test_audit_trail_records_every_stage(run, manifest):
    res = run(fx.mixed(manifest), ["plot", "roads", "services"], metadata={"drawing_type": "MP"})
    events = [e["event"] for e in AuditLog.read(res.job_dir / "audit.jsonl")]
    for ev in ("job_started", "source_copied", "format_identified", "entities_classified",
               "prepared_full_written", "output_written", "source_integrity_checked", "job_completed"):
        assert ev in events
    first = AuditLog.read(res.job_dir / "audit.jsonl")[0]
    assert first["spec_version"] == "1.18.2" and len(first["manifest_sha256"]) == 64


def test_processing_manifest_contents(run, manifest):
    res = run(fx.valid_plot(manifest))
    pm = json.loads((res.job_dir / "processing_manifest.json").read_text())
    assert pm["label"] == PROVISIONAL_LABEL and pm["spec_version"] == "1.18.2"
    assert pm["source"]["unchanged_after_run"] is True and len(pm["source"]["sha256"]) == 64
    assert all(len(o["sha256"]) == 64 and o["verified"] for o in pm["outputs"])
    assert "settings" in pm and "warnings" in pm and "errors" in pm


def test_never_claims_adm_approval(run, manifest):
    for name in ("valid_plot", "mixed"):
        res = run(fx.ALL[name](manifest), ["plot", "roads", "services"], metadata={"drawing_type": "MP"})
        for f in res.job_dir.rglob("*"):
            if f.suffix in (".json", ".html", ".txt", ".jsonl", ".dxf"):
                assert not FORBIDDEN.search(f.read_text(encoding="utf-8", errors="ignore")), f
        assert res.report["status"]["official_qc"] == "Official QC not yet performed"
        assert PROVISIONAL_LABEL in (res.job_dir / "qc_report.html").read_text(encoding="utf-8")


def test_export_requires_acknowledgement_and_is_audited(run, manifest):
    res = run(fx.valid_plot(manifest))
    with pytest.raises(PermissionError):
        export_package(res.job_dir, "Eng. A", False)
    with pytest.raises(PermissionError):
        export_package(res.job_dir, " ", True)
    pkg = export_package(res.job_dir, "Eng. A", True)
    import zipfile
    names = zipfile.ZipFile(pkg).namelist()
    assert "PROVISIONAL_NOT_ADM-VALIDATED.txt" in names and any(n.startswith("output/") for n in names)
    assert "exported" in [e["event"] for e in AuditLog.read(res.job_dir / "audit.jsonl")]


def test_official_qc_status_only_from_attached_output(run, manifest, tmp_path):
    res = run(fx.valid_plot(manifest))
    assert official_qc_status(res.job_dir)["status"] == "NOT_PERFORMED"
    with pytest.raises(ValueError):
        attach_official_qc(res.job_dir, tmp_path / "x.txt", "maybe", "Eng. A")
    rep = tmp_path / "qc_output.txt"
    rep.write_text("output of official tool (synthetic test stand-in)")
    attach_official_qc(res.job_dir, rep, "failed", "Eng. A")
    st = official_qc_status(res.job_dir)
    assert st["status"] == "FAILED" and st["report_sha256"] == sha256_file(rep)


def test_dwg_input_is_identified_and_blocked(run, tmp_path, manifest):
    p = tmp_path / "drawing.dwg"
    p.write_bytes(b"AC1027" + b"\x00" * 200)
    res = run(p)
    assert res.report["source"]["format"] == "DWG" and res.report["source"]["release"] == "AutoCAD 2013-2017"
    assert any(f["blocking"] for f in findings(res, "M4-IN-001"))
    assert res.report["outputs"] == [] and res.status == "Blocked by errors"


def test_newer_dxf_release_is_reported(run, manifest, save):
    doc = fx.valid_plot(manifest)
    doc.dxfversion = "AC1032"
    res = run(save(doc))
    assert any("2012 or earlier" in f["message"] for f in findings(res, "ADM-FMT-001"))
