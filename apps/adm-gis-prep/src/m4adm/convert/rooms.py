"""Stages C + D: feature detection and closed-region generation for architectural floor plans.

Algorithm (all distances in metres, see ConversionTolerances):

1. Barriers. Linework and hatches on wall/window layers are unioned; lines are buffered by gap_close/2 so
   drafting gaps up to gap_close disappear (counted and logged, never silently).
2. Openings. A doorway is a gap between two ALIGNED WALL ENDS: two convex corners of the barrier outline,
   opening_min..opening_max apart, where at each corner a wall face runs along the gap line and away from the
   other corner, and the gap line itself crosses only free space. Accepted shortest-first, never crossing an
   accepted one. Each becomes a virtual closure line (kept in the report and preview, never written as wall).
   Gaps between a free-standing column and a wall face, or any other non-aligned gap, are NOT closed.
3. Envelope. The barrier component (walls + closures) with the largest filled area is the building; its outer
   ring is the floor outline. If its filled area is barely larger than the walls themselves the exterior wall
   network is not closed: rooms cannot be separated from the outside and the envelope is UNRESOLVED.
4. Regions. Free space inside the envelope, cut by the closures, split into connected regions; each region is
   grown back by gap_close/2 to the wall face.
5. Classification. Regions narrower than room_min_width or smaller than room_min_area are wall cavities or
   slivers (NOT_GENERATED). Room-name text inside a region names it; one distinct name -> high confidence,
   several names or none -> requires review. Text never creates geometry.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from m4adm.convert.settings import ConversionSettings
from m4adm.convert.source import Prim, SourceModel, match

HIGH = "AUTO_GENERATED_HIGH_CONFIDENCE"
REVIEW = "GENERATED_REQUIRES_REVIEW"
UNRESOLVED = "UNRESOLVED"
NOT_GENERATED = "NOT_GENERATED"


@dataclass
class Closure:
    a: tuple[float, float]
    b: tuple[float, float]

    @property
    def line(self) -> LineString:
        return LineString([self.a, self.b])

    @property
    def width(self) -> float:
        return math.dist(self.a, self.b)


@dataclass
class Region:
    id: str
    poly: Polygon
    status: str
    reasons: list[str]
    names: list[str] = field(default_factory=list)       # distinct room names found inside
    numbers: list[str] = field(default_factory=list)     # room numbers paired with those names
    label_handles: list[str] = field(default_factory=list)
    closures: int = 0


@dataclass
class Label:
    name: str
    number: str | None
    at: tuple[float, float]
    handles: list[str]


@dataclass
class Detection:
    barrier_layers: list[str]
    label_layers: list[str]
    gaps_closed_estimate: int
    closures: list[Closure]
    envelope: Polygon | None
    envelope_status: str
    envelope_reason: str
    regions: list[Region]
    labels: list[Label]
    unplaced_labels: list[Label]
    barrier_outside: int
    barrier: object = None


def polygons(g) -> list[Polygon]:
    """Polygonal parts of any shapely geometry (lines and points produced by make_valid are dropped)."""
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if hasattr(g, "geoms"):
        return [q for part in g.geoms for q in polygons(part)]
    return []


# --------------------------------------------------------------------------- labels
def collect_labels(prims: list[Prim], settings: ConversionSettings) -> tuple[list[Label], list[str]]:
    pattern = re.compile(settings.room_number_pattern)
    texts = [p for p in prims if p.kind == "text" and match(p.layer, settings.roles["room_label"])]
    layers = sorted({p.layer for p in texts})
    numbers = [p for p in texts if pattern.match(p.text)]
    names = [p for p in texts if not pattern.match(p.text)]
    used: set[int] = set()
    labels = []
    for n in names:
        best, best_d = None, settings.tolerances.label_pair_distance
        for i, num in enumerate(numbers):
            if i in used:
                continue
            d = math.dist(n.at, num.at)
            if d <= best_d:
                best, best_d = i, d
        handles = [n.source_handle]
        number = None
        if best is not None:
            used.add(best)
            number = numbers[best].text.strip()
            handles.append(numbers[best].source_handle)
        labels.append(Label(n.text.strip().upper(), number, n.at, handles))
    return labels, layers


# --------------------------------------------------------------------------- openings
def _convex_corners(poly: Polygon) -> list[tuple[tuple[float, float], list[tuple[float, float]]]]:
    """Convex corners of the material (left of the oriented rings) with their two incident edge directions."""
    out = []
    poly = orient(poly, 1.0)
    for ring in [poly.exterior, *poly.interiors]:
        c = list(ring.coords)[:-1]
        n = len(c)
        if n < 3:
            continue
        for i in range(n):
            u, v, w = c[i - 1], c[i], c[(i + 1) % n]
            cross = (v[0] - u[0]) * (w[1] - v[1]) - (v[1] - u[1]) * (w[0] - v[0])
            if cross > 1e-12:
                out.append((v, [u, w]))
    return out


def _aligned(p, edge_ends, q, tol_deg: float) -> bool:
    """A wall face at p runs along p->q, extending away from q."""
    gx, gy = q[0] - p[0], q[1] - p[1]
    gl = math.hypot(gx, gy)
    for e in edge_ends:
        ex, ey = e[0] - p[0], e[1] - p[1]
        el = math.hypot(ex, ey)
        if el < 1e-9:
            continue
        cos = (ex * gx + ey * gy) / (el * gl)
        if cos < -math.cos(math.radians(tol_deg)):
            return True
    return False


def find_openings(barrier, settings: ConversionSettings) -> list[Closure]:
    tol = settings.tolerances
    corners = []
    for p in polygons(barrier):
        for q in polygons(p.simplify(tol.gap_close / 2)):
            corners.extend(_convex_corners(q))
    if not corners:
        return []
    pts = [Point(c[0]) for c in corners]
    tree = STRtree(pts)
    candidates = []
    for i, (p, ends) in enumerate(corners):
        for j in tree.query(pts[i].buffer(tol.opening_max)):
            j = int(j)
            if j <= i:
                continue
            q, ends_q = corners[j]
            d = math.dist(p, q)
            if not (tol.opening_min <= d <= tol.opening_max):
                continue
            if not (_aligned(p, ends, q, tol.opening_alignment_deg) and _aligned(q, ends_q, p, tol.opening_alignment_deg)):
                continue
            candidates.append((d, p, q))
    candidates.sort(key=lambda c: c[0])
    inner = barrier.buffer(-tol.gap_close / 4)
    accepted: list[Closure] = []
    used: set[tuple[float, float]] = set()
    for d, p, q in candidates:
        if p in used or q in used:
            continue                              # each wall corner bounds at most one opening
        seg = LineString([p, q])
        core = seg.interpolate(0.02, normalized=True), seg.interpolate(0.98, normalized=True)
        if LineString(core).intersects(inner):
            continue                              # the gap line would cut through a wall
        if any(seg.crosses(c.line) for c in accepted):
            continue
        accepted.append(Closure(p, q))
        used.update((p, q))
    return accepted


# --------------------------------------------------------------------------- detection
def detect_rooms(model: SourceModel, settings: ConversionSettings) -> Detection:
    tol = settings.tolerances
    barrier_prims = [p for p in model.prims if p.kind in ("line", "area")
                     and match(p.layer, settings.roles["wall"] + settings.roles["window"])
                     and not match(p.layer, settings.never_barrier)]
    barrier_layers = sorted({p.layer for p in barrier_prims})
    labels, label_layers = collect_labels(model.prims, settings)
    empty = Detection(barrier_layers, label_layers, 0, [], None, UNRESOLVED, "", [], labels, list(labels), 0)
    if not barrier_prims:
        empty.envelope_reason = ("No wall geometry found: no layer matched the wall/window role patterns. "
                                 "Assign the wall layers in the conversion settings.")
        return empty
    lines, areas = [], [p.geom for p in barrier_prims if p.kind == "area"]
    for p in barrier_prims:
        if p.kind != "line":
            continue
        g = p.geom
        if g.is_ring and len(g.coords) >= 4:
            solid = Polygon(g.coords)
            # A closed outline on a wall layer that is thinner than 0.7 m everywhere is a solid wall piece.
            if solid.is_valid and solid.area > 0 and solid.buffer(-0.35).is_empty:
                areas.append(solid)
                continue
        lines.append(g)
    half = tol.gap_close / 2
    raw = unary_union(polygons(unary_union([g.buffer(half, cap_style="square", join_style="mitre") for g in lines]
                                           + [a.buffer(half, join_style="mitre") for g in areas
                                              for a in polygons(g)])))
    # Gap closing count: components that the buffer merged (an estimate, reported as such).
    raw_parts = len(getattr(unary_union(lines + areas), "geoms", [None]))
    merged_parts = len(getattr(raw, "geoms", [raw]))
    closures = find_openings(raw, settings)
    closure_band = unary_union([c.line.buffer(half, cap_style="flat") for c in closures]) if closures else None
    walls = unary_union([raw, closure_band]) if closure_band is not None else raw
    parts = polygons(walls)
    filled = [(Polygon(p.exterior), p) for p in parts]
    env, main = max(filled, key=lambda fp: fp[0].area)
    det = Detection(barrier_layers, label_layers, max(0, raw_parts - merged_parts), closures, None, UNRESOLVED,
                    "", [], labels, [], 0, barrier=walls)
    det.barrier_outside = sum(1 for f, _ in filled if not f.intersects(env))
    if env.area < main.area * 1.5:
        det.envelope_reason = ("The exterior wall network does not enclose the floor: its largest closed outline "
                               f"({env.area:.1f} m2) is barely larger than the walls themselves "
                               f"({main.area:.1f} m2). Check for a gap in the exterior walls wider than "
                               f"{tol.opening_max} m, or wall layers missing from the wall role.")
        det.unplaced_labels = list(labels)
        return det
    det.envelope = env
    det.envelope_status = HIGH
    det.envelope_reason = "Outer boundary of the closed exterior wall network."
    hull = unary_union([p for p in parts]).convex_hull
    coverage = env.area / hull.area if hull.area else 1.0
    if coverage < 0.6:
        det.envelope_status = REVIEW
        det.envelope_reason = (f"The largest closed wall outline covers only {coverage:.0%} of the extent of the wall "
                               "geometry: the exterior walls may have a gap wider than a doorway, leaving part of the "
                               "floor outside the outline. Check the exterior and the rooms listed as unresolved.")
    inside = [p for f, p in filled if f.intersects(env)]
    free = env.difference(unary_union(inside))
    if closures:
        free = free.difference(unary_union([c.line.buffer(1e-4, cap_style="flat") for c in closures]))
    pieces = polygons(free)
    regions: list[Region] = []
    pieces = [p for p in sorted(pieces, key=lambda g: -g.area) if not p.is_empty and p.area > 0]
    tree = STRtree(pieces)
    for k, piece in enumerate(pieces):
        # Grow back to the wall face, but never into a neighbouring region across a doorway closure.
        grown = piece.buffer(half, join_style="mitre").intersection(env)
        neighbours = [pieces[int(j)] for j in tree.query(piece.buffer(tol.gap_close)) if int(j) != k]
        if neighbours:
            grown = grown.difference(unary_union(neighbours))
        grown_parts = polygons(grown)
        if not grown_parts:
            continue
        grown = max(grown_parts, key=lambda g: g.area).simplify(tol.gap_close / 4)
        touching = sum(1 for c in closures if c.line.distance(piece) < tol.gap_close)
        regions.append(Region(f"R{k + 1:03d}", grown, NOT_GENERATED, [], closures=touching))
    _classify(regions, labels, det, settings)
    det.regions = regions
    return det


def _classify(regions: list[Region], labels: list[Label], det: Detection, settings: ConversionSettings) -> None:
    tol = settings.tolerances
    placed: set[int] = set()
    for r in regions:
        narrow = r.poly.buffer(-tol.room_min_width / 2).is_empty
        if narrow or r.poly.area < tol.room_min_area:
            r.status = NOT_GENERATED
            r.reasons.append(f"{'narrower than ' + str(tol.room_min_width) + ' m' if narrow else ''}"
                             f"{' and ' if narrow and r.poly.area < tol.room_min_area else ''}"
                             f"{'smaller than ' + str(tol.room_min_area) + ' m2' if r.poly.area < tol.room_min_area else ''}"
                             ": wall cavity, doorway reveal or drafting sliver, not a room")
            continue
        islands = [Polygon(h) for h in r.poly.interiors]
        big_islands = [h for h in islands if h.area > tol.island_fill_max_area]
        for i, lab in enumerate(labels):
            if i not in placed and Polygon(r.poly.exterior).contains(Point(lab.at)) and not any(
                    h.contains(Point(lab.at)) for h in big_islands):
                placed.add(i)
                if lab.name not in r.names:
                    r.names.append(lab.name)
                if lab.number and lab.number not in r.numbers:
                    r.numbers.append(lab.number)
                r.label_handles.extend(lab.handles)
        if len(r.names) == 1:
            r.status = HIGH
            r.reasons.append(f"enclosed by walls and doorway closures; one room name inside ({r.names[0]})")
        elif len(r.names) > 1:
            r.status = REVIEW
            r.reasons.append("several different room names in one enclosed region (" + ", ".join(r.names) +
                             "): a separating wall or opening may be missing or not on a wall layer")
        else:
            r.status = REVIEW
            r.reasons.append("enclosed region without a room label (shaft, duct, void or unlabelled room)")
        if islands:
            # A Space is one closed polyline, so it cannot have holes.
            small = [h for h in islands if h.area <= tol.island_fill_max_area]
            if small:
                r.reasons.append(f"{len(small)} free-standing island(s) inside the room (columns or small structure, "
                                 f"{sum(h.area for h in small):.2f} m2 in total) are included in the room outline")
            if big_islands:
                r.status = REVIEW
                r.reasons.append(f"{len(big_islands)} enclosed island(s) larger than {tol.island_fill_max_area} m2 "
                                 "lie inside this room; a closed polyline cannot exclude them. Split the room "
                                 "or confirm the outline")
            r.poly = Polygon(r.poly.exterior)
    # Labels that fall just outside every room (e.g. text overlapping a wall): nearest room within 0.5 m.
    for i, lab in enumerate(labels):
        if i in placed:
            continue
        near = [r for r in regions if r.status != NOT_GENERATED and r.poly.distance(Point(lab.at)) <= 0.5]
        if near:
            r = min(near, key=lambda rr: rr.poly.distance(Point(lab.at)))
            placed.add(i)
            if lab.name not in r.names:
                r.names.append(lab.name)
            if lab.number and lab.number not in r.numbers:
                r.numbers.append(lab.number)
            r.label_handles.extend(lab.handles)
            r.status = REVIEW
            r.reasons.append(f"label '{lab.name}' lies {r.poly.distance(Point(lab.at)):.2f} m outside the region "
                             "and was attached to the nearest room")
    det.unplaced_labels = [lab for i, lab in enumerate(labels) if i not in placed]
