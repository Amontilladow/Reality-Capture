"""Entity classification: describe what each model-space entity actually is.

No meaning is assigned here. The classifier records the real structure of every entity
(LWPOLYLINE vs 2D/3D POLYLINE vs mesh, bulges, widths, elevation, OCS, block attributes)
so later stages can apply rules by role instead of by entity type alone.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from ezdxf.document import Drawing
from ezdxf.entities import DXFGraphic

BYLAYER_COLOR = 256
BYLAYER_LINEWEIGHT = -1

THREE_D_TYPES = {"3DFACE", "3DSOLID", "BODY", "REGION", "SURFACE", "EXTRUDEDSURFACE", "LOFTEDSURFACE",
                 "REVOLVEDSURFACE", "SWEPTSURFACE", "PLANESURFACE", "NURBSSURFACE", "MESH", "POLYFACE",
                 "POLYMESH"}
CURVE_TYPES = {"ARC", "ELLIPSE", "SPLINE"}
PROHIBITED_TYPES = {"HATCH", "SOLID", "XLINE", "LINE", "MPOLYGON"}
TEXT_TYPES = {"TEXT", "MTEXT", "ATTDEF"}
PROXY_TYPES = {"ACAD_PROXY_ENTITY"}


@dataclass
class EntityRecord:
    handle: str
    dxftype: str
    structure: str                      # LWPOLYLINE, POLYLINE2D, POLYLINE3D, POLYMESH, POLYFACE, INSERT, ...
    layer: str                          # layer as found in the drawing
    entity: DXFGraphic = field(repr=False)
    points: list[tuple[float, float]] = field(default_factory=list)   # WCS XY, vertex order
    closed: bool = False
    has_bulges: bool = False
    has_width: bool = False
    elevation: float = 0.0
    thickness: float = 0.0
    z_values: list[float] = field(default_factory=list)
    standard_extrusion: bool = True
    block_name: str | None = None
    attribs: dict[str, str] = field(default_factory=dict)              # tag (as stored) -> value
    is_xref: bool = False
    block_missing: bool = False
    location: tuple[float, float] | None = None
    overrides: dict[str, Any] = field(default_factory=dict)
    vertex_flags_curve_fit: bool = False

    @property
    def is_polyline_like(self) -> bool:
        return self.structure in ("LWPOLYLINE", "POLYLINE2D")

    @property
    def attribs_upper(self) -> dict[str, str]:
        return {k.upper(): v for k, v in self.attribs.items()}


def _xy(v) -> tuple[float, float]:
    return (float(v[0]), float(v[1]))


def _overrides(e: DXFGraphic) -> dict[str, Any]:
    out: dict[str, Any] = {}
    color = e.dxf.get("color", BYLAYER_COLOR)
    if color != BYLAYER_COLOR:
        out["color"] = color
    if e.dxf.hasattr("true_color"):
        out["true_color"] = e.dxf.true_color
    linetype = e.dxf.get("linetype", "BYLAYER")
    if linetype.upper() != "BYLAYER":
        out["linetype"] = linetype
    lw = e.dxf.get("lineweight", BYLAYER_LINEWEIGHT)
    if lw != BYLAYER_LINEWEIGHT:
        out["lineweight"] = lw
    return out


def _extrusion_ok(e: DXFGraphic) -> bool:
    if not e.dxf.hasattr("extrusion"):
        return True
    x, y, z = e.dxf.extrusion
    return math.isclose(x, 0, abs_tol=1e-9) and math.isclose(y, 0, abs_tol=1e-9) and math.isclose(z, 1, abs_tol=1e-9)


def classify_entity(e: DXFGraphic, doc: Drawing) -> EntityRecord:
    t = e.dxftype()
    rec = EntityRecord(handle=e.dxf.handle, dxftype=t, structure=t, layer=e.dxf.get("layer", "0"), entity=e)
    rec.overrides = _overrides(e)
    rec.standard_extrusion = _extrusion_ok(e)
    rec.thickness = float(e.dxf.get("thickness", 0.0) or 0.0) if e.dxf.is_supported("thickness") else 0.0

    if t == "LWPOLYLINE":
        rec.elevation = float(e.dxf.get("elevation", 0.0))
        ocs = e.ocs()
        pts = list(e.get_points("xyseb"))
        rec.points = [_xy(ocs.to_wcs((x, y, rec.elevation))) for x, y, *_ in pts]
        rec.closed = bool(e.closed)
        rec.has_bulges = any(abs(p[4]) > 1e-12 for p in pts)
        const_width = float(e.dxf.get("const_width", 0.0))
        rec.has_width = const_width != 0.0 or any(p[2] != 0.0 or p[3] != 0.0 for p in pts)
        rec.z_values = [rec.elevation] if rec.elevation else []
    elif t == "POLYLINE":
        mode = e.get_mode()
        rec.structure = {
            "AcDb2dPolyline": "POLYLINE2D",
            "AcDb3dPolyline": "POLYLINE3D",
            "AcDbPolygonMesh": "POLYMESH",
            "AcDbPolyFaceMesh": "POLYFACE",
        }.get(mode, "POLYLINE?")
        rec.closed = bool(e.is_closed)
        verts = list(e.vertices)
        if rec.structure == "POLYLINE2D":
            ocs = e.ocs()
            rec.elevation = float(e.dxf.elevation[2]) if e.dxf.hasattr("elevation") else 0.0
            rec.points = [_xy(ocs.to_wcs((v.dxf.location[0], v.dxf.location[1], rec.elevation))) for v in verts]
            rec.has_bulges = any(abs(v.dxf.get("bulge", 0.0)) > 1e-12 for v in verts)
            rec.has_width = (
                e.dxf.get("default_start_width", 0.0) != 0.0
                or e.dxf.get("default_end_width", 0.0) != 0.0
                or any(v.dxf.get("start_width", 0.0) != 0.0 or v.dxf.get("end_width", 0.0) != 0.0 for v in verts)
            )
            rec.vertex_flags_curve_fit = any(v.dxf.get("flags", 0) & (1 | 8) for v in verts) or bool(
                e.dxf.get("flags", 0) & (2 | 4)
            )
            rec.z_values = [rec.elevation] if rec.elevation else []
        else:
            rec.points = [_xy(v.dxf.location) for v in verts if v.dxf.hasattr("location")]
            rec.z_values = [float(v.dxf.location[2]) for v in verts if v.dxf.hasattr("location")]
    elif t == "INSERT":
        rec.block_name = e.dxf.name
        ins = e.ocs().to_wcs(e.dxf.insert)
        rec.location = _xy(ins)
        rec.points = [rec.location]
        rec.z_values = [float(ins[2])] if abs(ins[2]) > 0 else []
        rec.attribs = {a.dxf.tag: a.dxf.get("text", "") for a in e.attribs}
        block = doc.blocks.get(rec.block_name)
        if block is None:
            rec.block_missing = True
        else:
            rec.is_xref = bool(block.block_record.is_xref or block.block.dxf.get("flags", 0) & 4)
    elif t in ("LINE",):
        rec.points = [_xy(e.dxf.start), _xy(e.dxf.end)]
        rec.location = rec.points[0]
        rec.z_values = [z for z in (e.dxf.start[2], e.dxf.end[2]) if z]
    elif t in ("POINT",):
        rec.location = _xy(e.dxf.location)
        rec.points = [rec.location]
        rec.z_values = [e.dxf.location[2]] if e.dxf.location[2] else []
    elif t in ("ARC", "CIRCLE"):
        rec.location = _xy(e.ocs().to_wcs(e.dxf.center))
    else:
        for attr in ("insert", "center", "location", "defpoint", "start"):
            if e.dxf.is_supported(attr) and e.dxf.hasattr(attr):
                try:
                    rec.location = _xy(e.dxf.get(attr))
                except (TypeError, IndexError):
                    pass
                break
    if rec.location is None and rec.points:
        rec.location = rec.points[0]
    return rec


def classify_layout(doc: Drawing, layout=None) -> list[EntityRecord]:
    layout = layout if layout is not None else doc.modelspace()
    return [classify_entity(e, doc) for e in layout]


def paperspace_entity_count(doc: Drawing) -> int:
    return sum(len(layout) for layout in doc.layouts if not layout.is_modelspace)


def referenced_block_names(doc: Drawing) -> set[str]:
    """Names of blocks referenced anywhere (model/paper space and nested blocks)."""
    used: set[str] = set()

    def visit(entities) -> None:
        for e in entities:
            t = e.dxftype()
            if t == "INSERT":
                used.add(e.dxf.name)
            elif t == "DIMENSION" and e.dxf.hasattr("geometry"):
                used.add(e.dxf.geometry)

    for layout in doc.layouts:
        visit(layout)
    # Arrow blocks referenced by dimension styles count as used (as in AutoCAD PURGE).
    for ds in doc.dimstyles:
        for attr in ("dimblk", "dimblk1", "dimblk2", "dimldrblk"):
            name = ds.dxf.get(attr, "")
            if name:
                used.add(name)
        for attr in ("dimblk_handle", "dimblk1_handle", "dimblk2_handle", "dimldrblk_handle"):
            handle = ds.dxf.get(attr)
            rec = doc.entitydb.get(handle) if handle else None
            if rec is not None and rec.dxf.hasattr("name"):
                used.add(rec.dxf.name)
    # Follow nesting until no new names appear.
    frontier = set(used)
    while frontier:
        nxt: set[str] = set()
        for name in frontier:
            block = doc.blocks.get(name)
            if block is None:
                continue
            before = set(used)
            visit(block)
            nxt |= used - before
        frontier = nxt
    return used


def unused_block_names(doc: Drawing) -> list[str]:
    used = {n.upper() for n in referenced_block_names(doc)}
    out = []
    for block in doc.blocks:
        name = block.name
        if block.block_record.is_any_layout:
            continue
        if name.startswith("*"):  # anonymous blocks belong to their owners (dimensions, hatches, ...)
            continue
        if name.upper() not in used:
            out.append(name)
    return sorted(out)


def unused_linetypes(doc: Drawing) -> list[str]:
    used = {"BYLAYER", "BYBLOCK", "CONTINUOUS"}
    for layer in doc.layers:
        used.add(layer.dxf.get("linetype", "Continuous").upper())
    for layout in doc.layouts:
        for e in layout:
            used.add(e.dxf.get("linetype", "BYLAYER").upper())
    for block in doc.blocks:
        for e in block:
            used.add(e.dxf.get("linetype", "BYLAYER").upper())
    return sorted(lt.dxf.name for lt in doc.linetypes if lt.dxf.name.upper() not in used)


def xref_block_names(doc: Drawing) -> list[str]:
    return sorted(b.name for b in doc.blocks if b.block_record.is_xref or b.block.dxf.get("flags", 0) & 4)
