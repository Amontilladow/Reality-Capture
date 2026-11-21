import logging

import httpx
import pypdfium2 as pdfium
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.drawing_vision import (
    RASTERIZE_DPI,
    detect_title_block_candidates,
    native_text_runs_in_region,
    ocr_region,
    pdf_rect_to_pixel_run,
    render_page_to_grayscale,
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
    scale = RASTERIZE_DPI / 72
    native_runs = []
    for i in range(textpage.count_rects()):
        rect = textpage.get_rect(i)
        text = textpage.get_text_bounded(*rect)
        if text.strip():
            native_runs.append(pdf_rect_to_pixel_run(text, rect, page_height_pt, scale))

    bitmap = page.render(scale=scale)
    gray = render_page_to_grayscale(bitmap.to_pil())
    page_height_px, page_width_px = gray.shape

    candidates = detect_title_block_candidates(gray, page_width_px, page_height_px)
    regions: list[RegionWire] = []
    for region in candidates:
        runs = native_text_runs_in_region(native_runs, region) or ocr_region(gray, region)
        regions.append(RegionWire(
            left=region.left, top=region.top, width=region.width, height=region.height,
            runs=[TextRunWire(text=r.text, left=r.left, top=r.top, width=r.width, height=r.height, conf=r.conf, method=r.method) for r in runs],
        ))

    any_region_has_runs = any(len(region.runs) > 0 for region in regions)
    whole_page_ocr_text = None
    whole_page_ocr_confidence = None
    if not any_region_has_runs and len(whole_page_native_text.strip()) < MIN_USABLE_NATIVE_TEXT_LENGTH:
        whole_page_ocr_text, whole_page_ocr_confidence = whole_page_ocr(gray)

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
