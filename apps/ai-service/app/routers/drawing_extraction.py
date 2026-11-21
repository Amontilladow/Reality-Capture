import logging

import httpx
import pypdfium2 as pdfium
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.drawing_vision import (
    RASTERIZE_DPI,
    detect_title_block_candidates,
    grid_detection_scale,
    native_text_runs_in_region,
    ocr_cropped_image,
    pdf_rect_to_pixel_run,
    region_crop_margins_pt,
    render_page_to_grayscale,
    rescale_region,
    whole_page_ocr,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Below this, the page's own native text layer is treated as having
# nothing useful at all -- mirrors apps/api's MIN_USABLE_TEXT_LENGTH
# (pdf-text-extractor.ts) exactly; kept as a SEPARATE constant rather
# than a shared one across two different languages/services, since the
# two call sites already tolerate drifting independently if a future
# tune only applies to one of them (this one only gates whether the
# deepest whole-page-OCR fallback below is worth attempting at all).
MIN_USABLE_NATIVE_TEXT_LENGTH = 20


class DrawingExtractionRequest(BaseModel):
    company_id: str
    project_id: str
    # A short-lived, already-authorized URL (apps/api's own
    # StorageService.getReadUrl()) -- same contract as the old
    # /ocr/extract-text endpoint this replaces.
    pdf_url: str
    page: int = 1


class TextRunWire(BaseModel):
    text: str
    left: int
    top: int
    width: int
    height: int
    conf: float
    method: str  # 'native' | 'ocr'


class RegionWire(BaseModel):
    left: int
    top: int
    width: int
    height: int
    runs: list[TextRunWire]


class DrawingExtractionResponse(BaseModel):
    page_count: int
    page_width: int
    page_height: int
    # The PDF's OWN declared page rotation (0/90/180/270) -- exact
    # metadata, never a guessed value (Phase 2's prior OSD-based guess was
    # confirmed unreliable; see this module's own docstring). Reported for
    # the caller to use in display/normalization decisions; this service
    # never rotates anything itself -- every run's (left, top) below is
    # always in the page's own unrotated coordinate space.
    page_rotation_degrees: int
    # Every candidate title-block-shaped grid region found, RANKED
    # (closest to a page edge, then largest) but not filtered -- the
    # caller tries each in turn with its own drawing-number-plausibility
    # check until one succeeds. Empty when no grid-shaped region was
    # found at all (a borderless/hand-drawn title block): the caller
    # falls back to whole_page_native_text/whole_page_ocr_text, the same
    # "whole-page as the last resort" structure the embedded-text path
    # already had before this engine existed.
    regions: list[RegionWire]
    whole_page_native_text: str
    # Computed only when truly nothing else produced any text at all
    # (every region came back empty AND the page's native text layer is
    # also insufficient) -- the genuinely last-resort path, never the
    # primary strategy. None when not attempted.
    whole_page_ocr_text: str | None = None
    whole_page_ocr_confidence: float | None = None


@router.post("/extract-structured", response_model=DrawingExtractionResponse)
async def extract_structured(req: DrawingExtractionRequest) -> DrawingExtractionResponse:
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(req.pdf_url)
            resp.raise_for_status()
        except httpx.HTTPError as err:
            logger.warning("drawing-extraction: failed to fetch PDF for project %s: %s", req.project_id, err)
            raise HTTPException(status_code=502, detail=f"could not fetch the PDF: {err}") from err

    try:
        pdf = pdfium.PdfDocument(resp.content)
        page_count = len(pdf)
    except Exception as err:  # pypdfium2 raises PdfiumError for a corrupt/non-PDF file
        logger.warning("drawing-extraction: failed to open PDF for project %s: %s", req.project_id, err)
        raise HTTPException(status_code=422, detail=f"could not open the PDF: {err}") from err

    page_index = req.page - 1
    if page_index < 0 or page_index >= page_count:
        raise HTTPException(status_code=422, detail=f"page {req.page} does not exist in this {page_count}-page PDF")

    page = pdf[page_index]
    rotation = page.get_rotation()
    page_width_pt, page_height_pt = page.get_size()

    textpage = page.get_textpage()
    whole_page_native_text = textpage.get_text_range()
    # The API's own contracted coordinate space: every region/run this
    # endpoint reports lives here, regardless of what (lower) resolution
    # was actually rendered for grid detection below -- see
    # grid_detection_scale()'s own comment for why those are now
    # deliberately different on a large sheet.
    official_scale = RASTERIZE_DPI / 72
    page_width_px = round(page_width_pt * official_scale)
    page_height_px = round(page_height_pt * official_scale)

    native_runs = []
    for i in range(textpage.count_rects()):
        rect = textpage.get_rect(i)
        text = textpage.get_text_bounded(*rect)
        if text.strip():
            native_runs.append(pdf_rect_to_pixel_run(text, rect, page_height_pt, official_scale))

    # Real incident, confirmed in production: rendering the WHOLE page at
    # a fixed 300 DPI OOM'd this service's 512MB container on a large
    # (A1/A0-class) real engineering drawing sheet. This ONE render, at a
    # resolution capped regardless of the real sheet's size (see
    # grid_detection_scale()'s own comment), is the only full-page bitmap
    # this endpoint ever holds in memory -- used for BOTH grid detection
    # and, if truly needed, the whole-page-OCR last resort below. Native
    # text extraction above needed no rasterization at all (vector data);
    # a region actually needing OCR gets its own small, fresh, full-
    # resolution crop-render further down, never sliced from this array.
    detection_scale = grid_detection_scale(page_width_pt, page_height_pt, official_scale)
    detection_bitmap = page.render(scale=detection_scale, grayscale=True)
    detection_gray = render_page_to_grayscale(detection_bitmap.to_pil())

    candidates_at_detection_scale = detect_title_block_candidates(
        detection_gray, detection_gray.shape[1], detection_gray.shape[0], detection_scale,
    )
    candidates = [rescale_region(c, detection_scale, official_scale) for c in candidates_at_detection_scale]

    regions: list[RegionWire] = []
    for region in candidates:
        runs = native_text_runs_in_region(native_runs, region)
        if not runs:
            crop_margins, offset_left, offset_top = region_crop_margins_pt(region, official_scale, page_width_pt, page_height_pt)
            crop_bitmap = page.render(scale=official_scale, grayscale=True, crop=crop_margins)
            crop_gray = render_page_to_grayscale(crop_bitmap.to_pil())
            runs = ocr_cropped_image(crop_gray, offset_left, offset_top)
        regions.append(RegionWire(
            left=region.left, top=region.top, width=region.width, height=region.height,
            runs=[TextRunWire(text=r.text, left=r.left, top=r.top, width=r.width, height=r.height, conf=r.conf, method=r.method) for r in runs],
        ))

    any_region_has_runs = any(len(region.runs) > 0 for region in regions)
    whole_page_ocr_text = None
    whole_page_ocr_confidence = None
    if not any_region_has_runs and len(whole_page_native_text.strip()) < MIN_USABLE_NATIVE_TEXT_LENGTH:
        # The genuinely rare, deepest-last-resort path: reuses the SAME
        # (deliberately capped-resolution) array already rendered above
        # rather than a second, full-resolution whole-page render -- a
        # real memory-vs-quality tradeoff accepted deliberately, only on
        # a path that is rare by construction and was already a "worst
        # case" cost in this pipeline's design.
        whole_page_ocr_text, whole_page_ocr_confidence = whole_page_ocr(detection_gray)

    return DrawingExtractionResponse(
        page_count=page_count,
        page_width=page_width_px,
        page_height=page_height_px,
        page_rotation_degrees=rotation,
        regions=regions,
        whole_page_native_text=whole_page_native_text,
        whole_page_ocr_text=whole_page_ocr_text,
        whole_page_ocr_confidence=whole_page_ocr_confidence,
    )
