"""Settings for CAD-to-GIS conversion (architectural floor plan -> DRM BDMS 4.1 building floor).

Every tolerance is in METRES of the source drawing after unit conversion, so the same settings work for a
drawing in millimetres or metres. Layer patterns are case-insensitive fnmatch patterns matched against the
EFFECTIVE layer of each primitive (entities on layer "0" inside a block take the layer of the block reference).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from m4adm.models import CRSSettings, Metadata

# Source layer roles. The defaults match common architectural layer naming (AIA / Revit exports such as
# "A-200-M_WALL"); every project can override them, and the report lists which source layers matched each role.
DEFAULT_ROLES: dict[str, list[str]] = {
    # Linework and hatches that physically separate spaces.
    "wall": ["*WALL*", "*CURT_WALL*", "*CURT_PANEL*", "*COLUMN*", "*COLM*", "*DOOR*FRAME*"],
    # Window geometry -> Window features (also a barrier).
    "window": ["*CURT_PANEL*", "*WINDOW*", "*GLAZ*"],
    # Door blocks / leaves -> Door features where an opening is found next to them.
    "door": ["*DOOR*"],
    # Text naming rooms ("OFFICE AREA") and room numbers ("01-11").
    "room_label": ["*FLOR-IDEN*", "*ROOM*", "*RM-NAME*", "*RMNO*", "*SPACE*NAME*", "*ROOM-IDEN*"],
}
# Layers whose names contain these words are never barriers even if a role pattern matches
# (e.g. "A-WALL-PAT" is a wall hatch and IS a barrier; "A-ANNO-WALL-TAG" is annotation and is not).
DEFAULT_NEVER_BARRIER = ["*ANNO*", "*IDEN*", "*TEXT*", "*DIM*", "*TAG*", "*GRID*", "*TBLE*", "*TITLE*"]


class ConversionTolerances(BaseModel):
    # Gaps up to this width between barrier geometry are closed (drafting gaps, wall lines that do not quite
    # meet). Every closed gap is logged. Larger gaps are treated as openings.
    gap_close: float = 0.02
    # Openings between two aligned wall ends whose width is in this range are closed with a virtual line so
    # rooms separate at doorways. Each closure is logged and drawn in the preview.
    opening_min: float = 0.5
    opening_max: float = 2.5
    opening_alignment_deg: float = 5.0
    # Islands inside a room smaller than this (free-standing columns, small structure) are filled so the room
    # is one closed polyline; each fill is logged. Larger islands send the room to review.
    island_fill_max_area: float = 4.0
    # Regions narrower than this (everywhere) are wall cavities / slivers, not rooms.
    room_min_width: float = 0.45
    room_min_area: float = 0.8
    # Room-number text is paired with room-name text within this distance.
    label_pair_distance: float = 1.5
    # Curves are flattened with this maximum deviation.
    flatten: float = 0.005

    @field_validator("*")
    @classmethod
    def _positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("conversion tolerances must be positive")
        return v


class FeatureDecision(BaseModel):
    """An engineer's decision on one generated feature (by feature id from the conversion report)."""

    action: Literal["accept", "reject"]
    attributes: dict[str, str] = Field(default_factory=dict)   # target tag -> value, recorded as USER_ENTERED


class ConversionSettings(BaseModel):
    profile: Literal["bdms_building"] = "bdms_building"
    metadata: Metadata = Field(default_factory=Metadata)
    # Source units. "auto" reads $INSUNITS; anything unknown blocks conversion until declared.
    source_units: Literal["auto", "mm", "cm", "m"] = "auto"
    # Coordinates: control points are given in SOURCE drawing units (as read in CAD) -> target E/N metres.
    crs: CRSSettings = Field(default_factory=CRSSettings)
    roles: dict[str, list[str]] = Field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_ROLES.items()})
    never_barrier: list[str] = Field(default_factory=lambda: list(DEFAULT_NEVER_BARRIER))
    room_number_pattern: str = r"^\s*\d{1,3}\s*[-./]\s*\d{1,4}[A-Z]?\s*$"
    tolerances: ConversionTolerances = Field(default_factory=ConversionTolerances)
    # Floor-level facts the drawing cannot provide. Left empty -> reported as missing, never guessed.
    floor_height: str = ""
    building_number_of_floors: str = ""
    building_height: str = ""            # BuildingRoofDetail.BuildingHeight (m)
    building_usage_category: str = ""
    building_usage_type: str = ""
    # When the engineer declares the whole floor is one unit, a Unit feature is drawn on the floor outline
    # (status GENERATED_REQUIRES_REVIEW). Otherwise units are not generated: they cannot be derived from walls.
    single_unit_number: str = ""
    # Title block values the drawing cannot provide (DeveloperName, PropertyName, BuildingName, DrawingType,
    # DateOfDrawing, DrawingScale ...): tag -> value, recorded as entered by the engineer.
    title_values: dict[str, str] = Field(default_factory=dict)
    feature_decisions: dict[str, FeatureDecision] = Field(default_factory=dict)
    # Optional DXF whose block definitions (Detail blocks, ProjectDetail, DrawingDetail) are copied into the
    # output, e.g. the official DRM template saved as DXF. Without it, blocks are built from the manifest's
    # attribute tables and the report says so.
    template_path: str | None = None
    validate_output: bool = True
