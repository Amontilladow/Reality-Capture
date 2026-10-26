"""Stage A + B: source drawing inspection and geometry normalisation.

Reads model space only, explodes block references virtually (the source document is never modified), flattens
curves, converts to metres and keeps, for every primitive, the handle of the top-level source entity it came
from, so each generated feature can be traced back to source geometry.
"""
from __future__ import annotations

import fnmatch
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from ezdxf import path as ezpath
from ezdxf.document import Drawing
from shapely.geometry import LineString, Polygon
from shapely.validation import make_valid

INSUNITS_TO_M = {1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0}
UNITS_TO_M = {"mm": 0.001, "cm": 0.01, "m": 1.0}
CURVE_TYPES = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE"}
MAX_DEPTH = 8


@dataclass
class Prim:
    kind: str                     # "line" | "area" | "text"
    layer: str                    # effective layer
    source_handle: str            # top-level model-space entity
    source_type: str
    geom: object = None           # shapely LineString / Polygon (metres, local source frame)
    text: str = ""
    at: tuple[float, float] | None = None
    block: str | None = None      # top-level block name, for INSERTs


@dataclass
class SourceModel:
    unit_scale: float
    unit_origin: str              # how the unit scale was determined
    prims: list[Prim]
    layer_stats: dict[str, Counter]
    inserts: list[Prim] = field(default_factory=list)   # top-level INSERT outlines (geometry of all their parts)
    skipped: Counter = field(default_factory=Counter)

    def layers(self) -> list[str]:
        return sorted(self.layer_stats)


def resolve_units(doc: Drawing, declared: str) -> tuple[float | None, str]:
    if declared != "auto":
        return UNITS_TO_M[declared], f"declared by the engineer: {declared}"
    code = doc.header.get("$INSUNITS", 0)
    if code in INSUNITS_TO_M:
        return INSUNITS_TO_M[code], f"read from the drawing header ($INSUNITS={code})"
    return None, f"$INSUNITS={code} does not identify a length unit"


def match(layer: str, patterns: list[str]) -> bool:
    up = layer.upper()
    return any(fnmatch.fnmatchcase(up, p.upper()) for p in patterns)


def _clean_text(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.replace("\\P", " ")).strip()


def read_source(doc: Drawing, scale: float, flatten: float) -> SourceModel:
    prims: list[Prim] = []
    inserts: list[Prim] = []
    stats: dict[str, Counter] = defaultdict(Counter)
    skipped: Counter = Counter()
    tol = flatten / scale  # flattening distance in drawing units

    def pts_of(e) -> list[tuple[float, float]]:
        p = ezpath.make_path(e)
        return [(v.x * scale, v.y * scale) for v in p.flattening(tol)]

    def visit(e, layer: str, handle: str, depth: int, top_type: str, sink: list[Prim]):
        t = e.dxftype()
        own = e.dxf.get("layer", "0")
        eff = layer if own == "0" and depth > 0 else own
        if depth == 0:
            stats[eff][t] += 1
        if t == "INSERT":
            if depth >= MAX_DEPTH:
                skipped["INSERT nesting too deep"] += 1
                return
            try:
                children = list(e.virtual_entities())
            except Exception:                             # noqa: BLE001 - unexplodable block (e.g. non-uniform scale)
                skipped["INSERT that cannot be exploded"] += 1
                return
            for c in children:
                visit(c, eff, handle, depth + 1, top_type, sink)
            for a in e.attribs:
                txt = _clean_text(a.dxf.text)
                if txt:
                    ins = a.dxf.insert
                    sink.append(Prim("text", eff, handle, top_type, text=txt, at=(ins.x * scale, ins.y * scale)))
            return
        if t in CURVE_TYPES:
            try:
                pts = pts_of(e)
            except Exception:                             # noqa: BLE001
                skipped[f"{t} that cannot be flattened"] += 1
                return
            if len(pts) >= 2:
                closed = t == "CIRCLE" or (t in ("LWPOLYLINE", "POLYLINE") and e.is_closed)
                if closed and len(pts) >= 3:
                    pts = pts + [pts[0]] if pts[0] != pts[-1] else pts
                sink.append(Prim("line", eff, handle, top_type, geom=LineString(pts)))
            return
        if t == "HATCH":
            for p in ezpath.from_hatch(e):
                ring = [(v.x * scale, v.y * scale) for v in p.flattening(tol)]
                if len(ring) >= 3:
                    poly = make_valid(Polygon(ring))
                    if not poly.is_empty and poly.area > 0:
                        sink.append(Prim("area", eff, handle, top_type, geom=poly))
            return
        if t in ("TEXT", "MTEXT", "ATTRIB"):
            txt = _clean_text(e.plain_text() if t == "MTEXT" else e.dxf.text)
            if txt:
                at = e.dxf.insert
                if t == "TEXT" and e.dxf.get("halign", 0) and e.dxf.hasattr("align_point"):
                    at = e.dxf.align_point
                sink.append(Prim("text", eff, handle, top_type, text=txt, at=(at.x * scale, at.y * scale)))
            return
        skipped[t] += 1

    for e in doc.modelspace():
        handle = e.dxf.handle
        if e.dxftype() == "INSERT":
            parts: list[Prim] = []
            visit(e, e.dxf.get("layer", "0"), handle, 0, "INSERT", parts)
            prims.extend(parts)
            geoms = [p.geom for p in parts if p.geom is not None]
            if geoms:
                ins = Prim("insert", e.dxf.get("layer", "0"), handle, "INSERT", block=e.dxf.name)
                ins.geom = geoms
                inserts.append(ins)
        else:
            visit(e, e.dxf.get("layer", "0"), handle, 0, e.dxftype(), prims)
    return SourceModel(scale, "", prims, dict(stats), inserts, skipped)


def bounds(prims: list[Prim]) -> tuple[float, float, float, float] | None:
    xs, ys = [], []
    for p in prims:
        if p.geom is not None:
            x0, y0, x1, y1 = p.geom.bounds
            xs += [x0, x1]
            ys += [y0, y1]
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def angle_of(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0
