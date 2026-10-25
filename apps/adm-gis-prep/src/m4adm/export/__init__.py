"""Job workspace and export.

* The source file is never modified: it is copied byte-for-byte into ``<job>/input`` and
  all processing reads that copy.
* A job is assembled in ``<jobs>/<id>.partial`` and atomically renamed to ``<jobs>/<id>``
  only when complete. A failure renames it to ``<id>.failed`` with ``error.json``, so a
  partial run can never look like a successful one.
* Every file is written to a temporary name and atomically renamed into place.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import recover
from ezdxf.document import Drawing

from m4adm import PROVISIONAL_LABEL
from m4adm.classify import unused_block_names
from m4adm.io import sha256_file
from m4adm.rules import LayerSpec, Manifest

# AutoCAD acad.lin "DASHED" definition. Used only when the drawing lacks a Dashed
# linetype for RoadCenterLine; flagged PENDING until the official template is available.
STANDARD_DASHED = [0.75, 0.5, -0.25]


def new_job_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]


def _tmp_name(path: Path) -> Path:
    return path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex[:8]}")


def atomic_write_bytes(path: Path, data: bytes) -> None:
    tmp = _tmp_name(path)
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json.dumps(data, indent=2, default=str, ensure_ascii=False))


def atomic_save_doc(doc: Drawing, path: Path) -> None:
    tmp = _tmp_name(path)
    try:
        doc.saveas(str(tmp))
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


class JobWorkspace:
    def __init__(self, jobs_root: Path, job_id: str | None = None):
        self.root = Path(jobs_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.job_id = job_id or new_job_id()
        self.dir = self.root / f"{self.job_id}.partial"
        for sub in ("input", "work", "output"):
            (self.dir / sub).mkdir(parents=True, exist_ok=False if sub == "input" else True)

    @property
    def final_dir(self) -> Path:
        return self.root / self.job_id

    def copy_source(self, source: Path) -> tuple[Path, str]:
        """Byte-identical, read-only copy of the source. Returns (copy, sha256)."""
        source = Path(source).resolve()
        if source.is_relative_to(self.dir.resolve()):
            raise ValueError("source must not live inside the job folder")
        dest = self.dir / "input" / source.name
        shutil.copyfile(source, dest)
        os.chmod(dest, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        src_hash, copy_hash = sha256_file(source), sha256_file(dest)
        if src_hash != copy_hash:
            raise IOError("source copy hash mismatch")
        return dest, src_hash

    def finalize(self) -> Path:
        os.replace(self.dir, self.final_dir)
        self.dir = self.final_dir
        return self.final_dir

    def fail(self, exc: BaseException) -> Path:
        atomic_write_json(self.dir / "error.json", {
            "job_id": self.job_id,
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
            "note": "Job failed. No output in this folder is a valid prepared drawing.",
        })
        failed = self.root / f"{self.job_id}.failed"
        os.replace(self.dir, failed)
        self.dir = failed
        return failed


# --------------------------------------------------------------------------- DXF outputs
def normalise_layers(doc: Drawing, specs: list[LayerSpec], log: list[dict]) -> None:
    """Create/normalise ADM layer table records with the verified properties (no geometry change)."""
    for spec in specs:
        lt_name = _ensure_linetype(doc, spec.linetype, log)
        if spec.name not in doc.layers:
            layer = doc.layers.add(spec.name)
            log.append({"action": "layer_created", "layer": spec.name})
        else:
            layer = doc.layers.get(spec.name)
        before = {"color": layer.color, "linetype": layer.dxf.get("linetype", "Continuous"),
                  "lineweight": layer.dxf.get("lineweight", -3)}
        if abs(layer.color) != spec.color:
            layer.color = spec.color
        if lt_name and before["linetype"].lower() != lt_name.lower():
            layer.dxf.linetype = lt_name
        if before["lineweight"] != spec.lineweight_dxf:
            layer.dxf.lineweight = spec.lineweight_dxf
        after = {"color": layer.color, "linetype": layer.dxf.get("linetype", "Continuous"),
                 "lineweight": layer.dxf.get("lineweight", -3)}
        if after != before:
            log.append({"action": "layer_properties_set", "layer": spec.name, "before": before, "after": after})


def _ensure_linetype(doc: Drawing, name: str, log: list[dict]) -> str | None:
    for lt in doc.linetypes:
        if lt.dxf.name.lower() == name.lower():
            return lt.dxf.name
    if name.lower() == "dashed":
        doc.linetypes.add("DASHED", pattern=STANDARD_DASHED, description="Dashed __ __ __ __ __ __")
        log.append({"action": "linetype_created", "linetype": "DASHED",
                    "note": "AutoCAD standard acad.lin DASHED pattern; PENDING comparison with official template"})
        return "DASHED"
    log.append({"action": "linetype_missing", "linetype": name,
                "note": "Defined only in the official ADM template; not fabricated. Layer linetype left unchanged."})
    return None


@dataclass
class OutputSpec:
    kind: str                 # category name or "additional"
    file_token: str
    path: Path
    keep_handles: set[str]
    layers: list[LayerSpec]


def build_output(prepared: Path, out: OutputSpec, manifest: Manifest, job_id: str, source_sha: str,
                 purge_unused: bool, set_units: bool) -> dict:
    doc = ezdxf.readfile(str(prepared))
    msp = doc.modelspace()
    removed = 0
    for e in list(msp):
        if e.dxf.handle not in out.keep_handles:
            msp.delete_entity(e)
            removed += 1
    log: list[dict] = []
    if out.layers:
        normalise_layers(doc, out.layers, log)
    purged: list[str] = []
    if purge_unused:
        for name in unused_block_names(doc):
            block = doc.blocks.get(name)
            if block is not None and not block.block_record.is_xref:
                doc.blocks.delete_block(name, safe=False)
                purged.append(name)
        if purged:
            log.append({"action": "unused_blocks_omitted", "blocks": purged})
    if set_units and out.kind != "additional":
        if doc.header.get("$INSUNITS", 0) != manifest.units["insunits"]:
            log.append({"action": "header_set", "var": "$INSUNITS", "before": doc.header.get("$INSUNITS", 0),
                        "after": manifest.units["insunits"], "basis": "engineer confirmed metres"})
            doc.header["$INSUNITS"] = manifest.units["insunits"]
    if out.kind != "additional" and doc.header.get("$LUNITS", 2) != manifest.units["lunits"]:
        log.append({"action": "header_set", "var": "$LUNITS", "before": doc.header.get("$LUNITS"),
                    "after": manifest.units["lunits"]})
        doc.header["$LUNITS"] = manifest.units["lunits"]
    cv = doc.header.custom_vars
    for tag, value in (("M4ADM_STATUS", PROVISIONAL_LABEL), ("M4ADM_SPEC_VERSION", manifest.version),
                       ("M4ADM_JOB", job_id), ("M4ADM_SOURCE_SHA256", source_sha),
                       ("M4ADM_DATASET", out.kind)):
        if cv.has_tag(tag):
            cv.replace(tag, value)
        else:
            cv.append(tag, value)
    doc.dxfversion = "AC1024"  # R2010 family: readable by AutoCAD 2010-2012
    atomic_save_doc(doc, out.path)
    verify = verify_output(out.path, out.keep_handles)
    return {"dataset": out.kind, "file": out.path.name, "entities": len(out.keep_handles),
            "removed_other_datasets": removed, "changes": log, "verification": verify,
            "sha256": sha256_file(out.path), "dxf_version": "AC1024 (R2010)"}


def verify_output(path: Path, expected_handles: set[str]) -> dict:
    """Re-read a written file and confirm it is complete and structurally sound."""
    doc, auditor = recover.readfile(str(path))
    handles = {e.dxf.handle for e in doc.modelspace()}
    ok = handles == expected_handles and not auditor.has_errors
    return {
        "ok": ok,
        "reread_entities": len(handles),
        "missing_handles": sorted(expected_handles - handles)[:50],
        "unexpected_handles": sorted(handles - expected_handles)[:50],
        "audit_errors": [str(e.message) for e in auditor.errors][:50],
    }
