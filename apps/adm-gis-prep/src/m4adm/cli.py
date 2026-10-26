"""Command-line interface: `m4adm <command>`.

Exit codes for `prepare`: 0 = job completed (Ready for review / Prepared with warnings),
3 = job completed but Blocked by errors, 1 = job failed (no valid output), 2 = usage error.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import yaml

from m4adm import PROVISIONAL_LABEL, __version__
from m4adm.models import JobSettings, Tolerances

DEFAULT_JOBS = Path("workspace/jobs")


def _load_mapping(path: str | None) -> tuple[dict, dict]:
    if not path:
        return {}, {}
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    return dict(data.get("layers", {})), {str(k): v for k, v in (data.get("handles", {}) or {}).items()}


def _tolerances(items: list[str], base: Tolerances) -> Tolerances:
    values = base.model_dump()
    for item in items:
        key, _, val = item.partition("=")
        if key not in values:
            raise SystemExit(f"unknown tolerance '{key}'; known: {', '.join(values)}")
        values[key] = float(val)
    return Tolerances(**values)


def _load_control_points(path: str | None) -> list:
    """CSV or whitespace file, one pair per line: source_x source_y target_x target_y (# comments allowed)."""
    if not path:
        return []
    pairs = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        vals = [float(v) for v in line.replace(",", " ").split()]
        if len(vals) != 4:
            raise SystemExit(f"control point line needs 4 numbers (sx sy tx ty): {line!r}")
        pairs.append(((vals[0], vals[1]), (vals[2], vals[3])))
    return pairs


def cmd_prepare(a: argparse.Namespace) -> int:
    from m4adm.pipeline import STATUS_READY, prepare
    from m4adm.rules import load_profile

    manifest = load_profile(a.profile)
    categories = a.category or (["building"] if a.profile == "bdms_building" else None)
    if not categories:
        raise SystemExit("select at least one --category (plot, roads, services)")
    if a.profile == "sdd_planning" and not (a.project_id and a.date and a.drawing_type):
        raise SystemExit("sdd_planning needs --project-id, --date and --drawing-type")
    if a.profile == "bdms_building" and not all([a.zone, a.sector, a.plot, a.building, a.floor]):
        raise SystemExit("bdms_building needs --zone, --sector, --plot, --building and --floor")
    layers, handles = _load_mapping(a.mapping)
    settings = JobSettings(
        profile=a.profile,
        strict=not a.no_strict,
        categories=categories,
        metadata={"project_id": a.project_id or "", "submission_date": a.date or "",
                  "drawing_type": a.drawing_type or "", "spec_type": a.spec_type,
                  "consultant_name": a.consultant or "", "contractor_name": a.contractor or "",
                  "prepared_by": a.prepared_by or "", "zone_name": a.zone or "", "sector_number": a.sector or "",
                  "plot_number": a.plot or "", "building_number": a.building or "", "floor_id": a.floor or ""},
        crs={"source_crs": a.source_crs, "source_confirmed": a.crs_confirmed, "target_crs": a.target_crs,
             "transform_pipeline": a.transform, "confirm_transformation": a.confirm_transformation,
             "control_points": _load_control_points(a.control_points), "max_georef_rms": a.max_georef_rms},
        units_confirmed_metres=a.units_confirmed,
        tolerances=_tolerances(a.tolerance, manifest.tolerances) if a.tolerance else None,
        layer_mapping=layers,
        handle_mapping=handles,
        accepted_fixes=a.accept_fix,
        write_additional_file=not a.no_additional,
        template_path=a.template,
        parent_job=a.parent_job,
    )
    print(f"{PROVISIONAL_LABEL}\nM4 GIS preparation v{__version__} - profile {manifest.profile}, "
          f"specification v{manifest.version}" + (" - STRICT (any warning blocks)" if settings.strict else ""))
    try:
        res = prepare(Path(a.source), settings, Path(a.jobs), manifest)
    except Exception as exc:  # job folder was renamed *.failed with error.json
        print(f"JOB FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    r = res.report
    c = r["status"]["counts"]
    print(f"Job {res.job_id}: {res.status} | {r['status']['official_qc']}")
    print(f"  errors={c['ERROR']} warnings={c['WARNING']} info={c['INFO']} blocking={c['blocking']} "
          f"unresolved_layers={c['unresolved_layers']} open_fixes={c['open_fix_proposals']}")
    print(f"  source unchanged (SHA-256 verified): {r['source']['unchanged']}")
    for o in r["outputs"]:
        print(f"  output: {o['file']} ({o['entities']} entities, verified={o['verification']['ok']})")
    for f in [f for f in r["findings"] if f["blocking"]][:10]:
        print(f"  BLOCKING {f['rule_id']}: {f['message']}\n           next: {f['action']}")
    print(f"  report: {res.job_dir / 'qc_report.html'}")
    for g in r.get("qc_style_summary", [])[:25]:
        print(f"  [{g['count']:4d}] {g['qc_error']} ({', '.join(g['layers']) or '-'})")
    return 0 if res.status == STATUS_READY or (not settings.strict and not r["status"]["counts"]["ERROR"]
                                                and not r["status"]["counts"]["blocking"]) else 3


def cmd_inspect(a: argparse.Namespace) -> int:
    from m4adm.classify import classify_layout
    from m4adm.io import identify, load_dxf
    from m4adm.mapping import build_mapping
    from m4adm.rules import load_profile

    ident = identify(Path(a.source))
    print(json.dumps(ident.as_dict(), indent=2))
    if not ident.format.startswith("DXF"):
        print("Not a DXF: export the drawing as DXF (AutoCAD 2010 format) to inspect it.")
        return 0
    doc = load_dxf(ident.path).doc
    recs = classify_layout(doc)
    print(f"$INSUNITS={doc.header.get('$INSUNITS', 0)}  entities={len(recs)}  "
          f"types={dict(Counter(r.structure for r in recs))}")
    res = build_mapping(recs, load_profile(a.profile), a.category, {}, {})
    print(f"\nLayer mapping preview for {', '.join(a.category)}:")
    for d in res.decisions:
        tgt = d.target_layer or "-"
        hint = f"  hints: {', '.join(d.suggestions)}" if d.suggestions else ""
        print(f"  {d.source_layer:32s} -> {tgt:28s} {d.status:14s} {d.entity_count:6d}  {d.note}{hint}")
    return 0


def cmd_check_name(a: argparse.Namespace) -> int:
    from m4adm.rules import load_profile
    from m4adm.validate import Collector, bdms
    from m4adm.validate.filename import validate_filename

    col = Collector(load_profile(a.profile))
    if a.profile == "bdms_building":
        stem, _, ext = a.name.rpartition(".")
        ok = bdms.validate_stem(stem or a.name, col)
        if ext.lower() != "dwg":
            col.add("DRM-SPEC-FMT", f"Extension '.{ext}' is not .dwg.", "Submit the drawing as a .dwg file.")
            ok = False
    else:
        ok = validate_filename(a.name, col)
    for f in col.findings:
        print(f"{f.severity.value} {f.rule_id}: {f.message}\n  next: {f.action}")
    print("OK: name matches the ADM pattern" if ok and not col.findings else ("OK" if ok else "INVALID"))
    return 0 if ok else 3


def cmd_rules(a: argparse.Namespace) -> int:
    from m4adm.rules import load_profile

    m = load_profile(a.profile)
    if a.json:
        print(json.dumps([r.model_dump(mode="json") for r in m.rules], indent=2))
        return 0
    print(f"Profile {m.profile} - specification v{m.version} - manifest {m.path} (sha256 {m.sha256[:12]})")
    print(dict(Counter(r.evidence.value for r in m.rules)))
    for r in m.rules:
        print(f"  {r.id:16s} {r.evidence.value:30s} {r.severity.value:8s} {r.title}")
    return 0


def cmd_matrix(a: argparse.Namespace) -> int:
    from m4adm.matrix import MATRIX_FILES, ROOT, render_matrix
    from m4adm.rules import load_profile

    stale = False
    for profile, rel in MATRIX_FILES.items():
        text = render_matrix(load_profile(profile))
        path = ROOT / rel
        if a.check:
            if (path.read_text(encoding="utf-8") if path.exists() else "") != text:
                print(f"{rel} is out of date; run `m4adm matrix`.")
                stale = True
            continue
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path}")
    if a.check and not stale:
        print("compliance matrices up to date")
    return 1 if stale else 0


def cmd_fixtures(a: argparse.Namespace) -> int:
    from m4adm.fixtures import write_all

    for p in write_all(Path(a.out)):
        print(p)
    return 0


def cmd_history(a: argparse.Namespace) -> int:
    from m4adm.jobs import list_jobs

    for j in list_jobs(Path(a.jobs)):
        print(f"{j['job_id']}  {j['status']:24s} {j.get('source') or '-':40s} {','.join(j.get('categories') or [])}")
    return 0


def cmd_export(a: argparse.Namespace) -> int:
    from m4adm.jobs import export_package

    path = export_package(Path(a.job), a.by, a.acknowledge)
    print(f"{PROVISIONAL_LABEL}\npackage: {path}")
    return 0


def cmd_attach_qc(a: argparse.Namespace) -> int:
    from m4adm.jobs import attach_official_qc

    rec = attach_official_qc(Path(a.job), Path(a.file), a.outcome, a.by)
    print(json.dumps(rec, indent=2))
    return 0


def cmd_ui(a: argparse.Namespace) -> int:
    import uvicorn

    from m4adm.ui import create_app

    app = create_app(Path(a.workspace))
    print(f"M4 ADM GIS Preparation UI on http://127.0.0.1:{a.port} (local only)")
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="m4adm", description=f"M4 ADM GIS preparation ({PROVISIONAL_LABEL})")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)

    profiles = ["sdd_planning", "bdms_building"]
    s = sub.add_parser("prepare", help="Prepare for ADM GIS: analyse, map, validate, export")
    s.add_argument("source")
    s.add_argument("--profile", default="sdd_planning", choices=profiles,
                   help="sdd_planning = ADM SDD Plot/Roads/Services v1.18.2; bdms_building = DRM BDMS 4.1 building floor")
    s.add_argument("-c", "--category", action="append", choices=["plot", "roads", "services", "building"])
    s.add_argument("--project-id", help="SDD: CDP project ID")
    s.add_argument("--date", help="SDD: YYYYMMDD")
    s.add_argument("--drawing-type", choices=["AP", "MP"], help="SDD: AP or MP")
    s.add_argument("--zone", help="BDMS: zone name, e.g. 'KHALIFA CITY'")
    s.add_argument("--sector", help="BDMS: sector number, e.g. SE45_01")
    s.add_argument("--plot", help="BDMS: plot number, e.g. C8")
    s.add_argument("--building", help="BDMS: building number (1, 2, ...)")
    s.add_argument("--floor", help="BDMS: floor ID (G, F1, M1, B1, ...)")
    s.add_argument("--control-points", help="file with 'source_x source_y target_E target_N' per line (georeferencing)")
    s.add_argument("--max-georef-rms", type=float, default=0.05)
    s.add_argument("--no-strict", action="store_true", help="let warnings pass (default: any warning blocks)")
    s.add_argument("--spec-type", default="ADM", choices=["ADM", "DOT"])
    s.add_argument("--consultant")
    s.add_argument("--contractor")
    s.add_argument("--prepared-by")
    s.add_argument("--source-crs", help="e.g. EPSG:32640; omit if unknown (blocks coordinate confirmation)")
    s.add_argument("--crs-confirmed", action="store_true", help="engineer confirms the declared source CRS")
    s.add_argument("--target-crs", default="EPSG:32640")
    s.add_argument("--transform", help="target CRS or PROJ pipeline for an explicit transformation")
    s.add_argument("--confirm-transformation", action="store_true")
    s.add_argument("--units-confirmed", action="store_true", help="engineer confirms full scale, metres")
    s.add_argument("--mapping", help="YAML/JSON with 'layers: {SRC: ADMLayer}' and 'handles: {H: ADMLayer}'")
    s.add_argument("--accept-fix", action="append", default=[], help="fix id, or all:KIND")
    s.add_argument("--tolerance", action="append", default=[], help="name=value (metres)")
    s.add_argument("--template", help="official ADM template as DXF (when available)")
    s.add_argument("--no-additional", action="store_true")
    s.add_argument("--parent-job")
    s.add_argument("--jobs", default=str(DEFAULT_JOBS))
    s.set_defaults(fn=cmd_prepare)

    s = sub.add_parser("inspect", help="Identify format, list layers and mapping preview")
    s.add_argument("source")
    s.add_argument("--profile", default="sdd_planning", choices=profiles)
    s.add_argument("-c", "--category", action="append", default=None, choices=["plot", "roads", "services", "building"])
    s.set_defaults(fn=cmd_inspect)

    s = sub.add_parser("check-name", help="Validate a submission file name")
    s.add_argument("name")
    s.add_argument("--profile", default="sdd_planning", choices=profiles)
    s.set_defaults(fn=cmd_check_name)

    s = sub.add_parser("rules", help="Show the rule manifest")
    s.add_argument("--json", action="store_true")
    s.add_argument("--profile", default="sdd_planning", choices=profiles)
    s.set_defaults(fn=cmd_rules)

    s = sub.add_parser("matrix", help="Regenerate docs/COMPLIANCE_MATRIX.md from the manifest")
    s.add_argument("--check", action="store_true")
    s.set_defaults(fn=cmd_matrix)

    s = sub.add_parser("fixtures", help="Write synthetic DXF fixtures")
    s.add_argument("out")
    s.set_defaults(fn=cmd_fixtures)

    s = sub.add_parser("history", help="List jobs")
    s.add_argument("--jobs", default=str(DEFAULT_JOBS))
    s.set_defaults(fn=cmd_history)

    s = sub.add_parser("export", help="Package a job after reviewing the pre-export summary")
    s.add_argument("job")
    s.add_argument("--by", required=True)
    s.add_argument("--acknowledge", action="store_true", required=True)
    s.set_defaults(fn=cmd_export)

    s = sub.add_parser("attach-qc", help="Attach the real output of an official ADM QC run")
    s.add_argument("job")
    s.add_argument("--file", required=True)
    s.add_argument("--outcome", required=True, choices=["passed", "failed", "PASSED", "FAILED"])
    s.add_argument("--by", required=True)
    s.set_defaults(fn=cmd_attach_qc)

    s = sub.add_parser("ui", help="Start the local web UI (127.0.0.1 only)")
    s.add_argument("--workspace", default="workspace")
    s.add_argument("--port", type=int, default=8765)
    s.set_defaults(fn=cmd_ui)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if getattr(args, "cmd", None) == "inspect" and not args.category:
        args.category = ["building"] if args.profile == "bdms_building" else ["plot", "roads", "services"]
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
