"""Coordinate reference system handling.

Principles (spec §4.4 and M4 safety rules):
  * Assigning / declaring a CRS is not a transformation and never moves geometry.
  * Coordinates are never translated, rotated, scaled or reprojected because of their
    appearance, extents or presumed location.
  * An unknown or unconfirmed source CRS blocks any transformation and is a blocking error.
  * A transformation only runs with an explicit source CRS, explicit target CRS (or PROJ
    pipeline) AND an explicit confirmation flag; it is logged with before/after extents.
"""
from __future__ import annotations

from dataclasses import dataclass

from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError, ProjError

from m4adm.models import CRSSettings, Severity
from m4adm.validate import Collector

Extents = tuple[float, float, float, float]  # minx, miny, maxx, maxy


def extents_of(points: list[tuple[float, float]]) -> Extents | None:
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def parse_crs(value: str) -> CRS:
    return CRS.from_user_input(value)


def plausibility_window(window: dict, target: CRS) -> Extents:
    """Project the geographic plausibility window into the target CRS (densified edges)."""
    tr = Transformer.from_crs("EPSG:4326", target, always_xy=True)
    xs, ys = [], []
    n = 20
    for i in range(n + 1):
        lon = window["min_lon"] + (window["max_lon"] - window["min_lon"]) * i / n
        for lat in (window["min_lat"], window["max_lat"]):
            x, y = tr.transform(lon, lat)
            xs.append(x)
            ys.append(y)
        lat = window["min_lat"] + (window["max_lat"] - window["min_lat"]) * i / n
        for lon in (window["min_lon"], window["max_lon"]):
            x, y = tr.transform(lon, lat)
            xs.append(x)
            ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys))


@dataclass
class CRSStatus:
    source: CRS | None
    target: CRS
    same_as_target: bool
    transformation_requested: bool
    transformation_allowed: bool
    summary: str


def check_crs(settings: CRSSettings, extents: Extents | None, col: Collector) -> CRSStatus:
    m = col.manifest
    target = parse_crs(settings.target_crs)
    manifest_target = CRS.from_epsg(int(m.crs["target_epsg"]))
    if not target.equals(manifest_target):
        col.add(
            "ADM-CRS-001",
            f"Configured target CRS {settings.target_crs} differs from the ADM CRS "
            f"(EPSG:{m.crs['target_epsg']}, {m.crs['name']}).",
            f"Set the target CRS to EPSG:{m.crs['target_epsg']}.",
            blocking=True,
        )
    source: CRS | None = None
    requested = bool(settings.transform_pipeline)
    if not settings.source_crs:
        col.add(
            "USR-CRS-001",
            "Source coordinate system is unknown. Coordinate checks cannot be confirmed and any "
            "transformation is blocked.",
            "Confirm the drawing's coordinate system (e.g. from the survey/SDD reference data). If it is "
            "already WGS 84 / UTM 40N, select EPSG:32640 and tick 'confirmed'. Do not move the drawing by eye.",
            blocking=True,
        )
        _plausibility(extents, target, col, declared=False)
        return CRSStatus(None, target, False, requested, False, "source CRS unknown - blocked")
    try:
        source = parse_crs(settings.source_crs)
    except CRSError as exc:
        col.add("USR-CRS-001", f"Source CRS '{settings.source_crs}' is not a valid CRS definition: {exc}",
                "Enter an EPSG code (e.g. EPSG:32640) or a valid WKT/PROJ definition.", blocking=True)
        return CRSStatus(None, target, False, requested, False, "source CRS invalid - blocked")

    same = source.equals(target)
    if not settings.source_confirmed:
        col.add(
            "USR-CRS-001",
            f"Source CRS {settings.source_crs} is declared but not confirmed by the engineer.",
            "Review the declared CRS against the project survey data and tick 'source CRS confirmed'.",
            blocking=True,
        )
    if not same:
        col.add(
            "ADM-CRS-001",
            f"Declared source CRS {source.name} is not the ADM CRS {target.name}.",
            "The drawing must be delivered in WGS 84 / UTM Zone 40N. Either re-draft from SDD reference data, "
            "or supply an explicit, verified transformation and confirm it (logged with before/after extents).",
            blocking=True,
        )
    allowed = False
    if requested:
        if not (settings.confirm_transformation and settings.source_confirmed):
            col.add(
                "M4-SAFE-CRS",
                "A coordinate transformation was requested but not explicitly confirmed; nothing was transformed.",
                "Tick both 'source CRS confirmed' and 'confirm transformation' to run it, after checking the parameters.",
                blocking=True,
            )
        else:
            allowed = True

    if same:
        _plausibility(extents, target, col, declared=True)
    summary = (
        "declared source equals ADM CRS - no transformation performed (CRS assignment only)"
        if same else f"source {source.to_string()} differs from ADM CRS"
    )
    if same and not settings.source_confirmed:
        summary += " (declaration not confirmed)"
    return CRSStatus(source, target, same, requested, allowed, summary)


def _plausibility(extents: Extents | None, target: CRS, col: Collector, declared: bool) -> None:
    win = col.manifest.crs.get("plausibility_window_lonlat")
    if not (extents and win):
        return
    wx0, wy0, wx1, wy1 = plausibility_window(win, target)
    x0, y0, x1, y1 = extents
    if x0 >= wx0 and y0 >= wy0 and x1 <= wx1 and y1 <= wy1:
        return
    local = max(abs(x0), abs(x1), abs(y0), abs(y1)) < 100_000
    col.add(
        "ENG-CRS-003",
        f"Drawing extents ({x0:.1f}, {y0:.1f}) - ({x1:.1f}, {y1:.1f}) fall outside the plausible "
        f"UTM 40N window for the Abu Dhabi emirate ({wx0:.0f}, {wy0:.0f}) - ({wx1:.0f}, {wy1:.0f})."
        + (" Coordinates look like a local/arbitrary system." if local else ""),
        "Verify the coordinate system against SDD reference data (Appendix 1). The tool will not shift "
        "the drawing; correct it at source or supply a confirmed transformation.",
        extents=extents, window=(wx0, wy0, wx1, wy1),
    )
    if declared:
        col.add(
            "ADM-CRS-002",
            "Drawing may be in an arbitrary coordinate system (see ENG-CRS-003).",
            "Confirm the drawing was produced on ADM reference data in UTM 40N.",
            severity=Severity.WARNING,
        )


@dataclass
class TransformLog:
    pipeline: str
    before: Extents | None
    after: Extents | None
    entities: int


TRANSFORMABLE = {"LWPOLYLINE", "POINT", "INSERT"}


def transform_entities(entities, settings: CRSSettings) -> TransformLog:
    """Apply an explicitly confirmed transformation to supported entities.

    Raises ValueError (operation blocked) if any entity cannot be transformed exactly:
    curves, bulges, non-standard OCS, rotated blocks and other types are refused because
    their shape or orientation would need more than a point-wise transformation.
    """
    if not (settings.confirm_transformation and settings.source_confirmed and settings.transform_pipeline):
        raise ValueError("transformation not confirmed")
    try:
        if settings.transform_pipeline.strip().startswith(("+proj=pipeline", "proj=pipeline")):
            tr = Transformer.from_pipeline(settings.transform_pipeline)
        else:
            tr = Transformer.from_crs(settings.source_crs, settings.transform_pipeline, always_xy=True)
    except (CRSError, ProjError) as exc:
        raise ValueError(f"invalid transformation definition: {exc}") from exc

    refused = []
    for e in entities:
        t = e.dxftype()
        ext = e.dxf.get("extrusion", (0, 0, 1)) if e.dxf.is_supported("extrusion") else (0, 0, 1)
        if t not in TRANSFORMABLE or tuple(ext) != (0, 0, 1):
            refused.append(f"{t}#{e.dxf.handle}")
        elif t == "LWPOLYLINE" and any(abs(b) > 1e-12 for *_, b in e.get_points("xyb")):
            refused.append(f"{t}#{e.dxf.handle} (arc segments)")
        elif t == "INSERT" and abs(e.dxf.get("rotation", 0.0)) > 1e-12:
            refused.append(f"{t}#{e.dxf.handle} (rotated block)")
    if refused:
        raise ValueError("transformation blocked; unsupported entities: " + ", ".join(refused[:20]))

    before_pts, after_pts = [], []

    def tx(x: float, y: float) -> tuple[float, float]:
        nx, ny = tr.transform(x, y)
        if nx == float("inf") or ny == float("inf"):
            raise ValueError(f"transformation failed for point ({x}, {y})")
        before_pts.append((x, y))
        after_pts.append((nx, ny))
        return nx, ny

    count = 0
    for e in entities:
        t = e.dxftype()
        if t == "LWPOLYLINE":
            pts = list(e.get_points("xyseb"))
            e.set_points([(*tx(x, y), s, en, b) for x, y, s, en, b in pts], format="xyseb")
        elif t == "POINT":
            x, y, z = e.dxf.location
            e.dxf.location = (*tx(x, y), z)
        elif t == "INSERT":
            x, y, z = e.dxf.insert
            nx, ny = tx(x, y)
            dx, dy = nx - x, ny - y
            e.dxf.insert = (nx, ny, z)
            for a in e.attribs:
                ax, ay, az = a.dxf.insert
                a.dxf.insert = (ax + dx, ay + dy, az)
                if a.dxf.hasattr("align_point"):
                    px, py, pz = a.dxf.align_point
                    a.dxf.align_point = (px + dx, py + dy, pz)
        count += 1
    return TransformLog(settings.transform_pipeline, extents_of(before_pts), extents_of(after_pts), count)
