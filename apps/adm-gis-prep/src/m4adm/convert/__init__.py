"""CAD-to-GIS conversion: architectural floor plan -> DRM BDMS 4.1 building-floor GIS drawing (draft).

UPLOAD -> ANALYSE -> GENERATE FEATURES -> REVIEW -> TRANSFORM COORDINATES -> EXPORT -> QC

    A source inspection        source.read_source
    B normalisation            source.read_source (explode blocks, flatten curves, units -> metres)
    C feature detection        rooms.detect_rooms (barriers, doorway openings, labels)
    D region generation        rooms.detect_rooms (enclosed regions -> room polygons)
    E layer mapping            features.build_features (Space/Door/Window/Floor/...)
    F attributes               features.build_features + apply_decisions (with provenance)
    G coordinates              georef.plan (only when confirmed and every check passes)
    H target drawing           writer.write_target (DXF R2010)
    I target validation        pipeline.prepare on the GENERATED drawing (never on the raw source)
    J export + audit           this module: conversion_report.json/.html, features.json, preview.svg, audit.jsonl

The source is copied read-only and verified by SHA-256 before and after. The output is always a DRAFT for engineer
review: it is never described as approved, compliant or submission-ready.
"""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from shapely.affinity import affine_transform

from m4adm import PROVISIONAL_LABEL, __version__
from m4adm.adapters import STATUS_UNAVAILABLE, DWGConverter
from m4adm.audit import AuditLog, utc_now
from m4adm.convert import georef as georef_mod
from m4adm.convert import topology
from m4adm.convert.features import (ACCEPTED, REJECTED, Feature, apply_decisions, build_features, missing_mandatory,
                                    number_spaces,
                                    title_values)
from m4adm.convert.report import preview_svg, render_html, summary
from m4adm.convert.rooms import HIGH, NOT_GENERATED, REVIEW, UNRESOLVED, detect_rooms
from m4adm.convert.settings import ConversionSettings
from m4adm.convert.source import read_source, resolve_units
from m4adm.convert.writer import write_target
from m4adm.export import JobWorkspace, atomic_write_json, atomic_write_text
from m4adm.io import identify, load_dxf, sha256_file
from m4adm.rules import Manifest, load_profile

STATUS_BLOCKED = "Blocked: no draft could be generated"
STATUS_DRAFT_LOCAL = "Draft generated - NOT georeferenced - not for submission"
STATUS_DRAFT_REVIEW = "Draft generated - requires engineer review"
STATUS_DRAFT_CHECKED = "Draft generated - no open review items; official QC not yet performed"
STATUS_DRAFT_BLOCKED = "Draft generated - BLOCKED: mandatory identifiers missing"

LIMITATIONS = [
    "Output is DXF R2010 only. DWG output needs AutoCAD or a licensed DWG SDK; convert the DXF in AutoCAD "
    "(SAVEAS AutoCAD 2010/2013 DWG) before submission.",
    "Room detection reads 2D wall linework and hatches on the configured wall layers. Walls on other layers, "
    "walls drawn only inside external references, and rooms closed only by furniture or finishes are not detected.",
    "Doorways are closed only between aligned wall ends 0.5-2.5 m apart (configurable). Unaligned or wider "
    "openings leave rooms merged; the report lists such regions for review.",
    "Units, plot, roof outline, building-level facts (usage, number of floors, heights) and owner data cannot be "
    "read from an architectural floor plan; they stay MISSING until the engineer provides them.",
    "Space numbers proposed from source room numbers ('01-04' -> 4) must be confirmed against the project's "
    "numbering. Door and window SpaceNumber links are proposals.",
    "Without the official DRM template (DWG), Detail blocks are built from the BDMS 4.1 attribute tables. Pass the "
    "template saved as DXF (or an accepted GIS drawing) as template_path to copy its block definitions.",
    "Preliminary validation of the draft uses this tool's checks, not the official DRM QC tool.",
]


@dataclass
class ConversionResult:
    job_id: str
    job_dir: Path
    status: str
    report: dict


def convert(source: Path, settings: ConversionSettings, jobs_root: Path, manifest: Manifest | None = None
            ) -> ConversionResult:
    manifest = manifest or load_profile(settings.profile)
    source = Path(source).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    ws = JobWorkspace(Path(jobs_root))
    audit = AuditLog(ws.dir / "audit.jsonl")
    try:
        result = _run(source, settings, manifest, ws, audit)
    except Exception as exc:
        audit.record("job_failed", error=f"{type(exc).__name__}: {exc}")
        ws.fail(exc)
        raise
    ws.finalize()
    result.job_dir = ws.final_dir
    return result


def _run(source: Path, settings: ConversionSettings, manifest: Manifest, ws: JobWorkspace, audit: AuditLog
         ) -> ConversionResult:
    started = utc_now()
    sha_before = sha256_file(source)
    audit.record("conversion_started", job_id=ws.job_id, source=source.name, source_sha256=sha_before,
                 tool_version=__version__, manifest_sha256=manifest.sha256,
                 settings=json.loads(settings.model_dump_json()))
    copy, _ = ws.copy_source(source)
    ident = identify(copy)
    blockers: list[str] = []
    result_rows: dict[str, object] = {}
    readable = copy
    if ident.format == "DWG":
        conv = DWGConverter.from_env()
        if conv.status() == STATUS_UNAVAILABLE:
            blockers.append("Input is DWG and no DWG converter is installed. Save it as DXF in AutoCAD "
                            "(SAVEAS > AutoCAD 2010 DXF), or install ODA File Converter / LibreDWG.")
            readable = None
        else:
            readable = conv.to_dxf(copy, ws.dir / "work")
            audit.record("dwg_converted", converter=conv.describe())
    elif not ident.format.startswith("DXF"):
        blockers.append(f"Unsupported input format: {ident.format}. Supported: DXF (any release ezdxf reads), "
                        "DWG through an installed converter.")
        readable = None

    det = None
    feats: list[Feature] = []
    geo = georef_mod.GeorefResult(georef_mod.NOT_REQUESTED, ["not evaluated"])
    model = None
    if readable is not None:
        loaded = load_dxf(readable)
        audit.record("source_loaded", reader_repairs=len(loaded.audit_fixes), reader_errors=len(loaded.audit_errors))
        scale, how = resolve_units(loaded.doc, settings.source_units)
        result_rows["Units"] = how
        if scale is None:
            blockers.append(f"Drawing units unknown ({how}). Declare the source units (mm, cm or m).")
        else:
            audit.record("units_resolved", metres_per_unit=scale, how=how)
            model = read_source(loaded.doc, scale, settings.tolerances.flatten)
            model.unit_origin = how
            audit.record("source_read", primitives=len(model.prims), inserts=len(model.inserts),
                         skipped=dict(model.skipped))
            det = detect_rooms(model, settings)
            audit.record("detection", barrier_layers=det.barrier_layers, label_layers=det.label_layers,
                         closures=len(det.closures), envelope=det.envelope_status,
                         regions=dict(Counter(r.status for r in det.regions)))
            if det.envelope is None:
                blockers.append(det.envelope_reason)
            else:
                feats = build_features(model, det, manifest, settings)
                orphans = topology.drop_orphan_doors(feats)
                unknown = apply_decisions(feats, settings)
                for note in number_spaces(feats):
                    audit.record("link_unresolved", note=note)
                topo = {"orphan_openings_dropped": orphans, "windows_extended": topology.extend_windows(feats),
                        "features_snapped": topology.snap_vertices(feats),
                        "openings_clipped": topology.clip_openings(feats),
                        "vertices_merged": topology.cluster_vertices(feats), "vertices_inserted": topology.node(feats)}
                topology.copy_outline_to_roof(feats)
                audit.record("topology", **topo)
                result_rows["Topology (generated geometry only)"] = (
                    f"{topo['windows_extended']} windows extended to the room face, {topo['features_snapped']} "
                    f"door/window outlines snapped, {topo['vertices_merged']} vertices merged (<= 1.5 cm), "
                    f"{topo['vertices_inserted']} shared vertices inserted")
                for fid in unknown:
                    audit.record("decision_unmatched", feature=fid)
                for f in feats:
                    if f.status in (ACCEPTED, REJECTED):
                        audit.record("feature_decision", feature=f.id, status=f.status)
                geo = georef_mod.plan(settings.crs.control_points, scale, det.envelope, settings.crs,
                                      manifest.crs["allowed_epsg"], manifest.crs.get("plausibility_window_lonlat"))
                audit.record("georeferencing", **geo.as_dict())

    stem = _stem(settings)
    # The official QC checks the drawing's own file name, so the draft is named exactly <Zone>-<Sector>-<Plot>-
    # <Building>-<Floor>.dxf; "draft" is recorded in the header, the job folder and the report, not the name.
    out_name = f"{stem}.dxf" if stem else "CONVERSION_DRAFT.dxf"
    identifiers_missing = _identifiers_missing(settings)
    written = None
    if feats and not blockers:
        local = {f.id: f.poly for f in feats}
        if geo.status == georef_mod.APPLIED:
            s = geo.similarity
            import math
            t = math.radians(s.rotation_deg)
            a, b = s.scale * math.cos(t), s.scale * math.sin(t)
            for f in feats:
                if f.poly is not None:
                    f.poly = affine_transform(f.poly, [a, -b, b, a, s.tx, s.ty])
        written = write_target(ws.dir / "output" / out_name, feats, title_values(manifest, settings, stem), manifest,
                               Path(settings.template_path) if settings.template_path else None,
                               geo.status == georef_mod.APPLIED)
        audit.record("target_written", **written)
        for f in feats:                       # the preview and features.json stay in local metres
            f.poly = local[f.id]

    validation = None
    if written and settings.validate_output:
        validation = _validate(ws.dir / "output" / out_name, settings, manifest, geo, ws.dir / "validation")
        audit.record("target_validated", status=validation["status"], counts=validation["counts"])

    sha_after = sha256_file(source)
    exported = [f for f in feats if f.exported]
    review = [f for f in feats if f.status in (REVIEW, UNRESOLVED)]
    missing = missing_mandatory(feats, manifest) if feats else []
    if blockers or not written:
        status = STATUS_BLOCKED
    elif identifiers_missing:
        status = STATUS_DRAFT_BLOCKED
    elif geo.status != georef_mod.APPLIED:
        status = STATUS_DRAFT_LOCAL
    elif review or missing or (validation and validation["counts"].get("ERROR")):
        status = STATUS_DRAFT_REVIEW
    else:
        status = STATUS_DRAFT_CHECKED
    statuses = Counter(f.status for f in feats)
    result_rows.update({
        "Features detected (enclosed regions)": len(det.regions) if det else 0,
        "Doorway openings found": len(det.closures) if det else 0,
        "Features generated (written to the draft)": len(exported),
        "  high confidence": statuses.get(HIGH, 0) + statuses.get(ACCEPTED, 0),
        "  requires review": statuses.get(REVIEW, 0),
        "Unresolved items": statuses.get(UNRESOLVED, 0),
        "Not generated": statuses.get(NOT_GENERATED, 0) + statuses.get(REJECTED, 0),
        "Attributes populated": sum(1 for f in exported for v in f.attributes.values() if v.value),
        "Mandatory attributes missing": len(missing),
        "Identifiers missing (blocks the draft)": ", ".join(identifiers_missing) or "none",
        "Coordinate transformation": geo.status,
        "Target validation": validation["status"] if validation else "not run",
        "Export": f"output/{out_name}" if written else "no draft",
        "Official QC": "not yet performed (run the official DRM QC tool in AutoCAD)",
    })
    report = {
        "kind": "conversion", "job_id": ws.job_id, "label": PROVISIONAL_LABEL, "status": status,
        "blockers": blockers, "identifiers_missing": identifiers_missing, "started": started, "finished": utc_now(), "tool_version": __version__,
        "target_schema": f"{manifest.spec['title']} v{manifest.version} (profile {manifest.profile})",
        "source": {"name": source.name, "format": ident.format, "sha256": sha_before, "sha256_after": sha_after,
                   "unchanged": sha_before == sha_after,
                   "layers": {k: dict(v) for k, v in (model.layer_stats if model else {}).items()}},
        "result": result_rows,
        "roles": {"barrier_layers": det.barrier_layers if det else [], "label_layers": det.label_layers if det else []},
        "summary": summary(feats),
        "features": [f.as_dict() for f in feats],
        "missing_mandatory": missing,
        "unplaced_labels": [{"name": lab.name, "number": lab.number} for lab in (det.unplaced_labels if det else [])],
        "closures": [{"a": [round(c.a[0], 4), round(c.a[1], 4)], "b": [round(c.b[0], 4), round(c.b[1], 4)],
                      "width_m": round(c.width, 3)} for c in (det.closures if det else [])],
        "georeferencing": geo.as_dict(),
        "output": written,
        "validation": validation,
        "settings": json.loads(settings.model_dump_json()),
        "limitations": LIMITATIONS,
    }
    svg = preview_svg(det, feats) if det is not None and det.barrier is not None else ""
    atomic_write_json(ws.dir / "conversion_report.json", report)
    atomic_write_json(ws.dir / "features.json", report["features"])
    atomic_write_text(ws.dir / "preview.svg", svg)
    atomic_write_text(ws.dir / "conversion_report.html", render_html(report, svg))
    atomic_write_text(ws.dir / "README.txt", f"{PROVISIONAL_LABEL}\n{status}\n\nThis folder holds a DRAFT produced by "
                      "automatic CAD-to-GIS conversion. Review conversion_report.html before using the draft.\n")
    audit.record("conversion_finished", status=status, source_unchanged=sha_before == sha_after)
    return ConversionResult(ws.job_id, ws.dir, status, report)


def _identifiers_missing(settings: ConversionSettings) -> list[str]:
    """Identifiers every Space/Door/Window block needs for the official QC to link them (trial 01). They are never
    invented: without them the draft is still written for review, but its status is BLOCKED."""
    md = settings.metadata
    out = []
    for label, value in (("zone name", md.zone_name), ("sector number", md.sector_number),
                         ("plot number", md.plot_number), ("building number", md.building_number),
                         ("floor ID (FloorNumber on every block)", md.floor_id),
                         ("unit number (UnitNumber on every space, door and window)", settings.single_unit_number)):
        if not value:
            out.append(label)
    return out


def _stem(settings: ConversionSettings) -> str | None:
    md = settings.metadata
    parts = [md.zone_name, md.sector_number, md.plot_number, md.building_number, md.floor_id]
    return "-".join(parts) if all(parts) else None


def _validate(draft: Path, settings: ConversionSettings, manifest: Manifest, geo, root: Path) -> dict:
    """Stage I: run the existing preliminary QC on the GENERATED drawing (never on the raw source)."""
    from m4adm.models import CRSSettings, JobSettings
    from m4adm.pipeline import load_job_report, prepare

    georef = geo.status == georef_mod.APPLIED
    js = JobSettings(profile=manifest.profile, categories=["building"], metadata=settings.metadata, strict=True,
                     crs=CRSSettings(source_crs=geo.target_crs if georef else None, source_confirmed=georef,
                                     target_crs=settings.crs.target_crs),
                     units_confirmed_metres=True)
    res = prepare(draft, js, root, manifest)
    rep = load_job_report(res.job_dir)
    return {"status": res.status, "counts": rep["status"]["counts"], "job": res.job_id,
            "qc_style_summary": rep.get("qc_style_summary", []),
            "report": str(Path("validation") / res.job_id / "qc_report.html"),
            "note": "Units were confirmed as metres because the converter wrote them in metres."}
