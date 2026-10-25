"""Versioned rule manifest loader.

All ADM requirements live in ``rules/adm_v<version>.yaml``. Code never hard-codes layer
names, colours, attribute definitions or domain values; it asks the manifest.
"""
from __future__ import annotations

import hashlib
import os
from functools import cached_property
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, model_validator

from m4adm.models import Evidence, Severity, Tolerances

DEFAULT_SPEC_VERSION = "1.18.2"


def rules_dir() -> Path:
    env = os.environ.get("M4ADM_RULES_DIR")
    if env:
        return Path(env)
    # src/m4adm/rules/__init__.py -> apps/adm-gis-prep/rules
    return Path(__file__).resolve().parents[3] / "rules"


class Ref(BaseModel):
    page: int | str | None = None
    section: str | None = None
    table: str | None = None
    figure: str | None = None
    rule: int | None = None
    note: int | None = None

    def text(self) -> str:
        parts = []
        if self.page is not None:
            parts.append(f"p.{self.page}")
        if self.section:
            parts.append(f"§{self.section}")
        if self.table:
            parts.append(self.table)
        if self.figure:
            parts.append(self.figure)
        if self.rule is not None:
            parts.append(f"rule {self.rule}")
        if self.note is not None:
            parts.append(f"note {self.note}")
        return ", ".join(parts)


class LayerSpec(BaseModel):
    name: str
    topology: str           # polyline | point | dimension | title
    constraint: str         # closed | none | attribute_block
    color: int
    linetype: str
    lineweight: int | str   # "default" or hundredths of mm
    detail: str | None = None
    parent: str | None = None
    block: str | None = None
    aliases: list[str] = Field(default_factory=list)
    shared: bool = False
    standalone_point: bool = False

    @property
    def lineweight_dxf(self) -> int:
        return -3 if self.lineweight == "default" else int(self.lineweight)

    @property
    def is_geometry(self) -> bool:
        return self.topology == "polyline"

    @property
    def is_detail(self) -> bool:
        return self.constraint == "attribute_block"

    @property
    def is_closed(self) -> bool:
        return self.topology == "polyline" and self.constraint == "closed"


class CategorySpec(BaseModel):
    label: str
    file_token: str
    ref: Ref
    layers: list[LayerSpec]


class AttributeSpec(BaseModel):
    tag: str
    type: str
    mandatory: bool
    domain: str | None = None
    depends_on: str | None = None
    required_if_present: str | None = None
    max_length: int | None = None


class BlockSpec(BaseModel):
    ref: Ref
    attributes: list[AttributeSpec]


class RuleSpec(BaseModel):
    id: str
    title: str
    evidence: Evidence
    severity: Severity
    check: str
    implementation: str
    ref: Ref | None = None
    limitation: str | None = None


class Manifest(BaseModel):
    spec: dict[str, Any]
    output: dict[str, Any]
    units: dict[str, Any]
    crs: dict[str, Any]
    filename: dict[str, Any]
    title_block: dict[str, Any]
    categories: dict[str, CategorySpec]
    domains: dict[str, Any]
    blocks: dict[str, BlockSpec]
    tolerances: Tolerances
    rules: list[RuleSpec]
    path: Path | None = None
    sha256: str | None = None
    plot_usage: dict[str, list[str]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _consistency(self) -> "Manifest":
        ids = [r.id for r in self.rules]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate rule ids: {sorted(dupes)}")
        for cat in self.categories.values():
            names = {l.name for l in cat.layers}
            for layer in cat.layers:
                if layer.detail and layer.detail not in names:
                    raise ValueError(f"{layer.name}: detail layer {layer.detail} not defined")
                if layer.parent and layer.parent not in names:
                    raise ValueError(f"{layer.name}: parent layer {layer.parent} not defined")
                if layer.block and layer.block not in self.blocks:
                    raise ValueError(f"{layer.name}: block {layer.block} not defined")
        for bname, block in self.blocks.items():
            for att in block.attributes:
                if att.domain and att.domain not in self.domains:
                    raise ValueError(f"{bname}.{att.tag}: unknown domain {att.domain}")
        return self

    # ------------------------------------------------------------------ lookups
    @property
    def version(self) -> str:
        return str(self.spec["version"])

    @cached_property
    def rule_index(self) -> dict[str, RuleSpec]:
        return {r.id: r for r in self.rules}

    def rule(self, rule_id: str) -> RuleSpec:
        try:
            return self.rule_index[rule_id]
        except KeyError as exc:  # a check referencing a rule that is not in the manifest is a bug
            raise KeyError(f"rule {rule_id} is not defined in manifest {self.version}") from exc

    def layers_for(self, category: str) -> list[LayerSpec]:
        return self.categories[category].layers

    def layer(self, category: str, name: str) -> LayerSpec | None:
        for layer in self.categories[category].layers:
            if layer.name == name:
                return layer
        return None

    def all_layer_names(self) -> dict[str, set[str]]:
        """ADM layer name -> categories that define it."""
        out: dict[str, set[str]] = {}
        for cat, spec in self.categories.items():
            for layer in spec.layers:
                out.setdefault(layer.name, set()).add(cat)
        return out

    def domain_values(self, name: str) -> list[str]:
        if name == "plot_usage_category":
            return list(self.plot_usage)
        return list(self.domains[name])


def load_manifest(version: str = DEFAULT_SPEC_VERSION, path: Path | None = None) -> Manifest:
    path = path or rules_dir() / f"adm_v{version}.yaml"
    raw_bytes = path.read_bytes()
    data = yaml.safe_load(raw_bytes)
    manifest = Manifest(**data)
    manifest.path = path
    manifest.sha256 = hashlib.sha256(raw_bytes).hexdigest()
    usage_file = data["spec"].get("plot_usage_domain_file")
    if usage_file:
        usage = yaml.safe_load((path.parent / usage_file).read_text(encoding="utf-8"))
        if usage.get("source_pdf_sha256") != data["spec"]["source_pdf_sha256"]:
            raise ValueError("plot usage domain was extracted from a different PDF than the manifest")
        manifest.plot_usage = usage["usage_by_category"]
    return manifest
