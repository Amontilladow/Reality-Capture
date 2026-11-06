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
# Profile name -> manifest file. Each profile is a complete, versioned rule set.
PROFILES = {
    "sdd_planning": "adm_v1.18.2.yaml",
    "bdms_building": "drm_bdms_v4.1.yaml",
}
DEFAULT_PROFILE = "sdd_planning"


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
    lineweight_accept: list[int] = Field(default_factory=list)
    nesting_levels: int = 0          # same-layer nesting allowed (BDMS spaces: 1 level)

    @property
    def lineweight_dxf(self) -> int:
        return -3 if self.lineweight == "default" else int(self.lineweight)

    @property
    def accepted_lineweights(self) -> list[int]:
        return [self.lineweight_dxf, *self.lineweight_accept]

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
    month_case: str | None = None    # "upper" -> warn when a date's month is not upper case


class BlockSpec(BaseModel):
    ref: Ref
    attributes: list[AttributeSpec]
    # Attribute order of the official template block, as stored in the DRM-accepted drawings. The official QC
    # reads attributes by position, so a block written in another order is read wrongly (ADM QC trial 02).
    template_order: list[str] | None = None

    @model_validator(mode="after")
    def _order_covers_attributes(self) -> "BlockSpec":
        if self.template_order is not None and \
                sorted(t.upper() for t in self.template_order) != sorted(a.tag.upper() for a in self.attributes):
            raise ValueError(f"template_order {self.template_order} does not list exactly the block's attributes")
        return self

    @property
    def insert_order(self) -> list[str]:
        """Attribute tags in the order a block must store them: the template order when known."""
        if self.template_order is None:
            return [a.tag for a in self.attributes]
        by_upper = {a.tag.upper(): a.tag for a in self.attributes}
        return [by_upper[t.upper()] for t in self.template_order]


class RuleSpec(BaseModel):
    id: str
    title: str
    evidence: Evidence
    severity: Severity
    check: str
    implementation: str
    ref: Ref | None = None
    limitation: str | None = None
    qc_error: str | None = None      # wording of the corresponding official QC tool error, when one exists


class Manifest(BaseModel):
    profile: str = DEFAULT_PROFILE
    spec: dict[str, Any]
    output: dict[str, Any]
    units: dict[str, Any]
    crs: dict[str, Any]
    filename: dict[str, Any]
    title_block: dict[str, Any] | None = None
    title_blocks: dict[str, Any] | None = None
    prohibited_entities: list[str] | None = None
    cross_layer_snapping: list[str] = Field(default_factory=list)
    rule_aliases: dict[str, str | None] = Field(default_factory=dict)
    categories: dict[str, CategorySpec]
    domains: dict[str, Any]
    blocks: dict[str, BlockSpec]
    tolerances: Tolerances
    rules: list[RuleSpec]
    path: Path | None = None
    sha256: str | None = None
    plot_usage: dict[str, list[str]] = Field(default_factory=dict)
    codelists: dict[str, Any] = Field(default_factory=dict)

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
        for src, target in self.rule_aliases.items():
            if target is not None and target not in ids:
                raise ValueError(f"alias {src} -> {target}: target rule not defined")
            if src in ids:
                raise ValueError(f"{src} is both a rule and an alias")
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

    def resolve(self, rule_id: str) -> str | None:
        """Map a (generic) rule id to this profile's rule id; None = not applicable in this profile."""
        if rule_id in self.rule_index:
            return rule_id
        if rule_id in self.rule_aliases:
            return self.rule_aliases[rule_id]
        raise KeyError(f"rule {rule_id} is neither defined nor aliased in manifest {self.profile} {self.version}")

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


def load_profile(profile: str = DEFAULT_PROFILE) -> Manifest:
    if profile not in PROFILES:
        raise ValueError(f"unknown profile {profile!r}; available: {', '.join(PROFILES)}")
    return load_manifest(path=rules_dir() / PROFILES[profile])


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
    codelists = data["spec"].get("codelists_file")
    if codelists:
        manifest.codelists = yaml.safe_load((path.parent / codelists).read_text(encoding="utf-8"))
    return manifest
