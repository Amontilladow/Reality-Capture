"""Run history and post-run actions (export package, attaching real official-QC output).

A finished job folder is never rewritten. Post-run actions only add files and append to
the job's audit trail.
"""
from __future__ import annotations

import io
import json
import re
import shutil
import zipfile
from pathlib import Path

from m4adm.adapters import OfficialQC
from m4adm.audit import AuditLog, utc_now
from m4adm.export import atomic_write_bytes, atomic_write_json
from m4adm.io import sha256_file

JOB_ID_RE = re.compile(r"\d{8}T\d{6}Z-[0-9a-f]{8}")
PACKAGE_FILES = ("qc_report.html", "qc_report.json", "processing_manifest.json", "geometry_log.json",
                 "review_queue.json", "audit.jsonl", "README.txt")


def list_jobs(root: Path) -> list[dict]:
    root = Path(root)
    entries = []
    index = root / "index.jsonl"
    if index.exists():
        with open(index, encoding="utf-8") as fh:
            entries = [json.loads(line) for line in fh if line.strip()]
    failed = [{"job_id": p.name.removesuffix(".failed"), "status": "Failed (no valid output)", "finished": None,
               "source": None, "categories": []} for p in root.glob("*.failed")] if root.exists() else []
    return sorted(entries + failed, key=lambda e: e["job_id"], reverse=True)


def job_dir(root: Path, job_id: str) -> Path:
    if not JOB_ID_RE.fullmatch(job_id):
        raise ValueError("invalid job id")
    d = Path(root) / job_id
    if not (d / "qc_report.json").exists():
        raise FileNotFoundError(f"job {job_id} not found or not complete")
    return d


def load_report(job: Path) -> dict:
    return json.loads((Path(job) / "qc_report.json").read_text(encoding="utf-8"))


def official_qc_status(job: Path) -> dict:
    f = Path(job) / "official_qc" / "official_qc.json"
    if f.exists():
        data = json.loads(f.read_text(encoding="utf-8"))
        data["label"] = OfficialQC.STATUS_LABEL[data["status"]]
        return data
    return {"status": "NOT_PERFORMED", "label": OfficialQC.STATUS_LABEL["NOT_PERFORMED"]}


def export_package(job: Path, acknowledged_by: str, acknowledged: bool) -> Path:
    """Bundle outputs and reports after the engineer has reviewed the pre-export summary."""
    job = Path(job)
    if not acknowledged or not acknowledged_by.strip():
        raise PermissionError("export requires the engineer's name and an explicit review acknowledgement")
    report = load_report(job)
    stem = next((Path(o["file"]).stem for o in report["outputs"] if o["dataset"] != "additional"), job.name)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted((job / "output").glob("*")):
            z.write(f, f"output/{f.name}")
        for name in PACKAGE_FILES:
            if (job / name).exists():
                z.write(job / name, name)
        z.writestr("PROVISIONAL_NOT_ADM-VALIDATED.txt",
                   f"{report['label']}\n{report['disclaimer']}\nStatus at export: {report['status']['label']}\n"
                   f"Exported by {acknowledged_by} at {utc_now()} after reviewing the pre-export summary.\n")
    out_dir = job / "export"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"{stem.rsplit('_', 2)[0] if '_' in stem else stem}_{job.name}_package.zip"
    atomic_write_bytes(path, buf.getvalue())
    AuditLog(job / "audit.jsonl").record(
        "exported", by=acknowledged_by, package=str(path.relative_to(job)), sha256=sha256_file(path),
        status_at_export=report["status"]["label"], counts=report["status"]["counts"])
    return path


def attach_official_qc(job: Path, report_file: Path, outcome: str, attested_by: str) -> dict:
    """Archive the unmodified output of a real official ADM QC run against this job."""
    outcome = outcome.upper()
    if outcome not in ("PASSED", "FAILED"):
        raise ValueError("outcome must be PASSED or FAILED, as reported by the official ADM QC tool")
    if not attested_by.strip():
        raise ValueError("name of the engineer who ran the official QC tool is required")
    job = Path(job)
    dest_dir = job / "official_qc"
    dest_dir.mkdir(exist_ok=True)
    dest = dest_dir / Path(report_file).name
    shutil.copyfile(report_file, dest)
    record = {"status": outcome, "report_file": str(dest.relative_to(job)), "report_sha256": sha256_file(dest),
              "attested_by": attested_by, "recorded_at": utc_now(),
              "note": "Outcome as reported by the official ADM QC tool and attested by the engineer; the tool "
                      "output file is archived unchanged."}
    atomic_write_json(dest_dir / "official_qc.json", record)
    AuditLog(job / "audit.jsonl").record("official_qc_attached", **record)
    return record
