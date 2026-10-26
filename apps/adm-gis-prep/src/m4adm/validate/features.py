"""Feature geometry checks (Section 5) and attribute-block checks (Sections 4.5 and 6).

All checks are read-only: they never modify or delete an entity. Tolerances are explicit
(``m4adm.models.Tolerances``) and reported with every run.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

import shapely
from shapely.geometry import LineString, MultiPoint, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from m4adm.classify import EntityRecord
from m4adm.geometry import dedupe_consecutive, polyline_length, record_vertices, to_shape
from m4adm.models import Severity, Tolerances
from m4adm.rules import LayerSpec, Manifest
from m4adm.validate import Collector
from m4adm.validate.drawing import ARABIC, layer_spec_for

_COORD = re.compile(r"\[\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)")
DATE_RE = re.compile(r"^(\d{2})-([A-Za-z]{3})-(\d{4})$")
INT_RE = re.compile(r"^[+-]?\d+$")
NUM_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")
SPECIAL_RE = re.compile(r"[!@#$%^*=~`|\\{}\[\]<>?;\"]")
REPEAT_RE = re.compile(r"([A-Za-z\W_])\1{3,}")


@dataclass
class Feature:
    rec: EntityRecord
    layer: str
    spec: LayerSpec
    vertices: list[tuple[float, float]]
    shape: BaseGeometry | None
    details: list[EntityRecord] = field(default_factory=list)

    @property
    def handle(self) -> str:
        return self.rec.handle

    @property
    def polygon(self) -> Polygon | None:
        return self.shape if isinstance(self.shape, Polygon) and self.shape.is_valid else None

    @property
    def area_geom(self) -> BaseGeometry | None:
        """Polygon used for attribute association; invalid rings are repaired in memory only."""
        if not isinstance(self.shape, Polygon):
            return None
        return self.shape if self.shape.is_valid else shapely.make_valid(self.shape)

    @property
    def line(self) -> LineString | None:
        if isinstance(self.shape, LineString):
            return self.shape
        if isinstance(self.shape, Polygon):
            return LineString(self.shape.exterior.coords)
        return None


@dataclass
class FeatureContext:
    features: dict[str, list[Feature]] = field(default_factory=lambda: defaultdict(list))  # by ADM layer
    detail_owner: dict[str, str] = field(default_factory=dict)  # detail handle -> feature handle


def _loc(geom: BaseGeometry) -> tuple[float, float]:
    p = geom.representative_point() if not isinstance(geom, Point) else geom
    return (p.x, p.y)


def _reason_location(reason: str) -> tuple[float, float] | None:
    m = _COORD.search(reason)
    return (float(m.group(1)), float(m.group(2))) if m else None


def _segment_self_crossing(pts: list[tuple[float, float]]) -> tuple[float, float] | None:
    if len(pts) > 2000:
        return None
    segs = [LineString([pts[i], pts[i + 1]]) for i in range(len(pts) - 1)]
    for i in range(len(segs)):
        for j in range(i + 2, len(segs)):
            if segs[i].intersects(segs[j]):
                inter = segs[i].intersection(segs[j])
                return _loc(inter)
    return None


# --------------------------------------------------------------------------- build
def build_features(records: list[EntityRecord], target: dict[str, str | None], manifest: Manifest,
                   categories: list[str], tol: Tolerances) -> FeatureContext:
    ctx = FeatureContext()
    for r in records:
        tl = target.get(r.handle)
        if not tl:
            continue
        spec = layer_spec_for(manifest, categories, tl)
        if spec is None:
            continue
        if spec.is_geometry and r.is_polyline_like:
            verts = dedupe_consecutive(record_vertices(r, tol.arc_sagitta), tol.coincidence)
            shape = to_shape(r, tol.arc_sagitta, tol.coincidence)
            if (spec.is_closed and not r.closed and len(verts) >= 4
                    and math.dist(verts[0], verts[-1]) <= tol.coincidence):
                shape = Polygon(verts[:-1])  # ends on its start vertex: checked as the area it encloses
            ctx.features[tl].append(Feature(r, tl, spec, verts, shape))
    return ctx


# --------------------------------------------------------------------------- per-feature
def check_feature_geometry(ctx: FeatureContext, tol: Tolerances, col: Collector) -> None:
    for layer, feats in ctx.features.items():
        for f in feats:
            r = f.rec
            kw = dict(handle=r.handle, layer=layer, entity_type=r.structure, location=r.location)
            if abs(r.elevation) > 0:
                col.add("ADM-CAP-008", f"Polyline has elevation {r.elevation}.",
                        "Set elevation to 0 (PROPERTIES > Elevation). The tool does not change elevations.", **kw)
            if r.has_width:
                col.add("ADM-CAP-008", "Polyline has a width (global or per segment).",
                        "Set global and segment widths to 0.", **kw)
            if abs(r.thickness) > 0:
                col.add("ADM-CAP-009", f"Entity has thickness {r.thickness} (3D height).",
                        "Set thickness to 0.", **kw)
            if not r.standard_extrusion:
                col.add("ENG-GEO-002", "Entity uses a non-standard extrusion direction (mirrored or 3D-rotated OCS).",
                        "Recreate the polyline in the World UCS; checks used its true world position.", **kw)
            if r.has_bulges:
                col.add("ADM-CAP-005B", "Polyline contains arc segments (bulges).",
                        "Digitise the curve as vertices (or accept the DENSIFY_BULGES fix, tolerance "
                        f"{tol.arc_sagitta} m).", **kw)
            raw = r.points
            repeats = sum(1 for i in range(len(raw) - 1) if math.dist(raw[i], raw[i + 1]) <= tol.coincidence)
            if repeats:
                col.add("ENG-GEO-004", f"{repeats} repeated consecutive vertex/vertices (zero-length segments).",
                        "Remove duplicate vertices (e.g. OVERKILL or PEDIT).", **kw, count=repeats)
            length = polyline_length(f.vertices, r.closed)
            if length <= tol.zero_length:
                col.add("ADM-CAP-001B", f"Zero-length polyline (length {length:.4f} m).",
                        "Delete the zero-length polyline in CAD after confirming it carries no meaning.", **kw)
                continue
            gap_closed = len(raw) > 2 and math.dist(raw[0], raw[-1]) <= tol.coincidence
            if f.spec.is_closed and not r.closed:
                if gap_closed:
                    col.add("ADM-LYR-006", "Polyline ends where it starts but is not flagged closed.",
                            "Set the polyline to Closed (or accept the lossless CLOSE_FLAG fix).", **kw)
                else:
                    gap = math.dist(raw[0], raw[-1]) if len(raw) > 1 else 0.0
                    col.add("ADM-LYR-006", f"Open polyline on closed-polygon layer {layer} (end gap {gap:.3f} m).",
                            "Close the boundary in CAD so it encloses the feature area.", **kw, gap=gap)
            if r.closed or gap_closed:
                distinct = len(f.vertices) - (1 if len(f.vertices) > 1 and
                                              math.dist(f.vertices[0], f.vertices[-1]) <= tol.coincidence else 0)
                poly = f.shape if isinstance(f.shape, Polygon) else None
                usable = poly is not None and distinct >= 3 and shapely.make_valid(poly).area > tol.overlap_area
                reason = shapely.is_valid_reason(poly) if usable else "Valid Geometry"
                if not usable:
                    col.add("ENG-GEO-007", "Degenerate polygon (fewer than three distinct vertices or no area).",
                            "Redraw or remove the degenerate polygon.", **kw)
                elif reason != "Valid Geometry":
                    col.add("ADM-CAP-001F", f"Polygon is self-intersecting or invalid: {reason}.",
                            "Fix the boundary so it does not cross itself.", handle=r.handle, layer=layer,
                            entity_type=r.structure, location=_reason_location(reason) or r.location)

            elif isinstance(f.shape, LineString) and not f.shape.is_simple:
                col.add("ADM-CAP-001F", "Polyline crosses itself.",
                        "Fix the polyline so it does not cross itself.", handle=r.handle, layer=layer,
                        entity_type=r.structure, location=_segment_self_crossing(f.vertices) or r.location)


# --------------------------------------------------------------------------- per-layer topology
def check_layer_topology(ctx: FeatureContext, tol: Tolerances, col: Collector,
                         clipped: set[str] | None = None) -> None:
    clipped = clipped or set()
    for layer, feats in ctx.features.items():
        polys = [f for f in feats if f.polygon is not None and (f.rec.closed or f.spec.is_closed)]
        lines = [f for f in feats if f.line is not None and not (f.rec.closed or f.spec.is_closed)]
        _polygon_pairs(layer, polys, tol, col, clipped)
        _line_pairs(layer, lines, tol, col)
        _vertex_snapping(layer, feats, tol, col)


def _polygon_pairs(layer: str, polys: list[Feature], tol: Tolerances, col: Collector, clipped: set[str]) -> None:
    if len(polys) < 2:
        return
    geoms = [f.polygon for f in polys]
    tree = STRtree(geoms)
    left, right = tree.query(geoms, predicate="intersects")
    seen = set()
    for i, j in zip(left.tolist(), right.tolist()):
        if i >= j or (i, j) in seen:
            continue
        seen.add((i, j))
        a, b = polys[i], polys[j]
        ga, gb = geoms[i], geoms[j]
        if shapely.normalize(ga).equals_exact(shapely.normalize(gb), tol.coincidence):
            col.add("ADM-CAP-001G", f"Duplicate polygon (same geometry as {a.handle}).",
                    "Delete one of the duplicates in CAD after confirming which carries the attribute block.",
                    handle=b.handle, layer=layer, entity_type=b.rec.structure, location=_loc(gb),
                    duplicate_of=a.handle)
            continue
        inner, outer = (b, a) if gb.within(ga) else (a, b) if ga.within(gb) else (None, None)
        if inner is not None and inner.spec.nesting_levels > 0:
            depth = sum(1 for f, g in zip(polys, geoms) if f is not inner and inner.polygon.within(g))
            if depth > inner.spec.nesting_levels:
                key = ("nest", inner.handle)
                if key not in seen:
                    seen.add(key)
                    col.add("ENG-NEST-001", f"Polygon is nested {depth} levels deep; {inner.spec.nesting_levels} "
                            "level is allowed on this layer.",
                            "Restructure the nested polygons so no polygon is inside more than one other.",
                            handle=inner.handle, layer=layer, entity_type=inner.rec.structure,
                            location=_loc(inner.polygon), depth=depth)
            continue
        if inner is not None:
            if inner.handle in clipped:
                col.add("ADM-CAP-004", f"Inner polygon inside {outer.handle} marked ToBeClipped=Yes.",
                        "Confirm the inner area is meant to be clipped from the outer feature (Pavement/Landscape).",
                        severity=Severity.WARNING, handle=inner.handle, layer=layer,
                        entity_type=inner.rec.structure, location=_loc(inner.polygon), outer=outer.handle)
            else:
                col.add("ADM-CAP-004", f"Polygon lies inside polygon {outer.handle} on the same layer (island/donut).",
                        "Redraw so polygons on one layer do not nest; each closed polyline must be a single polygon.",
                        handle=inner.handle, layer=layer, entity_type=inner.rec.structure,
                        location=_loc(inner.polygon), outer=outer.handle)
            continue
        inter = ga.intersection(gb)
        if inter.area > tol.overlap_area:
            col.add("ADM-CAP-001C", f"Polygon overlaps polygon {a.handle} by {inter.area:.4f} m².",
                    "Adjust the shared boundary so the polygons touch without overlapping.",
                    handle=b.handle, layer=layer, entity_type=b.rec.structure, location=_loc(inter),
                    other=a.handle, overlap_area=inter.area)


def _is_vertex(p: Point, f: Feature, tol: float) -> bool:
    return any(math.dist((p.x, p.y), v) <= tol for v in f.vertices)


def _line_pairs(layer: str, lines: list[Feature], tol: Tolerances, col: Collector) -> None:
    if not lines:
        return
    geoms = [f.line for f in lines]
    tree = STRtree(geoms)
    left, right = tree.query(geoms, predicate="dwithin", distance=tol.snap_search)
    pairs = {(min(i, j), max(i, j)) for i, j in zip(left.tolist(), right.tolist()) if i != j}
    for i, j in sorted(pairs):
        a, b = lines[i], lines[j]
        ga, gb = geoms[i], geoms[j]
        if shapely.normalize(ga).equals_exact(shapely.normalize(gb), tol.coincidence):
            col.add("ADM-CAP-001G", f"Duplicate polyline (same geometry as {a.handle}).",
                    "Delete one of the duplicates after confirming which carries the attribute block.",
                    handle=b.handle, layer=layer, entity_type=b.rec.structure, location=_loc(gb),
                    duplicate_of=a.handle)
            continue
        inter = ga.intersection(gb)
        if inter.length > tol.zero_length:
            col.add("ADM-CAP-001C", f"Polyline overlaps polyline {a.handle} for {inter.length:.3f} m.",
                    "Remove the overlapping section so each segment is drawn once.",
                    handle=b.handle, layer=layer, entity_type=b.rec.structure, location=_loc(inter), other=a.handle)
            continue
        points = [g for g in getattr(inter, "geoms", [inter]) if isinstance(g, Point)]
        for p in points:
            if _is_vertex(p, a, tol.coincidence) and _is_vertex(p, b, tol.coincidence):
                continue  # properly noded at a shared vertex
            reported = False
            for f, g in ((a, ga), (b, gb)):
                d_end = min(math.dist((p.x, p.y), g.coords[0]), math.dist((p.x, p.y), g.coords[-1]))
                if tol.coincidence < d_end <= tol.snap_search:
                    col.add("ADM-CAP-001A", f"Overshoot: polyline extends {d_end:.3f} m past another polyline.",
                            "Trim the end back to the crossing line and snap it to a vertex.",
                            handle=f.handle, layer=layer, entity_type=f.rec.structure, location=(p.x, p.y))
                    reported = True
            if not reported and not (_is_vertex(p, a, tol.coincidence) or _is_vertex(p, b, tol.coincidence)):
                col.add("ADM-CAP-001E", f"Polyline crosses polyline {a.handle} without a shared vertex.",
                        "Add a vertex at the crossing on both lines, or confirm they are at different levels.",
                        handle=b.handle, layer=layer, entity_type=b.rec.structure, location=(p.x, p.y))
        # undershoots: open ends near (but not touching) another line, not near its vertices
        for f, g, other, og in ((a, ga, b, gb), (b, gb, a, ga)):
            for end in (g.coords[0], g.coords[-1]):
                pe = Point(end)
                d = og.distance(pe)
                if tol.coincidence < d <= tol.snap_search and not any(
                        math.dist(end, v) <= tol.snap_search for v in other.vertices):
                    col.add("ADM-CAP-001A", f"Undershoot: polyline end stops {d:.3f} m short of polyline {other.handle}.",
                            "Extend the end to the other line and snap it to a vertex.",
                            handle=f.handle, layer=layer, entity_type=f.rec.structure, location=end, gap=d)


def _vertex_snapping(layer: str, feats: list[Feature], tol: Tolerances, col: Collector) -> None:
    pts, owner = [], []
    for k, f in enumerate(feats):
        for v in f.vertices:
            pts.append(Point(v))
            owner.append(k)
    if len(pts) < 2:
        return
    tree = STRtree(pts)
    left, right = tree.query(pts, predicate="dwithin", distance=tol.snap_search)
    reported: set[tuple] = set()
    for i, j in zip(left.tolist(), right.tolist()):
        if i >= j or owner[i] == owner[j]:
            continue
        d = pts[i].distance(pts[j])
        if d <= tol.coincidence:
            continue
        key = (min(owner[i], owner[j]), max(owner[i], owner[j]), round(pts[i].x, 2), round(pts[i].y, 2))
        if key in reported:
            continue
        reported.add(key)
        a, b = feats[owner[i]], feats[owner[j]]
        col.add("ADM-CAP-001D", f"Vertex is {d:.3f} m from a vertex of {a.handle}: not snapped.",
                "Snap the two vertices together (endpoint/vertex snap), or separate them deliberately.",
                handle=b.handle, layer=layer, entity_type=b.rec.structure, location=(pts[j].x, pts[j].y),
                other=a.handle, distance=d)
    # snapping on edges (rule 2): a vertex touching another feature's edge away from its vertices
    boundaries = [f.line for f in feats]
    valid = [k for k, g in enumerate(boundaries) if g is not None]
    if len(valid) < 2:
        return
    btree = STRtree([boundaries[k] for k in valid])
    for i, p in enumerate(pts):
        for hit in btree.query(p, predicate="dwithin", distance=tol.coincidence).tolist():
            k = valid[hit]
            if k == owner[i]:
                continue
            if not _is_vertex(p, feats[k], tol.coincidence):
                f = feats[owner[i]]
                key = ("edge", owner[i], k, round(p.x, 3), round(p.y, 3))
                if key in reported:
                    continue
                reported.add(key)
                col.add("ADM-CAP-002", f"Vertex is snapped onto an edge of {feats[k].handle}, not onto a vertex.",
                        "Add a matching vertex on the other feature (or move this vertex to an existing vertex).",
                        handle=f.handle, layer=layer, entity_type=f.rec.structure, location=(p.x, p.y),
                        other=feats[k].handle)


# --------------------------------------------------------------------------- attribute blocks
def associate_and_check_details(records: list[EntityRecord], target: dict[str, str | None], manifest: Manifest,
                                categories: list[str], ctx: FeatureContext, tol: Tolerances,
                                col: Collector) -> None:
    details_by_layer: dict[str, list[EntityRecord]] = defaultdict(list)
    for r in records:
        tl = target.get(r.handle)
        if tl and r.dxftype == "INSERT" and r.attribs and r.location:
            spec = layer_spec_for(manifest, categories, tl)
            if spec is not None and spec.is_detail:
                details_by_layer[tl].append(r)

    detail_specs = {}
    for cat in categories:
        for spec in manifest.layers_for(cat):
            if spec.is_detail:
                detail_specs[spec.name] = spec

    all_linear = [f for feats in ctx.features.values() for f in feats
                  if f.line is not None and not f.spec.is_closed]
    for name, spec in detail_specs.items():
        dets = details_by_layer.get(name, [])
        parent_spec = layer_spec_for(manifest, categories, spec.parent) if spec.parent else None
        parents = ctx.features.get(spec.parent, []) if spec.parent else []
        for d in dets:
            check_block_attributes(d, spec, col)
        if parent_spec is None:
            continue
        if parent_spec.is_closed or spec.standalone_point:
            _associate_polygon(spec, dets, parents, tol, col, ctx)
        else:
            _associate_linear(spec, dets, parents, all_linear, tol, col, ctx)


def _associate_polygon(spec: LayerSpec, dets: list[EntityRecord], parents: list[Feature], tol: Tolerances,
                       col: Collector, ctx: FeatureContext) -> None:
    rule_outside = "ADM-ATT-012" if spec.standalone_point else "ADM-CAP-006"
    if spec.standalone_point and dets and not parents:
        for d in dets:
            col.add("ADM-ATT-012", f"{spec.name} block present but no {spec.parent} polygon exists.",
                    f"Submit the {spec.parent} polygon that contains this borehole.",
                    handle=d.handle, layer=spec.name, entity_type="INSERT", location=d.location)
        return
    polys = [p for p in parents if p.area_geom is not None and not p.area_geom.is_empty]
    tree = STRtree([p.area_geom for p in polys]) if polys else None
    for d in dets:
        pt = Point(d.location)
        hits = tree.query(pt, predicate="within").tolist() if tree else []
        if not hits:
            near = tree.query(pt, predicate="dwithin", distance=tol.coincidence).tolist() if tree else []
            if near:
                owner = polys[near[0]]
                col.add("ENG-GEO-008", f"Attribute block insertion point lies on the boundary of {owner.handle}.",
                        "Move the insertion point inside the polygon.", handle=d.handle, layer=spec.name,
                        entity_type="INSERT", location=d.location, feature=owner.handle)
                owner.details.append(d)
                ctx.detail_owner[d.handle] = owner.handle
            else:
                col.add(rule_outside, f"Attribute block insertion point is not inside any {spec.parent} polygon.",
                        f"Move the block inside its {spec.parent} polygon (spec Figure 3), or check the layer.",
                        handle=d.handle, layer=spec.name, entity_type="INSERT", location=d.location)
            continue
        owner = min((polys[h] for h in hits), key=lambda f: f.area_geom.area)
        owner.details.append(d)
        ctx.detail_owner[d.handle] = owner.handle
    if spec.standalone_point:
        return
    det_handles = {d.handle for d in dets}
    for p in polys:  # open/degenerate boundaries are already reported; no cascade "missing block" errors
        _count_details(spec, p, [d for d in p.details if d.handle in det_handles], col)


def _associate_linear(spec: LayerSpec, dets: list[EntityRecord], parents: list[Feature],
                      all_linear: list[Feature], tol: Tolerances, col: Collector, ctx: FeatureContext) -> None:
    for d in dets:
        on_vertex = [f for f in parents if any(math.dist(d.location, v) <= tol.attribute_vertex for v in f.vertices)]
        snapped_lines = [f for f in all_linear if any(math.dist(d.location, v) <= tol.attribute_vertex
                                                      for v in f.vertices)]
        kw = dict(handle=d.handle, layer=spec.name, entity_type="INSERT", location=d.location)
        if not on_vertex:
            on_line = [f for f in parents if f.line is not None and f.line.distance(Point(d.location)) <= tol.attribute_vertex]
            col.add("ADM-CAP-006B",
                    "Attribute block lies on the line but not on a vertex." if on_line
                    else f"Attribute block is not on any {spec.parent} line.",
                    f"Snap the insertion point to one vertex of its {spec.parent} polyline (spec Figure 4).", **kw)
            continue
        if len(snapped_lines) > 1:
            col.add("ADM-CAP-006B",
                    f"Attribute block sits on a vertex shared by {len(snapped_lines)} lines (intersection/snap point).",
                    "Move it to a vertex used by its own line only.", **kw,
                    lines=[f.handle for f in snapped_lines])
        owner = on_vertex[0]
        owner.details.append(d)
        ctx.detail_owner[d.handle] = owner.handle
    det_handles = {d.handle for d in dets}
    for p in parents:
        if p.line is None or p.line.length <= tol.zero_length:
            continue  # zero-length features are already reported
        _count_details(spec, p, [d for d in p.details if d.handle in det_handles], col)


def _count_details(spec: LayerSpec, feature: Feature, own: list[EntityRecord], col: Collector) -> None:
    kw = dict(handle=feature.handle, layer=feature.layer, entity_type=feature.rec.structure,
              location=_loc(feature.shape) if feature.shape is not None else feature.rec.location)
    if not own:
        col.add("ADM-ATT-001", f"{feature.layer} feature has no {spec.name} attribute block.",
                f"Insert one '{spec.block}' attribute block on layer {spec.name} "
                + ("inside the polygon." if feature.spec.is_closed else "snapped to one of its vertices."), **kw)
    elif len(own) > 1:
        col.add("ADM-ATT-001", f"{feature.layer} feature has {len(own)} {spec.name} attribute blocks; one is required.",
                "Keep exactly one attribute block per feature.", **kw, details_handles=[d.handle for d in own])


def check_block_attributes(d: EntityRecord, spec: LayerSpec, col: Collector) -> None:
    m = col.manifest
    block = m.blocks[spec.block]
    kw = dict(handle=d.handle, layer=spec.name, entity_type="INSERT", location=d.location)
    names_ok = {spec.block, spec.name, *spec.aliases}
    if d.block_name != spec.block:
        if d.block_name and d.block_name.lower() in {n.lower() for n in names_ok}:
            col.add("ADM-LYR-007", f"Block name '{d.block_name}' is a spelling variant of '{spec.block}'.",
                    "Use the block exactly as named in the official template (pending confirmation).", **kw)
        else:
            col.add("ADM-ATT-013", f"Block '{d.block_name}' on layer {spec.name}; expected '{spec.block}'.",
                    f"Replace with the predefined '{spec.block}' attribute block.", **kw)
    present = d.attribs_upper
    spec_tags = {a.tag.upper(): a for a in block.attributes}
    for extra in sorted(set(present) - set(spec_tags)):
        col.add("ADM-ATT-002", f"Attribute '{extra}' is not part of block {spec.block} (Section 6).",
                "Use the predefined attribute block unchanged.", **kw, tag=extra)
    for tag_u, a in spec_tags.items():
        if tag_u not in present:
            if a.mandatory:
                col.add("ADM-ATT-003", f"Mandatory attribute {a.tag} is missing from the block.",
                        "Use the predefined attribute block from the official template.", **kw, tag=a.tag)
            else:
                col.add("ADM-ATT-002", f"Optional attribute {a.tag} is missing from the block structure.",
                        "Use the predefined attribute block unchanged.", **kw, tag=a.tag)
            continue
        raw = present[tag_u] or ""
        val = raw.strip()
        if a.required_if_present:
            other = present.get(a.required_if_present.upper(), "").strip()
            if other and not val:
                col.add("ADM-ATT-007", f"{a.tag} is required because {a.required_if_present} is filled in.",
                        f"Enter {a.tag}.", **kw, tag=a.tag)
        if not val:
            if a.mandatory:
                col.add("ADM-ATT-003", f"Mandatory attribute {a.tag} is empty.", f"Enter a value for {a.tag}.",
                        **kw, tag=a.tag)
            continue
        if raw != val:
            col.add("ADM-ATT-011", f"{a.tag} has leading/trailing spaces.", "Remove the extra spaces.", **kw, tag=a.tag)
        _check_type(a, val, col, kw)
        if a.domain:
            allowed = m.domain_values(a.domain)
            if val not in allowed:
                ci = next((x for x in allowed if x.lower() == val.lower()), None)
                col.add("ADM-ATT-004", f"{a.tag} = '{val}' is not an allowed value"
                        + (f" (did you mean '{ci}'? values are case-sensitive)." if ci else "."),
                        f"Use one of: {', '.join(allowed[:12])}{' ...' if len(allowed) > 12 else ''}.",
                        **kw, tag=a.tag, value=val)
        if a.depends_on:
            cat = present.get(a.depends_on.upper(), "").strip()
            options = m.plot_usage.get(cat)
            if options is not None and val not in options:
                ci = next((x for x in options if x.lower() == val.lower()), None)
                col.add("ADM-ATT-009", f"UsageType '{val}' is not listed for UsageCategoryType '{cat}' (Appendix 2)"
                        + (f"; exact value is '{ci}'." if ci else "."),
                        "Use a usage type listed for this category, or obtain ADM SDD direction for a new value.",
                        **kw, tag=a.tag, value=val, category=cat)
        if a.max_length and len(val) > a.max_length:
            col.add("ADM-ATT-008", f"{a.tag} has {len(val)} characters; maximum is {a.max_length}.",
                    f"Shorten {a.tag} to {a.max_length} characters.", **kw, tag=a.tag)
        if a.type in ("character", "string") and not a.domain:
            if SPECIAL_RE.search(val) or REPEAT_RE.search(val):
                col.add("ADM-ATT-011", f"{a.tag} = '{val}' contains special or repeated characters.",
                        "Check for a data-entry error.", **kw, tag=a.tag, value=val)
            if a.tag.endswith("English") and ARABIC.search(val):
                col.add("ADM-ATT-011", f"{a.tag} contains Arabic script.", "Enter the English value.", **kw, tag=a.tag)
            if a.tag.endswith("Arabic") and not ARABIC.search(val):
                col.add("ADM-ATT-011", f"{a.tag} contains no Arabic script.", "Enter the Arabic value.", **kw, tag=a.tag)


def _check_type(a, val: str, col: Collector, kw: dict) -> None:
    if a.type == "integer" and not INT_RE.match(val):
        col.add("ADM-ATT-005", f"{a.tag} = '{val}' is not an integer.", f"Enter a whole number for {a.tag}.",
                **kw, tag=a.tag, value=val)
    elif a.type in ("float", "double", "number"):
        if not NUM_RE.match(val) or not math.isfinite(float(val)):
            col.add("ADM-ATT-005", f"{a.tag} = '{val}' is not a number.", f"Enter a numeric value for {a.tag}.",
                    **kw, tag=a.tag, value=val)
    elif a.type == "date":
        mt = DATE_RE.match(val)
        ok = False
        if mt:
            try:
                datetime.strptime(val.upper(), "%d-%b-%Y")
                ok = True
            except ValueError:
                ok = False
        if not ok:
            col.add("ADM-ATT-006", f"{a.tag} = '{val}' is not a valid DD-MON-YYYY date.",
                    "Write the date like 05-DEC-2013.", **kw, tag=a.tag, value=val)
        elif a.month_case == "upper" and mt.group(2) != mt.group(2).upper():
            col.add("ADM-ATT-006", f"{a.tag} = '{val}': month is not upper-case as in the example 05-DEC-2013.",
                    "Write the month in capitals.", severity=Severity.WARNING, **kw, tag=a.tag, value=val)


def tobeclipped_handles(ctx: FeatureContext) -> set[str]:
    out = set()
    for layer in ("Pavement", "LandscapeArea"):
        for f in ctx.features.get(layer, []):
            for d in f.details:
                if d.attribs_upper.get("TOBECLIPPED", "").strip() == "Yes":
                    out.add(f.handle)
    return out


# --------------------------------------------------------------------------- services
def check_services(ctx: FeatureContext, plot_polys: list[tuple[str, Polygon]], tol: Tolerances,
                   col: Collector) -> None:
    corridors = [f for f in ctx.features.get("ServiceCorridor", []) if f.polygon is not None]
    strips = [f for f in ctx.features.get("ReservedStrip", []) if f.polygon is not None]
    if not plot_polys:
        col.add("ADM-SRV-001", "No Plot geometry available in this run; corridor-versus-plot checks were skipped.",
                "Provide the plot geometry with the services submission (include the Plot category or layer).")
    else:
        tree = STRtree([p for _, p in plot_polys])
        for c in corridors:
            for k in tree.query(c.polygon, predicate="intersects").tolist():
                h, plot = plot_polys[k]
                if c.polygon.relate_pattern(plot, "T********"):
                    inter = c.polygon.intersection(plot)
                    col.add("ADM-SRV-002", f"Service corridor overlaps plot {h} ({inter.area:.3f} m²).",
                            "Adjust the corridor so it only touches plot boundaries (snapping at external "
                            "boundaries is allowed).", handle=c.handle, layer="ServiceCorridor",
                            entity_type=c.rec.structure, location=_loc(inter) if not inter.is_empty else None,
                            plot=h)
    if strips and corridors:
        grown = [c.polygon.buffer(tol.coincidence) for c in corridors]
        for s in strips:
            if not any(g.contains(s.polygon) for g in grown):
                col.add("ENG-SRV-003", "Reserved strip is not inside a service corridor.",
                        "Check that the reserved strip lies within its service corridor (spec Figure 5).",
                        handle=s.handle, layer="ReservedStrip", entity_type=s.rec.structure,
                        location=_loc(s.polygon))


# --------------------------------------------------------------------------- cross-layer topology
def check_cross_layer_snapping(ctx: FeatureContext, layers: list[str], tol: Tolerances, col: Collector) -> None:
    """Where geometries of different layers meet, vertices must exist in both (snapping only on vertices).

    * a vertex of one feature lying on another feature's edge without a vertex there -> ADM-CAP-002 (ERROR)
    * edges crossing without a vertex in either feature                              -> ADM-CAP-001E
    * vertices of different features closer than snap_search but not coincident      -> ADM-CAP-001D
    """
    feats = [f for layer in layers for f in ctx.features.get(layer, []) if f.line is not None]
    if len(feats) < 2:
        return
    lines = [f.line for f in feats]
    tree = STRtree(lines)
    left, right = tree.query(lines, predicate="dwithin", distance=tol.snap_search)
    reported: set = set()
    for i, j in zip(left.tolist(), right.tolist()):
        if i >= j or feats[i].layer == feats[j].layer:
            continue
        a, b = feats[i], feats[j]
        for f, other in ((a, b), (b, a)):
            for v in f.vertices:
                p = Point(v)
                d = other.line.distance(p)
                near_vertex = min(math.dist(v, w) for w in other.vertices)
                if d <= tol.coincidence and near_vertex > tol.coincidence:
                    key = ("T", f.handle, other.handle, round(v[0], 4), round(v[1], 4))
                    if key not in reported:
                        reported.add(key)
                        col.add("ADM-CAP-002", f"{f.layer} vertex lies on an edge of {other.layer} {other.handle} "
                                f"without a matching vertex there.",
                                f"Add a vertex to the {other.layer} polygon at this point (snap on vertices only).",
                                handle=f.handle, layer=f.layer, entity_type=f.rec.structure, location=v,
                                other=other.handle, other_layer=other.layer)
                elif tol.coincidence < near_vertex <= tol.snap_search:
                    w = min(other.vertices, key=lambda q: math.dist(v, q))
                    key = ("near", min(f.handle, other.handle), max(f.handle, other.handle),
                           round((v[0] + w[0]) / 2, 2), round((v[1] + w[1]) / 2, 2))
                    if key not in reported:
                        reported.add(key)
                        col.add("ADM-CAP-001D", f"{f.layer} vertex is {near_vertex:.4f} m from a vertex of "
                                f"{other.layer} {other.handle}: not snapped.",
                                "Snap the two vertices together, or separate them deliberately.",
                                handle=f.handle, layer=f.layer, entity_type=f.rec.structure, location=v,
                                other=other.handle, other_layer=other.layer, distance=near_vertex)
        if not a.line.intersects(b.line):
            continue
        inter = a.line.intersection(b.line)
        for g in getattr(inter, "geoms", [inter]):
            if not isinstance(g, Point):
                continue
            q = (g.x, g.y)
            if min(math.dist(q, w) for w in a.vertices) > tol.coincidence and \
                    min(math.dist(q, w) for w in b.vertices) > tol.coincidence:
                key = ("X", a.handle, b.handle, round(q[0], 4), round(q[1], 4))
                if key not in reported:
                    reported.add(key)
                    col.add("ADM-CAP-001E", f"{a.layer} {a.handle} crosses {b.layer} {b.handle} without a vertex "
                            "in either.", "Add a vertex at the crossing on both polygons, or correct the edges so "
                            "they do not cross.", handle=b.handle, layer=b.layer, entity_type=b.rec.structure,
                            location=q, other=a.handle, other_layer=a.layer)
