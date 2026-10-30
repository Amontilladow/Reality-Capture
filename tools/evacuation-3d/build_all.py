"""Build models, 3D renders and register data for every supplied sheet.

usage: python3 build_all.py <src_dir> <out_dir> [code ...]
Each sheet is shown in its floor's landscape reference orientation (the approved
format is landscape): azimuth = 18 deg + rotation of the sheet relative to that
reference, measured by the rigid fit of the equipment symbols.
"""
import json
import os
import pickle
import subprocess
import sys

import analyze_all as AA
import model as MD
import scene as SC

HERE = os.path.dirname(os.path.abspath(__file__))
LANDSCAPE_REF = {"BASEMENT": "B-01", "GROUND": "GF-02", "MEZZANINE": "MF-02"}
BASE_AZ = 18.0
ELEVATION = 52.0


def azimuth(code, floor, fits):
    """fits[code] = rotation (deg) mapping that sheet onto variant -01."""
    rot = fits.get(code, 0)
    ref = fits.get(LANDSCAPE_REF[floor], 0)
    return (BASE_AZ + (rot - ref)) % 360


def build_one(path, out, fits):
    s, m = AA.summarise(path)
    stem = os.path.join(out, s["code"])
    with open(stem + "_model.pkl", "wb") as f:
        pickle.dump(m, f)
    MD.save(m, stem + "_model.json")
    s["azimuth"] = azimuth(s["code"], s["floor"], fits)
    cam = SC.Camera(s["azimuth"], ELEVATION)
    sc, _ = SC.build_scene(m, cam, max_px=8000)
    SC.save(sc, stem + "_scene.json")
    subprocess.run(["node", os.path.join(HERE, "render", "render.js"), stem + "_scene.json", stem + "_3d.png"],
                   check=True, stdout=subprocess.DEVNULL)
    with open(stem + "_summary.json", "w") as f:
        json.dump(s, f, indent=1)
    print(s["code"], "az", s["azimuth"], s["symbols"], "routes", s["route_polylines"], "unreached",
          s["route_unreached_px"], "stairs", s["stair_zones"], "yah", bool(s["yah"]), flush=True)


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(out, exist_ok=True)
    # variant rotations from the symbol fit (symbols do not depend on the model build)
    fits = {s["code"]: s.get("fit_to_01", {}).get("rotation_deg", 0)
            for s in json.load(open(os.path.join(out, "analysis.json")))}
    for p in sorted(os.listdir(src)):
        if not p.endswith(".pdf"):
            continue
        code = AA.sheet_id(p)[2]
        if only and code not in only:
            continue
        build_one(os.path.join(src, p), out, fits)
