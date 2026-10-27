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
import re
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from m4adm import PROVISIONAL_LABEL, __version__
from m4adm.adapters import DWGConverter, OfficialQC, OfficialTemplate, STATUS_UNAVAILABLE
from m4adm.audit import AuditLog, utc_now
from m4adm.classify import classify_layout
from m4adm.crs import check_crs, extents_of, fit_similarity, georeference_entities, transform_entities
from m4adm.export import JobWorkspace, OutputSpec, atomic_save_doc, atomic_write_json, atomic_write_text, build_output
from shapely.geometry import Polygon

from m4adm.geometry import to_shape
from m4adm.geometry.fixes import apply_fixes, propose
from m4adm.io import identify, load_dxf, sha256_file
from m4adm.mapping import build_mapping, categories_of
from m4adm.models import CRSSettings, Finding, JobSettings, Severity
from m4adm.report import render_html
from m4adm.rules import Manifest, load_profile
from m4adm.validate import bdms
from m4adm.validate import Collector
from m4adm.validate.drawing import (
    check_entity_roles, check_hygiene, check_layer_properties, check_shared_layers, check_title, check_units,
)
from m4adm.validate.features import (
    associate_and_check_details, build_features, check_cross_layer_snapping, check_feature_geometry,
    check_layer_topology, check_services, tobeclipped_handles,
)
from m4adm.validate.filename import build_stem, validate_metadata, validate_stem

STATUS_READY = "Ready for review"
STATUS_WARNINGS = "Prepared with warnings"
STATUS_BLOCKED = "Blocked by errors"
STATUS_BLOCKED_STRICT = "Blocked: warnings and open decisions must be resolved (strict mode)"

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
    manifest = manifest or load_profile(settings.profile)
    if manifest.profile != settings.profile:
        raise ValueError(f"manifest profile {manifest.profile!r} does not match job profile {settings.profile!r}")
    if settings.profile == "bdms_building" and [c.value for c in settings.categories] != ["building"]:
        raise ValueError("the bdms_building profile takes exactly one category: building (one floor per file)")
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
    conversion: dict | None = None
    if ident.format == "DWG":
        conv = DWGConverter.from_env()
        if conv.status() == STATUS_UNAVAILABLE:
            col.add("M4-IN-001", f"Input is DWG ({ident.release}); no DWG converter is installed.",
                    "Save the drawing as DXF from AutoCAD (SAVEAS > AutoCAD 2010 DXF), or install ODA File Converter "
                    "(set M4ADM_ODA_CONVERTER) or LibreDWG dwg2dxf (set M4ADM_DWG2DXF), then re-run.", blocking=True)
            readable = None
        else:
            try:
                readable = conv.to_dxf(copy, ws.dir / "work")
                conv_ident = identify(readable)
                if not conv_ident.format.startswith("DXF"):
                    raise RuntimeError(f"converter output is {conv_ident.format}, not DXF")
                conversion = {"converter": conv.describe(), "kind": conv.kind, "dxf": str(readable.relative_to(ws.dir)),
                              "dxf_sha256": conv_ident.sha256, "dxf_version": conv_ident.version_code}
                audit.record("dwg_converted", **conversion)
                col.add("M4-IN-001", f"DWG input ({ident.release}) was converted to DXF with {conv.describe()} before "
                        "checking.", "Conversion fidelity on this installation is validated by the reference test "
                        "(DWG vs AutoCAD DXF of the same drawing); keep the original DWG as the master.",
                        severity=Severity.INFO, converter=conversion)
            except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
                col.add("M4-IN-001", f"DWG conversion failed: {exc}",
                        "Save the drawing as DXF from AutoCAD (SAVEAS > AutoCAD 2010 DXF) and upload the DXF.",
                        blocking=True)
                audit.record("dwg_conversion_failed", error=str(exc))
                readable = None
    elif ident.format == "DXF-BINARY" or ident.format == "UNKNOWN":
        if ident.format == "UNKNOWN":
            col.add("M4-IN-001", "Input is not a recognised DXF or DWG file.",
                    "Upload an AutoCAD DXF export of the drawing.", blocking=True)
            readable = None
    max_code = manifest.output.get("max_version_code")
    min_code = manifest.output.get("min_version_code")
    if ident.version_code and max_code and ident.version_code > max_code:
        col.add("ADM-FMT-001", f"Source is saved as {ident.release} ({ident.version_code}); the specification allows "
                f"releases up to {max_code}. The prepared file is written in the R2010 (AC1024) format.",
                "Keep the R2010 output; when converting to DWG, choose AutoCAD 2010/2012 format.")
    if ident.version_code and min_code and ident.version_code < min_code:
        col.add("ADM-FMT-001", f"Source is saved as {ident.release} ({ident.version_code}); the specification "
                f"requires {min_code} or later. The prepared file is written in R2010 (AC1024).",
                "Keep the R2010 output.")

    report: dict[str, Any] = {}
    if readable is not None:
        loaded = load_dxf(readable)
        doc = loaded.doc
        for msg in loaded.audit_errors:
            col.add("ENG-FILE-001", f"DXF structure error: {msg}", "Run AUDIT in AutoCAD and re-export the DXF.")
        repairs: Counter = Counter()
        examples: dict[str, list[str]] = {}
        for msg in loaded.audit_fixes:
            if msg.startswith("Deleted entity"):
                # e.g. an INSERT whose block definition is missing: it cannot be carried into the output
                col.add("ADM-CAP-010", f"Reader could not keep an object and left it out of the prepared files: {msg}",
                        "Fix the object in the source drawing (restore the block definition or remove the "
                        "reference), export again and re-run. The source file still contains it.")
                changes["reader_removed"].append(msg)
                audit.record("reader_removed_entity", message=msg)
            else:
                kind = re.sub(r"invalid key .+? in ", "invalid key … in ", re.sub(r"#[0-9A-Fa-f]+", "#…", msg))
                repairs[kind] += 1
                examples.setdefault(kind, []).append(msg)
        for kind, n in repairs.items():
            col.add("ENG-FILE-001", f"Reader repaired (in memory only), {n}×: {kind}",
                    "Run AUDIT/RECOVER in AutoCAD so the source itself is clean.", count=n,
                    examples=examples[kind][:10])
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
        crs_settings = settings.crs
        georeferenced = False
        if settings.crs.control_points:
            georeferenced, crs_settings = _georeference(settings, in_scope, col, changes, audit)
            if georeferenced:
                in_scope = [r for r in classify_layout(doc) if mres.entity_target.get(r.handle)]
        pts = [p for r in in_scope for p in (r.points or ([r.location] if r.location else []))]
        crs_status = check_crs(crs_settings, extents_of(pts), col)
        crs_summary = crs_status.summary if not georeferenced else (
            f"georeferenced from control points into {settings.crs.target_crs} (confirmed by engineer); "
            + crs_status.summary)
        if crs_status.transformation_allowed and not georeferenced:
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
        is_bdms = manifest.profile == "bdms_building"
        if not is_bdms:
            for cat in categories:
                stem = build_stem(settings.metadata, manifest.categories[cat].file_token)
                validate_stem(stem, col, context=f"{cat} file")
            validate_metadata(settings.metadata, categories, col)
        check_units(doc, settings.units_confirmed_metres, col)
        check_hygiene(doc, col, set(specs))
        check_layer_properties(doc, col, specs)
        check_entity_roles(records2, target2, manifest, categories, col)
        if manifest.title_block:
            check_title(records2, target2, col)
        check_shared_layers(records2, target2, categories, col)
        ctx = build_features(records2, target2, manifest, categories, tol)
        check_feature_geometry(ctx, tol, col)
        associate_and_check_details(records2, target2, manifest, categories, ctx, tol, col)
        check_layer_topology(ctx, tol, col, tobeclipped_handles(ctx))
        if manifest.cross_layer_snapping:
            check_cross_layer_snapping(ctx, manifest.cross_layer_snapping, tol, col)
        if is_bdms:
            bdms.run_bdms_checks(records2, target2, manifest, settings.metadata, ctx, tol, col)
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
            stem = _output_stem(manifest, settings, token)
            keep = {h for h, t in target2.items() if t and cat in categories_of(manifest, t, categories)}
            spec = OutputSpec(cat, token, out_dir / f"{stem}.dxf", keep, manifest.layers_for(cat))
            info = build_output(prepared, spec, manifest, ws.job_id, src_hash_before, settings.purge_unused_blocks,
                                settings.units_confirmed_metres)
            outputs.append(info)
            audit.record("output_written", **{k: v for k, v in info.items() if k != "changes"},
                         changes=info["changes"])
            for name in info.get("foreign_layers_remaining", []):
                col.add("ADM-LYR-001", f"Layer '{name}' is still in the prepared file {info['file']} (referenced "
                        "inside a block definition).", "Move the block's content to layer 0 or a specified layer.",
                        severity=Severity.ERROR, layer=name)
        extra = {h for h, t in target2.items() if not t}
        if extra and settings.write_additional_file:
            stem = _output_stem(manifest, settings, "additional")
            spec = OutputSpec("additional", "additional", out_dir / f"{stem}.dxf", extra, [])
            info = build_output(prepared, spec, manifest, ws.job_id, src_hash_before, False, False)
            info["note"] = ("Reference-only file, not a submission file: entities not mapped to a specified layer, "
                            "kept with their original layers so no information is lost.")
            outputs.append(info)
            audit.record("output_written", **{k: v for k, v in info.items() if k != "changes"})
        for o in outputs:
            if not o["verification"]["ok"]:
                col.add("ENG-FILE-001", f"Output {o['file']} failed re-read verification: {o['verification']}",
                        "Do not use this output; report the problem.", severity=Severity.ERROR, blocking=True)
        release = (f"AutoCAD {manifest.output['max_autocad_release']} or earlier" if manifest.output.get(
            "max_autocad_release") else f"AutoCAD {manifest.output.get('min_autocad_release', '')} or later")
        col.add("ADM-FMT-001", f"Prepared files are DXF (R2010/AC1024). The specification requires DWG ({release}); "
                f"DWG converter status: {DWGConverter.from_env().status()}.",
                "Convert each prepared DXF to DWG (AutoCAD 2010 format) in AutoCAD or ODA File Converter before "
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
        status = STATUS_BLOCKED_STRICT if settings.strict else STATUS_WARNINGS
    else:
        status = STATUS_READY
    template_cmp = {c: OfficialTemplate(Path(settings.template_path) if settings.template_path else None)
                    .compare(manifest, c).__dict__ for c in categories}
    report = {
        "label": PROVISIONAL_LABEL,
        "disclaimer": DISCLAIMER,
        "tool": {"name": "M4 ADM GIS Preparation", "version": __version__},
        "spec": {"profile": manifest.profile, "title": manifest.spec["title"], "version": manifest.version,
                 "source_pdf_sha256": manifest.spec["source_pdf_sha256"],
                 "manifest_file": manifest.path.name if manifest.path else None,
                 "manifest_sha256": manifest.sha256},
        "job": {"id": ws.job_id, "started": started, "finished": utc_now(), "parent_job": settings.parent_job,
                "categories": categories, "settings": json.loads(settings.model_dump_json())},
        "source": {**ident.as_dict(), "conversion": conversion, "original_path": str(source), "sha256_before": src_hash_before,
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
        "qc_style_summary": _qc_summary(findings),
        "strict_mode": settings.strict,
        "checks_not_applicable": dict(col.not_applicable),
        "changes": changes,
        "outputs": outputs,
        "integrations": {
            "dwg_converter": DWGConverter.from_env().status(),
            "official_template": template_cmp,
            "official_qc": STATUS_UNAVAILABLE,
        },
        "limitations": _limitations(manifest),
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


def _output_stem(manifest: Manifest, settings: JobSettings, token: str) -> str:
    if manifest.profile == "bdms_building":
        stem = bdms.build_stem(settings.metadata)
        if not bdms.validate_stem(stem, Collector(manifest)):
            stem = "INVALID-NAME_floor"
        return stem if token != "additional" else f"{stem}_UNMAPPED-REFERENCE"
    stem = build_stem(settings.metadata, token)
    return stem if validate_stem(stem, Collector(manifest)) else f"INVALID-NAME_{token}"


def _georeference(settings: JobSettings, in_scope, col: Collector, changes: dict, audit: AuditLog
                  ) -> tuple[bool, CRSSettings]:
    """Fit and (only when confirmed and within tolerance) apply control-point georeferencing."""
    c = settings.crs
    try:
        sim = fit_similarity([tuple(map(tuple, pair)) for pair in c.control_points])
    except ValueError as exc:
        col.add("ENG-GEOREF-001", f"Control points rejected: {exc}", "Supply at least two distinct control point "
                "pairs (source x,y -> target E,N).", blocking=True)
        return False, c
    audit.record("georeference_fitted", **sim.as_dict(), points=len(c.control_points))
    if sim.rms > c.max_georef_rms:
        col.add("ENG-GEOREF-001", f"Control-point fit RMS {sim.rms:.4f} m exceeds the limit {c.max_georef_rms} m "
                f"(residuals {', '.join(f'{r:.4f}' for r in sim.residuals)} m). Nothing was transformed.",
                "Check the control point pairs (order, units, typing) or use better-defined points.", blocking=True,
                fit=sim.as_dict())
        return False, c
    if not (c.confirm_transformation and c.source_confirmed):
        col.add("M4-SAFE-CRS", f"Georeferencing fitted (scale {sim.scale:.6f}, rotation {sim.rotation_deg:.4f}°, "
                f"RMS {sim.rms:.4f} m) but not confirmed; nothing was transformed.",
                "Review the fit and tick 'confirm transformation' and 'source confirmed' to apply it.", blocking=True,
                fit=sim.as_dict())
        return False, c
    try:
        tlog = georeference_entities([r.entity for r in in_scope], sim)
    except ValueError as exc:
        col.add("M4-SAFE-CRS", f"Georeferencing not performed: {exc}",
                "Fix or exclude the listed entities, then re-run.", blocking=True)
        audit.record("transformation_blocked", reason=str(exc))
        return False, c
    entry = {**tlog.__dict__, "fit": sim.as_dict(), "control_points": c.control_points}
    changes["transformation"].append(entry)
    audit.record("coordinates_georeferenced", **entry)
    return True, CRSSettings(source_crs=c.target_crs, source_confirmed=True, target_crs=c.target_crs)


def _qc_summary(findings: list[Finding]) -> list[dict]:
    """Findings grouped like the official QC report: one row per error description and layer.

    The count follows the official tool: a finding may name its counting unit (`qc_unit`: the file, a block, a
    polygon), so e.g. three empty fields of one block count once. Detailed findings stay in the report."""
    groups: dict[tuple[str, str], dict] = {}
    for i, f in enumerate(findings):
        name = f.details.get("official_qc_error")
        if not name or f.severity != Severity.ERROR:      # the official report lists errors only
            continue
        layer = f.details.get("qc_layer", f.layer)      # the official report leaves file-level rows without layer
        g = groups.setdefault((name, layer or ""), {"qc_error": name, "rule_id": f.rule_id, "units": set(),
                                                    "layers": [layer] if layer else []})
        g["units"].add(f.details.get("qc_unit") or f"#{i}")
    return [{"qc_error": g["qc_error"], "rule_id": g["rule_id"], "count": len(g["units"]), "layers": g["layers"]}
            for g in groups.values()]


def _sorted(findings: list[Finding]) -> list[Finding]:
    order = {"ERROR": 0, "WARNING": 1, "INFO": 2}
    return sorted(findings, key=lambda f: (order[f.severity.value], not f.blocking, f.rule_id, f.handle or ""))


def _append_index(root: Path, entry: dict) -> None:
    with open(root / "index.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, default=str) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def _limitations(manifest: Manifest) -> list[str]:
    if manifest.profile == "bdms_building":
        return [
            "Output is DXF R2010 (AC1024). DWG output needs AutoCAD or ODA File Converter (not bundled/tested).",
            "The official QC tool (DRM_CPDQC_V2.3.fas) runs only inside AutoCAD and is not emulated; its rules were "
            "reproduced from the QC manual and calibrated on 4 accepted sample drawings. This report is not DRM QC.",
            "The official zone and sector name lists are compiled into the QC tool and are not published "
            "(DRM-GEN-04 not checked).",
            "SPEC says 1 unit = 1 cm, accepted samples are in metres; metres are required here (DISCREPANCIES_BDMS).",
            "Space polygons are not generated from architectural wall lines; they must be drawn (or mapped) in CAD.",
            "Unit-number uniqueness across all floors of a building needs all floor files in one run (checked per file).",
        ]
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
