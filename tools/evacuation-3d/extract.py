"""Vector extraction from AutoCAD-plotted evacuation PDFs.

Reads every drawing path with its optional-content layer, flattens curves,
and returns polylines in *displayed sheet* coordinates (PDF points, y down),
so geometry lines up with what the reviewer sees on the original sheet.
"""
import collections
import pickle
import sys

import numpy as np
import pymupdf


def _bez(p0, p1, p2, p3, n=12):
    t = np.linspace(0, 1, n)[:, None]
    P = [np.array([p.x, p.y]) for p in (p0, p1, p2, p3)]
    return ((1 - t) ** 3 * P[0] + 3 * (1 - t) ** 2 * t * P[1]
            + 3 * (1 - t) * t ** 2 * P[2] + t ** 3 * P[3])


def _items_to_polylines(items):
    """Group consecutive connected segments into polylines."""
    polys, cur = [], []
    for it in items:
        k = it[0]
        if k == "l":
            seg = np.array([[it[1].x, it[1].y], [it[2].x, it[2].y]])
        elif k == "c":
            seg = _bez(*it[1:5])
        elif k == "re":
            r = it[1]
            seg = np.array([[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x0, r.y0]])
        elif k == "qu":
            q = it[1]
            seg = np.array([[q.ul.x, q.ul.y], [q.ur.x, q.ur.y], [q.lr.x, q.lr.y], [q.ll.x, q.ll.y], [q.ul.x, q.ul.y]])
        else:
            continue
        if cur and np.allclose(cur[-1][-1], seg[0], atol=1e-3) and k in "lc":
            cur.append(seg[1:])
        else:
            if cur:
                polys.append(np.vstack(cur))
            cur = [seg]
    if cur:
        polys.append(np.vstack(cur))
    return polys


def extract(pdf_path):
    doc = pymupdf.open(pdf_path)
    page = doc[0]
    rot = page.rotation
    disp = page.rect
    M = page.rotation_matrix  # unrotated -> displayed
    page.set_rotation(0)
    m = np.array([[M.a, M.b], [M.c, M.d]])
    off = np.array([M.e, M.f])

    def tx(a):
        return a @ m + off

    layers = collections.defaultdict(list)
    for d in page.get_drawings():
        lay = d.get("layer") or ""
        for pl in _items_to_polylines(d["items"]):
            layers[lay].append({
                "pts": tx(pl),
                "stroke": d.get("color"),
                "fill": d.get("fill"),
                "closed": bool(d.get("closePath")) or d["type"] in ("f", "fs"),
                "dashes": d.get("dashes"),
                "width": d.get("width"),
            })

    images = []
    for info in page.get_image_info(xrefs=True):
        x0, y0, x1, y1 = info["bbox"]
        corners = tx(np.array([[x0, y0], [x1, y1]]))
        bb = [corners[:, 0].min(), corners[:, 1].min(), corners[:, 0].max(), corners[:, 1].max()]
        images.append({"xref": info["xref"], "bbox": bb, "w": info["width"], "h": info["height"],
                       "transform": info["transform"]})

    text = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                (x0, y0), (x1, y1) = tx(np.array([[s["bbox"][0], s["bbox"][1]], [s["bbox"][2], s["bbox"][3]]]))
                text.append({"text": s["text"], "bbox": [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]})

    return {"file": pdf_path, "rotation": rot, "size": (disp.width, disp.height),
            "layers": dict(layers), "images": images, "text": text, "doc": doc}


if __name__ == "__main__":
    data = extract(sys.argv[1])
    doc = data.pop("doc")
    with open(sys.argv[2], "wb") as f:
        pickle.dump(data, f)
    for k, v in sorted(data["layers"].items(), key=lambda kv: -len(kv[1])):
        print(len(v), k)
