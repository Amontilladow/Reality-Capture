"""Reading CAD input: format identification, hashing and safe DXF loading.

The source file is only ever opened for reading. Loading happens from a byte-identical
copy inside the job working directory (see ``m4adm.export.JobWorkspace``).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from ezdxf import recover
from ezdxf.filemanagement import dxf_file_info
from ezdxf.document import Drawing

# DWG/DXF version codes -> AutoCAD release family
ACAD_VERSIONS = {
    "AC1009": "R12",
    "AC1012": "R13",
    "AC1014": "R14",
    "AC1015": "AutoCAD 2000-2002",
    "AC1018": "AutoCAD 2004-2006",
    "AC1021": "AutoCAD 2007-2009",
    "AC1024": "AutoCAD 2010-2012",
    "AC1027": "AutoCAD 2013-2017",
    "AC1032": "AutoCAD 2018+",
}
# Releases that AutoCAD 2012 can open natively (spec: "not later than 2012").
MAX_ALLOWED_CODE = "AC1024"


@dataclass
class FileIdentity:
    path: Path
    format: str               # DXF-ASCII | DXF-BINARY | DWG | UNKNOWN
    version_code: str | None  # e.g. AC1024
    release: str | None
    size: int
    sha256: str
    notes: list[str] = field(default_factory=list)

    @property
    def release_ok(self) -> bool | None:
        if not self.version_code:
            return None
        return self.version_code <= MAX_ALLOWED_CODE

    def as_dict(self) -> dict:
        return {
            "path": str(self.path),
            "format": self.format,
            "version_code": self.version_code,
            "release": self.release,
            "release_within_autocad_2012": self.release_ok,
            "size_bytes": self.size,
            "sha256": self.sha256,
            "notes": self.notes,
        }


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def identify(path: Path) -> FileIdentity:
    """Identify the actual file format from its content, not its extension."""
    path = Path(path)
    data = path.read_bytes()
    head = data[:64]
    ident = FileIdentity(path, "UNKNOWN", None, None, len(data), hashlib.sha256(data).hexdigest())
    if head[:6].startswith(b"AC10") and head[:6].decode("ascii", "replace")[2:6].isdigit():
        ident.format = "DWG"
        ident.version_code = head[:6].decode("ascii")
    elif head.startswith(b"AutoCAD Binary DXF"):
        ident.format = "DXF-BINARY"
    else:
        text = data[:4096].decode("latin-1", "replace")
        stripped = text.lstrip()
        if stripped.startswith("0") and "SECTION" in text[:200]:
            ident.format = "DXF-ASCII"
        elif stripped.startswith("999"):
            ident.format = "DXF-ASCII"
    if ident.format.startswith("DXF"):
        try:
            ident.version_code = dxf_file_info(str(path)).version
        except Exception as exc:  # pragma: no cover - malformed header
            ident.notes.append(f"could not read DXF header: {exc}")
    if ident.version_code:
        ident.release = ACAD_VERSIONS.get(ident.version_code, "unknown release")
    ext = path.suffix.lower()
    if ident.format == "DWG" and ext != ".dwg":
        ident.notes.append(f"content is DWG but extension is {ext!r}")
    if ident.format.startswith("DXF") and ext != ".dxf":
        ident.notes.append(f"content is DXF but extension is {ext!r}")
    return ident


@dataclass
class LoadResult:
    doc: Drawing
    audit_errors: list[str]
    audit_fixes: list[str]


def load_dxf(path: Path) -> LoadResult:
    """Load a DXF in recover mode so damaged files still produce a report.

    Recover-mode repairs happen in memory only; they are reported as findings and the
    source file is never written.
    """
    doc, auditor = recover.readfile(str(path))
    return LoadResult(
        doc=doc,
        audit_errors=[str(e.message) for e in auditor.errors],
        audit_fixes=[str(f.message) for f in auditor.fixes],
    )
