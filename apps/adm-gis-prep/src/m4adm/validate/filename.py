"""File name and submission metadata validation (Section 4.2)."""
from __future__ import annotations

import re
from datetime import datetime

from m4adm.models import Metadata, Severity
from m4adm.validate import Collector

_ILLEGAL_PROJECT_CHARS = re.compile(r"[_<>\s/\\:*?\"|]")


def build_stem(meta: Metadata, dataset_token: str) -> str:
    return f"{meta.project_id}_{meta.submission_date}_{meta.drawing_type}_{dataset_token}_{meta.spec_type}"


def validate_stem(stem: str, col: Collector, *, context: str = "") -> bool:
    """Validate a file-name stem (no extension). Returns True when no ERROR was raised."""
    fn = col.manifest.filename
    before = sum(1 for f in col.findings if f.severity == Severity.ERROR)
    where = f" ({context})" if context else ""
    if "<" in stem or ">" in stem:
        col.add("ADM-NAME-007", f"File name '{stem}' contains '<' or '>'{where}.",
                "Remove the angle brackets; they only show the syntax in the specification.")
    parts = stem.split("_")
    if len(parts) != 5:
        col.add(
            "ADM-NAME-001",
            f"File name '{stem}' has {len(parts)} underscore-separated parts; 5 are required{where}.",
            "Use <ProjectID>_<YYYYMMDD>_<AP/MP>_<Plot/Roads/Services/additional>_<ADM/DOT>. "
            "The project ID itself must not contain underscores.",
        )
        return False
    project, date, dtype, dataset, spec = parts
    if not project or _ILLEGAL_PROJECT_CHARS.search(project):
        col.add("ADM-NAME-002", f"Project ID '{project}' is empty or contains spaces/separators{where}.",
                "Enter the unique CDP project code exactly as issued by the ADM CDP system.")
    if not re.fullmatch(r"\d{8}", date):
        col.add("ADM-NAME-003", f"Date '{date}' is not 8 digits YYYYMMDD{where}.",
                "Enter the submission date as YYYYMMDD, e.g. 20240131.")
    else:
        try:
            datetime.strptime(date, "%Y%m%d")
        except ValueError:
            col.add("ADM-NAME-003", f"Date '{date}' is not a real calendar date (YYYYMMDD){where}.",
                    "Correct the year, month and day.")
    if dtype not in fn["drawing_types"]:
        col.add("ADM-NAME-004", f"Drawing type '{dtype}' is not AP or MP{where}.",
                "Use AP (As Planned: one or two related themes) or MP (Master Plan: all three themes).")
    if dataset not in fn["dataset_tokens"]:
        hint = next((t for t in fn["dataset_tokens"] if t.lower() == dataset.lower()), None)
        col.add(
            "ADM-NAME-005",
            f"Dataset '{dataset}' is not one of {', '.join(fn['dataset_tokens'])}{where}.",
            f"Use '{hint}' exactly as written in the specification examples." if hint
            else "Use Plot, Roads, Services or additional.",
        )
    if spec not in fn["spec_types"]:
        col.add("ADM-NAME-006", f"Specification type '{spec}' is not ADM or DOT{where}.",
                "Use ADM for submissions prepared to the ADM CAD specification.")
    return sum(1 for f in col.findings if f.severity == Severity.ERROR) == before


def validate_filename(name: str, col: Collector) -> bool:
    """Validate a complete file name including the extension."""
    ok = True
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    if f".{ext.lower()}" != col.manifest.filename["extension"]:
        col.add("ADM-NAME-009", f"Extension '.{ext}' is not .dwg.", "Submit the drawing as a .dwg file.",
                severity=Severity.ERROR)
        ok = False
    return validate_stem(stem, col) and ok


def validate_metadata(meta: Metadata, categories: list[str], col: Collector) -> None:
    if meta.drawing_type == "MP" and set(categories) != {"plot", "roads", "services"}:
        missing = sorted({"plot", "roads", "services"} - set(categories))
        col.add(
            "ADM-NAME-008",
            f"Master Plan (MP) submission is missing theme(s): {', '.join(missing)}.",
            "Select Plot, Roads and Services together, or use drawing type AP for a partial submission.",
        )
    if not (meta.consultant_name.strip() or meta.contractor_name.strip()):
        col.add(
            "ADM-TTL-002",
            "No consultant or contractor name entered in the job metadata.",
            "Enter at least the main consultant or main contractor name, and make sure the drawing's "
            "Title attribute block carries it (the tool does not write title blocks without the official template).",
            severity=Severity.WARNING,
        )
