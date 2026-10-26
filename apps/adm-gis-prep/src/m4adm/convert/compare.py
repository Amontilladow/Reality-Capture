"""Measure a conversion draft against an accepted GIS drawing of the same floor.

EVALUATION ONLY. The alignment used here is fitted to matched room centroids purely to measure geometry; it is
never used to georeference a submission (that needs engineer-supplied control points, see georef.py).

Metrics: feature counts per layer, room-name matching, IoU and area ratio per matched room after alignment,
centroid residuals of the alignment, and attribute agreement for SpaceUsage.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import ezdxf
from shapely.affinity import affine_transform
from shapely.geometry import Point, Polygon

from m4adm.crs import fit_similarity


def _norm(name: str) -> str:
    return " ".join(name.upper().replace("ROOM", "").split())


def _reference(path: Path) -> tuple[dict[str, int], list[tuple[str, Polygon]]]:
    doc = ezdxf.readfile(str(path))
    msp = doc.modelspace()
    counts: dict[str, int] = {}
    spaces = []
    polys = [e for e in msp.query("LWPOLYLINE")]
    for e in polys:
        counts[e.dxf.layer] = counts.get(e.dxf.layer, 0) + 1
    space_polys = [Polygon([(p[0], p[1]) for p in e.get_points()]) for e in polys if e.dxf.layer == "Space"]
    for ins in msp.query("INSERT[layer=='SpaceDetail']"):
        usage = ins.get_attrib_text("SPACEUSAGE") or ""
        pt = ins.dxf.insert
        host = [p for p in space_polys if p.buffer(1e-6).contains(Point(pt.x, pt.y))]
        if host:
            spaces.append((usage.strip(), min(host, key=lambda p: p.area)))
    return counts, spaces


def compare(conversion_dir: Path, reference_dxf: Path) -> dict:
    rep = json.loads((Path(conversion_dir) / "conversion_report.json").read_text(encoding="utf-8"))
    gen_counts: dict[str, int] = {}
    gen_spaces = []
    for f in rep["features"]:
        if f["vertices"] is None or f["status"] not in ("AUTO_GENERATED_HIGH_CONFIDENCE", "GENERATED_REQUIRES_REVIEW",
                                                        "USER_ACCEPTED"):
            continue
        gen_counts[f["layer"]] = gen_counts.get(f["layer"], 0) + 1
        if f["layer"] == "Space":
            gen_spaces.append((f["attributes"].get("SPACEUSAGE", {}).get("value", ""), Polygon(f["vertices"]), f["id"]))
    ref_counts, ref_spaces = _reference(Path(reference_dxf))
    # Match rooms whose normalised name occurs exactly once on each side.
    gen_by = {}
    for name, poly, fid in gen_spaces:
        gen_by.setdefault(_norm(name), []).append((poly, fid))
    ref_by = {}
    for name, poly in ref_spaces:
        ref_by.setdefault(_norm(name), []).append(poly)
    pairs = [(n, gen_by[n][0], ref_by[n][0]) for n in gen_by if n and len(gen_by[n]) == 1 and len(ref_by.get(n, [])) == 1]
    result = {"reference": Path(reference_dxf).name, "feature_counts": {"generated": gen_counts, "reference": ref_counts},
              "rooms_generated": len(gen_spaces), "rooms_reference": len(ref_spaces),
              "rooms_matched_by_name": len(pairs),
              "unmatched_generated": sorted({_norm(n) for n, _, _ in gen_spaces} - set(ref_by)),
              "unmatched_reference": sorted(set(ref_by) - {_norm(n) for n, _, _ in gen_spaces}),
              "note": "Alignment fitted to matched room centroids for measurement only; not a georeferencing."}
    if len(pairs) < 3:
        result["alignment"] = "not enough uniquely named rooms to align (need 3)"
        return result
    sim = fit_similarity([((g[0].centroid.x, g[0].centroid.y), (r.centroid.x, r.centroid.y)) for _, g, r in pairs])
    t = math.radians(sim.rotation_deg)
    a, b = sim.scale * math.cos(t), sim.scale * math.sin(t)
    rows = []
    for (name, (gp, fid), rp), res in zip(pairs, sim.residuals):
        moved = affine_transform(gp, [a, -b, b, a, sim.tx, sim.ty])
        inter = moved.intersection(rp).area
        union = moved.union(rp).area
        rows.append({"room": name, "feature": fid, "iou": round(inter / union, 3) if union else 0.0,
                     "area_generated_m2": round(gp.area, 2), "area_reference_m2": round(rp.area, 2),
                     "centroid_residual_m": round(res, 3)})
    result["alignment"] = {"scale": round(sim.scale, 5), "rotation_deg": round(sim.rotation_deg, 3),
                           "rms_m": round(sim.rms, 3)}
    result["rooms"] = rows
    result["mean_iou"] = round(sum(r["iou"] for r in rows) / len(rows), 3)
    return result
