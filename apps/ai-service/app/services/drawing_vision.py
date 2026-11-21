"""
Site Drawing Hub, Drawing Intelligence Engine replacement: the multi-stage
extraction pipeline's actual page-vision work (stages 1-4 of the brief:
ingestion/validation, native text, layout/title-block detection, targeted
OCR). Structured extraction/normalization and field-level verification
(stages 5-6) stay in apps/api/.../extraction, which already owns the
title-block regex/matching engine and the revision-governance rules this
must never touch -- this module's only job is to hand that engine
accurate, correctly-SCOPED candidate text, however the page produced it.

Library choices, both deliberate:

- pypdfium2 (Apache-2.0/BSD; Google's PDFium, the same engine Chrome uses)
  for BOTH native text extraction and page rasterization, replacing
  pdf2image/poppler-utils (no longer needed once pypdfium2 renders pages
  itself) and explicitly NOT PyMuPDF. This codebase already has a
  deliberate, documented rejection of PyMuPDF (see requirements.txt's own
  comment): it's AGPL-3.0/commercial dual-licensed, and RealityCapture is
  a commercial SaaS product without a paid Artifex license. Using it
  would risk AGPL's network-use clause extending to this whole codebase.
  pypdfium2 gives the same native-text + rendering capability under a
  license with no such risk.
- opencv-python-headless (Apache-2.0) for title-block GRID detection
  (long horizontal/vertical line structures), never for OCR itself --
  that stays pytesseract, now invoked only on a small cropped region
  instead of the whole page (brief: "do not use whole-page OCR as the
  primary extraction strategy").

Core design: a title block is, geometrically, almost always a bordered
grid somewhere on the page -- the same thing pdf-parse's draw-operator
table detection looked for on the Node side, now found from PIXELS
instead (catches a grid that isn't built from the specific vector draw
operators pdf-parse recognizes, e.g. a scanned page with no vector data
at all). Detecting the title block's REGION (a bounding box), not its
exact internal row/column lines, is deliberately as far as this module
goes: once a region is found, every native text run or OCR word whose
own bounding box falls inside it is handed to apps/api, which already
owns a proven row/column reconstruction algorithm (extraction/
ocr-structure.ts, generalized by this same engineering effort to accept
either source) and the title-block field-matching engine built on top of
it. Rebuilding that matching logic here in Python would duplicate it in
two languages, drifting them apart over time -- the opposite of "small,
isolated, reversible" changes.

Multiple candidate grid regions are common (the title block AND a
separate small revision-history table are both bordered grids -- the
exact shape that previously produced a false revision match of "Date",
see ocr.py's git history / apps/api's title-block-extractor.ts comment
on isPlausibleRevision). This module does not try to be certain which
one is the real title block: it ranks candidates by a cheap heuristic
(closer to a page edge, larger) and returns ALL of them in that order.
apps/api tries each in turn with its own validation (does the region's
text contain a plausible drawing number at all?) until one succeeds --
the exact same "null falls through to the next thing" pattern already
used throughout that engine, now extended one level further.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np
import pytesseract
from PIL import Image

logger = logging.getLogger(__name__)

# Matches ocr.py's own prior constant exactly (300 DPI: the commonly cited
# floor for Tesseract to reliably segment small title-block text).
RASTERIZE_DPI = 300

# A detected grid-line blob narrower or shorter than this (in PIXELS, at
# RASTERIZE_DPI) is noise -- a single stray ruled line, a dimension tick
# mark, part of a hatching pattern -- not a real title-block-sized grid.
# Empirically generous (a real title block is rarely under half an inch
# in either dimension at 300 DPI, i.e. 150px) specifically so this never
# rejects a genuinely small title block; false candidates are filtered by
# apps/api's own "does this contain a plausible drawing number" check
# downstream, which is a far more reliable filter than a pixel-size
# guess could ever be on its own.
MIN_CANDIDATE_WIDTH_PX = 150
MIN_CANDIDATE_HEIGHT_PX = 60

RunMethod = Literal['native', 'ocr']


@dataclass
class TextRun:
    """One recognized run of text and its pixel-space bounding box, at
    RASTERIZE_DPI, origin top-left -- the same coordinate convention
    OcrWord used in ai-service's OLD ocr.py, kept identical on purpose so
    apps/api's existing (now generalized) row/column reconstruction
    doesn't need a second coordinate system to understand.
    `method` records whether THIS run came from the PDF's own text layer
    or from a targeted OCR pass on a small crop -- apps/api's per-field
    verification stage (Verified/Unverified/Missing) uses this as one of
    the signals behind each field's stored "extraction method" evidence."""
    text: str
    left: int
    top: int
    width: int
    height: int
    conf: float
    method: RunMethod


@dataclass
class GridRegion:
    """One candidate title-block-shaped grid, in pixel space."""
    left: int
    top: int
    width: int
    height: int


def _binarize(gray: np.ndarray) -> np.ndarray:
    """Otsu threshold, inverted (text/lines become white on black) -- the
    shape cv2's morphology operations below expect. Same adaptive-to-
    the-image approach as the old ocr.py's hand-rolled Otsu implementation
    (kept here via cv2's own equivalent now that opencv is a dependency
    for grid detection anyway, rather than keeping two separate
    binarization implementations for the two different things that now
    both need one)."""
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return binary


def detect_title_block_candidates(gray: np.ndarray, page_width: int, page_height: int) -> list[GridRegion]:
    """
    Finds every bordered-grid-shaped region on the page from pixel data
    alone (morphological line detection: open with a long horizontal
    kernel to keep only long horizontal strokes, same with a vertical
    kernel, OR them together, dilate slightly to merge a grid's own
    border+internal lines into one solid blob per grid, then take each
    blob's bounding box). Confirmed by hand against four synthetic
    fixtures covering a bottom-right corner title block, a full-width
    bottom strip layout, a title block with no native text at all (a
    scanned page), and a second grid elsewhere on the page (a revision-
    history mini-table) that must be found too, not merged with or
    mistaken for the real title block -- both are returned as separate
    candidates, ranked, and it's the CALLER's job (apps/api, which also
    has the drawing-number-plausibility check this module deliberately
    doesn't) to pick the one that's actually the title block.

    Ranked by a cheap heuristic only (distance from the nearest page
    edge, then size): title blocks are drawn near an edge/corner in
    virtually every real convention, but this is a tie-breaking ORDER
    HINT, never a hard filter -- every candidate found is returned, so a
    genuinely unusual layout still gets tried, just later.
    """
    binary = _binarize(gray)
    h, w = binary.shape
    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, w // 40), 1))
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, h // 40)))
    horiz_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horiz_kernel)
    vert_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vert_kernel)
    grid = cv2.bitwise_or(horiz_lines, vert_lines)
    dilated = cv2.dilate(grid, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)), iterations=2)

    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[GridRegion] = []
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        if cw < MIN_CANDIDATE_WIDTH_PX or ch < MIN_CANDIDATE_HEIGHT_PX:
            continue
        candidates.append(GridRegion(left=x, top=y, width=cw, height=ch))

    def edge_distance(region: GridRegion) -> int:
        right_gap = page_width - (region.left + region.width)
        bottom_gap = page_height - (region.top + region.height)
        return min(region.left, right_gap, region.top, bottom_gap)

    candidates.sort(key=lambda r: (edge_distance(r), -(r.width * r.height)))
    return candidates


def native_text_runs_in_region(
    native_runs: list[TextRun], region: GridRegion, tolerance_px: int = 6,
) -> list[TextRun]:
    """Every already-extracted native text run whose bounding box falls
    inside `region` (with a small tolerance -- a run's own box can sit a
    few pixels outside a detected grid's outer border without actually
    belonging to a different field). Deliberately simple containment,
    not a fuzzy/partial-overlap rule: a run straddling a region's edge is
    much more likely to be unrelated text that merely runs close to the
    title block than a genuine field value, so excluding it is the safer
    default -- exactly how this engagement has treated every other
    "ambiguous evidence" case (never guess; fall through to the next
    tier instead)."""
    return [
        run for run in native_runs
        if run.left >= region.left - tolerance_px
        and run.top >= region.top - tolerance_px
        and run.left + run.width <= region.left + region.width + tolerance_px
        and run.top + run.height <= region.top + region.height + tolerance_px
    ]


def ocr_region(gray: np.ndarray, region: GridRegion, padding_px: int = 10) -> list[TextRun]:
    """Targeted OCR scoped to ONE candidate region's own crop (padded
    slightly so a word right at the border isn't clipped mid-character) --
    never the whole page. This is the only place pytesseract is invoked
    outside of a last-resort whole-page fallback the router keeps
    separate and only reaches for when no region produced anything at
    all (brief: "do not use whole-page OCR as the primary extraction
    strategy" -- here it's the targeted exception's own crop, not the
    primary path, and the whole-page fallback stays the genuinely last
    resort)."""
    h, w = gray.shape
    x0 = max(0, region.left - padding_px)
    y0 = max(0, region.top - padding_px)
    x1 = min(w, region.left + region.width + padding_px)
    y1 = min(h, region.top + region.height + padding_px)
    crop = _binarize_for_ocr(gray[y0:y1, x0:x1])

    data = pytesseract.image_to_data(crop, output_type=pytesseract.Output.DICT)
    runs: list[TextRun] = []
    n = len(data['text'])
    for i in range(n):
        conf = data['conf'][i]
        stripped = data['text'][i].strip()
        if conf is None or int(conf) < 0 or not stripped:
            continue
        runs.append(TextRun(
            text=stripped,
            left=x0 + data['left'][i], top=y0 + data['top'][i],
            width=data['width'][i], height=data['height'][i],
            conf=float(conf), method='ocr',
        ))
    return runs


def _binarize_for_ocr(gray_crop: np.ndarray) -> np.ndarray:
    """Otsu binarization tuned for Tesseract's own input expectations
    (black text on white, the opposite polarity from the INVERTED
    binary _binarize() above uses for line-structure detection)."""
    _, binary = cv2.threshold(gray_crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary


def render_page_to_grayscale(pil_image: Image.Image) -> np.ndarray:
    return np.asarray(pil_image.convert('L'), dtype=np.uint8)


def pdf_rect_to_pixel_run(
    text: str, rect: tuple[float, float, float, float], page_height_pt: float, scale: float,
) -> TextRun:
    """Converts one native-text rect from pypdfium2's own coordinate
    convention (PDF points, origin BOTTOM-left: (left, bottom, right,
    top)) into this module's pixel-space, origin TOP-left convention, at
    the same `scale` the page was rasterized at -- so a native run and an
    OCR run from the same page always land in one consistent coordinate
    system, regardless of which produced them. Confirmed by hand against
    a real pypdfium2 textpage: get_rect() returns exactly this (left,
    bottom, right, top) order, not (left, top, right, bottom)."""
    left, bottom, right, top = rect
    return TextRun(
        text=text.strip(),
        left=round(left * scale),
        top=round((page_height_pt - top) * scale),
        width=round((right - left) * scale),
        height=round((top - bottom) * scale),
        conf=100.0,  # the PDF's own text layer; not a recognition guess, so this is reported at Tesseract's max-confidence scale for a consistent 0-100 comparison, never averaged together with a real OCR confidence as if it were one.
        method='native',
    )


def whole_page_ocr(gray: np.ndarray) -> tuple[str, float]:
    """The genuine last resort: used only when native text AND every
    detected region (native or targeted-OCR) came back empty. Mirrors
    the old ocr.py's whole-page behavior exactly, kept only as a safety
    net, never the first thing tried."""
    binary = _binarize_for_ocr(gray)
    text = pytesseract.image_to_string(binary)
    data = pytesseract.image_to_data(binary, output_type=pytesseract.Output.DICT)
    confidences = [int(c) for c in data['conf'] if c is not None and int(c) >= 0]
    confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0
    return text, confidence
