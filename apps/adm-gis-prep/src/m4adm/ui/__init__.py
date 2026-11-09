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
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from m4adm import PROVISIONAL_LABEL, __version__
from m4adm.adapters import STATUS_UNAVAILABLE, DWGConverter
from m4adm.audit import AuditLog
from m4adm.convert import convert
from m4adm.convert.settings import ConversionSettings
from m4adm.io import sha256_file
from m4adm.jobs import JOB_ID_RE, attach_official_qc, export_package, job_dir, list_jobs, load_report, official_qc_status
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

    async def store_source(drawing: UploadFile | None, existing: str) -> Path | str:
        """The path of the drawing to process (an upload is stored read-only, once per content), or an error message."""
        if drawing is not None and drawing.filename:
            data = await drawing.read()
            if len(data) > MAX_UPLOAD:
                return "File is larger than 500 MB. Split the drawing or purge it in CAD first."
            name = SAFE_NAME.sub("_", Path(drawing.filename).name) or "drawing.dxf"
            d = uploads / hashlib.sha256(data).hexdigest()[:16]
            d.mkdir(exist_ok=True)
            source = d / name
            if not source.exists():
                tmp = d / f".{name}.part"
                tmp.write_bytes(data)
                os.replace(tmp, source)
                os.chmod(source, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
            return source
        if existing:
            return resolve_upload(existing)
        return "Select a drawing: upload a DXF or choose a previously uploaded file."

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
        source = await store_source(drawing, existing)
        if isinstance(source, str):
            return _back(source)
        if not category:
            return _back("Select at least one category (Plot, Roads, Services).")
        pairs = parse_control_points(control_points)
        if isinstance(pairs, str):
            return _back(pairs)
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


    # ------------------------------------------------------------------ floor plan -> DRM BDMS draft (conversion)
    def conversion_dir(job_id: str) -> Path:
        if not JOB_ID_RE.fullmatch(job_id) or not (jobs_root / job_id / "conversion_report.json").exists():
            raise HTTPException(404, f"conversion {job_id} not found or not complete")
        return jobs_root / job_id

    def list_conversions(limit: int = 15) -> list[dict]:
        out = []
        for d in sorted((p for p in jobs_root.iterdir() if JOB_ID_RE.fullmatch(p.name)), reverse=True):
            f = d / "conversion_report.json"
            if f.exists():
                r = json.loads(f.read_text(encoding="utf-8"))
                out.append({"job_id": d.name, "status": r["status"], "source": r["source"]["name"],
                            "output": (r.get("output") or {}).get("path")})
                if len(out) >= limit:
                    break
        return out

    bdms = manifests["bdms_building"]

    @app.get("/convert", response_class=HTMLResponse)
    def convert_form(request: Request, error: str | None = None):
        dwg = DWGConverter.from_env()
        return TEMPLATES.TemplateResponse(request, "convert.html", ctx(
            request, error=error, uploads=uploaded_files(), conversions=list_conversions(),
            usage_categories=bdms.domains["usage_category_type"], usage_types=bdms.domains["usage_type"],
            unit_types=bdms.domains["unit_type"], unit_classifications=bdms.domains["unit_classification_suggested"],
            drawing_types=bdms.domains["drawing_type"], dwg_ready=dwg.status() != STATUS_UNAVAILABLE,
            dwg_reader=dwg.describe() if dwg.executable else None))

    @app.post("/convert")
    async def do_convert(
        drawing: UploadFile | None = File(None),
        existing: str = Form(""),
        zone_name: str = Form(""), sector_number: str = Form(""), plot_number: str = Form(""),
        building_number: str = Form(""), floor_id: str = Form(""),
        single_unit_number: str = Form(""),
        floor_height: str = Form(""), building_number_of_floors: str = Form(""), building_height: str = Form(""),
        building_usage_category: str = Form(""), building_usage_type: str = Form(""),
        unit_type: str = Form(""), unit_classification: str = Form(""), unit_category: str = Form(""),
        unit_num_bedroom: str = Form(""), unit_num_bathroom: str = Form(""), unit_balconies_area: str = Form(""),
        unit_usage_type: str = Form(""), unit_owner_name: str = Form(""), unit_owner_nationality: str = Form(""),
        unit_owner_passport: str = Form(""),
        developer_name: str = Form(""), building_name: str = Form(""),
        title_drawing_type: str = Form(""), date_of_drawing: str = Form(""),
        source_units: str = Form("auto"),
        control_points: str = Form(""), confirm_transformation: str = Form(""),
    ):
        def back(message: str) -> RedirectResponse:
            return RedirectResponse(f"/convert?error={quote(message)}", status_code=303)

        source = await store_source(drawing, existing)
        if isinstance(source, str):
            return back(source)
        pairs = parse_control_points(control_points)
        if isinstance(pairs, str):
            return back(pairs)
        up = lambda v: v.strip().upper()          # file-name parts and the date are written in capitals
        titles = {"DeveloperName": developer_name.strip(), "BuildingName": building_name.strip(),
                  "DrawingType": title_drawing_type.strip(), "DateOfDrawing": up(date_of_drawing)}
        units = {"UnitType": unit_type, "UnitClassification": unit_classification, "UnitCategory": unit_category,
                 "UnitNumBedroom": unit_num_bedroom, "UnitNumBathroom": unit_num_bathroom,
                 "UnitBalconiesArea": unit_balconies_area, "UnitUsageType": unit_usage_type,
                 "UnitOwnerName": unit_owner_name, "UnitOwnerNatioanlity": unit_owner_nationality,   # spelled as in the spec
                 "UnitOwnerPassport": unit_owner_passport}
        try:
            settings = ConversionSettings(
                metadata={"zone_name": up(zone_name), "sector_number": up(sector_number), "plot_number": up(plot_number),
                          "building_number": building_number.strip(), "floor_id": up(floor_id)},
                source_units=source_units, single_unit_number=single_unit_number.strip(),
                floor_height=floor_height.strip(), building_number_of_floors=building_number_of_floors.strip(),
                building_height=building_height.strip(), building_usage_category=building_usage_category.strip(),
                building_usage_type=building_usage_type.strip(),
                title_values={k: v for k, v in titles.items() if v},
                unit_values={k: v.strip() for k, v in units.items() if v.strip()},
                crs={"control_points": pairs, "confirm_transformation": bool(confirm_transformation)})
        except ValueError as exc:
            return back(f"Settings are invalid: {exc}")
        try:
            res = await run_in_threadpool(convert, source, settings, jobs_root)
        except Exception as exc:
            return back(f"The conversion failed ({type(exc).__name__}: {exc}). The failed job folder is kept for diagnosis.")
        return RedirectResponse(f"/conversions/{res.job_id}", status_code=303)

    @app.get("/conversions/{job_id}", response_class=HTMLResponse)
    def show_conversion(request: Request, job_id: str):
        d = conversion_dir(job_id)
        r = json.loads((d / "conversion_report.json").read_text(encoding="utf-8"))
        outputs = sorted(p.name for p in (d / "output").glob("*")) if (d / "output").exists() else []
        return TEMPLATES.TemplateResponse(request, "conversion.html", ctx(
            request, r=r, job_id=job_id, outputs=outputs, has_preview=(d / "preview.svg").exists(),
            qc=(r.get("validation") or {}).get("qc_style_summary") or []))

    @app.get("/conversions/{job_id}/files/{path:path}")
    def conversion_file(job_id: str, path: str):
        d = conversion_dir(job_id).resolve()
        p = (d / path).resolve()
        if not p.is_relative_to(d) or not p.is_file():
            raise HTTPException(404, "file not found")
        media = {".html": "text/html", ".svg": "image/svg+xml"}.get(p.suffix)
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


def parse_control_points(text: str) -> list | str:
    """Pairs ((source_x, source_y), (target_E, target_N)) from one 'x y E N' line each, or an error message."""
    pairs = []
    for n, line in enumerate(text.splitlines(), 1):
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        try:
            vals = [float(v) for v in line.replace(",", " ").split()]
        except ValueError:
            vals = []
        if len(vals) != 4:
            return f"Control point line {n} needs 4 numbers: source_x source_y target_E target_N."
        pairs.append(((vals[0], vals[1]), (vals[2], vals[3])))
    return pairs


def _back(message: str) -> RedirectResponse:
    return RedirectResponse(f"/?error={quote(message)}", status_code=303)
