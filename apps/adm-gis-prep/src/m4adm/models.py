"""Shared data models: findings, mapping decisions, fix proposals, job settings."""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class Severity(str, Enum):
    ERROR = "ERROR"      # definite violation of a rule
    WARNING = "WARNING"  # possible issue, needs engineer review
    INFO = "INFO"        # information only


class Evidence(str, Enum):
    VERIFIED_SPEC = "VERIFIED_SPEC"
    ENGINEERING_CHECK = "ENGINEERING_CHECK"
    PENDING_OFFICIAL_CONFIRMATION = "PENDING_OFFICIAL_CONFIRMATION"
    USER_DECISION_REQUIRED = "USER_DECISION_REQUIRED"


class Finding(BaseModel):
    """One traceable QC result. `handle` is the source drawing handle when applicable."""

    rule_id: str
    severity: Severity
    evidence: Evidence
    message: str
    action: str = Field(description="What the engineer should do next")
    handle: str | None = None
    layer: str | None = None
    entity_type: str | None = None
    location: tuple[float, float] | None = None
    category: str | None = None
    blocking: bool = False
    ref: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class Category(str, Enum):
    plot = "plot"
    roads = "roads"
    services = "services"


class Tolerances(BaseModel):
    coincidence: float = 0.001
    snap_search: float = 0.05
    zero_length: float = 0.001
    overlap_area: float = 0.0001
    arc_sagitta: float = 0.01
    attribute_vertex: float = 0.001

    @field_validator("*")
    @classmethod
    def _positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("tolerances must be positive")
        return v


class Metadata(BaseModel):
    """Project / submission metadata entered by the engineer."""

    project_id: str = ""
    submission_date: str = ""          # YYYYMMDD
    drawing_type: str = ""             # AP | MP
    spec_type: str = "ADM"             # ADM | DOT
    consultant_name: str = ""
    contractor_name: str = ""
    prepared_by: str = ""
    notes: str = ""


class CRSSettings(BaseModel):
    source_crs: str | None = None      # e.g. "EPSG:32640"; None = unknown
    source_confirmed: bool = False
    target_crs: str = "EPSG:32640"
    # Explicit transformation request. Only honoured with confirm_transformation.
    transform_pipeline: str | None = None
    confirm_transformation: bool = False


class JobSettings(BaseModel):
    categories: list[Category]
    metadata: Metadata = Field(default_factory=Metadata)
    crs: CRSSettings = Field(default_factory=CRSSettings)
    units_confirmed_metres: bool = False
    tolerances: Tolerances | None = None   # None = manifest defaults
    # Layer mapping accepted by the engineer: source layer name -> ADM layer name.
    layer_mapping: dict[str, str] = Field(default_factory=dict)
    # Per-entity override: source handle -> ADM layer name (or "__exclude__").
    handle_mapping: dict[str, str] = Field(default_factory=dict)
    # Accepted fix proposal ids, or "all:<KIND>" to accept every proposal of a kind.
    accepted_fixes: list[str] = Field(default_factory=list)
    write_additional_file: bool = True
    purge_unused_blocks: bool = True
    template_path: str | None = None
    parent_job: str | None = None

    @field_validator("categories")
    @classmethod
    def _non_empty(cls, v: list[Category]) -> list[Category]:
        if not v:
            raise ValueError("select at least one category (plot, roads, services)")
        return list(dict.fromkeys(v))


FixKind = Literal["CLOSE_FLAG", "TO_LWPOLYLINE", "DENSIFY_BULGES", "BYLAYER"]


class FixProposal(BaseModel):
    id: str
    kind: FixKind
    handle: str
    layer: str | None
    description: str
    lossless: bool
    rule_id: str
    details: dict[str, Any] = Field(default_factory=dict)


class MappingDecision(BaseModel):
    source_layer: str
    target_layer: str | None
    category: str | None
    status: Literal["VERIFIED_NAME", "ALIAS", "CASE_VARIANT", "USER_ACCEPTED", "UNRESOLVED", "OUT_OF_SCOPE"]
    entity_count: int
    suggestions: list[str] = Field(default_factory=list)
    note: str = ""
