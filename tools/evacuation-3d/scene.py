"""Metric 3D scene + orthographic axonometric camera for one floor model.

World frame (three.js convention, metres): x = sheet right, y = up,
z = sheet down (toward the reader). Plan proportions are preserved: the plan is
only translated and divided by the drawing scale, never stretched.
"""
import json
import math

import numpy as np

WALL_H = 2.0      # diagrammatic cut height; true storey height is not on the sheets
SLAB_T = 0.35     # diagrammatic slab thickness
GLAZING_H = 2.0


class Camera:
    """Orthographic camera; azimuth about the vertical, elevation above horizon."""

    def __init__(self, azimuth_deg=28.0, elevation_deg=50.0):
        t, f = math.radians(azimuth_deg), math.radians(elevation_deg)
        self.azimuth, self.elevation = azimuth_deg, elevation_deg
        self.d = np.array([math.sin(t) * math.cos(f), math.sin(f), math.cos(t) * math.cos(f)])
        self.xc = np.array([math.cos(t), 0.0, -math.sin(t)])
        self.yc = np.cross(self.d, self.xc)

    def project(self, p):
        p = np.atleast_2d(np.asarray(p, float))
        return np.c_[p @ self.xc, p @ self.yc]

    def depth(self, p):
        return np.atleast_2d(np.asarray(p, float)) @ self.d  # larger = nearer the viewer


class Frame:
    """Plan points (sheet pt) -> world metres, centred on the plan bbox."""

    def __init__(self, model):
        bb = model["bbox"]
        self.s = model["scale_pt_per_m"]
        self.o = np.array([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2])

    def xz(self, pts):
        return (np.asarray(pts, float) - self.o) / self.s

    def world(self, pts, y=0.0):
        q = self.xz(pts)
        return np.c_[q[:, 0], np.full(len(q), y), q[:, 1]]


def _poly(fr, p):
    return {"outer": fr.xz(p["outer"]).round(4).tolist(), "holes": [fr.xz(h).round(4).tolist() for h in p["holes"]]}


def build_scene(model, cam, max_px=8000, margin=0.04):
    fr = Frame(model)
    fl = model["floor_lines"]
    scene = {
        "wall_h": WALL_H, "slab_t": SLAB_T, "glazing_h": GLAZING_H,
        "walls": [_poly(fr, p) for p in model["walls"]],
        "glazing": [_poly(fr, p) for p in model["glazing"]],
        "slab": [_poly(fr, p) for p in model["slab"]],
        "stairs": [_poly(fr, p) for p in model["stairs"]],
        "lines": {k: [fr.xz(s).round(4).tolist() for s in v] for k, v in fl.items()},
        "camera": {"d": cam.d.tolist(), "up": [0, 1, 0]},
        # approved-sample palette: sheet background, room cream, wall grey, stair green
        "style": {"bg": "#E4EEBF", "slabTop": "#F4F3C8", "slabSide": "#C9C79A", "wallTop": "#838585",
                  "wallSide": "#B4B6B6", "edge": "#4F5151", "stair": "#139647"},
    }
    # frustum from everything that will be drawn, overlays included
    pts = []
    for p in model["slab"] + model["walls"]:
        o = p["outer"]
        pts += [fr.world(o, 0), fr.world(o, WALL_H), fr.world(o, -SLAB_T)]
    for pl in model["routes"]["polylines"]:
        pts.append(fr.world(pl, 0))
    for s in model["symbols"]:
        pts.append(fr.world([s["pos"]], 0))
    uv = cam.project(np.vstack(pts))
    lo, hi = uv.min(0), uv.max(0)
    pad = (hi - lo) * margin
    lo, hi = lo - pad, hi + pad
    w, h = hi - lo
    if w >= h:
        px = (max_px, int(round(max_px * h / w)))
    else:
        px = (int(round(max_px * w / h)), max_px)
    scene["frustum"] = {"left": lo[0], "right": hi[0], "bottom": lo[1], "top": hi[1]}
    scene["px"] = px
    return scene, fr


def save(scene, path):
    with open(path, "w") as f:
        json.dump(scene, f)
