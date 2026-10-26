"""Stage H (part): topology of the GENERATED features so they meet the BDMS snapping rules.

Only geometry this tool generated is adjusted here, never source geometry, and every adjustment is recorded on
the feature:

* Windows are drawn inside the exterior wall; DRM requires each window to touch a space. A window's room-side
  edge is extended along the wall normal to the room boundary when that is at most `max_extend` away.
* Door and window vertices within `snap` of a room vertex move onto it (else onto the room edge), removing the
  1-2 cm offsets left by the barrier buffer.
* Noding: wherever a vertex of one generated polygon lies on another's edge, that edge gets a matching vertex
  (DRM "Snapping error" rule). Shapes do not change.
"""
from __future__ import annotations

import math

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points

from m4adm.convert.features import Feature
from m4adm.convert.rooms import NOT_GENERATED

SNAP_LAYERS = {"Space", "Door", "Window", "Floor", "Unit", "BuildingOutline"}


def _rooms(feats: list[Feature]) -> list[Feature]:
    return [f for f in feats if f.layer == "Space" and f.exported]


def extend_windows(feats: list[Feature], max_extend: float = 0.6) -> int:
    rooms = _rooms(feats)
    done = 0
    for f in feats:
        if f.layer != "Window" or not f.exported:
            continue
        near = [r for r in rooms if r.poly.distance(f.poly) <= max_extend]
        if not near:
            f.reasons.append(f"no room boundary within {max_extend} m: the window touches no space - review")
            continue
        room = min(near, key=lambda r: r.poly.distance(f.poly))
        gap = room.poly.distance(f.poly)
        if gap < 1e-6:
            continue
        c = list(f.poly.exterior.coords)[:4]
        # the two vertices nearest the room form the room-side edge
        order = sorted(range(4), key=lambda i: room.poly.exterior.distance(Point(c[i])))
        i, j = sorted(order[:2])
        if (j - i) % 4 not in (1, 3):
            continue
        ex, ey = c[j][0] - c[i][0], c[j][1] - c[i][1]
        el = math.hypot(ex, ey)
        nx, ny = -ey / el, ex / el
        mid = ((c[i][0] + c[j][0]) / 2, (c[i][1] + c[j][1]) / 2)
        if room.poly.exterior.distance(Point(mid[0] + nx * gap, mid[1] + ny * gap)) > \
                room.poly.exterior.distance(Point(mid[0] - nx * gap, mid[1] - ny * gap)):
            nx, ny = -nx, -ny
        new = list(c)
        ok = True
        for k in (i, j):
            ray = LineString([c[k], (c[k][0] + nx * (max_extend + 0.05), c[k][1] + ny * (max_extend + 0.05))])
            hit = ray.intersection(room.poly.exterior)
            if hit.is_empty:
                ok = False
                break
            p = nearest_points(Point(c[k]), hit)[1]
            new[k] = (p.x, p.y)
        if not ok:
            f.reasons.append("room-side edge could not be extended to the room boundary - review")
            continue
        poly = Polygon(new)
        if poly.is_valid and poly.area > 0:
            f.poly = poly
            f.reasons.append(f"extended {gap:.3f} m to the boundary of {room.id} so it touches the space")
            done += 1
    return done


def snap_vertices(feats: list[Feature], snap: float = 0.03) -> int:
    rooms = _rooms(feats) + [f for f in feats if f.exported and f.layer in ("Floor", "Unit", "BuildingOutline")]
    moved = 0
    room_vertices = [(x, y) for r in rooms for x, y in r.poly.exterior.coords[:-1]]
    for f in feats:
        if f.layer not in ("Door", "Window") or not f.exported:
            continue
        coords = list(f.poly.exterior.coords)[:-1]
        changed = False
        for k, (x, y) in enumerate(coords):
            best = min(room_vertices, key=lambda v: (v[0] - x) ** 2 + (v[1] - y) ** 2, default=None)
            if best is not None and 1e-9 < math.dist(best, (x, y)) <= snap:
                coords[k] = best
                changed = True
                continue
            for r in rooms:
                d = r.poly.exterior.distance(Point(x, y))
                if 1e-9 < d <= snap:
                    p = r.poly.exterior.interpolate(r.poly.exterior.project(Point(x, y)))
                    coords[k] = (p.x, p.y)
                    changed = True
                    break
        if changed:
            poly = Polygon(_dedupe(coords))
            if poly.is_valid and poly.area > 0:
                f.poly = poly
                moved += 1
                f.reasons.append(f"vertices snapped (<= {snap} m) to adjacent room vertices/edges")
    return moved


PRIORITY = {"Space": 0, "Floor": 1, "Unit": 1, "BuildingOutline": 1, "Door": 2, "Window": 3}


def _dedupe(coords: list) -> list:
    out = []
    for c in coords:
        if not out or math.dist(out[-1], c) > 1e-6:
            out.append(c)
    while len(out) > 1 and math.dist(out[0], out[-1]) <= 1e-6:
        out.pop()
    return out


def cluster_vertices(feats: list[Feature], tol: float = 0.015) -> int:
    """Vertices of DIFFERENT generated polygons closer than `tol` become one vertex (the room's vertex when one is
    in the cluster), so features that meet share exact vertices. Returns the number of vertices moved."""
    from shapely import STRtree

    polys = [f for f in feats if f.exported and f.layer in SNAP_LAYERS]
    verts = [(f, k, (x, y)) for f in polys for k, (x, y) in enumerate(f.poly.exterior.coords[:-1])]
    pts = [Point(v[2]) for v in verts]
    tree = STRtree(pts)
    target: dict[int, tuple[float, float]] = {}
    for i, (f, _, p) in enumerate(verts):
        if i in target:
            continue
        group = [int(j) for j in tree.query(pts[i].buffer(tol)) if math.dist(verts[int(j)][2], p) <= tol]
        if len({verts[j][0].id for j in group}) < 2:
            continue
        rep = min(group, key=lambda j: (PRIORITY.get(verts[j][0].layer, 9), j))
        for j in group:
            target.setdefault(j, verts[rep][2])
    moved = 0
    by_feat: dict[str, list] = {}
    for i, (f, k, p) in enumerate(verts):
        by_feat.setdefault(f.id, list(f.poly.exterior.coords)[:-1])
        if i in target and target[i] != p:
            by_feat[f.id][k] = target[i]
            moved += 1
    for f in polys:
        coords = _dedupe(by_feat.get(f.id, []))
        if len(coords) >= 3:
            poly = Polygon(coords)
            if poly.is_valid and poly.area > 0:
                f.poly = poly
    return moved


def node(feats: list[Feature], tol: float = 1e-4) -> int:
    """Insert a vertex in an edge wherever another generated polygon has a vertex on it. Returns vertices added."""
    polys = [f for f in feats if f.exported and f.layer in SNAP_LAYERS]
    all_vertices = [(f.id, (x, y)) for f in polys for x, y in f.poly.exterior.coords[:-1]]
    added = 0
    for f in polys:
        ring = list(f.poly.exterior.coords)[:-1]
        others = [v for fid, v in all_vertices if fid != f.id]
        x0, y0, x1, y1 = f.poly.bounds
        others = [v for v in others if x0 - tol <= v[0] <= x1 + tol and y0 - tol <= v[1] <= y1 + tol]
        if not others:
            continue
        out = []
        n = len(ring)
        for k in range(n):
            a, b = ring[k], ring[(k + 1) % n]
            out.append(a)
            seg = LineString([a, b])
            on = []
            for v in others:
                if math.dist(v, a) <= tol or math.dist(v, b) <= tol:
                    continue
                if seg.distance(Point(v)) <= tol:
                    on.append((seg.project(Point(v)), v))
            for _, v in sorted(set(on)):
                out.append(v)
                added += 1
        poly = Polygon(_dedupe(out))
        if poly.is_valid:
            f.poly = poly
    return added


def clip_openings(feats: list[Feature]) -> int:
    """Doors and windows must not overlap rooms: the part inside a room is cut away (the room keeps its outline)."""
    from shapely.ops import unary_union

    rooms = unary_union([r.poly for r in _rooms(feats)])
    clipped = 0
    for f in feats:
        if f.layer not in ("Door", "Window") or not f.exported:
            continue
        inter = f.poly.intersection(rooms).area
        if inter <= 1e-6:
            continue
        rest = f.poly.difference(rooms)
        parts = [g for g in getattr(rest, "geoms", [rest]) if isinstance(g, Polygon) and g.area > 0]
        if parts:
            f.poly = max(parts, key=lambda g: g.area).simplify(1e-5)
            f.reasons.append(f"clipped {inter:.3f} m2 that overlapped a room")
            clipped += 1
    return clipped


def drop_orphan_doors(feats: list[Feature]) -> int:
    """A door joins two rooms, or one room and the outside when a door block at the opening is evidence of a
    door. Openings bordering no room, or one room without a door block (e.g. a gap between glazing panels in
    the facade), are not written as doors."""
    rooms = _rooms(feats)
    dropped = 0
    for f in feats:
        if f.layer != "Door" or not f.exported:
            continue
        n = sum(1 for r in rooms if r.poly.distance(f.poly) < 0.05)
        if n >= 2 or (n == 1 and f.source_handles):
            continue
        f.status = NOT_GENERATED
        f.reasons.append("the opening borders no generated room" if n == 0 else
                         "the opening borders one room and the outside, with no door block at it (facade "
                         "glazing joint or gap), so no door is written")
        dropped += 1
    return dropped
