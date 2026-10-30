"""Build one 3D evacuation plan sheet end to end.

usage: python3 build_sheet.py <source.pdf> <out_dir> <sheet_code> <floor> [azimuth elevation max_px]
"""
import json
import os
import pickle
import subprocess
import sys

from reportlab.pdfgen import canvas

import model as MD
import scene as SC
import sheet as SH

HERE = os.path.dirname(os.path.abspath(__file__))


def build(src, out_dir, code, floor, az=18.0, el=52.0, max_px=8000, revision="P01 (draft)"):
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, code)
    m = MD.build(src)
    with open(stem + "_model.pkl", "wb") as f:
        pickle.dump(m, f)
    MD.save(m, stem + "_model.json")
    cam = SC.Camera(az, el)
    sc, fr = SC.build_scene(m, cam, max_px=max_px)
    SC.save(sc, stem + "_scene.json")
    png = stem + "_3d.png"
    subprocess.run(["node", os.path.join(HERE, "render", "render.js"), stem + "_scene.json", png], check=True)
    sheet = {
        "floor": floor, "code": code,
        "source_name": os.path.basename(src).split("-", 1)[-1] if len(os.path.basename(src).split("-")[0]) == 8
        else os.path.basename(src),
        "revision": revision,
    }
    c = canvas.Canvas(stem + ".pdf", pagesize=SH.SHEET_SIZE)
    c.setTitle(f"Escape and Rescue Plan {code} (3D)")
    SH.draw_plan_sheet(c, sheet, m, cam, fr, sc["frustum"], png)
    c.showPage()
    c.save()
    return m, sc, stem + ".pdf"


def redraw(out_dir, code, floor, source_name, az=18.0, el=52.0, revision="P01 (draft)"):
    """Recompose the sheet PDF from a saved model/scene/render (no re-extraction)."""
    stem = os.path.join(out_dir, code)
    m = pickle.load(open(stem + "_model.pkl", "rb"))
    sc = json.load(open(stem + "_scene.json"))
    cam = SC.Camera(az, el)
    sheet = {"floor": floor, "code": code, "source_name": source_name, "revision": revision}
    c = canvas.Canvas(stem + ".pdf", pagesize=SH.SHEET_SIZE)
    c.setTitle(f"Escape and Rescue Plan {code} (3D)")
    SH.draw_plan_sheet(c, sheet, m, cam, SC.Frame(m), sc["frustum"], stem + "_3d.png")
    c.showPage()
    c.save()
    return stem + ".pdf"


if __name__ == "__main__":
    a = sys.argv[1:]
    extra = list(map(float, a[4:7])) if len(a) > 4 else []
    build(a[0], a[1], a[2], a[3], *extra)
