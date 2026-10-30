"""Compose one 3D evacuation plan sheet: rendered architecture + vector overlays."""
import math

import numpy as np
from reportlab.lib.colors import HexColor

import graphics as G
from scene import WALL_H

FLOORS = {
    "BASEMENT": ("BASEMENT FLOOR", "الطابق السفلي"),
    "GROUND": ("GROUND FLOOR", "الطابق الأرضي"),
    "MEZZANINE": ("MEZZANINE FLOOR", "طابق الميزانين"),
}


class Mapper:
    """World (metres) -> sheet points, via the same orthographic camera as the render."""

    def __init__(self, cam, fr, frustum, rect):
        self.cam, self.fr = cam, fr
        L, R_, B, T = frustum["left"], frustum["right"], frustum["bottom"], frustum["top"]
        x0, y0, w, h = rect
        self.k = min(w / (R_ - L), h / (T - B))
        self.img = (x0 + (w - (R_ - L) * self.k) / 2, y0 + (h - (T - B) * self.k) / 2,
                    (R_ - L) * self.k, (T - B) * self.k)
        self.L, self.B = L, B

    def plan(self, pts, y=0.0):
        uv = self.cam.project(self.fr.world(np.atleast_2d(pts), y))
        return np.c_[self.img[0] + (uv[:, 0] - self.L) * self.k, self.img[1] + (uv[:, 1] - self.B) * self.k]


def _overlap(a, b, pad=2):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


class Placer:
    """Greedy label placement: try offsets around the anchor, avoid earlier boxes."""

    OFFS = [(0, 1), (0.8, 0.8), (-0.8, 0.8), (1.1, 0), (-1.1, 0), (0, -1.1), (1.3, 1.3), (-1.3, 1.3),
            (1.8, 0), (-1.8, 0), (0, 1.9), (1.3, -1.3), (-1.3, -1.3), (0, -2), (2.4, 1), (-2.4, 1)]

    def __init__(self, keepout=()):
        self.boxes = list(keepout)

    def place(self, ax, ay, w, h, gap):
        for ox, oy in self.OFFS:
            cx, cy = ax + ox * (gap + w / 2), ay + oy * (gap + h / 2)
            b = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
            if not any(_overlap(b, o) for o in self.boxes):
                self.boxes.append(b)
                return b
        cx, cy = ax, ay + gap + h / 2
        b = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        self.boxes.append(b)
        return b


def _leader(c, ax, ay, b, color):
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    # end the leader on the box edge
    dx, dy = ax - cx, ay - cy
    hw, hh = (b[2] - b[0]) / 2, (b[3] - b[1]) / 2
    t = min(hw / abs(dx) if dx else 1e9, hh / abs(dy) if dy else 1e9)
    ex, ey = cx + dx * min(t, 1), cy + dy * min(t, 1)
    c.setStrokeColor(G.WHITE)
    c.setLineWidth(3.2)
    c.line(ax, ay, ex, ey)
    c.setStrokeColor(color)
    c.setLineWidth(1.4)
    c.line(ax, ay, ex, ey)
    c.setFillColor(color)
    c.setStrokeColor(G.WHITE)
    c.setLineWidth(1)
    c.circle(ax, ay, 3.2, stroke=1, fill=1)


def _polyline(c, pts):
    p = c.beginPath()
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    c.drawPath(p, stroke=1, fill=0)


def draw_routes(c, M, routes, scale_pt):
    terms = np.array(routes["terminals"]) if routes["terminals"] else np.zeros((0, 2))
    screen = [M.plan(pl, 0.03) for pl in routes["polylines"]]
    c.setLineCap(1)
    c.setLineJoin(1)
    # approved-sample style: green dashed line, green chevrons
    c.setStrokeColor(G.GREEN)
    c.setLineWidth(3.6)
    c.setDash(9, 5)
    for s in screen:
        _polyline(c, s)
    c.setDash()
    # chevrons at regular screen spacing + an arrowhead on every exit end
    spacing = 70
    for pl, s in zip(routes["polylines"], screen):
        seg = np.diff(s, axis=0)
        L = np.hypot(seg[:, 0], seg[:, 1])
        cum = np.r_[0, np.cumsum(L)]
        total = cum[-1]
        ends_at_exit = len(terms) and np.min(np.hypot(*(terms - pl[-1]).T)) < 0.8 * scale_pt
        n = int(total // spacing)
        marks = [spacing * (i + 0.5) for i in range(n)] if n else ([total / 2] if total > 30 else [])
        for d in marks:
            if ends_at_exit and total - d < 30:
                continue
            k = min(np.searchsorted(cum, d) - 1, len(L) - 1)
            k = max(k, 0)
            t = (d - cum[k]) / max(L[k], 1e-6)
            x, y = s[k] + seg[k] * t
            G.chevron(c, x, y, math.atan2(seg[k][1], seg[k][0]), 12, color=G.GREEN)
        if ends_at_exit and len(seg):
            v = seg[-1]
            G.chevron(c, s[-1][0], s[-1][1], math.atan2(v[1], v[0]), 16, color=G.GREEN)


SHEET_SIZE = (1550.15, 1135.32)   # approved sample format (EVAC_PLAN.pdf), landscape
MARGIN = 42
TITLE_H = 150
BAND_H = 250
BAND_TITLE_H = 18
NOTE_H = 16


def layout(W=SHEET_SIZE[0], H=SHEET_SIZE[1]):
    """Sheet regions (x, y, w, h) in points; shared with the QC comparison crop."""
    m = MARGIN
    band_y = m + NOTE_H
    plan_top = H - m - TITLE_H
    fr = [0.165, 0.155, 0.487, 0.193]   # Remember | AR | Symbols | Site map, as on the sample
    xs, x = [], m
    for f in fr:
        xs.append((x, (W - 2 * m) * f))
        x += (W - 2 * m) * f
    return {
        "title": (m, plan_top, W - 2 * m, TITLE_H),
        "drawing": (m + 14, band_y + BAND_H + 8, W - 2 * m - 28, plan_top - band_y - BAND_H - 12),
        "band": (m, band_y, W - 2 * m, BAND_H),
        "panels": [(px, band_y, pw, BAND_H) for px, pw in xs],
        "note": (m, m, W - 2 * m, NOTE_H),
    }


def draw_plan_sheet(c, sheet, model, cam, fr, frustum, png_path):
    W, H = SHEET_SIZE
    L = layout(W, H)
    m = MARGIN
    c.setPageSize((W, H))
    c.setFillColor(G.BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)

    _title(c, L["title"], sheet)

    rect = L["drawing"]
    M = Mapper(cam, fr, frustum, rect)
    ix, iy, iw, ih = M.img
    c.drawImage(png_path, ix, iy, iw, ih)
    draw_routes(c, M, model["routes"], model["scale_pt_per_m"])
    _symbols(c, M, model, sheet)

    L["cam"] = cam
    _band(c, L, model)
    c.setStrokeColor(G.FRAME)
    c.setLineWidth(1)
    c.rect(m, m + NOTE_H, W - 2 * m, H - 2 * m - NOTE_H, stroke=1, fill=0)

    # draft status + traceability, outside the sign frame (not part of the sign face)
    x, y, w, h = L["note"]
    G.text_en(c, x, y + 4,
              f"{sheet['code']}  |  {sheet['revision']}  |  source: {sheet['source_name']}  |  "
              f"3D axonometric, not to scale (azimuth {cam.azimuth:.0f}\u00b0, elevation {cam.elevation:.0f}\u00b0, "
              f"walls cut at {WALL_H:.1f} m)", 7, color=G.GREY)
    G.text_en(c, x + w, y + 4, "DRAFT FOR FLS CONSULTANT REVIEW - NOT FOR SUBMISSION - NO ADCDA APPROVAL CLAIMED",
              7, bold=True, color=G.DARK_RED, align="right")
    return rect


def _title(c, r, sheet):
    x, y, w, h = r
    en_floor, ar_floor = FLOORS[sheet["floor"]]
    G.text_en(c, x + 26, y + h - 78, "EVACUATION PLAN", 64, bold=True, color=G.FRAME)
    G.text_en(c, x + 28, y + h - 118, en_floor, 30, bold=True, color=G.FRAME)
    G.text_ar(c, x + w - 26, y + h - 82, "خطة الإخلاء", 66, bold=True, color=G.FRAME)
    G.text_ar(c, x + w - 26, y + h - 124, ar_floor, 32, bold=True, color=G.FRAME)
    # ADCD logo position: approved artwork must be inserted here, never redrawn
    lw, lh = 170, 104
    lx, ly = x + w / 2 - lw / 2, y + h - lh - 22
    c.setStrokeColor(G.GREY)
    c.setLineWidth(1)
    c.setDash(4, 3)
    c.rect(lx, ly, lw, lh, stroke=1, fill=0)
    c.setDash()
    G.text_en(c, lx + lw / 2, ly + lh / 2 + 6, "ADCD LOGO", 11, bold=True, align="centre", color=G.GREY)
    G.text_en(c, lx + lw / 2, ly + lh / 2 - 9, "insert approved artwork", 8.5, align="centre", color=G.GREY)


def _symbols(c, M, model, sheet):
    keep = []
    yah = None
    if model.get("yah") and sheet.get("show_yah", True):
        ax, ay = M.plan([model["yah"]["tip"]], 0.0)[0]
        yah = (ax, ay)
        keep.append((ax - 30, ay, ax + 30, ay + 80))
    P = Placer(keep)
    order = ["assembly_point", "exit_sign", "lift", "fire_hose_reel", "fire_extinguisher",
             "wheeled_extinguisher", "manual_call_point", "fire_brigade_inlet"]
    for kind in order:
        for s in [s for s in model["symbols"] if s["kind"] == kind]:
            ax, ay = M.plan([s["pos"]], 0.0)[0]
            if kind == "exit_sign":
                h = 18
                b = P.place(ax, ay, 2.5 * h, h, 14)
                _leader(c, ax, ay, b, G.SIGN_GREEN)
                G.exit_sign(c, b[0], b[1], h)
                continue
            sz = 34 if kind == "assembly_point" else 21
            b = P.place(ax, ay, sz, sz, 13)
            _leader(c, ax, ay, b, G.ACCENT[kind])
            G.DRAW[kind](c, b[0], b[1], sz)
    if yah:
        ax, ay = yah
        G.you_are_here(c, ax, ay, 44)


REMEMBER = [("CALL", "Civil Defence 997", "الإتصال", "الدفاع المدني 997"),
            ("WARN", "Everybody in danger.", "تحذير", "الجميع في خطر"),
            ("PUT OUT", "The fire with a portable fire extinguisher if possible", "إخماد",
             "الحريق مع طفاية الحريق المحمولة إن أمكن"),
            ("EVACUATE", "Through nearest exit or emergency exit. Avoid smoke-filled areas.", "الإخلاء",
             "من خلال أقرب مخرج أو مخرج طوارئ. تجنب المناطق المليئة بالدخان.")]


def _panel_title(c, p, en, ar_):
    x, y, w, h = p
    c.setFillColor(G.SIGN_GREEN)
    c.rect(x, y + h - BAND_TITLE_H, w, BAND_TITLE_H, stroke=0, fill=1)
    if en and ar_:
        G.text_en(c, x + w / 2 - 6, y + h - 13, en, 10.5, bold=True, color=G.WHITE, align="right")
        G.text_ar(c, x + w / 2 + 6, y + h - 14, ar_, 10.5, bold=True, color=G.WHITE, align="left")
    elif en:
        G.text_en(c, x + w / 2, y + h - 13, en, 10.5, bold=True, color=G.WHITE, align="centre")
    else:
        G.text_ar(c, x + w / 2, y + h - 14, ar_, 10.5, bold=True, color=G.WHITE, align="centre")


def _band(c, L, model):
    x, y, w, h = L["band"]
    c.setFillColor(G.WHITE)
    c.rect(x, y, w, h, stroke=0, fill=1)
    p_en, p_ar, p_sym, p_map = L["panels"]
    _panel_title(c, p_en, "Remember", None)
    _panel_title(c, p_ar, None, "تذكر")
    _panel_title(c, p_sym, "Symbols", "رموز")
    _panel_title(c, p_map, "Site Map", "خارطة الموقع")
    c.setStrokeColor(G.FRAME)
    c.setLineWidth(0.8)
    for px, py, pw, ph in L["panels"][1:]:
        c.line(px, py, px, py + ph)

    # Remember (EN) / تذكر (AR): wording exactly as on the approved sample
    rows_top = y + h - BAND_TITLE_H - 22
    rh = (h - BAND_TITLE_H - 24) / 4
    for i, (k_en, v_en, k_ar, v_ar) in enumerate(REMEMBER):
        yy = rows_top - i * rh
        G.text_en(c, p_en[0] + 10, yy, k_en, 9, bold=True)
        _wrap_en(c, p_en[0] + 68, yy, v_en, 9, p_en[2] - 76)
        G.text_ar(c, p_ar[0] + p_ar[2] - 10, yy, k_ar, 9, bold=True)
        _wrap_ar(c, p_ar[0] + p_ar[2] - 54, yy, v_ar, 9, p_ar[2] - 62)

    # Symbols grid (items actually used on this floor)
    kinds = {s["kind"] for s in model["symbols"]}
    items = ["you_are_here"] + [k for k in ("fire_extinguisher", "wheeled_extinguisher", "fire_hose_reel",
                                            "manual_call_point", "lift", "fire_brigade_inlet") if k in kinds]
    items += [k for k in ("assembly_point",) if k in kinds] + ["exit_sign", "stair", "route"]
    cols = 4
    rows = -(-len(items) // cols)
    cw = p_sym[2] / cols
    ch = (h - BAND_TITLE_H - 10) / rows
    c.setFillColor(HexColor("#F2F2F2"))
    c.rect(p_sym[0], p_sym[1], p_sym[2], h - BAND_TITLE_H, stroke=0, fill=1)
    for i, key in enumerate(items):
        r_, col = divmod(i, cols)
        cx = p_sym[0] + col * cw
        cy = p_sym[1] + h - BAND_TITLE_H - 6 - (r_ + 1) * ch
        gs = min(30, ch - 12)
        gx = cx + cw - 10 - (64 if key in ("route", "stair", "exit_sign") else gs)
        if key == "you_are_here":
            G.you_are_here(c, cx + cw - 10 - gs / 2, cy + 4, gs * 0.6)
        elif key == "exit_sign":
            G.exit_sign(c, cx + cw - 10 - 2.5 * gs * 0.8, cy + ch / 2 - gs * 0.4, gs * 0.8)
        elif key in G.DRAW:
            G.DRAW[key](c, gx, cy + ch / 2 - gs / 2, gs)
        else:
            _legend_glyph(c, key, gx, cy + ch / 2 - gs / 2, gs)
        en, ar_ = G.LABELS[key]
        tx = gx - 8 if key not in ("exit_sign",) else cx + cw - 10 - 2.5 * gs * 0.8 - 8
        G.text_ar(c, tx, cy + ch / 2 + 1, ar_, 8.5, bold=True, align="right")
        G.text_en(c, tx, cy + ch / 2 - 11, en, 8.5, bold=True, align="right")

    # Site map: no site plan was supplied -> floor key plan in the same orientation
    kp = (p_map[0] + 8, p_map[1] + 18, p_map[2] - 16, h - BAND_TITLE_H - 26)
    _key_plan(c, model, kp, L.get("cam"))
    G.text_en(c, p_map[0] + p_map[2] / 2, p_map[1] + 6, "Site plan not supplied - floor key plan shown", 6.5,
              align="centre", color=G.GREY)


def _key_plan(c, model, r, cam=None):
    """Small top-down plan with YAH and assembly points, turned to the 3D view's heading
    (azimuth rounded to 90 degrees so the key plan stays orthogonal)."""
    x, y, w, h = r
    th = np.radians(round((cam.azimuth if cam else 0) / 90) * 90)

    def R(p):  # plan (x right, y down) -> key-plan (u right, v up)
        p = np.atleast_2d(np.asarray(p, float))
        return np.c_[p[:, 0] * np.cos(th) - p[:, 1] * np.sin(th), -p[:, 0] * np.sin(th) - p[:, 1] * np.cos(th)]

    pts = [np.asarray(p["outer"]) for p in model["slab"]]
    allp = R(np.vstack(pts + [np.asarray(pl) for pl in model["routes"]["polylines"]] +
                       [np.array([s["pos"] for s in model["symbols"]])]))
    lo, hi = allp.min(0), allp.max(0)
    k = min(w / (hi[0] - lo[0]), h / (hi[1] - lo[1]))
    ox = x + (w - (hi[0] - lo[0]) * k) / 2
    oy = y + (h - (hi[1] - lo[1]) * k) / 2

    def T(p):
        q = R(p)
        return np.c_[ox + (q[:, 0] - lo[0]) * k, oy + (q[:, 1] - lo[1]) * k]

    def poly(p, fill, stroke=None, lw=0.5):
        q = T(p)
        path = c.beginPath()
        path.moveTo(*q[0])
        for v in q[1:]:
            path.lineTo(*v)
        path.close()
        c.setFillColor(fill)
        if stroke is not None:
            c.setStrokeColor(stroke)
            c.setLineWidth(lw)
        c.drawPath(path, fill=1, stroke=1 if stroke is not None else 0)

    for p in model["slab"]:
        poly(p["outer"], G.ROOM, HexColor("#9A9A9A"), 0.8)
    for p in model["stairs"]:
        poly(p["outer"], G.SIGN_GREEN)
    for p in model["walls"]:
        poly(p["outer"], G.WALL)
    c.setStrokeColor(G.GREEN)
    c.setLineWidth(1.6)
    c.setLineCap(1)
    for pl in model["routes"]["polylines"]:
        _polyline(c, T(pl))
    for s in model["symbols"]:
        if s["kind"] == "assembly_point":
            px, py = T(s["pos"])[0]
            G.assembly_point(c, px - 7, py - 7, 14)
    if model.get("yah"):
        px, py = T(model["yah"]["tip"])[0]
        c.setFillColor(G.RED)
        c.setStrokeColor(G.WHITE)
        c.setLineWidth(1)
        c.circle(px, py, 6, stroke=1, fill=1)


def _legend_glyph(c, key, x, y, s):
    if key == "you_are_here":
        G.you_are_here(c, x + 34, y - 2, s * 0.62)
    elif key == "route":
        c.setFillColor(HexColor("#C9E8C6"))
        c.rect(x, y + 2, 64, s - 4, stroke=0, fill=1)
        c.setStrokeColor(G.GREEN)
        c.setLineWidth(2.4)
        c.setDash(6, 4)
        c.line(x + 6, y + s / 2, x + 50, y + s / 2)
        c.setDash()
        G.chevron(c, x + 54, y + s / 2, 0, 11, color=G.GREEN)
    elif key == "direction":
        c.setStrokeColor(G.GREEN)
        c.setLineWidth(5.5)
        c.line(x, y + s / 2, x + 76, y + s / 2)
        G.chevron(c, x + 38, y + s / 2, 0, 17)
    elif key == "start":
        c.setStrokeColor(G.GREEN)
        c.setLineWidth(5.5)
        c.line(x + 38, y + s / 2, x + 76, y + s / 2)
        c.setFillColor(G.GREEN)
        c.setStrokeColor(G.WHITE)
        c.setLineWidth(1.5)
        c.circle(x + 38, y + s / 2, 6.5, stroke=1, fill=1)
    elif key == "exit_sign":
        G.exit_sign(c, x, y + s * 0.1, s * 0.8)
    elif key == "stair":
        c.setFillColor(G.SIGN_GREEN)
        c.setStrokeColor(HexColor("#1d3b24"))
        c.setLineWidth(1)
        c.rect(x, y + 2, 64, s - 4, stroke=1, fill=1)
        for i in range(1, 9):
            c.line(x + i * 64 / 9, y + 2, x + i * 64 / 9, y + s - 2)
    else:
        G.DRAW[key](c, x + 22, y, s)


def _wrap_en(c, x, y, text, size, width, color=G.BLACK, bold=False, centre=False):
    font = "Sans-B" if bold else "Sans"
    words, line, yy = text.split(), "", y
    for w in words:
        t = (line + " " + w).strip()
        if c.stringWidth(t, font, size) > width and line:
            G.text_en(c, x, yy, line, size, bold=bold, color=color, align="centre" if centre else "left")
            yy -= size * 1.25
            line = w
        else:
            line = t
    if line:
        G.text_en(c, x, yy, line, size, bold=bold, color=color, align="centre" if centre else "left")


def _wrap_ar(c, x, y, text, size, width):
    words, line, yy = text.split(), "", y
    for w in words:
        t = (line + " " + w).strip()
        if c.stringWidth(G.ar(t), "Ar", size) > width and line:
            G.text_ar(c, x, yy, line, size)
            yy -= size * 1.45
            line = w
        else:
            line = t
    if line:
        G.text_ar(c, x, yy, line, size)


