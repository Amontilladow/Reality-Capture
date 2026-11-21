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
# floor for Tesseract to reliably segment small title-block text). This
# stays the API's own contracted coordinate space (every region/run this
# service reports is in THIS scale) even though, below, the actual pixel
# array used for grid DETECTION is deliberately rendered smaller on a
# large sheet -- see grid_detection_scale()'s own comment.
RASTERIZE_DPI = 300

# Real incident, confirmed in production right after this pipeline first
# shipped: rendering a WHOLE page at a fixed 300 DPI, then holding
# several same-sized intermediate arrays alive at once for grid
# detection (binary/horiz/vert/grid/dilated), spiked memory enough to OOM
# this service's 512MB container on a real uploaded drawing within
# seconds of the request arriving. Standard engineering drawing sheet
# sizes (A1, A0, ANSI D/E) are MUCH larger than the A3 fixtures this was
# validated against -- at 300 DPI, an A0 sheet's single grayscale array
# alone is ~140MB, and grid detection briefly holds several of those.
# Capping the LONGEST side of the array used for grid detection bounds
# that cost regardless of the real sheet's size, while native text
# extraction (vector data, not pixels) and a per-region OCR crop (small
# regardless of the sheet's overall size) are unaffected -- see
# grid_detection_scale() and ocr_cropped_image() below.
MAX_GRID_DETECTION_LONG_SIDE_PX = 2200

# A detected grid-line blob physically smaller than this is noise -- a
# single stray ruled line, a dimension tick mark, part of a hatching
# pattern -- not a real title-block-sized grid. Expressed in INCHES, not
# a fixed pixel count, because the array handed to detect_title_block_
# candidates() can now be rendered at different effective resolutions
# depending on the page's real size (see MAX_GRID_DETECTION_LONG_SIDE_PX
# above) -- a fixed pixel threshold calibrated for 300 DPI would reject
# genuine grids on a downscaled large sheet. Empirically generous (a
# real title block is rarely under half an inch in either dimension)
# specifically so this never rejects a genuinely small title block;
# false candidates are filtered by apps/api's own "does this contain a
# plausible drawing number" check downstream, which is a far more
# reliable filter than a size guess could ever be on its own.
MIN_CANDIDATE_WIDTH_INCHES = 0.5
MIN_CANDIDATE_HEIGHT_INCHES = 0.2

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


def grid_detection_scale(page_width_pt: float, page_height_pt: float, official_scale: float) -> float:
    """The scale (pixels per PDF point) used to render the page for grid
    DETECTION only -- bounded so the resulting array's longer side never
    exceeds MAX_GRID_DETECTION_LONG_SIDE_PX, regardless of how large the
    real sheet is (a title block's own region, once found, is converted
    back to `official_scale` via rescale_region() below -- nothing
    downstream ever sees this lower-resolution space). Never larger than
    `official_scale` itself: a genuinely small page (A4, letter) renders
    at the same resolution it always did, this only ever scales DOWN."""
    longer_side_pt = max(page_width_pt, page_height_pt)
    capped_scale = MAX_GRID_DETECTION_LONG_SIDE_PX / longer_side_pt
    return min(official_scale, capped_scale)


def rescale_region(region: GridRegion, from_scale: float, to_scale: float) -> GridRegion:
    """Converts a region found in one pixel scale into another -- pure
    arithmetic, no re-rendering. Used to bring a region detected on the
    deliberately-downscaled grid-detection array (see
    grid_detection_scale()) back into the API's official RASTERIZE_DPI-
    based coordinate space, where every native text run is already
    computed and where apps/api expects every reported coordinate to
    live."""
    ratio = to_scale / from_scale
    return GridRegion(
        left=round(region.left * ratio), top=round(region.top * ratio),
        width=round(region.width * ratio), height=round(region.height * ratio),
    )


def detect_title_block_candidates(gray: np.ndarray, page_width: int, page_height: int, scale: float) -> list[GridRegion]:
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

    `scale` is whatever pixels-per-point `gray` was actually rendered at
    (see grid_detection_scale()) -- used only to convert
    MIN_CANDIDATE_WIDTH_INCHES/HEIGHT_INCHES into the right pixel count
    for THIS array's own resolution, never assumed to be RASTERIZE_DPI.

    Ranked by a cheap heuristic only (distance from the nearest page
    edge, then size): title blocks are drawn near an edge/corner in
    virtually every real convention, but this is a tie-breaking ORDER
    HINT, never a hard filter -- every candidate found is returned, so a
    genuinely unusual layout still gets tried, just later.
    """
    min_width_px = MIN_CANDIDATE_WIDTH_INCHES * 72 * scale
    min_height_px = MIN_CANDIDATE_HEIGHT_INCHES * 72 * scale

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
        if cw < min_width_px or ch < min_height_px:
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


def ocr_cropped_image(gray_crop: np.ndarray, offset_left: int, offset_top: int) -> list[TextRun]:
    """Targeted OCR on an ALREADY-CROPPED small image -- a region's own
    crop, rendered fresh and directly at full RASTERIZE_DPI by the
    caller (this service's own router, via pypdfium2's own crop-render:
    see drawing_extraction.py) rather than sliced out of one already-held
    whole-page array. This is deliberate: re-rendering
    just a region's own small bounding box costs the same small amount of
    memory regardless of how large the overall page is, where slicing a
    crop out of a full-page array requires holding that whole array in
    memory first -- exactly the real OOM this service hit in production
    on a large (A1/A0-class) sheet. Never the whole page; this is the
    only place pytesseract is invoked outside of the genuine last-resort
    whole-page fallback the router keeps separate (brief: "do not use
    whole-page OCR as the primary extraction strategy").

    `offset_left`/`offset_top` are this crop's own top-left corner in the
    API's official pixel space (RASTERIZE_DPI-based) -- added back to
    every recognized word's local-to-the-crop coordinates so every
    returned TextRun still reports an absolute page position, exactly as
    before."""
    crop = _binarize_for_ocr(gray_crop)
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
            left=offset_left + data['left'][i], top=offset_top + data['top'][i],
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


def region_crop_margins_pt(
    region: GridRegion, official_scale: float, page_width_pt: float, page_height_pt: float, padding_px: int = 10,
) -> tuple[tuple[float, float, float, float], int, int]:
    """Pure geometry: converts one region (in the API's official pixel
    space, origin top-left) into the (left, bottom, right, top) MARGIN
    AMOUNTS pypdfium2's own page.render(crop=...) expects, in PDF POINT
    units -- so the router can re-render just that region's own small
    area at full resolution instead of holding a full-page bitmap, no
    matter how large the real page is (see ocr_cropped_image()'s own
    comment on why this is the actual OOM fix).

    Padding is added on every side (so a word right at a region's own
    detected border isn't clipped mid-character) and clamped to the
    page's own edges -- pypdfium2 does not support a negative crop
    margin. Returns the margins alongside this crop's own top-left
    corner, STILL in the official pixel space (`offset_left`/
    `offset_top`): the caller adds these back to every OCR'd word's
    crop-local coordinates so the result stays in one consistent,
    absolute coordinate system regardless of how it was rendered."""
    page_width_px = page_width_pt * official_scale
    page_height_px = page_height_pt * official_scale

    offset_left = max(0, round(region.left - padding_px))
    offset_top = max(0, round(region.top - padding_px))
    right_edge = min(page_width_px, region.left + region.width + padding_px)
    bottom_edge = min(page_height_px, region.top + region.height + padding_px)

    left_margin_pt = offset_left / official_scale
    top_margin_pt = offset_top / official_scale
    right_margin_pt = (page_width_px - right_edge) / official_scale
    bottom_margin_pt = (page_height_px - bottom_edge) / official_scale

    return (left_margin_pt, bottom_margin_pt, right_margin_pt, top_margin_pt), offset_left, offset_top


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
