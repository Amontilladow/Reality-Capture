"""End-to-end 'Prepare for ADM GIS' pipeline.

Order of operations (each step logged to the job audit trail):
  1. copy the source into the job folder (read-only, hash-verified) and identify its format
  2. load (recover mode), classify every model-space entity
  3. map layers (verified names / PDF aliases / accepted mappings); queue everything else
  4. CRS gate (declaration, confirmation, optional confirmed transformation)
  5. apply only the fixes the engineer accepted
  6. validate the prepared state against the manifest rules
  7. export one DXF per dataset (+ additional file), re-read and verify each output
  8. confirm the source is byte-identical, write reports, atomically publish the job folder
"""
from __future__ import annotations

import json
import os
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from m4adm import PROVISIONAL_LABEL, __version__
from m4adm.adapters import DWGConverter, OfficialQC, OfficialTemplate, STATUS_UNAVAILABLE
from m4adm.audit import AuditLog, utc_now
from m4adm.classify import classify_layout
from m4adm.crs import check_crs, extents_of, transform_entities
from m4adm.export import JobWorkspace, OutputSpec, atomic_save_doc, atomic_write_json, atomic_write_text, build_output
from shapely.geometry import Polygon

from m4adm.geometry import to_shape
from m4adm.geometry.fixes import apply_fixes, propose
from m4adm.io import identify, load_dxf, sha256_file
from m4adm.mapping import build_mapping, categories_of
from m4adm.models import Finding, JobSettings, Severity
from m4adm.report import render_html
from m4adm.rules import Manifest, load_manifest
from m4adm.validate import Collector
from m4adm.validate.drawing import (
    check_entity_roles, check_hygiene, check_layer_properties, check_shared_layers, check_title, check_units,
)
from m4adm.validate.features import (
    associate_and_check_details, build_features, check_feature_geometry, check_layer_topology, check_services,
    tobeclipped_handles,
)
from m4adm.validate.filename import build_stem, validate_metadata, validate_stem

STATUS_READY = "Ready for review"
STATUS_WARNINGS = "Prepared with warnings"
STATUS_BLOCKED = "Blocked by errors"

DISCLAIMER = (
    "Internal preliminary QC by the M4 ADM GIS preparation tool. This is NOT official ADM QC, approval or "
    "acceptance. Run the official ADM QC tool and submit through ADM channels; ADM decides acceptance."
)


@dataclass
class JobResult:
    job_id: str
    job_dir: Path
    status: str
    report: dict[str, Any]


def prepare(source: Path, settings: JobSettings, jobs_root: Path, manifest: Manifest | None = None) -> JobResult:
    manifest = manifest or load_manifest()
    tol = settings.tolerances or manifest.tolerances
    categories = [c.value for c in settings.categories]
    source = Path(source).resolve()
    if not source.is_file():
        raise FileNotFoundError(f"source drawing not found: {source}")
    ws = JobWorkspace(jobs_root)
    audit = AuditLog(ws.dir / "audit.jsonl")
    try:
        result = _run(source, settings, manifest, tol, categories, ws, audit)
    except Exception as exc:
        audit.record("job_failed", error=f"{type(exc).__name__}: {exc}")
        ws.fail(exc)
        raise
    return result


def _run(source: Path, settings: JobSettings, manifest: Manifest, tol, categories: list[str],
         ws: JobWorkspace, audit: AuditLog) -> JobResult:
    started = utc_now()
    src_stat = source.stat()
    src_hash_before = sha256_file(source)
    audit.record("job_started", job_id=ws.job_id, source=str(source), source_sha256=src_hash_before,
                 spec_version=manifest.version, manifest_sha256=manifest.sha256, tool_version=__version__,
                 settings=json.loads(settings.model_dump_json()))
    copy, copy_hash = ws.copy_source(source)
    audit.record("source_copied", copy=str(copy.relative_to(ws.dir)), sha256=copy_hash, read_only=True)
    ident = identify(copy)
    audit.record("format_identified", **ident.as_dict())

    col = Collector(manifest)
    changes: dict[str, list] = {"layer_mapping": [], "fixes": [], "transformation": [], "outputs": [],
                               "reader_removed": []}
    outputs: list[dict] = []
    proposals_out: list = []
    mapping_decisions: list = []
    crs_summary = "not evaluated"
    readable = copy
    if ident.format == "DWG":
        conv = DWGConverter.from_env()
        col.add("M4-IN-001", f"Input is DWG ({ident.release}); DWG cannot be read without a converter "
                f"(converter status: {conv.status()}).",
                "Save the drawing as DXF from AutoCAD (SAVEAS > AutoCAD 2010 DXF) and upload the DXF, or install "
                "ODA File Converter and set M4ADM_ODA_CONVERTER.", blocking=True)
        readable = None
    elif ident.format == "DXF-BINARY" or ident.format == "UNKNOWN":
        if ident.format == "UNKNOWN":
            col.add("M4-IN-001", "Input is not a recognised DXF or DWG file.",
                    "Upload an AutoCAD DXF export of the drawing.", blocking=True)
            readable = None
    if ident.release_ok is False:
        col.add("ADM-FMT-001", f"Source is saved as {ident.release} ({ident.version_code}); ADM requires AutoCAD "
                "2012 or earlier. The prepared file is written in the R2010 (AC1024) format.",
                "Keep the R2010 output; when converting to DWG, choose AutoCAD 2010/2012 format.")

    report: dict[str, Any] = {}
    if readable is not None:
        loaded = load_dxf(readable)
        doc = loaded.doc
        for msg in loaded.audit_errors:
            col.add("ENG-FILE-001", f"DXF structure error: {msg}", "Run AUDIT in AutoCAD and re-export the DXF.")
        for msg in loaded.audit_fixes:
            if msg.startswith("Deleted entity"):
                # e.g. an INSERT whose block definition is missing: it cannot be carried into the output
                col.add("ADM-CAP-010", f"Reader could not keep an object and left it out of the prepared files: {msg}",
                        "Fix the object in the source drawing (restore the block definition or remove the "
                        "reference), export again and re-run. The source file still contains it.")
                changes["reader_removed"].append(msg)
                audit.record("reader_removed_entity", message=msg)
            else:
                col.add("ENG-FILE-001", f"Reader repaired (in memory only): {msg}",
                        "Run AUDIT/RECOVER in AutoCAD so the source itself is clean.")
        records = classify_layout(doc)
        audit.record("entities_classified", count=len(records),
                     by_type=dict(Counter(r.structure for r in records)))

        # ---------------------------------------------------------------- mapping
        mres = build_mapping(records, manifest, categories, settings.layer_mapping, settings.handle_mapping)
        mapping_decisions = mres.decisions
        for src, tgt in mres.invalid_user_mappings:
            col.add("USR-MAP-001", f"Mapping '{src}' -> '{tgt}' is not valid for the selected categories.",
                    "Choose an ADM layer of a selected category, or __exclude__.", severity=Severity.ERROR)
        for d in mres.decisions:
            if d.status == "UNRESOLVED":
                col.add("USR-MAP-001",
                        f"Layer '{d.source_layer}' ({d.entity_count} entities: {d.note}) is not an ADM layer; "
                        "its entities are not in the ADM files until mapped.",
                        "Assign the ADM layer these entities represent, or mark the layer __exclude__. "
                        + (f"Name-based hints (unverified): {', '.join(d.suggestions)}." if d.suggestions else ""),
                        layer=d.source_layer, suggestions=d.suggestions)
            elif d.status in ("ALIAS", "CASE_VARIANT"):
                col.add("ADM-LYR-007", f"Layer '{d.source_layer}' recognised as '{d.target_layer}' ({d.status}).",
                        f"The prepared file uses '{d.target_layer}' (Tables 5-7 spelling); confirm with the official "
                        "template.", layer=d.source_layer)
            elif d.status == "OUT_OF_SCOPE":
                col.add("ADM-LYR-001", f"Layer '{d.source_layer}' belongs to a dataset that was not selected; "
                        f"{d.entity_count} entities go to the additional file.",
                        "Select that category too if these features are part of this submission.",
                        severity=Severity.INFO, layer=d.source_layer)
        by_handle = {r.handle: r for r in records}
        for h, tgt in mres.entity_target.items():
            r = by_handle[h]
            if tgt and r.layer != tgt:
                r.entity.dxf.layer = tgt
                changes["layer_mapping"].append({"handle": h, "from": r.layer, "to": tgt,
                                                 "basis": mres.entity_status[h]})
        if changes["layer_mapping"]:
            audit.record("layers_mapped", count=len(changes["layer_mapping"]),
                         summary=dict(Counter(f"{c['from']} -> {c['to']} ({c['basis']})"
                                              for c in changes["layer_mapping"])))

        # ---------------------------------------------------------------- CRS
        in_scope = [r for r in records if mres.entity_target.get(r.handle)]
        pts = [p for r in in_scope for p in (r.points or ([r.location] if r.location else []))]
        crs_status = check_crs(settings.crs, extents_of(pts), col)
        crs_summary = crs_status.summary
        if crs_status.transformation_allowed:
            try:
                tlog = transform_entities([r.entity for r in in_scope], settings.crs)
                changes["transformation"].append(tlog.__dict__)
                audit.record("coordinates_transformed", **tlog.__dict__)
                crs_summary = f"transformed with '{tlog.pipeline}' (confirmed by engineer)"
            except ValueError as exc:
                col.add("M4-SAFE-CRS", f"Transformation not performed: {exc}",
                        "Resolve the listed entities, or transform in a GIS/CAD tool with verified parameters.",
                        blocking=True)
                audit.record("transformation_blocked", reason=str(exc))

        # ---------------------------------------------------------------- fixes
        specs = {}
        for cat in categories:
            for s in manifest.layers_for(cat):
                specs.setdefault(s.name, s)
        proposals = propose(records, specs, mres.entity_target, tol, {})
        fres = apply_fixes(doc, proposals, settings.accepted_fixes, tol)
        changes["fixes"] = fres.applied
        for a in fres.applied:
            audit.record("fix_applied", **a)
        for s in fres.skipped:
            audit.record("fix_skipped", **s)
        unknown_accept = [a for a in settings.accepted_fixes
                          if not a.startswith("all:") and a not in {p.id for p in proposals}]
        if unknown_accept:
            audit.record("accepted_fix_not_applicable", fixes=unknown_accept)

        # ---------------------------------------------------------------- validate prepared state
        records2 = classify_layout(doc)
        origin = fres.origin
        target2 = {r.handle: mres.entity_target.get(origin.get(r.handle, r.handle)) for r in records2}
        for cat in categories:
            stem = build_stem(settings.metadata, manifest.categories[cat].file_token)
            validate_stem(stem, col, context=f"{cat} file")
        validate_metadata(settings.metadata, categories, col)
        check_units(doc, settings.units_confirmed_metres, col)
        check_hygiene(doc, col, set(specs))
        check_layer_properties(doc, col, specs)
        check_entity_roles(records2, target2, manifest, categories, col)
        check_title(records2, target2, col)
        check_shared_layers(records2, target2, categories, col)
        ctx = build_features(records2, target2, manifest, categories, tol)
        check_feature_geometry(ctx, tol, col)
        associate_and_check_details(records2, target2, manifest, categories, ctx, tol, col)
        check_layer_topology(ctx, tol, col, tobeclipped_handles(ctx))
        if "services" in categories:
            plot_polys = [(f.handle, f.polygon) for f in ctx.features.get("Plot", []) if f.polygon is not None]
            if not plot_polys:  # plot layer present but Plot category not selected
                for r in records2:
                    if r.layer.lower() == "plot" and r.is_polyline_like and r.closed:
                        g = to_shape(r, tol.arc_sagitta, tol.coincidence)
                        if isinstance(g, Polygon) and g.is_valid:
                            plot_polys.append((r.handle, g))
            check_services(ctx, plot_polys, tol, col)
        for f in col.findings:
            if f.handle and f.handle in origin:
                f.details["source_handle"] = origin[f.handle]

        applied_ids = {a["fix"] for a in fres.applied}
        proposals_out = [p for p in propose(records2, specs, target2, tol, origin) if p.id not in applied_ids]

        # ---------------------------------------------------------------- export
        prepared = ws.dir / "work" / "prepared_full.dxf"
        atomic_save_doc(doc, prepared)
        audit.record("prepared_full_written", file=str(prepared.relative_to(ws.dir)))
        out_dir = ws.dir / "output"
        for cat in categories:
            token = manifest.categories[cat].file_token
            stem = build_stem(settings.metadata, token)
            stem_col = Collector(manifest)
            if not validate_stem(stem, stem_col):
                stem = f"INVALID-NAME_{token}"
            keep = {h for h, t in target2.items() if t and cat in categories_of(manifest, t, categories)}
            spec = OutputSpec(cat, token, out_dir / f"{stem}.dxf", keep, manifest.layers_for(cat))
            info = build_output(prepared, spec, manifest, ws.job_id, src_hash_before, settings.purge_unused_blocks,
                                settings.units_confirmed_metres)
            outputs.append(info)
            audit.record("output_written", **{k: v for k, v in info.items() if k != "changes"},
                         changes=info["changes"])
        extra = {h for h, t in target2.items() if not t}
        if extra and settings.write_additional_file:
            stem = build_stem(settings.metadata, "additional")
            if not validate_stem(stem, Collector(manifest)):
                stem = "INVALID-NAME_additional"
            spec = OutputSpec("additional", "additional", out_dir / f"{stem}.dxf", extra, [])
            info = build_output(prepared, spec, manifest, ws.job_id, src_hash_before, False, False)
            info["note"] = ("Reference-only additional file (spec §4.1): entities not mapped to an ADM layer, "
                            "kept with their original layers so no information is lost.")
            outputs.append(info)
            audit.record("output_written", **{k: v for k, v in info.items() if k != "changes"})
        for o in outputs:
            if not o["verification"]["ok"]:
                col.add("ENG-FILE-001", f"Output {o['file']} failed re-read verification: {o['verification']}",
                        "Do not use this output; report the problem.", severity=Severity.ERROR, blocking=True)
        col.add("ADM-FMT-001", "Prepared files are DXF (R2010/AC1024). ADM requires DWG (AutoCAD 2012 or earlier); "
                f"DWG converter status: {DWGConverter.from_env().status()}.",
                "Convert each prepared DXF to DWG in AutoCAD 2010-2012 format (or with ODA File Converter) before "
                "running the official QC tool, then rename .dxf to .dwg with the same stem.", severity=Severity.INFO)
        col.add("ADM-NAME-009", "Output file names use the validated ADM stem with the .dxf extension of the format "
                "actually produced.", "After conversion to DWG the extension must be .dwg.", severity=Severity.INFO)
        changes["outputs"] = [{"file": o["file"], "changes": o["changes"]} for o in outputs]
        rejected = sorted(extra)
        report_unresolved = [d for d in mapping_decisions if d.status == "UNRESOLVED"]
    else:
        rejected, report_unresolved = [], []

    # -------------------------------------------------------------------- integrity + reports
    src_hash_after = sha256_file(source)
    src_unchanged = src_hash_after == src_hash_before and source.stat().st_mtime_ns == src_stat.st_mtime_ns
    if not src_unchanged:  # should be impossible; surfaced loudly if it ever happens
        col.add("ENG-FILE-001", "SOURCE FILE CHANGED DURING PROCESSING.", "Stop and investigate immediately.",
                severity=Severity.ERROR, blocking=True)
    audit.record("source_integrity_checked", sha256_before=src_hash_before, sha256_after=src_hash_after,
                 unchanged=src_unchanged)

    findings = col.findings
    counts = Counter(f.severity.value for f in findings)
    blocking = [f for f in findings if f.blocking]
    if counts.get("ERROR") or blocking:
        status = STATUS_BLOCKED
    elif counts.get("WARNING") or report_unresolved or proposals_out:
        status = STATUS_WARNINGS
    else:
        status = STATUS_READY
    template_cmp = {c: OfficialTemplate(Path(settings.template_path) if settings.template_path else None)
                    .compare(manifest, c).__dict__ for c in categories}
    report = {
        "label": PROVISIONAL_LABEL,
        "disclaimer": DISCLAIMER,
        "tool": {"name": "M4 ADM GIS Preparation", "version": __version__},
        "spec": {"title": manifest.spec["title"], "version": manifest.version,
                 "source_pdf_sha256": manifest.spec["source_pdf_sha256"],
                 "manifest_file": manifest.path.name if manifest.path else None,
                 "manifest_sha256": manifest.sha256},
        "job": {"id": ws.job_id, "started": started, "finished": utc_now(), "parent_job": settings.parent_job,
                "categories": categories, "settings": json.loads(settings.model_dump_json())},
        "source": {**ident.as_dict(), "original_path": str(source), "sha256_before": src_hash_before,
                   "sha256_after": src_hash_after, "unchanged": src_unchanged,
                   "path": str(Path("input") / copy.name)},
        "status": {
            "label": status,
            "official_qc": OfficialQC.STATUS_LABEL["NOT_PERFORMED"],
            "official_qc_tool": STATUS_UNAVAILABLE,
            "counts": {"ERROR": counts.get("ERROR", 0), "WARNING": counts.get("WARNING", 0),
                       "INFO": counts.get("INFO", 0), "blocking": len(blocking),
                       "unresolved_layers": len(report_unresolved), "open_fix_proposals": len(proposals_out)},
        },
        "crs": {"summary": crs_summary, "settings": json.loads(settings.crs.model_dump_json()),
                "target": manifest.crs["name"]},
        "tolerances": json.loads(tol.model_dump_json()),
        "mapping": [json.loads(d.model_dump_json()) for d in mapping_decisions],
        "review_queue": {
            "unresolved_layers": [json.loads(d.model_dump_json()) for d in report_unresolved],
            "fix_proposals": [json.loads(p.model_dump_json()) for p in proposals_out],
        },
        "findings": [json.loads(f.model_dump_json()) for f in _sorted(findings)],
        "changes": changes,
        "outputs": outputs,
        "integrations": {
            "dwg_converter": DWGConverter.from_env().status(),
            "official_template": template_cmp,
            "official_qc": STATUS_UNAVAILABLE,
        },
        "limitations": _limitations(),
    }
    geometry_log = {
        "modified": changes["layer_mapping"] + changes["fixes"] + changes["transformation"],
        "rejected_from_adm_files": [{"handle": h, "reason": "not mapped to an ADM layer of the selected categories; "
                                     "kept in the additional file"} for h in rejected]
        + [{"handle": None, "reason": f"removed by the DXF reader (still in the source): {m}"}
           for m in changes["reader_removed"]],
        "unresolved": [json.loads(f.model_dump_json()) for f in _sorted(findings)
                       if f.severity == Severity.ERROR or f.evidence.value == "USER_DECISION_REQUIRED"],
    }
    processing_manifest = {
        "label": PROVISIONAL_LABEL,
        "job_id": ws.job_id,
        "tool_version": __version__,
        "spec_version": manifest.version,
        "manifest_sha256": manifest.sha256,
        "source": {"file": source.name, "sha256": src_hash_before, "unchanged_after_run": src_unchanged},
        "settings": json.loads(settings.model_dump_json()),
        "status": status,
        "counts": report["status"]["counts"],
        "warnings": [f.message for f in findings if f.severity == Severity.WARNING][:500],
        "errors": [f.message for f in findings if f.severity == Severity.ERROR][:500],
        "outputs": [{"file": o["file"], "sha256": o["sha256"], "verified": o["verification"]["ok"]}
                    for o in outputs],
    }
    d = ws.dir
    atomic_write_json(d / "qc_report.json", report)
    atomic_write_text(d / "qc_report.html", render_html(report))
    atomic_write_json(d / "geometry_log.json", geometry_log)
    atomic_write_json(d / "review_queue.json", report["review_queue"])
    atomic_write_json(d / "processing_manifest.json", processing_manifest)
    atomic_write_text(d / "README.txt", f"{PROVISIONAL_LABEL}\n\n{DISCLAIMER}\n\nStatus: {status}\n"
                      f"Specification version: {manifest.version}\nJob: {ws.job_id}\n")
    audit.record("job_completed", status=status, counts=report["status"]["counts"])
    final = ws.finalize()
    _append_index(ws.root, {"job_id": ws.job_id, "finished": report["job"]["finished"], "source": source.name,
                            "categories": categories, "status": status, "counts": report["status"]["counts"],
                            "parent_job": settings.parent_job, "spec_version": manifest.version})
    return JobResult(ws.job_id, final, status, report)


def _sorted(findings: list[Finding]) -> list[Finding]:
    order = {"ERROR": 0, "WARNING": 1, "INFO": 2}
    return sorted(findings, key=lambda f: (order[f.severity.value], not f.blocking, f.rule_id, f.handle or ""))


def _append_index(root: Path, entry: dict) -> None:
    with open(root / "index.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, default=str) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def _limitations() -> list[str]:
    return [
        "Output is DXF R2010 (AC1024). DWG output needs AutoCAD or ODA File Converter (not bundled/tested).",
        "The official ADM DWG template is not available: title block, attribute block definitions, dimension style "
        "and the 'Track' linetype are checked against the PDF tables only and are never fabricated.",
        "The official ADM QC tool (.FAS) is not available and is not emulated. This report is not ADM QC.",
        "No real source drawing with its ADM-accepted output was available to calibrate checks; tolerances are "
        "M4 engineering defaults and are reported with every run.",
        "Coordinate system cannot be read from a DXF; it is taken from the engineer's confirmed declaration.",
        "Geometry checks run within each ADM layer; cross-layer topology is only checked where the PDF requires it "
        "(service corridors vs plots, boreholes in activity areas, reserved strips in corridors).",
    ]


def load_job_report(job_dir: Path) -> dict:
    return json.loads((Path(job_dir) / "qc_report.json").read_text(encoding="utf-8"))
