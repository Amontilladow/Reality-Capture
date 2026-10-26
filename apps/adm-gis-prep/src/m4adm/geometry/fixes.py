"""Opt-in geometry fixes.

A fix is only ever *proposed* by the tool. It is applied when the engineer accepts it
(by id, or all fixes of a kind), and every application is logged with before/after data.
Nothing is deleted except the original of a lossless POLYLINE->LWPOLYLINE conversion,
whose replacement is logged against the source handle.

Kinds:
  CLOSE_FLAG      lossless  - polyline already ends at its start vertex; drop the repeated
                              end vertex and set the Closed flag.
  TO_LWPOLYLINE   lossless  - 2D heavy POLYLINE without widths/curve-fit -> LWPOLYLINE with
                              identical vertices, bulges, elevation and OCS.
  DENSIFY_BULGES  lossy*    - replace arc segments with vertices; max deviation <= arc_sagitta.
  BYLAYER         no geometry change - reset colour/linetype/lineweight overrides to BYLAYER.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from ezdxf.document import Drawing

from m4adm.classify import EntityRecord
from m4adm.geometry import densify_xyb
from m4adm.models import FixProposal, Tolerances
from m4adm.rules import LayerSpec

ORDER = ["CLOSE_FLAG", "TO_LWPOLYLINE", "DENSIFY_BULGES", "BYLAYER"]


def propose(records: list[EntityRecord], specs: dict[str, LayerSpec], target: dict[str, str | None],
            tol: Tolerances, origin: dict[str, str]) -> list[FixProposal]:
    """origin maps current handle -> source handle (for entities replaced by earlier fixes)."""
    out: list[FixProposal] = []
    for r in records:
        tl = target.get(r.handle)
        spec = specs.get(tl) if tl else None
        if spec is None:
            continue
        src = origin.get(r.handle, r.handle)
        if spec.is_closed and r.structure == "LWPOLYLINE" and not r.closed and len(r.points) >= 4 \
                and math.dist(r.points[0], r.points[-1]) <= tol.coincidence:
            out.append(FixProposal(id=f"CLOSE_FLAG:{src}", kind="CLOSE_FLAG", handle=src, layer=tl, lossless=True,
                                   rule_id="ADM-LYR-006",
                                   description="Remove repeated end vertex and set Closed flag (shape unchanged)."))
        if spec.is_geometry and r.structure == "POLYLINE2D" and not r.has_width and not r.vertex_flags_curve_fit:
            out.append(FixProposal(id=f"TO_LWPOLYLINE:{src}", kind="TO_LWPOLYLINE", handle=src, layer=tl,
                                   lossless=True, rule_id="ADM-CAP-003",
                                   description="Convert 2D POLYLINE to LWPOLYLINE with identical vertices and bulges."))
        if spec.is_geometry and r.structure == "LWPOLYLINE" and r.has_bulges:
            out.append(FixProposal(id=f"DENSIFY_BULGES:{src}", kind="DENSIFY_BULGES", handle=src, layer=tl,
                                   lossless=False, rule_id="ADM-CAP-005B",
                                   description=f"Replace arc segments by vertices (max deviation {tol.arc_sagitta} m).",
                                   details={"arc_sagitta": tol.arc_sagitta}))
        if r.overrides and r.dxftype in ("LWPOLYLINE", "POLYLINE", "INSERT"):
            out.append(FixProposal(id=f"BYLAYER:{src}", kind="BYLAYER", handle=src, layer=tl, lossless=True,
                                   rule_id="ENG-GEO-003", description="Reset entity colour/linetype/lineweight to BYLAYER.",
                                   details={"overrides": r.overrides}))
    return out


def is_accepted(p: FixProposal, accepted: list[str]) -> bool:
    return p.id in accepted or f"all:{p.kind}" in accepted


@dataclass
class FixResult:
    applied: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    origin: dict[str, str] = field(default_factory=dict)  # new handle -> source handle


def apply_fixes(doc: Drawing, proposals: list[FixProposal], accepted: list[str], tol: Tolerances) -> FixResult:
    res = FixResult()
    current: dict[str, str] = {}  # source handle -> current handle
    todo = [p for p in proposals if is_accepted(p, accepted)]
    todo.sort(key=lambda p: ORDER.index(p.kind))
    for p in todo:
        handle = current.get(p.handle, p.handle)
        e = doc.entitydb.get(handle)
        if e is None or not e.is_alive:
            res.skipped.append({"fix": p.id, "reason": "entity not found"})
            continue
        if p.kind == "CLOSE_FLAG":
            pts = list(e.get_points("xyseb"))
            removed = pts[-1]
            e.set_points(pts[:-1], format="xyseb")
            e.closed = True
            res.applied.append({"fix": p.id, "kind": p.kind, "handle": handle, "source_handle": p.handle,
                                "removed_vertex": removed[:2], "vertices_before": len(pts),
                                "vertices_after": len(pts) - 1, "max_shape_change_m": 0.0})
        elif p.kind == "TO_LWPOLYLINE":
            new = _to_lwpolyline(doc, e)
            current[p.handle] = new.dxf.handle
            res.origin[new.dxf.handle] = p.handle
            res.applied.append({"fix": p.id, "kind": p.kind, "handle": new.dxf.handle, "source_handle": p.handle,
                                "replaced_handle": handle, "vertices": len(new), "max_shape_change_m": 0.0})
        elif p.kind == "DENSIFY_BULGES":
            raw = [(x, y, b) for x, y, b in e.get_points("xyb")]
            pts, dev = densify_xyb(raw, e.closed, tol.arc_sagitta)
            e.set_points([(x, y, 0, 0, 0) for x, y in pts], format="xyseb")
            res.applied.append({"fix": p.id, "kind": p.kind, "handle": handle, "source_handle": p.handle,
                                "vertices_before": len(raw), "vertices_after": len(pts),
                                "max_shape_change_m": dev, "tolerance_m": tol.arc_sagitta})
        elif p.kind == "BYLAYER":
            before = {"color": e.dxf.get("color", 256), "linetype": e.dxf.get("linetype", "BYLAYER"),
                      "lineweight": e.dxf.get("lineweight", -1)}
            e.dxf.color = 256
            e.dxf.linetype = "BYLAYER"
            e.dxf.lineweight = -1
            if e.dxf.hasattr("true_color"):
                before["true_color"] = e.dxf.true_color
                e.dxf.discard("true_color")
            res.applied.append({"fix": p.id, "kind": p.kind, "handle": handle, "source_handle": p.handle,
                                "before": before, "max_shape_change_m": 0.0})
    return res


def _to_lwpolyline(doc: Drawing, poly):
    """Lossless 2D POLYLINE -> LWPOLYLINE (same OCS vertices, bulges, closed flag, elevation)."""
    layout = poly.get_layout() or doc.modelspace()
    pts = [(v.dxf.location[0], v.dxf.location[1], v.dxf.get("bulge", 0.0)) for v in poly.vertices]
    attribs = {"layer": poly.dxf.layer}
    for key in ("color", "linetype", "lineweight", "ltscale", "true_color", "extrusion"):
        if poly.dxf.hasattr(key):
            attribs[key] = poly.dxf.get(key)
    if poly.dxf.hasattr("elevation"):
        attribs["elevation"] = poly.dxf.elevation[2]
    new = layout.add_lwpolyline(pts, format="xyb", close=poly.is_closed, dxfattribs=attribs)
    layout.delete_entity(poly)
    return new
