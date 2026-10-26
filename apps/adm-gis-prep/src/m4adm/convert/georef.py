"""Stage G: controlled coordinate transformation.

Two separate operations, each recorded:

1. Unit conversion (drawing units -> metres): a pure scale by the factor read from $INSUNITS or declared by the
   engineer. Done during source reading; it does not move the drawing anywhere.
2. Georeferencing (local metres -> UTM metres): a 2D similarity (rotation + translation + scale) fitted by least
   squares to engineer-supplied control points. It is applied only when every check passes AND the engineer
   confirmed it. Otherwise the draft stays in local coordinates and is marked NOT GEOREFERENCED.

Control points are entered in SOURCE DRAWING UNITS (as read in CAD, e.g. millimetres) -> target E, N in metres.
Nothing here guesses points, assumes a CRS, or shifts the drawing to "look plausible".
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from pyproj import CRS, Transformer
from shapely.geometry import MultiPoint, Polygon

from m4adm.crs import Similarity, fit_similarity

APPLIED, NOT_REQUESTED, BLOCKED, AWAITING_CONFIRMATION = (
    "APPLIED", "NOT_REQUESTED", "BLOCKED", "AWAITING_CONFIRMATION")
SCALE_TOLERANCE = 0.002          # after unit conversion a correct fit has scale 1 +/- 0.2 %
MIN_SPREAD_FRACTION = 0.3        # control points must span at least 30 % of the floor's diagonal


@dataclass
class GeorefResult:
    status: str
    messages: list[str] = field(default_factory=list)
    similarity: Similarity | None = None
    points: list[dict] = field(default_factory=list)
    target_crs: str | None = None
    diagnostics: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"status": self.status, "messages": self.messages, "target_crs": self.target_crs,
                "transformation": self.similarity.as_dict() if self.similarity else None,
                "control_points": self.points, "diagnostics": self.diagnostics}


def plan(control_points, unit_scale: float, envelope: Polygon | None, crs_settings, allowed_epsg: list[int],
         window: dict | None) -> GeorefResult:
    pts = [((sx * unit_scale, sy * unit_scale), (tx, ty)) for (sx, sy), (tx, ty) in control_points]
    if not pts:
        return GeorefResult(NOT_REQUESTED, ["No control points: the draft stays in local coordinates (metres) and "
                                            "is NOT georeferenced. It cannot be submitted until georeferenced."])
    res = GeorefResult(BLOCKED, points=[{"source_m": list(s), "target": list(t)} for s, t in pts])
    try:
        target = CRS.from_user_input(crs_settings.target_crs)
    except Exception as exc:                                            # noqa: BLE001
        res.messages.append(f"Target CRS '{crs_settings.target_crs}' is not recognised: {exc}")
        return res
    epsg = target.to_epsg()
    res.target_crs = f"EPSG:{epsg}" if epsg else target.name
    if epsg not in allowed_epsg:
        res.messages.append(f"Target CRS {res.target_crs} is not one the BDMS submission accepts "
                            f"({', '.join(f'EPSG:{e}' for e in allowed_epsg)}).")
        return res
    if len(pts) < 2:
        res.messages.append("At least two control point pairs are needed (three or more give a residual check).")
        return res
    try:
        sim = fit_similarity(pts)
    except ValueError as exc:
        res.messages.append(str(exc))
        return res
    res.similarity = sim
    for p, r in zip(res.points, sim.residuals):
        p["residual_m"] = round(r, 4)
    diag = res.diagnostics
    diag["n_points"] = len(pts)
    diag["scale"] = sim.scale
    diag["rms_m"] = sim.rms
    blocking = []
    if len(pts) == 2:
        res.messages.append("Only two control points: the fit is exact by construction, so residuals cannot reveal "
                            "a wrong point. Use three or more well-spread points.")
    if abs(sim.scale - 1) > SCALE_TOLERANCE:
        blocking.append(f"Fitted scale {sim.scale:.5f} differs from 1 by more than {SCALE_TOLERANCE:.1%}: after "
                        "unit conversion the floor should not change size. Check the drawing units and that each "
                        "source point matches its target point.")
    if sim.rms > crs_settings.max_georef_rms:
        blocking.append(f"RMS residual {sim.rms:.3f} m exceeds the {crs_settings.max_georef_rms} m limit.")
    if len(pts) >= 3:
        # Leave-one-out: fit without each point and see how far that point is from where the others put it.
        loo = []
        for k in range(len(pts)):
            rest = pts[:k] + pts[k + 1:]
            try:
                fit = fit_similarity(rest)
            except ValueError:
                continue
            loo.append((math.dist(fit.apply(*pts[k][0]), pts[k][1]), fit.rms, k))
        diag["leave_one_out_m"] = [round(d, 4) for d, _, _ in sorted(loo, key=lambda x: x[2])]
        if len(pts) >= 4 and loo:
            d, rest_rms, k = max(loo)
            if d > 3 * crs_settings.max_georef_rms and rest_rms <= crs_settings.max_georef_rms:
                blocking.insert(0, f"Control point {k + 1} is inconsistent with the others: they place it {d:.3f} m "
                                   f"from its target while fitting each other within {rest_rms:.3f} m. Check it or "
                                   "remove it.")
        hull = MultiPoint([s for s, _ in pts]).convex_hull
        diag["control_area_m2"] = hull.area
    if envelope is not None:
        x0, y0, x1, y1 = envelope.bounds
        diag_len = math.hypot(x1 - x0, y1 - y0)
        spread = max(math.dist(a, b) for (a, _), (b, _) in ((p, q) for p in pts for q in pts))
        diag["spread_fraction"] = spread / diag_len if diag_len else 0
        if diag_len and spread < MIN_SPREAD_FRACTION * diag_len:
            blocking.append(f"Control points span {spread:.1f} m, less than {MIN_SPREAD_FRACTION:.0%} of the floor's "
                            f"{diag_len:.1f} m diagonal; rotation would be poorly determined. Use points far apart "
                            "(e.g. opposite building corners).")
        if len(pts) >= 3 and diag.get("control_area_m2", 0) < 0.01 * diag_len ** 2:
            res.messages.append("Control points are nearly collinear; add a point off that line.")
        if window:
            c = envelope.centroid
            lon, lat = Transformer.from_crs(target, CRS.from_epsg(4326), always_xy=True).transform(*sim.apply(c.x, c.y))
            diag["centre_lonlat"] = [round(lon, 6), round(lat, 6)]
            if not (window["min_lon"] <= lon <= window["max_lon"] and window["min_lat"] <= lat <= window["max_lat"]):
                blocking.append(f"The transformed floor lies at lon {lon:.4f}, lat {lat:.4f}, outside the Abu Dhabi "
                                f"emirate window: the target coordinates or CRS are wrong.")
    if blocking:
        res.messages = blocking + res.messages
        return res
    if not crs_settings.confirm_transformation:
        res.status = AWAITING_CONFIRMATION
        res.messages.insert(0, f"Fit is acceptable (RMS {sim.rms:.3f} m, scale {sim.scale:.5f}, rotation "
                               f"{sim.rotation_deg:.3f} deg). Confirm the transformation to apply it.")
        return res
    res.status = APPLIED
    res.messages.insert(0, f"Applied: RMS {sim.rms:.3f} m, scale {sim.scale:.6f}, rotation {sim.rotation_deg:.4f} deg, "
                           f"shift ({sim.tx:.3f}, {sim.ty:.3f}).")
    return res
