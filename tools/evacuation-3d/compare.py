"""QC comparison sheet: original 2D sheet | extraction overlay | generated 3D plan."""
import cv2
import numpy as np
import pymupdf
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader

import graphics as G

KIND_COL = {  # BGR for cv2
    "fire_extinguisher": (0, 0, 230), "wheeled_extinguisher": (0, 0, 140), "fire_hose_reel": (0, 120, 255),
    "manual_call_point": (200, 0, 200), "lift": (0, 0, 0), "exit_sign": (0, 150, 0),
    "assembly_point": (0, 90, 0), "fire_brigade_inlet": (40, 40, 120),
}
KIND_TAG = {"fire_extinguisher": "FE", "wheeled_extinguisher": "WFE", "fire_hose_reel": "HR",
            "manual_call_point": "MCP", "lift": "L", "exit_sign": "EX", "assembly_point": "AP",
            "fire_brigade_inlet": "FB"}


def original_crop(src_pdf, bbox, dpi=110):
    p = pymupdf.open(src_pdf)[0]
    pix = p.get_pixmap(dpi=dpi, clip=pymupdf.Rect(*bbox))
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    return cv2.cvtColor(a, cv2.COLOR_RGB2BGR), dpi / 72.0


def overlay(src_pdf, model, out_png, dpi=110):
    img, s = original_crop(src_pdf, model["bbox"], dpi)
    bb = model["bbox"]
    faded = cv2.addWeighted(img, 0.35, np.full_like(img, 255), 0.65, 0)
    P = lambda p: np.round((np.asarray(p) - [bb[0], bb[1]]) * s).astype(np.int32)
    lay = faded.copy()
    for p in model["walls"]:
        cv2.fillPoly(lay, [P(p["outer"])] + [P(h) for h in p["holes"]], (60, 60, 60))
    for p in model["glazing"]:
        cv2.fillPoly(lay, [P(p["outer"])], (200, 150, 60))
    for p in model["stairs"]:
        cv2.polylines(lay, [P(p["outer"])], True, (0, 160, 0), 2)
    for p in model["slab"]:
        cv2.polylines(lay, [P(p["outer"])], True, (180, 180, 180), 1)
    out = cv2.addWeighted(lay, 0.75, faded, 0.25, 0)
    for pl in model["routes"]["polylines"]:
        q = P(pl)
        cv2.polylines(out, [q], False, (255, 120, 0), 2, cv2.LINE_AA)
        if len(q) >= 2:
            cv2.arrowedLine(out, tuple(map(int, q[-2])), tuple(map(int, q[-1])), (255, 60, 0), 2,
                            tipLength=min(1.0, 12 / max(1, np.hypot(*(q[-1] - q[-2])))))
    for t in model["routes"]["terminals"]:
        cv2.circle(out, tuple(map(int, P([t])[0])), 7, (255, 60, 0), 2)
    for sy in model["symbols"]:
        c = tuple(map(int, P([sy["pos"]])[0]))
        col = KIND_COL[sy["kind"]]
        cv2.drawMarker(out, c, col, cv2.MARKER_CROSS, 12, 2)
        cv2.putText(out, KIND_TAG[sy["kind"]], (c[0] + 6, c[1] - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, col, 1,
                    cv2.LINE_AA)
    if model.get("yah"):
        c = tuple(map(int, P([model["yah"]["tip"]])[0]))
        cv2.circle(out, c, 9, (0, 0, 255), 2)
        cv2.putText(out, "YAH", (c[0] + 10, c[1] + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)
    cv2.imwrite(out_png, out)
    o, _ = original_crop(src_pdf, model["bbox"], dpi)
    cv2.imwrite(out_png.replace(".png", "_orig.png"), o)
    return out_png


def plan_raster(sheet_pdf, out_png, dpi=110):
    from sheet import layout
    p = pymupdf.open(sheet_pdf)[0]
    H = p.rect.height
    x, y, w, h = layout(p.rect.width, H)["drawing"]
    clip = pymupdf.Rect(x, H - (y + h), x + w, H - y)  # reportlab y-up -> PDF y-down
    pix = p.get_pixmap(dpi=dpi, clip=clip)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    ys, xs = np.nonzero((a < 245).any(2))
    a = a[max(0, ys.min() - 10):ys.max() + 10, max(0, xs.min() - 10):xs.max() + 10]  # trim white margins
    cv2.imwrite(out_png, cv2.cvtColor(a, cv2.COLOR_RGB2BGR))
    return out_png


def _fit(c, path, x, y, w, h):
    ir = ImageReader(path)
    iw, ih = ir.getSize()
    k = min(w / iw, h / ih)
    c.drawImage(ir, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k)


def draw_comparison(c, code, floor_name, src_name, orig_png, overlay_png, plan_png, checks):
    W, H = 2384, 1684
    m = 42
    c.setPageSize((W, H))
    c.setStrokeColor(G.BLACK)
    c.setLineWidth(2)
    c.rect(m, m, W - 2 * m, H - 2 * m)
    G.text_en(c, m + 20, H - m - 50, f"QC COMPARISON SHEET - {code} ({floor_name})", 34, bold=True)
    G.text_en(c, m + 20, H - m - 80, f"Source: {src_name}   |   Original 2D sheet vs. extracted geometry vs. "
              "generated 3D evacuation plan", 14, color=G.GREY)
    c.setFillColor(G.GREEN)
    c.rect(m, H - m - 96, W - 2 * m, 5, stroke=0, fill=1)
    top = H - m - 110
    tbl_h = 520
    ph = top - (m + tbl_h) - 40
    pw = (W - 2 * m - 80) / 3
    titles = [("1. ORIGINAL 2D SHEET (plan area)", "As supplied; unmodified raster of the PDF."),
              ("2. EXTRACTION OVERLAY (QC)", "Walls (dark grey), glazing (blue), escape stairs (green outline), "
               "routes (blue, arrow = traced direction), equipment anchors (coloured crosses), YAH (red)."),
              ("3. GENERATED 3D EVACUATION PLAN", "Drawing area of the 3D sheet.")]
    for i, (img, (t, sub)) in enumerate(zip((orig_png, overlay_png, plan_png), titles)):
        x = m + 20 + i * (pw + 20)
        G.text_en(c, x, top - 6, t, 16, bold=True)
        G.text_en(c, x, top - 24, sub[:150], 9.5, color=G.GREY)
        c.setStrokeColor(HexColor("#BBBBBB"))
        c.setLineWidth(1)
        c.rect(x, m + tbl_h + 20, pw, ph - 20)
        _fit(c, img, x + 4, m + tbl_h + 24, pw - 8, ph - 28)

    # checklist table
    y = m + tbl_h
    G.text_en(c, m + 20, y - 10, "VERIFICATION CHECKLIST", 16, bold=True)
    cols = [("Check", 0.16), ("Method", 0.33), ("Result", 0.33), ("Status", 0.18)]
    x0 = m + 20
    tw = W - 2 * m - 40
    rh = (tbl_h - 70) / (len(checks) + 1)
    yy = y - 30
    x = x0
    c.setFillColor(HexColor("#E8F6EE"))
    c.rect(x0, yy - rh, tw, rh, stroke=0, fill=1)
    for name, f in cols:
        G.text_en(c, x + 8, yy - rh + 8, name.upper(), 11, bold=True)
        x += tw * f
    for i, row in enumerate(checks):
        yr = yy - rh * (i + 2)
        c.setStrokeColor(HexColor("#DDDDDD"))
        c.line(x0, yr, x0 + tw, yr)
        x = x0
        for j, ((_, f), val) in enumerate(zip(cols, row)):
            colr = G.BLACK
            if j == 3:
                colr = {"VERIFIED": G.SIGN_GREEN, "DERIVED": HexColor("#1F6FB2"),
                        "PARTIAL": HexColor("#C77700"), "NOT VERIFIABLE": G.DARK_RED}.get(val.split(" ")[0] if val else "",
                                                                                         G.BLACK)
                for key, cc in (("NOT VERIFIABLE", G.DARK_RED), ("PARTIAL", HexColor("#C77700"))):
                    if val.startswith(key):
                        colr = cc
            _cell(c, x + 8, yr + rh - 14, val, 9.5, tw * f - 14, bold=(j in (0, 3)), color=colr)
            x += tw * f


def _cell(c, x, y, text, size, width, bold=False, color=G.BLACK):
    font = "Sans-B" if bold else "Sans"
    words, line, yy = text.split(), "", y
    for w in words:
        t = (line + " " + w).strip()
        if c.stringWidth(t, font, size) > width and line:
            G.text_en(c, x, yy, line, size, bold=bold, color=color)
            yy -= size * 1.2
            line = w
        else:
            line = t
    if line:
        G.text_en(c, x, yy, line, size, bold=bold, color=color)
