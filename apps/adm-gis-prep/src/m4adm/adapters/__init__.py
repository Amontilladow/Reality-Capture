"""Integration points for files and tools M4 does not have yet.

Every adapter here is an interface plus configuration. None of them fabricates the
official artefact it stands in for:

* ``DWGConverter``      - DXF <-> DWG through ODA File Converter (free, separately licensed
                          download) when the engineer installs it and points M4ADM_ODA_CONVERTER
                          at it. Not installed in this build -> status UNAVAILABLE.
* ``OfficialTemplate``  - loads the official ADM template (as DXF) and compares its layers and
                          attribute block definitions with the manifest. PENDING: no template yet.
* ``OfficialQC``        - the official ADM QC tool is an AutoCAD .FAS (compiled LISP) that runs
                          inside AutoCAD. It cannot run here and must not be re-created. This
                          adapter only archives the real output of a manual run.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import ezdxf

from m4adm.io import sha256_file
from m4adm.rules import Manifest

STATUS_UNAVAILABLE = "UNAVAILABLE"
STATUS_AVAILABLE_UNTESTED = "AVAILABLE_UNTESTED"
STATUS_PENDING = "PENDING_OFFICIAL_FILE"
STATUS_LOADED = "LOADED"


# --------------------------------------------------------------------------- DWG conversion
@dataclass
class DWGConverter:
    """ODA File Converter command-line wrapper.

    CLI form (per ODA documentation):
        ODAFileConverter <in_dir> <out_dir> <out_version> <out_type> <recurse> <audit> [filter]
    e.g. ODAFileConverter in out ACAD2010 DWG 0 1 "*.DXF"
    """

    executable: str | None = None

    @classmethod
    def from_env(cls) -> "DWGConverter":
        exe = os.environ.get("M4ADM_ODA_CONVERTER") or shutil.which("ODAFileConverter")
        return cls(exe)

    def status(self) -> str:
        if self.executable and Path(self.executable).exists():
            return STATUS_AVAILABLE_UNTESTED
        return STATUS_UNAVAILABLE

    def command(self, in_dir: Path, out_dir: Path, out_type: str, version: str = "ACAD2010",
                pattern: str = "*.DXF") -> list[str]:
        if out_type not in ("DWG", "DXF"):
            raise ValueError("out_type must be DWG or DXF")
        return [str(self.executable), str(in_dir), str(out_dir), version, out_type, "0", "1", pattern]

    def convert(self, in_dir: Path, out_dir: Path, out_type: str, pattern: str) -> subprocess.CompletedProcess:
        if self.status() == STATUS_UNAVAILABLE:
            raise RuntimeError(
                "DWG conversion unavailable: install ODA File Converter and set M4ADM_ODA_CONVERTER, "
                "or convert in AutoCAD (SAVEAS / DXFOUT)."
            )
        return subprocess.run(self.command(in_dir, out_dir, out_type, pattern=pattern), capture_output=True,
                              text=True, timeout=600, check=False)


# --------------------------------------------------------------------------- template
@dataclass
class TemplateComparison:
    status: str
    path: str | None = None
    sha256: str | None = None
    missing_layers: list[str] = field(default_factory=list)
    extra_layers: list[str] = field(default_factory=list)
    layer_property_differences: list[str] = field(default_factory=list)
    block_tag_differences: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    missing_blocks: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class OfficialTemplate:
    """Reads the official ADM template once M4 receives it (converted to DXF if needed)."""

    def __init__(self, path: Path | None):
        self.path = Path(path) if path else None

    def compare(self, manifest: Manifest, category: str) -> TemplateComparison:
        if not self.path:
            return TemplateComparison(STATUS_PENDING, notes=[
                "Official ADM DWG template not supplied. Layer, block, title-block, dimension-style and "
                "linetype definitions are taken from the PDF tables only; nothing is fabricated."])
        if self.path.suffix.lower() != ".dxf":
            return TemplateComparison(STATUS_PENDING, str(self.path), notes=[
                "Template must be supplied as DXF (convert the DWG with AutoCAD or ODA File Converter)."])
        doc = ezdxf.readfile(str(self.path))
        cmp = TemplateComparison(STATUS_LOADED, str(self.path), sha256_file(self.path))
        spec_layers = {l.name: l for l in manifest.layers_for(category)}
        tpl_layers = {l.dxf.name: l for l in doc.layers}
        tpl_lower = {n.lower(): n for n in tpl_layers}
        for name, spec in spec_layers.items():
            actual = tpl_layers.get(name) or tpl_layers.get(tpl_lower.get(name.lower(), ""))
            if actual is None:
                cmp.missing_layers.append(name)
                continue
            if actual.dxf.name != name:
                cmp.layer_property_differences.append(f"{name}: template spells it '{actual.dxf.name}'")
            if abs(actual.color) != spec.color:
                cmp.layer_property_differences.append(f"{name}: colour {abs(actual.color)} vs spec {spec.color}")
            if actual.dxf.get("linetype", "Continuous").lower() != spec.linetype.lower():
                cmp.layer_property_differences.append(
                    f"{name}: linetype {actual.dxf.get('linetype')} vs spec {spec.linetype}")
            if actual.dxf.get("lineweight", -3) != spec.lineweight_dxf:
                cmp.layer_property_differences.append(
                    f"{name}: lineweight {actual.dxf.get('lineweight')} vs spec {spec.lineweight_dxf}")
        known = {n.lower() for n in spec_layers} | {"0", "defpoints"}
        cmp.extra_layers = sorted(n for n in tpl_layers if n.lower() not in known)
        for name, spec in spec_layers.items():
            if not spec.block:
                continue
            block = doc.blocks.get(spec.block)
            if block is None:
                cmp.missing_blocks.append(spec.block)
                continue
            tpl_tags = {a.dxf.tag.upper() for a in block.query("ATTDEF")}
            spec_tags = {a.tag.upper() for a in manifest.blocks[spec.block].attributes}
            if tpl_tags != spec_tags:
                cmp.block_tag_differences[spec.block] = {
                    "only_in_template": sorted(tpl_tags - spec_tags),
                    "only_in_pdf": sorted(spec_tags - tpl_tags),
                }
        return cmp


# --------------------------------------------------------------------------- official QC
MANUAL_QC_PROCEDURE = [
    "Convert the prepared DXF to DWG (AutoCAD 2012 or earlier format) with AutoCAD or ODA File Converter.",
    "Open the DWG in AutoCAD on a workstation where the official ADM QC tool is installed.",
    "Load the QC tool with APPLOAD (<QC Tool>.fas, version matching specification 1.18.2) and run it as "
    "described in the official QC Tool User Manual.",
    "Save the QC tool's error-message report unchanged.",
    "Attach that report to this job (m4adm attach-qc or the 'Official QC' panel) with the outcome the tool reported.",
]


@dataclass
class OfficialQCResult:
    status: str                 # NOT_PERFORMED | PASSED | FAILED (as reported by the official tool)
    report_file: str | None = None
    report_sha256: str | None = None
    attested_by: str | None = None
    recorded_at: str | None = None


class OfficialQC:
    STATUS_LABEL = {
        "NOT_PERFORMED": "Official QC not yet performed",
        "PASSED": "Official QC passed (official tool output attached)",
        "FAILED": "Official QC failed (official tool output attached)",
    }

    @staticmethod
    def availability() -> str:
        # A .FAS runs only inside AutoCAD. No automated, supported execution path exists here.
        return STATUS_UNAVAILABLE
