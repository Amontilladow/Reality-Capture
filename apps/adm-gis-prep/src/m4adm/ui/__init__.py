"""Local web UI (FastAPI). Bound to 127.0.0.1 by the CLI; drawings never leave the machine."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from m4adm import PROVISIONAL_LABEL, __version__
from m4adm.audit import AuditLog
from m4adm.io import sha256_file
from m4adm.jobs import attach_official_qc, export_package, job_dir, list_jobs, load_report, official_qc_status
from m4adm.mapping import EXCLUDE
from m4adm.models import JobSettings
from m4adm.pipeline import prepare
from m4adm.rules import PROFILES, load_profile

TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]")
MAX_UPLOAD = 500 * 1024 * 1024
CRS_CHOICES = [
    ("", "Unknown - I have not confirmed the coordinate system"),
    ("EPSG:32640", "WGS 84 / UTM zone 40N (EPSG:32640) - ADM CRS"),
    ("EPSG:32639", "WGS 84 / UTM zone 39N (EPSG:32639)"),
]


def create_app(workspace: Path) -> FastAPI:
    workspace = Path(workspace)
    uploads = workspace / "uploads"
    jobs_root = workspace / "jobs"
    uploads.mkdir(parents=True, exist_ok=True)
    jobs_root.mkdir(parents=True, exist_ok=True)
    manifests = {name: load_profile(name) for name in PROFILES}
    manifest = manifests["sdd_planning"]
    app = FastAPI(title="M4 ADM GIS Preparation", docs_url=None, redoc_url=None)

    def ctx(request: Request, **kw):
        return {"request": request, "label": PROVISIONAL_LABEL, "version": __version__,
                "spec_version": manifest.version, **kw}

    def uploaded_files() -> list[dict]:
        out = []
        for d in sorted(uploads.iterdir(), reverse=True):
            for f in d.iterdir():
                out.append({"id": f"{d.name}/{f.name}", "name": f.name, "size": f.stat().st_size})
        return out

    def resolve_upload(upload_id: str) -> Path:
        p = (uploads / upload_id).resolve()
        if not p.is_relative_to(uploads.resolve()) or not p.is_file():
            raise HTTPException(404, "uploaded file not found")
        return p

    def get_job(job_id: str) -> Path:
        try:
            return job_dir(jobs_root, job_id)
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request, error: str | None = None):
        return TEMPLATES.TemplateResponse(request, "index.html", ctx(
            request, uploads=uploaded_files(), jobs=list_jobs(jobs_root)[:30], crs_choices=CRS_CHOICES,
            tolerances=manifest.tolerances.model_dump(), error=error))

    @app.post("/prepare")
    async def do_prepare(
        request: Request,
        drawing: UploadFile | None = File(None),
        existing: str = Form(""),
        category: list[str] = Form([]),
        project_id: str = Form(""),
        submission_date: str = Form(""),
        drawing_type: str = Form(""),
        spec_type: str = Form("ADM"),
        consultant_name: str = Form(""),
        contractor_name: str = Form(""),
        prepared_by: str = Form(""),
        source_crs: str = Form(""),
        source_crs_other: str = Form(""),
        source_confirmed: str = Form(""),
        units_confirmed: str = Form(""),
        tol_coincidence: str = Form(""),
        tol_snap_search: str = Form(""),
        tol_arc_sagitta: str = Form(""),
        profile: str = Form("sdd_planning"),
        strict: str = Form(""),
        zone_name: str = Form(""),
        sector_number: str = Form(""),
        plot_number: str = Form(""),
        building_number: str = Form(""),
        floor_id: str = Form(""),
        target_crs: str = Form("EPSG:32640"),
        control_points: str = Form(""),
        confirm_transformation: str = Form(""),
    ):
        if profile not in manifests:
            return _back(f"Unknown profile {profile!r}.")
        if profile == "bdms_building":
            category = ["building"]
        if drawing is not None and drawing.filename:
            data = await drawing.read()
            if len(data) > MAX_UPLOAD:
                return _back("File is larger than 500 MB. Split the drawing or purge it in CAD first.")
            name = SAFE_NAME.sub("_", Path(drawing.filename).name) or "drawing.dxf"
            d = uploads / hashlib.sha256(data).hexdigest()[:16]
            d.mkdir(exist_ok=True)
            source = d / name
            if not source.exists():
                tmp = d / f".{name}.part"
                tmp.write_bytes(data)
                os.replace(tmp, source)
                os.chmod(source, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        elif existing:
            source = resolve_upload(existing)
        else:
            return _back("Select a drawing: upload a DXF or choose a previously uploaded file.")
        if not category:
            return _back("Select at least one category (Plot, Roads, Services).")
        pairs = []
        for n, line in enumerate(control_points.splitlines(), 1):
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            try:
                vals = [float(v) for v in line.replace(",", " ").split()]
            except ValueError:
                vals = []
            if len(vals) != 4:
                return _back(f"Control point line {n} needs 4 numbers: source_x source_y target_E target_N.")
            pairs.append(((vals[0], vals[1]), (vals[2], vals[3])))
        tol = None
        overrides = {k: v.strip() for k, v in (("coincidence", tol_coincidence), ("snap_search", tol_snap_search),
                                               ("arc_sagitta", tol_arc_sagitta)) if v and v.strip()}
        if overrides:
            tol = manifests[profile].tolerances.model_dump()
            try:
                tol.update({k: float(v) for k, v in overrides.items()})
            except ValueError:
                return _back("Tolerances must be numbers in metres.")
        try:
            settings = JobSettings(
                profile=profile,
                strict=bool(strict),
                categories=category,
                metadata={"project_id": project_id.strip(), "submission_date": submission_date.strip(),
                          "drawing_type": drawing_type, "spec_type": spec_type,
                          "consultant_name": consultant_name, "contractor_name": contractor_name,
                          "prepared_by": prepared_by, "zone_name": zone_name.strip(),
                          "sector_number": sector_number.strip(), "plot_number": plot_number.strip(),
                          "building_number": building_number.strip(), "floor_id": floor_id.strip()},
                crs={"source_crs": (source_crs_other.strip() or source_crs) or None,
                     "source_confirmed": bool(source_confirmed), "target_crs": target_crs,
                     "control_points": pairs, "confirm_transformation": bool(confirm_transformation)},
                units_confirmed_metres=bool(units_confirmed),
                tolerances=tol,
            )
        except ValueError as exc:
            return _back(f"Settings are invalid: {exc}")
        return _run(settings, source)

    def _run(settings: JobSettings, source: Path):
        try:
            res = prepare(source, settings, jobs_root, manifests[settings.profile])
        except Exception as exc:
            return _back(f"Processing failed ({type(exc).__name__}: {exc}). No output was produced; "
                         "the failed job folder is kept for diagnosis.")
        return RedirectResponse(f"/jobs/{res.job_id}", status_code=303)

    @app.get("/jobs/{job_id}", response_class=HTMLResponse)
    def show_job(request: Request, job_id: str, sev: str | None = None, msg: str | None = None):
        d = get_job(job_id)
        r = load_report(d)
        findings = [f for f in r["findings"] if not sev or f["severity"] == sev]
        m = manifests[r["spec"].get("profile", "sdd_planning")]
        adm_layers = sorted({l.name for c in r["job"]["categories"] for l in m.layers_for(c)})
        exports = sorted(p.name for p in (d / "export").glob("*.zip")) if (d / "export").exists() else []
        return TEMPLATES.TemplateResponse(request, "job.html", ctx(
            request, r=r, findings=findings, sev=sev, adm_layers=adm_layers, exclude=EXCLUDE,
            audit=AuditLog.read(d / "audit.jsonl"), official=official_qc_status(d), exports=exports, msg=msg))

    @app.post("/jobs/{job_id}/rerun")
    async def rerun(request: Request, job_id: str):
        d = get_job(job_id)
        r = load_report(d)
        form = await request.form()
        settings = JobSettings(**r["job"]["settings"])
        layer_mapping = dict(settings.layer_mapping)
        for key, value in form.multi_items():
            if key.startswith("map::") and value:
                layer_mapping[key[5:]] = value
        accepted = list(dict.fromkeys(settings.accepted_fixes + form.getlist("fix")))
        settings = settings.model_copy(update={"layer_mapping": layer_mapping, "accepted_fixes": accepted,
                                               "parent_job": job_id})
        src = Path(r["source"]["original_path"])
        copy = d / r["source"]["path"]
        source = src if src.exists() and sha256_file(src) == r["source"]["sha256_before"] else copy
        return _run(settings, source)

    @app.post("/jobs/{job_id}/export")
    def do_export(job_id: str, by: str = Form(""), acknowledge: str = Form("")):
        d = get_job(job_id)
        try:
            path = export_package(d, by, bool(acknowledge))
        except PermissionError as exc:
            return RedirectResponse(f"/jobs/{job_id}?msg={quote(str(exc))}", status_code=303)
        return RedirectResponse(f"/jobs/{job_id}?msg={quote('Package created: ' + path.name)}", status_code=303)

    @app.post("/jobs/{job_id}/official-qc")
    async def do_official_qc(job_id: str, report: UploadFile = File(...), outcome: str = Form(...),
                             by: str = Form("")):
        d = get_job(job_id)
        tmp = d / "work" / SAFE_NAME.sub("_", Path(report.filename or "official_qc_report.txt").name)
        tmp.write_bytes(await report.read())
        try:
            attach_official_qc(d, tmp, outcome, by)
        except ValueError as exc:
            return RedirectResponse(f"/jobs/{job_id}?msg={quote(str(exc))}", status_code=303)
        finally:
            tmp.unlink(missing_ok=True)
        return RedirectResponse(f"/jobs/{job_id}?msg={quote('Official QC output attached')}", status_code=303)

    @app.get("/jobs/{job_id}/files/{path:path}")
    def job_file(job_id: str, path: str):
        d = get_job(job_id).resolve()
        p = (d / path).resolve()
        if not p.is_relative_to(d) or not p.is_file():
            raise HTTPException(404, "file not found")
        media = "text/html" if p.suffix == ".html" else None
        return FileResponse(p, media_type=media, filename=None if media else p.name)

    @app.get("/rules", response_class=HTMLResponse)
    def rules(request: Request, profile: str = "sdd_planning"):
        if profile not in manifests:
            raise HTTPException(404, "unknown profile")
        return TEMPLATES.TemplateResponse(request, "rules.html", ctx(request, m=manifests[profile],
                                                                     profiles=list(manifests)))

    @app.get("/api/jobs")
    def api_jobs():
        return list_jobs(jobs_root)

    @app.get("/api/jobs/{job_id}")
    def api_job(job_id: str):
        return json.loads((get_job(job_id) / "qc_report.json").read_text(encoding="utf-8"))

    return app


def _back(message: str) -> RedirectResponse:
    return RedirectResponse(f"/?error={quote(message)}", status_code=303)
