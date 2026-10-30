"""3D evacuation-plan conversion service (private).

Runs the tools/evacuation-3d engine on a batch of 2D evacuation-plan PDFs. A
batch takes minutes per sheet, so the API never waits on one request:

    POST   /jobs               upload the PDFs (+ optional logo, settings) -> {"id"}
    GET    /jobs/{id}          status + per-sheet progress
    GET    /jobs/{id}/result   the finished package as a zip
    DELETE /jobs/{id}          remove the job's files

One batch runs at a time (one sheet build peaks at ~1.5 GB); later batches
wait in order. Job state lives on local disk only: if the service restarts, the
job is gone, GET returns 404 and the API's queue retry resubmits it.
"""
import asyncio
import hmac
import io
import json
import logging
import os
import shutil
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile, status
from fastapi.responses import Response

from app.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("evac3d")

CHUNK = 1024 * 1024
SAFE_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- ")
LOGO_EXT = {".png", ".jpg", ".jpeg"}

_queue: asyncio.Queue = asyncio.Queue()
_worker: asyncio.Task | None = None


async def require_service_auth(x_internal_service_secret: str = Header(default="")) -> None:
    expected = settings.internal_service_secret
    if not expected or not hmac.compare_digest(x_internal_service_secret, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


def _job_dir(job_id: str) -> Path:
    try:
        uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(404, "Job not found.")
    d = Path(settings.work_dir) / job_id
    if not d.exists():
        raise HTTPException(404, "Job not found (the service may have restarted).")
    return d


def _safe_name(name: str | None, default: str) -> str:
    base = Path(name or default).name
    return "".join(c if c in SAFE_CHARS else "_" for c in base) or default


async def _save(upload: UploadFile, dest: Path, max_mb: int) -> None:
    size = 0
    with open(dest, "wb") as out:          # streamed to disk, never held in memory
        while chunk := await upload.read(CHUNK):
            size += len(chunk)
            if size > max_mb * 1024 * 1024:
                raise HTTPException(413, f"{upload.filename} is larger than {max_mb} MB.")
            out.write(chunk)


def _state(job: Path) -> dict:
    meta = json.loads((job / "job.json").read_text())
    progress = {}
    if (job / "progress.json").exists():
        try:
            progress = json.loads((job / "progress.json").read_text())
        except json.JSONDecodeError:   # being rewritten this instant
            pass
    return {**meta, "progress": progress}


def _set(job: Path, **kw) -> None:
    meta = json.loads((job / "job.json").read_text())
    meta.update(kw)
    tmp = job / "job.json.tmp"
    tmp.write_text(json.dumps(meta))
    os.replace(tmp, job / "job.json")


async def _run(job: Path) -> None:
    _set(job, status="running", startedAt=time.time())
    proc = await asyncio.create_subprocess_exec(
        settings.engine_python, os.path.join(settings.engine_dir, "convert.py"), "run", str(job),
        cwd=settings.engine_dir, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=settings.job_timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        _set(job, status="failed", rejected=True, error="The conversion took too long and was stopped.",
             finishedAt=time.time())
        return
    message = stderr.decode("utf-8", "replace").strip().splitlines()
    if proc.returncode == 0 and (job / "result" / "report.json").exists():
        _set(job, status="done", finishedAt=time.time())
    else:
        # exit 2: the input itself was rejected -- resubmitting cannot help
        _set(job, status="failed", rejected=proc.returncode == 2, finishedAt=time.time(),
             error=(message[-1] if message else f"exit code {proc.returncode}")[:1000])
        logger.warning("evac3d job %s failed (exit %s): %s", job.name, proc.returncode, message[-5:])


async def _work() -> None:
    while True:
        job = await _queue.get()
        try:
            await _run(job)
        except Exception as e:   # never let one job stop the worker
            logger.exception("evac3d job %s crashed", job.name)
            _set(job, status="failed", error=str(e)[:1000], finishedAt=time.time())
        finally:
            _queue.task_done()


def _sweep() -> None:
    root = Path(settings.work_dir)
    if not root.exists():
        return
    now = time.time()
    for d in root.iterdir():
        try:
            meta = json.loads((d / "job.json").read_text())
            done = meta.get("finishedAt")
            if done and now - done > settings.keep_finished_s:
                shutil.rmtree(d, ignore_errors=True)
        except (OSError, json.JSONDecodeError):
            continue


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    global _worker
    # jobs left from a previous process cannot be resumed
    shutil.rmtree(settings.work_dir, ignore_errors=True)
    Path(settings.work_dir).mkdir(parents=True, exist_ok=True)
    _worker = asyncio.create_task(_work())
    yield
    _worker.cancel()


app = FastAPI(title="EngineeringOS 3D Evacuation Plan Service", version="1.0.0", lifespan=_lifespan)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "queued": _queue.qsize()}


@app.post("/jobs", dependencies=[Depends(require_service_auth)])
async def create_job(
    drawings: list[UploadFile] = File(...),
    logo: UploadFile | None = File(default=None),
    settings_json: str = Form(default="{}", alias="settings"),
) -> dict:
    _sweep()
    if not drawings:
        raise HTTPException(422, "Upload at least one PDF drawing.")
    if len(drawings) > settings.max_files:
        raise HTTPException(422, f"At most {settings.max_files} drawings per conversion.")
    try:
        job_settings = json.loads(settings_json or "{}")
        if not isinstance(job_settings, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(422, "settings must be a JSON object.")
    job_id = str(uuid.uuid4())
    job = Path(settings.work_dir) / job_id
    (job / "input").mkdir(parents=True)
    try:
        names = set()
        for i, d in enumerate(drawings):
            name = _safe_name(d.filename, f"drawing-{i + 1}.pdf")
            if not name.lower().endswith(".pdf"):
                raise HTTPException(422, f"{d.filename}: only PDF drawings are supported.")
            if name in names:
                name = f"{i + 1:02d}-{name}"
            names.add(name)
            await _save(d, job / "input" / name, settings.max_file_mb)
            with open(job / "input" / name, "rb") as fh:
                if fh.read(5) != b"%PDF-":
                    raise HTTPException(422, f"{d.filename} is not a PDF file.")
        if logo is not None and logo.filename:
            ext = Path(logo.filename).suffix.lower()
            if ext not in LOGO_EXT:
                raise HTTPException(422, "The logo must be a PNG or JPG image.")
            await _save(logo, job / "input" / f"logo{ext}", settings.max_logo_mb)
        (job / "settings.json").write_text(json.dumps(job_settings))
        (job / "job.json").write_text(json.dumps({"id": job_id, "status": "queued", "createdAt": time.time(),
                                                  "files": sorted(names)}))
    except BaseException:
        shutil.rmtree(job, ignore_errors=True)
        raise
    await _queue.put(job)
    return {"id": job_id, "status": "queued", "position": _queue.qsize()}


@app.get("/jobs/{job_id}", dependencies=[Depends(require_service_auth)])
async def get_job(job_id: str) -> dict:
    return _state(_job_dir(job_id))


@app.get("/jobs/{job_id}/result", dependencies=[Depends(require_service_auth)])
async def get_result(job_id: str) -> Response:
    job = _job_dir(job_id)
    if _state(job).get("status") != "done":
        raise HTTPException(409, "The conversion has not finished.")
    buf = io.BytesIO()
    result = job / "result"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(result.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(result).as_posix())
    report = json.loads((result / "report.json").read_text())
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"X-Evac3d-Status": report.get("status", "")})


@app.delete("/jobs/{job_id}", dependencies=[Depends(require_service_auth)])
async def delete_job(job_id: str) -> dict:
    job = _job_dir(job_id)
    if _state(job).get("status") in ("queued", "running"):
        raise HTTPException(409, "The conversion is still running.")
    shutil.rmtree(job, ignore_errors=True)
    return {"deleted": job_id}
