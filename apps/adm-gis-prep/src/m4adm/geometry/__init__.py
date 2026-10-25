"""Geometry helpers: entity records -> shapely geometry, exact arc densification."""
from __future__ import annotations

import math

from ezdxf.math import Vec2, bulge_center
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry

from m4adm.classify import EntityRecord


def arc_points(p1: tuple[float, float], p2: tuple[float, float], bulge: float, sagitta: float
               ) -> tuple[list[tuple[float, float]], float]:
    """Intermediate points of a bulge arc from p1 to p2 (exclusive of both ends).

    Points are equally spaced in angle (consistent vertex spacing, spec Figure 2) and the
    maximum chord-to-arc deviation is <= ``sagitta``. Returns (points, max_deviation).
    """
    if abs(bulge) < 1e-12:
        return [], 0.0
    a, b = Vec2(p1), Vec2(p2)
    chord = a.distance(b)
    if chord == 0:
        return [], 0.0
    theta = 4.0 * math.atan(bulge)                 # signed included angle, + = counter-clockwise
    radius = chord / (2.0 * math.sin(abs(theta) / 2.0))
    center = Vec2(bulge_center(a, b, bulge))
    start = math.atan2(a.y - center.y, a.x - center.x)
    if sagitta >= radius:
        n = max(1, math.ceil(abs(theta) / (math.pi / 2)))
    else:
        max_step = 2.0 * math.acos(1.0 - sagitta / radius)
        n = max(1, math.ceil(abs(theta) / max_step))
    pts = []
    for k in range(1, n):
        ang = start + theta * k / n
        pts.append((center.x + radius * math.cos(ang), center.y + radius * math.sin(ang)))
    deviation = radius * (1.0 - math.cos(abs(theta) / (2.0 * n)))
    return pts, deviation


def densify_xyb(points: list[tuple[float, float, float]], closed: bool, sagitta: float
                ) -> tuple[list[tuple[float, float]], float]:
    """Replace bulge segments with vertices. Original vertices are kept exactly."""
    out: list[tuple[float, float]] = []
    worst = 0.0
    n = len(points)
    seg_count = n if closed else n - 1
    for i in range(n):
        x, y, bulge = points[i]
        out.append((x, y))
        if i < seg_count:
            nx, ny, _ = points[(i + 1) % n]
            mids, dev = arc_points((x, y), (nx, ny), bulge, sagitta)
            out.extend(mids)
            worst = max(worst, dev)
    return out, worst


def record_vertices(rec: EntityRecord, sagitta: float) -> list[tuple[float, float]]:
    """WCS vertices for checks; bulge arcs approximated within ``sagitta``."""
    if not rec.has_bulges:
        return list(rec.points)
    e = rec.entity
    if rec.structure == "LWPOLYLINE":
        raw = [(x, y, b) for x, y, b in e.get_points("xyb")]
    else:
        raw = [(v.dxf.location[0], v.dxf.location[1], v.dxf.get("bulge", 0.0)) for v in e.vertices]
    ocs_pts, _ = densify_xyb(raw, rec.closed, sagitta)
    ocs = e.ocs()
    return [tuple(ocs.to_wcs((x, y, rec.elevation)))[:2] for x, y in ocs_pts]


def dedupe_consecutive(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for p in pts:
        if not out or math.dist(out[-1], p) > tol:
            out.append(p)
    return out


def to_shape(rec: EntityRecord, sagitta: float, tol: float) -> BaseGeometry | None:
    """Polygon for closed polylines, LineString for open ones, Point for inserts."""
    if rec.structure == "INSERT" and rec.location:
        return Point(rec.location)
    if not rec.is_polyline_like:
        return None
    pts = dedupe_consecutive(record_vertices(rec, sagitta), tol)
    if rec.closed:
        if len(pts) > 1 and math.dist(pts[0], pts[-1]) <= tol:
            pts = pts[:-1]
        if len(pts) < 3:
            return None
        return Polygon(pts)
    if len(pts) < 2:
        return None
    return LineString(pts)


def polyline_length(pts: list[tuple[float, float]], closed: bool) -> float:
    if len(pts) < 2:
        return 0.0
    total = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    if closed:
        total += math.dist(pts[-1], pts[0])
    return total
