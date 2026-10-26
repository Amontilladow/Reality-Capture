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
# service's -- and that process gets a hard memory cap. A drawing too big for
# the cap fails its own job with a clear message instead of pushing this
# 512 MB container into an out-of-memory restart that would also take down
# the AI assistant. Measured: drawings already in the DRM GIS format peak at
# ~90 MB; raw architectural originals need 280-670 MB and belong on the
# desktop tool.
CHUNK = 1024 * 1024
SAFE_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- ")

# One job at a time: two concurrent runs would double the memory the cap is
# sized for.
_one_at_a_time = asyncio.Semaphore(1)


def _limit_memory() -> None:
    limit = settings.gis_prep_memory_limit_mb * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


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
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, preexec_fn=_limit_memory,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=settings.gis_prep_timeout_s)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                raise HTTPException(422, "GIS preparation took too long on this server. Run it with the desktop tool (m4adm ui) instead.")

        message = stderr.decode("utf-8", "replace").strip()[-1000:]
        if proc.returncode in (2, 3):              # input rejected / over the memory cap: retrying cannot help
            raise HTTPException(422, message or "The drawing was rejected.")
        if proc.returncode != 0:
            if "MemoryError" in message:
                raise HTTPException(422, "The drawing needs more memory than this server allows. "
                                         "Run it with the desktop tool (m4adm ui) instead.")
            logger.warning("GIS preparation process failed (exit %s): %s", proc.returncode, message)
            raise HTTPException(500, f"GIS preparation failed: {message or f'exit code {proc.returncode}'}")

        meta = json.loads(stdout.decode("utf-8"))
        headers = {"X-M4ADM-Job": meta["job_id"], "X-M4ADM-Status": meta["status"], "X-M4ADM-Label": meta["label"]}
        return Response(package.read_bytes(), media_type="application/zip", headers=headers)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
