import asyncio
import json
import logging
import os
import resource
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# GIS Preparation (apps/adm-gis-prep) hosted inside this service so it costs no
# extra Render instance (D-034). The engine runs as a SEPARATE process from its
# own virtualenv (/opt/m4adm, built in the Dockerfile) -- its pinned
# dependencies (pydantic, numpy, shapely, pyproj) never mix with this
# service's -- and that process is watched: if its real memory use (RSS) goes
# over gis_prep_memory_limit_mb it is stopped and the job fails with a clear
# message, instead of pushing this 512 MB container (about 180 MB used by the
# service itself) into an out-of-memory restart that would also take down the
# AI assistant. RSS is what the container limit counts; a virtual-memory cap
# (RLIMIT_AS) was tried first and rejected drawings that fit comfortably,
# because numpy/shapely reserve far more address space than they touch. It
# stays only as a loose backstop against a runaway allocation between checks.
# Measured peak RSS: DRM GIS-format drawings ~90 MB, the 12 MB M19B
# architectural originals ~280 MB, the 36 MB ground floor ~670 MB.
CHUNK = 1024 * 1024
SAFE_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- ")

# One job at a time: two concurrent runs would double the memory the cap is
# sized for.
_one_at_a_time = asyncio.Semaphore(1)


RSS_POLL_S = 0.2
TOO_BIG = ("The drawing needs more memory than this server allows. "
           "Run it with the desktop tool (m4adm ui) instead.")


def _backstop_address_space() -> None:
    limit = settings.gis_prep_address_space_limit_mb * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def _rss_mb(pid: int) -> float:
    try:
        with open(f"/proc/{pid}/status", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except (FileNotFoundError, ProcessLookupError, ValueError):
        pass
    return 0.0


async def _watch_memory(proc: asyncio.subprocess.Process, exceeded: list[float]) -> None:
    while proc.returncode is None:
        rss = _rss_mb(proc.pid)
        if rss > settings.gis_prep_memory_limit_mb:
            exceeded.append(rss)
            proc.kill()
            return
        await asyncio.sleep(RSS_POLL_S)


@router.post("/prepare")
async def prepare(drawing: UploadFile = File(...), settings_json: str = Form(..., alias="settings")):
    name = "".join(c if c in SAFE_CHARS else "_" for c in Path(drawing.filename or "drawing.dxf").name) or "drawing"
    max_bytes = settings.gis_prep_max_upload_mb * 1024 * 1024
    tmp = Path(tempfile.mkdtemp(prefix="gis-prep-"))
    try:
        source = tmp / name
        size = 0
        with open(source, "wb") as out:          # streamed to disk, never held in memory
            while chunk := await drawing.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"Drawing is larger than {settings.gis_prep_max_upload_mb} MB, the limit "
                                             "for cloud GIS preparation. Run it with the desktop tool (m4adm ui) instead.")
                out.write(chunk)
        (tmp / "settings.json").write_text(settings_json, encoding="utf-8")
        package = tmp / "package.zip"

        async with _one_at_a_time:
            proc = await asyncio.create_subprocess_exec(
                settings.gis_prep_python, "-m", "m4adm.package", str(source), str(tmp / "settings.json"), str(package),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, preexec_fn=_backstop_address_space,
            )
            exceeded: list[float] = []
            watcher = asyncio.create_task(_watch_memory(proc, exceeded))
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=settings.gis_prep_timeout_s)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                raise HTTPException(422, "GIS preparation took too long on this server. Run it with the desktop tool (m4adm ui) instead.")
            finally:
                watcher.cancel()

        if exceeded:
            logger.warning("GIS preparation stopped at %.0f MB RSS (limit %s MB)", exceeded[0], settings.gis_prep_memory_limit_mb)
            raise HTTPException(422, TOO_BIG)

        message = stderr.decode("utf-8", "replace").strip()[-1000:]
        if proc.returncode in (2, 3):              # input rejected / over the memory cap: retrying cannot help
            raise HTTPException(422, message or "The drawing was rejected.")
        if proc.returncode != 0:
            if "MemoryError" in message:
                raise HTTPException(422, TOO_BIG)
            logger.warning("GIS preparation process failed (exit %s): %s", proc.returncode, message)
            raise HTTPException(500, f"GIS preparation failed: {message or f'exit code {proc.returncode}'}")

        meta = json.loads(stdout.decode("utf-8"))
        headers = {"X-M4ADM-Job": meta["job_id"], "X-M4ADM-Status": meta["status"], "X-M4ADM-Label": meta["label"]}
        return Response(package.read_bytes(), media_type="application/zip", headers=headers)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
