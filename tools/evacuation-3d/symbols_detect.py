"""Classify the raster safety icons embedded in the source evacuation sheets.

The source sheets place each fire-safety symbol as an embedded bitmap. Pixel
size differs from sheet to sheet, so classification uses colour composition
and shape only (rotation-invariant), never the image hash or size.
"""
import numpy as np
import pymupdf


def _rgb(doc, xref):
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha != 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    return a[:, :, :3].astype(int)


def classify(doc, xref):
    a = _rgb(doc, xref)
    h, w = a.shape[:2]
    if min(h, w) < 40 or max(h, w) > 900:
        return None
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 170) & (g < 90) & (b < 90)
    dark_red = (r > 90) & (r < 180) & (g < 60) & (b < 60)
    green = (g > 90) & (r < 110) & (g > b)
    black = (r < 60) & (g < 60) & (b < 60)
    white = (r > 215) & (g > 215) & (b > 215)
    f = {k: v.mean() for k, v in dict(red=red, dark_red=dark_red, green=green, black=black, white=white).items()}
    ar = max(h, w) / min(h, w)
    if f["black"] > 0.35:
        return "lift"
    if f["green"] > 0.3:
        return "assembly_point" if ar < 1.3 else "exit_sign"
    if f["dark_red"] > 0.25:
        return "fire_brigade_inlet"
    if f["red"] > 0.4:
        if ar >= 1.25:
            return "fire_extinguisher"
        # same artwork at every scale: hose reel tile ~1.07:1, call point ~1.13:1
        return "fire_hose_reel" if ar < 1.10 else "manual_call_point"
    if f["red"] > 0.05 and f["white"] > 0.3 and ar > 1.4:
        return "wheeled_extinguisher"
    return None
