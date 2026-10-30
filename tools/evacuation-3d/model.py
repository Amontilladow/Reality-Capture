"""Build a simplified 3D floor model + evacuation overlay data from one sheet.

Everything is measured from the source PDF's CAD layers:

  walls      A-HATCH solid grey poche, A-WALL outlines, S-COLS columns
  glazing    A-GLAZ-CURT / A-WINDOW linework
  stairs     green escape-stair highlight fills, S-STRS treads
  routes     A-ESCAPE-ROUTE green dash fills -> skeleton -> directed graph
  symbols    embedded raster icons (see symbols_detect.py)
  YAH        red teardrop on layer "0"; its tip is the installation point

Plan coordinates stay in displayed-sheet PDF points; `to_world` converts to
metres using the derived drawing scale (see SCALE_PT_PER_M).
"""
import collections
import json

import cv2
import numpy as np
from skimage.morphology import skeletonize

from extract import extract
from symbols_detect import classify

# Derived, not stated on the sheets: Q-SPCQ parking bays measure 110.8 pt deep;
# read as the standard 5.5 m bay depth -> 20.15 pt/m (~1:141 at A1). Cross-check:
# feature-stair riser labels step ~5.6 pt = 0.28 m going. Recorded in the QC report.
SCALE_PT_PER_M = 110.8 / 5.5
R = 4  # raster px per pt for geometry processing (0.012 m/px)

WALL_FILL_LAYERS = {"A-HATCH", "A-WALL-____-PATT", "A-WALL", "S-COLS", "Str_Hatch", "Miacasa_Wall"}
WALL_LINE_LAYERS = {"A-WALL", "A-WALL-____-MCUT", "A-102$0$A-WALL-____-OTLN", "S-COLS", "Miacasa_Wall"}
GLAZING_LAYERS = {"A-GLAZ-CURT", "A-102$0$A-GLAZ-CWMG-MCUT"}
FLOOR_LINE_LAYERS = {
    "stair": {"S-STRS", "S-STRS-MBND", "A-102$0$S-STRS-____-OTLN"},
    "door": {"A-DOOR", "A-DOOR-OPNG"},
    "bay": {"Q-SPCQ", "C-PRKG"},
    "rail": {"A-FLOR-HRAL"},
}
GREY_FILLS = {(0.5, 0.5, 0.5), (0.6, 0.6, 0.6)}
ROUTE_GREEN = (0.0, 1.0, 0.0)
STAIR_GREENS = {(0.0, 1.0, 0.0), (0.05, 0.97, 0.03)}


def _rgb(c):
    return tuple(round(v, 2) for v in c) if c else None


def _canvas(bbox):
    x0, y0, x1, y1 = bbox
    return np.zeros((int((y1 - y0) * R) + 2, int((x1 - x0) * R) + 2), np.uint8)


def _px(pts, bbox):
    return np.round((pts - [bbox[0], bbox[1]]) * R).astype(np.int32)


def _pt(px, bbox):
    return np.asarray(px, float) / R + [bbox[0], bbox[1]]


def _legend_top(data):
    ys = [t["bbox"][1] for t in data["text"] if "Remember" in t["text"] or "Symbols" in t["text"]]
    top = min(ys) if ys else data["size"][1]
    # the legend's green title band starts above its text: use any green fill
    # spanning most of the sheet width just above the legend text
    W = data["size"][0]
    for L in data["layers"].values():
        for e in L:
            if e["fill"] and len(e["pts"]) > 2 and _rgb(e["fill"]) in STAIR_GREENS:
                x0, y0 = e["pts"].min(0)
                x1, y1 = e["pts"].max(0)
                if x1 - x0 > 0.6 * W and top - 60 < y0 <= top:
                    top = min(top, y0)
    return top - 2


def _title_bottom(data):
    ys = [t["bbox"][3] for t in data["text"] if "FLOOR" in t["text"] or "EVACUATION PLAN" in t["text"]]
    return max(ys) if ys else 0


def _plan_bbox(data, top, bottom):
    pts = []
    for lay in ("A-WALL", "A-ESCAPE-ROUTE", "S-COLS"):
        for e in data["layers"].get(lay, []):
            p = e["pts"]
            p = p[(p[:, 1] > top) & (p[:, 1] < bottom)]
            if len(p):
                pts.append(p)
    P = np.vstack(pts)
    pad = 25
    return [P[:, 0].min() - pad, max(top, P[:, 1].min() - pad), P[:, 0].max() + pad, min(bottom, P[:, 1].max() + pad)]


def _inside(p, bbox):
    return bbox[0] <= p[0] <= bbox[2] and bbox[1] <= p[1] <= bbox[3]


def _polys_from_mask(mask, bbox, eps_px=1.0, min_area_px=12):
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    if hier is None:
        return out
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1 or cv2.contourArea(c) < min_area_px:
            continue
        outer = cv2.approxPolyDP(c, eps_px, True)[:, 0, :]
        holes = []
        j = hier[i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) >= min_area_px:
                holes.append(cv2.approxPolyDP(cs[j], eps_px, True)[:, 0, :])
            j = hier[j][0]
        if len(outer) >= 3:
            out.append({"outer": _pt(outer, bbox), "holes": [_pt(h, bbox) for h in holes if len(h) >= 3]})
    return out


def wall_mask(data, bbox):
    m = _canvas(bbox)
    for lay in WALL_FILL_LAYERS:
        for e in data["layers"].get(lay, []):
            if e["fill"] and e["closed"] and len(e["pts"]) > 2 and _rgb(e["fill"]) in GREY_FILLS:
                cv2.fillPoly(m, [_px(e["pts"], bbox)], 255)
    for lay in WALL_LINE_LAYERS:
        for e in data["layers"].get(lay, []):
            cv2.polylines(m, [_px(e["pts"], bbox)], False, 255, max(1, int(0.9 * R)))
    # outline pairs of unhatched partitions/columns merge into solids
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(1.2 * R) | 1,) * 2)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    # closed outlines (columns, short wall ends) become solid
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is not None:
        for i, c in enumerate(cs):
            if hier[0][i][3] != -1 and cv2.contourArea(c) < (0.45 * SCALE_PT_PER_M * R) ** 2:
                cv2.drawContours(m, cs, i, 255, -1)
    return m


def glazing_mask(data, bbox, walls):
    m = _canvas(bbox)
    for lay in GLAZING_LAYERS | {"A-WINDOW"}:
        for e in data["layers"].get(lay, []):
            cv2.polylines(m, [_px(e["pts"], bbox)], False, 255, max(1, int(1.0 * R)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(1.5 * R) | 1,) * 2)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    # A-WINDOW also carries mullion/profile detail clusters; keep only runs
    # longer than 2 m, which are the glazing lines themselves
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros(n, bool)
    keep[1:] = np.maximum(st[1:, 2], st[1:, 3]) > 2.0 * SCALE_PT_PER_M * R
    m = np.where(keep[lab], 255, 0).astype(np.uint8)
    m[walls > 0] = 0
    return m


def slab_mask(data, bbox, walls, glazing, ratio=0.1):
    """Floor plate = concave hull of the wall/finish/glazing envelope.

    Not a stated slab edge: the sheets carry no slab outline, so the plate is
    inferred from the outermost architectural linework (flagged in QC)."""
    import shapely
    m = cv2.bitwise_or(walls, glazing)
    for e in data["layers"].get("A-PLST-FNSH", []):
        cv2.polylines(m, [_px(e["pts"], bbox)], False, 255, 1)
    ys, xs = np.nonzero(m[::4, ::4])
    pts = shapely.MultiPoint(np.c_[xs, ys] * 4)
    hull = shapely.concave_hull(pts, ratio=ratio)
    out = np.zeros_like(m)
    if hull.geom_type == "Polygon":
        cv2.fillPoly(out, [np.array(hull.exterior.coords, np.int32)], 255)
    return out


def stair_zones(data, bbox):
    m = _canvas(bbox)
    for lay, L in data["layers"].items():
        if lay == "A-ESCAPE-ROUTE":
            continue
        for e in L:
            if e["fill"] and e["closed"] and len(e["pts"]) > 2 and _rgb(e["fill"]) in STAIR_GREENS:
                cv2.fillPoly(m, [_px(e["pts"], bbox)], 255)
    return _polys_from_mask(m, bbox, eps_px=1.5, min_area_px=(1.0 * SCALE_PT_PER_M * R) ** 2)


def _covered(poly, mask, bbox, frac=0.6):
    m = np.zeros_like(mask)
    cv2.fillPoly(m, [_px(poly["outer"], bbox)], 255)
    a = np.count_nonzero(m)
    return a and np.count_nonzero(m & mask) / a >= frac


def floor_lines(data, bbox):
    out = {}
    for kind, layers in FLOOR_LINE_LAYERS.items():
        segs = []
        for lay in layers:
            for e in data["layers"].get(lay, []):
                p = e["pts"]
                if len(p) >= 2 and _inside(p[0], bbox):
                    segs.append(p)
        out[kind] = segs
    return out


# ---------------------------------------------------------------- routes ----

def _route_components(data, bbox, stairs=()):
    m = _canvas(bbox)
    for e in data["layers"].get("A-ESCAPE-ROUTE", []):
        if e["fill"] and _rgb(e["fill"]) == ROUTE_GREEN and len(e["pts"]) > 2:
            cv2.fillPoly(m, [_px(e["pts"], bbox)], 255)
    # the stair highlight's own hatch is drawn on the route layer too
    sm = np.zeros_like(m)
    for z in stairs:
        cv2.fillPoly(sm, [_px(z["outer"], bbox)], 255)
    m[cv2.erode(sm, np.ones((int(1.5 * R),) * 2, np.uint8)) > 0] = 0
    n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
    dots, arrows, ends = [], [], []
    dash = m.copy()
    for i in range(1, n):
        x, y, w, h, a = st[i]
        comp = (lab[y:y + h, x:x + w] == i).astype(np.uint8)
        cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cs, key=cv2.contourArea)
        sol = a / max(1.0, cv2.contourArea(cv2.convexHull(c)))
        (_, _), (rw, rh), _ = cv2.minAreaRect(c)
        elong = max(rw, rh) / max(1.0, min(rw, rh))
        area_pt = a / R / R
        centre = _pt(cen[i], bbox)
        size_pt = max(rw, rh) / R
        if area_pt > 60 and elong < 1.5 and sol > 0.9:
            dots.append(centre)  # dots sit on the route line; stay in dash
            continue
        single = 115 <= area_pt <= 190 and 18 <= size_pt <= 25 and sol < 0.85
        double = 230 <= area_pt <= 340 and 28 <= size_pt <= 42 and sol < 0.7
        if single or double:
            am = lab == i
            dash[am] = 0
            ys, xs = np.nonzero(am)
            P = np.c_[xs, ys].astype(np.float32)
            parts = [P]
            if double:  # two stacked chevrons drawn touching
                _, lbl, _ = cv2.kmeans(P, 2, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.1), 5,
                                       cv2.KMEANS_PP_CENTERS)
                parts = [P[lbl[:, 0] == k] for k in (0, 1)]
            for Q in parts:
                pm = np.zeros_like(am)
                pm[Q[:, 1].astype(int), Q[:, 0].astype(int)] = True
                hull = cv2.convexHull(Q.astype(np.int32))
                mo = cv2.moments(hull)
                hc = np.array([mo["m10"] / mo["m00"], mo["m01"] / mo["m00"]])
                d = Q.mean(0) - hc
                d = d / max(1e-6, np.hypot(*d))
                arrows.append({"centre": _pt(Q.mean(0), bbox), "mask": pm, "dir": d,
                               "size": float(np.ptp(Q, axis=0).max())})
        else:
            # dash axis end points (px), for gap bridging
            pts = c[:, 0, :].astype(float)
            mu = pts.mean(0)
            u = np.linalg.svd(pts - mu)[2][0]
            t = (pts - mu) @ u
            ends.append((i, mu + u * t.min() + [x, y], -u))
            ends.append((i, mu + u * t.max() + [x, y], u))
    ys, xs = np.nonzero(dash)
    dpts = np.c_[xs, ys].astype(float)
    links = []
    for a in arrows:
        # an arrow is a route end unless a route line lies ahead of its apex;
        # if one does, the apex is linked forward onto it
        ay, ax = np.nonzero(a["mask"])
        apts = np.c_[ax, ay].astype(float)
        apex = apts[np.argmax(apts @ a["dir"])]
        v = dpts - apex
        dist = np.hypot(v[:, 0], v[:, 1])
        cosang = (v @ a["dir"]) / np.maximum(dist, 1e-6)
        ok = (cosang > 0.85) & (dist < 12 * R)
        a["terminal"] = not np.any(ok)
        a["apex"] = _pt(apex, bbox)
        if not a["terminal"]:
            q = dpts[np.argmin(np.where(ok, dist, np.inf))]
            links.append((apex, q))
    _bridge(dash, ends, dots, arrows, bbox, lab)
    for p, q in links:
        cv2.line(dash, tuple(map(int, p)), tuple(map(int, q)), 255, max(1, int(1.2 * R)))
    return dash, dots, arrows


def _bridge(dash, ends, dots, arrows, bbox, lab, gap_pt=9.0):
    """Join each dash end to the next dash/dot/arrow ahead of it."""
    E = np.array([e[1] for e in ends])
    ys, xs = np.nonzero(dash)
    dpix = np.c_[xs, ys].astype(float)
    lab_at = lab[ys, xs]
    lim = gap_pt * R
    w = max(1, int(1.2 * R))
    for k, (cid, p, d) in enumerate(ends):
        v = E - p
        dist = np.hypot(v[:, 0], v[:, 1])
        ahead = (v @ d) > 0
        own = np.array([e[0] == cid for e in ends])
        ok = ahead & ~own & (dist < lim)
        # prefer ends roughly along the dash direction
        cosang = np.where(dist > 0, (v @ d) / np.maximum(dist, 1e-6), 0)
        score = np.where(ok & (cosang > 0.5), dist, np.inf)
        j = int(np.argmin(score))
        if np.isfinite(score[j]):
            cv2.line(dash, tuple(map(int, p)), tuple(map(int, E[j])), 255, w)
        else:
            # e.g. a dash meeting a bent corner piece: join the nearest route
            # pixel ahead instead of a dash end
            v2 = dpix - p
            d2 = np.hypot(v2[:, 0], v2[:, 1])
            c2 = (v2 @ d) / np.maximum(d2, 1e-6)
            ok2 = (c2 > 0.7) & (d2 < lim) & (lab_at != cid)
            if np.any(ok2):
                q = dpix[np.argmin(np.where(ok2, d2, np.inf))]
                cv2.line(dash, tuple(map(int, p)), tuple(map(int, q)), 255, w)
        for c in dots:
            cp = (np.asarray(c) - [bbox[0], bbox[1]]) * R
            if np.hypot(*(cp - p)) < lim * 1.2:
                cv2.line(dash, tuple(map(int, p)), tuple(map(int, cp)), 255, w)
        for a in arrows:
            ac = (np.asarray(a["centre"]) - [bbox[0], bbox[1]]) * R
            if float((p - ac) @ a["dir"]) > 0:
                continue  # only join an arrow from behind it
            ys, xs = np.nonzero(a["mask"][max(0, int(p[1] - lim)):int(p[1] + lim), max(0, int(p[0] - lim)):int(p[0] + lim)])
            if len(xs):
                q = np.c_[xs + max(0, int(p[0] - lim)), ys + max(0, int(p[1] - lim))]
                qq = q[np.argmin(np.hypot(q[:, 0] - p[0], q[:, 1] - p[1]))]
                if np.hypot(*(qq - p)) < lim:
                    cv2.line(dash, tuple(map(int, p)), tuple(map(int, qq)), 255, w)


def _neighbors(sk):
    k = np.ones((3, 3), np.uint8)
    k[1, 1] = 0
    return cv2.filter2D(sk.astype(np.uint8), -1, k, borderType=cv2.BORDER_CONSTANT)


_STEPS = [(dy, dx, (2 ** 0.5 if dy and dx else 1.0)) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]


def _geodesic(sk, sources):
    import heapq
    H, W = sk.shape
    dist = np.full(sk.shape, np.inf)
    heap = [(0.0, p) for p in sources]
    for _, p in heap:
        dist[p] = 0.0
    heapq.heapify(heap)
    while heap:
        d, (y, x) = heapq.heappop(heap)
        if d > dist[y, x]:
            continue
        for dy, dx, w in _STEPS:
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and sk[yy, xx] and d + w < dist[yy, xx]:
                dist[yy, xx] = d + w
                heapq.heappush(heap, (d + w, (yy, xx)))
    return dist


def routes(data, bbox, stairs=()):
    """Directed escape-route polylines.

    Dashes are bridged into a band and thinned to a 1-px skeleton. Geodesic
    distance is measured along the skeleton from every arrowhead (the exits the
    source drawing points to); each route is then walked downhill from its
    start point, so direction comes from the drawing's own arrowheads.
    """
    dash, dots, arrows = _route_components(data, bbox, stairs)
    band = cv2.dilate(dash, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(1.0 * R) | 1,) * 2))
    for a in arrows:
        band[a["mask"]] = 255
    sk = skeletonize(band > 0)
    sky, skx = np.nonzero(sk)
    skel_pts = np.c_[skx, sky]

    def nearest(p_pt):
        q = (np.asarray(p_pt) - [bbox[0], bbox[1]]) * R
        k = int(np.argmin(np.hypot(skel_pts[:, 0] - q[0], skel_pts[:, 1] - q[1])))
        return (int(skel_pts[k, 1]), int(skel_pts[k, 0]))

    # arrow apex: arrow pixel farthest from the band entering it is unreliable on
    # chevrons, so use the skeleton pixels inside each arrow as the exit sources
    sources, terminals = [], []
    for a in [a for a in arrows if a["terminal"]]:
        inside = sk & a["mask"]
        ys, xs = np.nonzero(inside)
        sources += list(zip(ys.tolist(), xs.tolist())) or [nearest(a["centre"])]
        terminals.append(a["centre"])
    nb = _neighbors(sk) * sk
    leaves = [tuple(p) for p in np.argwhere(sk & (nb == 1))]
    # a route that runs into a highlighted escape stair ends there (the source
    # draws no arrowhead at stair doors)
    sm = np.zeros_like(band)
    for z in stairs:
        cv2.fillPoly(sm, [_px(z["outer"], bbox)], 255)
    sm = cv2.dilate(sm, np.ones((int(4 * R),) * 2, np.uint8))
    dist = _geodesic(sk, sources)
    # a stair-side route end that already leads to an arrowed exit is a start
    # (people arriving by stair); otherwise the stair itself is the exit
    stair_ends = [p for p in leaves if sm[p] and not np.isfinite(dist[p])]
    if stair_ends:
        for p in stair_ends:
            sources.append(p)
            terminals.append(_pt((p[1], p[0]), bbox))
        dist = _geodesic(sk, sources)
    starts = set(leaves) | {nearest(d) for d in dots}
    starts = [p for p in starts if np.isfinite(dist[p]) and dist[p] > 3 * R]
    starts.sort(key=lambda p: -dist[p])

    H, W = sk.shape
    used = np.zeros_like(sk, bool)
    paths = []
    for st in starts:
        if used[st]:
            continue
        path = [st]
        cur = st
        while dist[cur] > 0:
            y, x = cur
            cand = [(dist[y + dy, x + dx], (y + dy, x + dx)) for dy, dx, _ in _STEPS
                    if 0 <= y + dy < H and 0 <= x + dx < W and sk[y + dy, x + dx]]
            d, nxt = min(cand)
            if d >= dist[cur]:
                break
            path.append(nxt)
            if used[nxt]:
                break  # joined an already traced route
            cur = nxt
        for p in path[:-1]:
            used[p] = True
        used[path[-1]] = used[path[-1]] or dist[path[-1]] == 0
        if len(path) >= 6 * R:  # drop dash-end / arrow-wing spurs
            paths.append(path)

    polylines = []
    for path in paths:
        p = _pt(np.array([(x, y) for y, x in path], float), bbox)
        approx = cv2.approxPolyDP(p.astype(np.float32).reshape(-1, 1, 2), 0.5, False)[:, 0, :]
        polylines.append(approx.astype(float))
    unreached = int(np.count_nonzero(sk & ~np.isfinite(dist)))
    # QC: every mid-route chevron must agree with the traced direction
    checks = []
    for a in arrows:
        if a["terminal"]:
            continue
        best = None
        c = np.asarray(a["centre"])
        for p in polylines:
            segs = np.diff(p, axis=0)
            L2 = np.maximum((segs ** 2).sum(1), 1e-9)
            t = np.clip(((c - p[:-1]) * segs).sum(1) / L2, 0, 1)
            dd = np.hypot(*(p[:-1] + segs * t[:, None] - c).T)
            k = int(np.argmin(dd))
            if best is None or dd[k] < best[0]:
                best = (dd[k], segs[k] / np.sqrt(L2[k]))
        agree = best is not None and best[0] < 15 and float(best[1] @ a["dir"]) > 0.5
        checks.append({"pos": a["centre"], "dir": a["dir"], "agrees": bool(agree)})
    return {"polylines": polylines, "unreached_px": unreached, "dots": dots,
            "terminals": terminals, "arrow_count": len(arrows), "midroute_arrows": checks}


# ------------------------------------------------------------ symbols ------

def symbols(data, doc, bbox):
    out = []
    for im in data["images"]:
        c = np.array([(im["bbox"][0] + im["bbox"][2]) / 2, (im["bbox"][1] + im["bbox"][3]) / 2])
        if not _inside(c, bbox) or not im["xref"]:
            continue
        kind = classify(doc, im["xref"])
        if kind:
            out.append({"kind": kind, "pos": c, "src_bbox": im["bbox"]})
    return out


def you_are_here(data, bbox):
    m = _canvas(bbox)
    found = False
    for e in data["layers"].get("0", []):
        if e["fill"] and _rgb(e["fill"]) == (1.0, 0.0, 0.0) and len(e["pts"]) > 2:
            cv2.fillPoly(m, [_px(e["pts"], bbox)], 255)
            found = True
    if not found:
        return None
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)[:, 0, :]
    # the pin's round head is its max inscribed circle; the tip is the contour
    # point farthest from that centre
    filled = np.zeros_like(m)
    cv2.drawContours(filled, [c], -1, 255, -1)
    dt = cv2.distanceTransform(filled, cv2.DIST_L2, 5)
    cy, cx = np.unravel_index(np.argmax(dt), dt.shape)
    far = c[np.argmax(np.hypot(c[:, 0] - cx, c[:, 1] - cy))]
    return {"tip": _pt(far, bbox), "head": _pt((cx, cy), bbox)}


# ------------------------------------------------------------- driver ------

def build(pdf_path):
    data = extract(pdf_path)
    doc = data.pop("doc")
    top, bottom = _title_bottom(data), _legend_top(data)
    bbox = _plan_bbox(data, top, bottom)
    walls = wall_mask(data, bbox)
    glaz = glazing_mask(data, bbox, walls)
    slab = slab_mask(data, bbox, walls, glaz)
    stairs = [z for z in stair_zones(data, bbox) if _covered(z, slab, bbox)]
    model = {
        "source": pdf_path,
        "sheet_size": data["size"],
        "rotation": data["rotation"],
        "bbox": bbox,
        "scale_pt_per_m": SCALE_PT_PER_M,
        "walls": _polys_from_mask(walls, bbox),
        "glazing": _polys_from_mask(glaz, bbox, min_area_px=8),
        "slab": _polys_from_mask(slab, bbox, eps_px=2.0),
        "stairs": stairs,
        "floor_lines": floor_lines(data, bbox),
        "routes": routes(data, bbox, stairs),
        "symbols": symbols(data, doc, bbox),
        "yah": you_are_here(data, bbox),
        "riser_labels": [t for t in data["text"] if t["text"].strip().isdigit() and _inside(t["bbox"][:2], bbox)],
        "_masks": {"walls": walls, "glazing": glaz, "slab": slab},
    }
    return model


def _jsonable(o):
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items() if not k.startswith("_")}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    return o


def save(model, path):
    with open(path, "w") as f:
        json.dump(_jsonable(model), f)
