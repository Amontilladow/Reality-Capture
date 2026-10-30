"""Flat 2D vector evacuation symbols and bilingual text helpers (reportlab).

Symbols are simplified ISO 7010-style pictograms drawn as vectors, so they stay
sharp at any print size and remain editable in the exported PDF/SVG.
"""
import os

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = "/usr/share/fonts/truetype/liberation"

pdfmetrics.registerFont(TTFont("Sans", os.path.join(LIB, "LiberationSans-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Sans-B", os.path.join(LIB, "LiberationSans-Bold.ttf")))
# DejaVu Sans: full Arabic presentation forms plus digits/punctuation (the
# available Noto Sans Arabic build lacks digits, which dropped "997")
DEJAVU = "/usr/share/fonts/truetype/dejavu"
pdfmetrics.registerFont(TTFont("Ar", os.path.join(DEJAVU, "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Ar-B", os.path.join(DEJAVU, "DejaVuSans-Bold.ttf")))

# approved-sample palette (EVAC_PLAN.pdf)
BG = HexColor("#E4EEBF")
ROOM = HexColor("#F4F3C8")
WALL = HexColor("#838585")
FRAME = HexColor("#221F1F")
ORANGE = HexColor("#F89424")
RED = HexColor("#EA262B")
DARK_RED = HexColor("#8E0E12")
GREEN = HexColor("#139647")
SIGN_GREEN = HexColor("#139647")
DARK_GREEN = HexColor("#0E7A39")
GREY = HexColor("#6F6F6F")
LIGHT = HexColor("#F2F2F2")
BLACK = black
WHITE = white


def ar(text):
    """Shape + reorder Arabic for a renderer without OpenType shaping."""
    return get_display(arabic_reshaper.reshape(text))


def text_ar(c, x, y, s, size, bold=False, align="right", color=BLACK):
    c.setFillColor(color)
    c.setFont("Ar-B" if bold else "Ar", size)
    t = ar(s)
    if align == "right":
        c.drawRightString(x, y, t)
    elif align == "centre":
        c.drawCentredString(x, y, t)
    else:
        c.drawString(x, y, t)


def text_en(c, x, y, s, size, bold=False, align="left", color=BLACK):
    c.setFillColor(color)
    c.setFont("Sans-B" if bold else "Sans", size)
    if align == "right":
        c.drawRightString(x, y, s)
    elif align == "centre":
        c.drawCentredString(x, y, s)
    else:
        c.drawString(x, y, s)


def _tile(c, x, y, s, fill, r=0.06):
    c.setFillColor(fill)
    c.setStrokeColor(WHITE)
    c.setLineWidth(max(0.6, s * 0.03))
    c.roundRect(x, y, s, s, s * r, stroke=1, fill=1)


def _poly(c, pts, x, y, s, close=True, fill=True, stroke=False):
    p = c.beginPath()
    p.moveTo(x + pts[0][0] * s, y + pts[0][1] * s)
    for px, py in pts[1:]:
        p.lineTo(x + px * s, y + py * s)
    if close:
        p.close()
    c.drawPath(p, fill=1 if fill else 0, stroke=1 if stroke else 0)


def _extinguisher(c, x, y, s, scale=1.0, ox=0.0, oy=0.0):
    k = s * scale
    bx, by = x + ox * s, y + oy * s
    c.setFillColor(WHITE)
    c.roundRect(bx + 0.36 * k, by + 0.12 * k, 0.28 * k, 0.56 * k, 0.1 * k, stroke=0, fill=1)
    c.rect(bx + 0.44 * k, by + 0.68 * k, 0.12 * k, 0.08 * k, stroke=0, fill=1)
    c.setStrokeColor(WHITE)
    c.setLineWidth(0.05 * k)
    c.setLineCap(1)
    c.line(bx + 0.40 * k, by + 0.80 * k, bx + 0.66 * k, by + 0.80 * k)        # handle
    p = c.beginPath()                                                         # hose
    p.moveTo(bx + 0.62 * k, by + 0.78 * k)
    p.curveTo(bx + 0.86 * k, by + 0.78 * k, bx + 0.84 * k, by + 0.40 * k, bx + 0.76 * k, by + 0.22 * k)
    c.drawPath(p, stroke=1, fill=0)


def fire_extinguisher(c, x, y, s):
    _tile(c, x, y, s, RED)
    _extinguisher(c, x, y, s)


def wheeled_extinguisher(c, x, y, s):
    _tile(c, x, y, s, RED)
    _extinguisher(c, x, y, s, scale=0.86, ox=0.02, oy=0.14)
    c.setFillColor(WHITE)
    for cx in (0.30, 0.70):
        c.circle(x + cx * s, y + 0.15 * s, 0.09 * s, stroke=0, fill=1)


def fire_hose_reel(c, x, y, s):
    _tile(c, x, y, s, RED)
    c.setStrokeColor(WHITE)
    c.setLineWidth(0.06 * s)
    for r in (0.32, 0.21, 0.10):
        c.circle(x + 0.5 * s, y + 0.53 * s, r * s, stroke=1, fill=0)
    c.setLineCap(1)
    c.line(x + 0.5 * s, y + 0.21 * s, x + 0.86 * s, y + 0.12 * s)


def manual_call_point(c, x, y, s):
    _tile(c, x, y, s, RED)
    c.setStrokeColor(WHITE)
    c.setFillColor(WHITE)
    c.setLineWidth(0.06 * s)
    c.roundRect(x + 0.2 * s, y + 0.2 * s, 0.6 * s, 0.6 * s, 0.06 * s, stroke=1, fill=0)
    c.circle(x + 0.5 * s, y + 0.5 * s, 0.13 * s, stroke=0, fill=1)
    c.setFillColor(RED)
    c.circle(x + 0.5 * s, y + 0.5 * s, 0.05 * s, stroke=0, fill=1)


def fire_brigade_inlet(c, x, y, s):
    _tile(c, x, y, s, DARK_RED)
    c.setFillColor(WHITE)
    c.setStrokeColor(WHITE)
    c.setLineWidth(0.05 * s)
    for cx in (0.32, 0.68):
        c.circle(x + cx * s, y + 0.38 * s, 0.12 * s, stroke=1, fill=0)
    c.setFont("Sans-B", 0.3 * s)
    c.drawCentredString(x + 0.5 * s, y + 0.62 * s, "FB")


def lift(c, x, y, s):
    _tile(c, x, y, s, BLACK)
    c.setStrokeColor(WHITE)
    c.setFillColor(WHITE)
    c.setLineWidth(0.05 * s)
    c.rect(x + 0.16 * s, y + 0.14 * s, 0.46 * s, 0.72 * s, stroke=1, fill=0)
    for cx in (0.29, 0.49):
        c.circle(x + cx * s, y + 0.62 * s, 0.06 * s, stroke=0, fill=1)
        c.rect(x + (cx - 0.06) * s, y + 0.24 * s, 0.12 * s, 0.3 * s, stroke=0, fill=1)
    _poly(c, [(0.72, 0.62), (0.86, 0.62), (0.79, 0.78)], x, y, s)
    _poly(c, [(0.72, 0.38), (0.86, 0.38), (0.79, 0.22)], x, y, s)


RUNNER = [  # unit-square strokes of the running figure
    [(0.55, 0.66), (0.42, 0.40)],
    [(0.53, 0.62), (0.68, 0.52), (0.80, 0.60)],
    [(0.52, 0.62), (0.36, 0.60), (0.27, 0.48)],
    [(0.42, 0.40), (0.58, 0.25), (0.55, 0.07)],
    [(0.42, 0.40), (0.30, 0.22), (0.13, 0.20)],
]


def runner(c, x, y, s, color=WHITE):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(0.1 * s)
    c.setLineCap(1)
    c.setLineJoin(1)
    for st in RUNNER:
        _poly(c, st, x, y, s, close=False, fill=False, stroke=True)
    c.circle(x + 0.62 * s, y + 0.80 * s, 0.1 * s, stroke=0, fill=1)


def exit_sign(c, x, y, h):
    """Green EXIT / مخرج sign, h tall, 2.5h wide; returns width."""
    w = 2.5 * h
    c.setFillColor(SIGN_GREEN)
    c.setStrokeColor(WHITE)
    c.setLineWidth(max(0.6, h * 0.03))
    c.roundRect(x, y, w, h, h * 0.08, stroke=1, fill=1)
    # door frame + running figure
    c.setStrokeColor(WHITE)
    c.setLineWidth(0.05 * h)
    c.rect(x + 0.55 * h, y + 0.12 * h, 0.36 * h, 0.76 * h, stroke=1, fill=0)
    runner(c, x + 0.08 * h, y + 0.08 * h, 0.82 * h)
    text_en(c, x + 1.07 * h, y + 0.52 * h, "EXIT", 0.34 * h, bold=True, color=WHITE)
    text_ar(c, x + 1.07 * h, y + 0.12 * h, "مخرج", 0.32 * h, bold=True, align="left", color=WHITE)
    return w


def assembly_point(c, x, y, s):
    _tile(c, x, y, s, SIGN_GREEN)
    c.setFillColor(WHITE)
    for (ax, ay, dx, dy) in ((0.1, 0.9, 1, -1), (0.9, 0.9, -1, -1), (0.1, 0.1, 1, 1), (0.9, 0.1, -1, 1)):
        tip = (ax + dx * 0.2, ay + dy * 0.2)
        _poly(c, [tip, (tip[0] - dx * 0.13, tip[1]), (tip[0], tip[1] - dy * 0.13)], x, y, s)
        c.setStrokeColor(WHITE)
        c.setLineWidth(0.045 * s)
        c.line(x + ax * s, y + ay * s, x + (tip[0] - dx * 0.05) * s, y + (tip[1] - dy * 0.05) * s)
    for cx, cy, r in ((0.5, 0.58, 0.075), (0.34, 0.52, 0.065), (0.66, 0.52, 0.065)):
        c.circle(x + cx * s, y + cy * s, r * s, stroke=0, fill=1)
        c.roundRect(x + (cx - r * 1.2) * s, y + (cy - 0.27) * s, r * 2.4 * s, 0.18 * s, 0.03 * s, stroke=0, fill=1)


def escape_stair_tag(c, x, y, h):
    """Small green tag 'ESCAPE STAIR / درج الطوارئ'; returns width."""
    c.setFont("Sans-B", 0.36 * h)
    w = max(c.stringWidth("ESCAPE STAIR", "Sans-B", 0.36 * h),
            c.stringWidth(ar("درج الطوارئ"), "Ar-B", 0.36 * h)) + 0.5 * h
    c.setFillColor(SIGN_GREEN)
    c.setStrokeColor(WHITE)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, h * 0.12, stroke=1, fill=1)
    text_en(c, x + w / 2, y + 0.56 * h, "ESCAPE STAIR", 0.32 * h, bold=True, align="centre", color=WHITE)
    text_ar(c, x + w / 2, y + 0.12 * h, "درج الطوارئ", 0.32 * h, bold=True, align="centre", color=WHITE)
    return w


def you_are_here(c, ax, ay, s):
    """Red pin whose tip sits exactly on (ax, ay); s = head diameter."""
    r = s / 2
    cx, cy = ax, ay + s * 1.15
    c.setFillColor(RED)
    c.setStrokeColor(WHITE)
    c.setLineWidth(1.2)
    p = c.beginPath()
    p.moveTo(ax, ay)
    p.curveTo(ax - r * 0.25, ay + r * 0.9, cx - r * 1.0, cy - r * 0.55, cx - r, cy)
    p.arcTo(cx - r, cy - r, cx + r, cy + r, 180, -180)
    p.curveTo(cx + r * 1.0, cy - r * 0.55, ax + r * 0.25, ay + r * 0.9, ax, ay)
    p.close()
    c.drawPath(p, fill=1, stroke=1)
    c.setFillColor(WHITE)
    c.circle(cx, cy, r * 0.74, stroke=0, fill=1)
    c.setFillColor(RED)
    c.setFont("Sans-B", r * 0.36)
    for i, w in enumerate(("YOU", "ARE", "HERE")):
        c.drawCentredString(cx, cy + r * (0.28 - 0.38 * i), w)
    return (cx - r, ay, cx + r, cy + r)


def chevron(c, x, y, ang, size, color=DARK_GREEN):
    """Filled arrowhead centred on (x, y) pointing at angle ang (radians)."""
    import math
    ca, sa = math.cos(ang), math.sin(ang)
    pts = [(0.55, 0), (-0.45, 0.55), (-0.2, 0), (-0.45, -0.55)]
    pts = [(x + size * (u * ca - v * sa), y + size * (u * sa + v * ca)) for u, v in pts]
    c.setFillColor(color)
    c.setStrokeColor(WHITE)
    c.setLineWidth(0.8)
    p = c.beginPath()
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    p.close()
    c.drawPath(p, fill=1, stroke=1)


DRAW = {
    "fire_extinguisher": fire_extinguisher,
    "wheeled_extinguisher": wheeled_extinguisher,
    "fire_hose_reel": fire_hose_reel,
    "manual_call_point": manual_call_point,
    "fire_brigade_inlet": fire_brigade_inlet,
    "lift": lift,
    "assembly_point": assembly_point,
}

ACCENT = {
    "fire_extinguisher": RED, "wheeled_extinguisher": RED, "fire_hose_reel": RED,
    "manual_call_point": RED, "fire_brigade_inlet": DARK_RED, "lift": BLACK,
    "assembly_point": SIGN_GREEN, "exit_sign": SIGN_GREEN,
}

LABELS = {
    "you_are_here": ("You Are Here", "أنت هنا"),
    "route": ("Primary Route", "مسار الهروب الرئيسي"),
    "direction": ("Direction of escape", "اتجاه الإخلاء"),
    "exit_sign": ("Emergency Exit", "مخرج الطوارئ"),
    "stair": ("Escape Stair", "درج الطوارئ"),
    "assembly_point": ("Assembly Point", "نقطة التجمع"),
    "lift": ("Elevator", "مصعد"),
    "fire_extinguisher": ("Fire Extinguisher", "طفاية الحريق"),
    "wheeled_extinguisher": ("Wheeled Extinguisher", "طفاية حريق بعجلات"),
    "fire_hose_reel": ("Fire Hose Reel", "خرطوم إطفاء الحريق"),
    "manual_call_point": ("Manual Fire Alarm", "إنذار حريق يدوي"),
    "fire_brigade_inlet": ("Fire Brigade Inlet", "مدخل تغذية الدفاع المدني"),
    "start": ("Route start", "بداية المسار"),
}
