"""Phase 1 analysis of every supplied sheet -> analysis.json (drawing register + QC data).

usage: python3 analyze_all.py <src_dir> <out_dir>
"""
import collections
import glob
import json
import os
import pickle
import re
import sys

import numpy as np
import pymupdf

import model as MD


def sheet_id(path):
    name = os.path.basename(path)
    name = re.sub(r"^[0-9a-f]{8}-", "", name)  # upload prefix
    m = re.match(r"(Basment|Ground_Floor|Mezzanine_Floor)-Emergency_Evacuation_Plan-(\d+)", name)
    floor = {"Basment": "BASEMENT", "Ground_Floor": "GROUND", "Mezzanine_Floor": "MEZZANINE"}[m.group(1)]
    code = {"BASEMENT": "B", "GROUND": "GF", "MEZZANINE": "MF"}[floor] + "-" + m.group(2)
    return name, floor, code


def tread_scale(model, data):
    """Escape-stair tread pitch (pt) inside the highlighted stair zones."""
    import cv2
    bb = model["bbox"]
    pitches = []
    for z in model["stairs"]:
        poly = np.asarray(z["outer"], np.float32)
        segs = []
        for lay in ("S-STRS", "S-STRS-MBND"):
            for e in data["layers"].get(lay, []):
                p = e["pts"]
                if len(p) == 2 and cv2.pointPolygonTest(poly, tuple(map(float, p.mean(0))), False) >= 0:
                    v = p[1] - p[0]
                    L = np.hypot(*v)
                    if L > 15:
                        segs.append((p.mean(0), v / L, L))
        if len(segs) < 4:
            continue
        # dominant tread direction, then spacing of parallel lines along the normal
        ang = np.array([np.arctan2(d[1], d[0]) % np.pi for _, d, _ in segs])
        hist, edges = np.histogram(ang, bins=36, range=(0, np.pi))
        a0 = edges[np.argmax(hist)] + np.pi / 72
        sel = [s for s, a in zip(segs, ang) if min(abs(a - a0), np.pi - abs(a - a0)) < 0.06]
        n = np.array([-np.sin(a0), np.cos(a0)])
        off = np.sort([c @ n for c, _, _ in sel])
        d = np.diff(off)
        d = d[(d > 3) & (d < 10)]
        pitches += d.tolist()
    return float(np.median(pitches)) if len(pitches) >= 3 else None


def fit_variant(ref, cur):
    """Best rigid(+uniform scale) map of cur symbols onto ref symbols over 8 symmetries."""
    best = None
    kinds = sorted({s["kind"] for s in ref["symbols"]} & {s["kind"] for s in cur["symbols"]})
    A = np.array([s["pos"] for s in ref["symbols"]])
    B = np.array([s["pos"] for s in cur["symbols"]])
    ca, cb = A.mean(0), B.mean(0)
    sa = np.sqrt(((A - ca) ** 2).sum(1).mean())
    sb = np.sqrt(((B - cb) ** 2).sum(1).mean())
    for rot in range(4):
        for mirror in (False, True):
            th = rot * np.pi / 2
            Rm = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
            Bm = (B - cb) * ([-1, 1] if mirror else [1, 1])
            Bt = (Bm @ Rm.T) * (sa / sb) + ca
            res = []
            for k in kinds:
                Ak = np.array([s["pos"] for s in ref["symbols"] if s["kind"] == k])
                Bk = np.array([p for p, s in zip(Bt, cur["symbols"]) if s["kind"] == k])
                dd = np.hypot(Bk[:, None, 0] - Ak[None, :, 0], Bk[:, None, 1] - Ak[None, :, 1])
                res += dd.min(1).tolist()
            r = float(np.median(res))
            if best is None or r < best["median_residual_pt"]:
                best = {"rotation_deg": rot * 90, "mirrored": mirror, "scale_ratio": float(sa / sb),
                        "median_residual_pt": r, "max_residual_pt": float(np.max(res))}
    return best


def summarise(path):
    name, floor, code = sheet_id(path)
    doc = pymupdf.open(path)
    meta = doc.metadata
    data = MD.extract(path)
    data.pop("doc")
    m = MD.build(path)
    r = m["routes"]
    texts = [t["text"].strip() for t in data["text"] if t["text"].strip()]
    title = " / ".join(dict.fromkeys(t for t in texts if t in ("EVACUATION PLAN",) or "FLOOR" in t))
    riser = sorted({int(t) for t in texts if t.isdigit() and int(t) < 100})
    odd = sorted({t for t in texts if re.fullmatch(r"\d+ \d+", t)})
    tp = tread_scale(m, data)
    w, h = data["size"]
    return {
        "file": name, "code": code, "floor": floor, "pdf_title_meta": meta.get("title"),
        "creator": meta.get("creator"), "page_size_pt": [round(w), round(h)],
        "paper": "A1 " + ("portrait" if h > w else "landscape"),
        "page_rotation": data["rotation"], "title_text": title,
        "drawing_number": None, "revision": None, "scale_stated": None,
        "layers": len(data["layers"]),
        "plan_bbox_pt": [round(v, 1) for v in m["bbox"]],
        "symbols": dict(collections.Counter(s["kind"] for s in m["symbols"])),
        "route_polylines": len(r["polylines"]), "route_unreached_px": r["unreached_px"],
        "route_start_dots": len(r["dots"]), "arrowheads": r["arrow_count"],
        "exit_terminals": len(r["terminals"]),
        "midroute_arrows_agree": [a["agrees"] for a in r["midroute_arrows"]],
        "stair_zones": len(m["stairs"]), "walls": len(m["walls"]), "glazing": len(m["glazing"]),
        "yah": m["yah"]["tip"].tolist() if m["yah"] else None,
        "riser_numbers": [min(riser), max(riser)] if riser else None,
        "unexplained_text": odd,
        "tread_pitch_pt": tp,
        "has_parking_bay_ref": any(abs(np.linalg.norm(e["pts"][-1] - e["pts"][0]) - 110.8) < 1.5
                                   for e in data["layers"].get("Q-SPCQ", [])),
    }, m


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    results, models = [], {}
    for p in sorted(glob.glob(os.path.join(src, "*.pdf"))):
        s, m = summarise(p)
        results.append(s)
        models[s["code"]] = {"symbols": [{"kind": x["kind"], "pos": x["pos"].tolist()} for x in m["symbols"]],
                             "bbox": m["bbox"]}
        print(s["code"], s["symbols"], s["route_polylines"], s["route_unreached_px"], s["tread_pitch_pt"], flush=True)
    for s in results:
        ref = f'{s["code"].split("-")[0]}-01'
        if s["code"] != ref and ref in models:
            s["fit_to_01"] = fit_variant(models[ref], models[s["code"]])
    results.sort(key=lambda s: ({"BASEMENT": 0, "GROUND": 1, "MEZZANINE": 2}[s["floor"]], s["code"]))
    with open(os.path.join(out, "analysis.json"), "w") as f:
        json.dump(results, f, indent=1)
    with open(os.path.join(out, "symbol_positions.json"), "w") as f:
        json.dump(models, f)
