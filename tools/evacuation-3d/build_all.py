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
LANDSCAPE_REF = {"BASEMENT": "B-01", "GROUND": "GF-02", "MEZZANINE": "MF-02", "ROOF": "RF-01"}
# the Roof has no landscape variant; it shares the Ground Floor footprint, so it is
# turned the same way as the Ground Floor (GF-01 -> GF-02 is a 90 deg turn)
REF_TURN = {"ROOF": 90}
BASE_AZ = 18.0
ELEVATION = 52.0


def azimuth(code, floor, fits):
    """fits[code] = rotation (deg) mapping that sheet onto variant -01."""
    rot = fits.get(code, 0)
    ref = fits.get(LANDSCAPE_REF[floor], 0)
    return (BASE_AZ + REF_TURN.get(floor, 0) + (rot - ref)) % 360


def build_one(path, out, fits, fit_full=None):
    s, m = AA.summarise(path)
    if fit_full and fit_full.get(s["code"]):
        s["fit_to_01"] = fit_full[s["code"]]
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
    analysis = json.load(open(os.path.join(out, "analysis.json")))
    fits = {s["code"]: s.get("fit_to_01", {}).get("rotation_deg", 0) for s in analysis}
    fit_full = {s["code"]: s.get("fit_to_01") for s in analysis}
    # sheets added after the first analysis: fit their symbols to variant -01 now
    pdfs = {AA.sheet_id(p)[2]: os.path.join(src, p) for p in os.listdir(src) if p.endswith(".pdf")}
    for code, p in pdfs.items():
        ref = code.split("-")[0] + "-01"
        if code in fits or ref not in pdfs:
            continue
        def syms(path):
            d = MD.extract(path)
            doc = d.pop("doc")
            bb = MD._plan_bbox(d, MD._title_bottom(d), MD._legend_top(d))
            return {"symbols": [{"kind": x["kind"], "pos": x["pos"].tolist()} for x in MD.symbols(d, doc, bb)]}
        f = AA.fit_variant(syms(pdfs[ref]), syms(p)) if code != ref else None
        fits[code] = f["rotation_deg"] if f else 0
        fit_full[code] = f
    for p in sorted(os.listdir(src)):
        if not p.endswith(".pdf"):
            continue
        code = AA.sheet_id(p)[2]
        if only and code not in only:
            continue
        build_one(os.path.join(src, p), out, fits, fit_full)
