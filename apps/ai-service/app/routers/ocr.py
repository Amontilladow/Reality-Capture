import logging

import httpx
import numpy as np
import pytesseract
from fastapi import APIRouter, HTTPException
from PIL import Image, ImageOps
from pdf2image import convert_from_bytes
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Drawing Intelligence & Control, Decision 1 step 3: "use image
# preprocessing and appropriate resolution to improve title-block
# recognition." 300 DPI is the commonly cited floor for Tesseract to
# reliably segment small title-block text: a page rendered at ordinary
# screen resolution (72-96 DPI) is usually too blurry for accurate
# character recognition, especially for the dense, small-font title
# blocks typical of construction drawings.
RASTERIZE_DPI = 300


def _binarize_for_ocr(image: Image.Image) -> Image.Image:
    """
    The other half of Decision 1 step 3 ("use image preprocessing... to
    improve title-block recognition"), which this router never actually
    did -- OCR ran straight off the raw rasterized page. Root-caused from
    reported wrong (not just low-confidence/NEEDS_REVIEW) extracted field
    values on real CAD-exported sheets: bordered title-block grids, thin
    ruled lines, dimension marks, light hatching and revision-cloud stamps
    give Tesseract's own internal thresholding plenty of non-text ink to
    confuse with characters. Grayscale + Otsu's-threshold binarization
    removes almost all of that ambiguity before Tesseract ever runs: clean
    black text on a white background is the input Tesseract is actually
    tuned for.

    Deliberately does NOT crop to a specific region: this app explicitly
    never assumes one fixed title-block layout (title-block-extractor.ts's
    own comment on DRAWING_NUMBER_LABELED/DRAWING_NUMBER_BARE), since a
    different consultant's template places it in a different corner. This
    improves raw recognition fidelity everywhere on the page instead,
    which helps regardless of layout.

    Otsu's method (not a single fixed brightness cutoff) finds the
    threshold that best separates ink from background FOR THIS IMAGE,
    so it adapts to a lightly-scanned, over-exposed, or tinted sheet
    instead of misfiring on one fixed assumption. Implemented directly
    (no opencv dependency -- this service already tracks container size
    closely, see RASTERIZE_DPI's and torch's own comments above) over
    grayscale pixel data: numpy and Pillow are already dependencies here.
    """
    gray = np.asarray(ImageOps.autocontrast(image.convert("L")), dtype=np.uint8)

    histogram, _ = np.histogram(gray, bins=256, range=(0, 256))
    total_pixels = gray.size
    cumulative_sum = np.cumsum(histogram)
    cumulative_intensity = np.cumsum(histogram * np.arange(256))
    total_intensity = cumulative_intensity[-1]

    # Between-class variance at every possible threshold, vectorized
    # rather than looped: the classic Otsu formula, computed for all 256
    # candidate thresholds at once.
    with np.errstate(divide="ignore", invalid="ignore"):
        weight_background = cumulative_sum / total_pixels
        weight_foreground = 1.0 - weight_background
        mean_background = np.where(cumulative_sum > 0, cumulative_intensity / np.maximum(cumulative_sum, 1), 0)
        remaining = total_pixels - cumulative_sum
        mean_foreground = np.where(
            remaining > 0, (total_intensity - cumulative_intensity) / np.maximum(remaining, 1), 0,
        )
        between_class_variance = weight_background * weight_foreground * (mean_background - mean_foreground) ** 2

    threshold = int(np.nanargmax(np.nan_to_num(between_class_variance)))
    binary = np.where(gray > threshold, 255, 0).astype(np.uint8)
    return Image.fromarray(binary)


class OcrExtractRequest(BaseModel):
    company_id: str
    project_id: str
    # A short-lived, already-authorized URL (apps/api's own
    # StorageService.getReadUrl(), the same presigned-GET mechanism every
    # other download in that app uses): never a raw storage key or
    # credential. This service fetches the bytes itself; nothing is
    # pushed to it.
    pdf_url: str
    page: int = 1


class OcrExtractResponse(BaseModel):
    text: str
    # Tesseract's own mean per-word confidence for the page, normalized to
    # 0-1: the caller (apps/api's title-block extractor) treats this as
    # one more signal alongside its own pattern-match confidence, never as
    # a standalone guarantee.
    confidence: float


@router.post("/extract-text", response_model=OcrExtractResponse)
async def extract_text(req: OcrExtractRequest) -> OcrExtractResponse:
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(req.pdf_url)
            resp.raise_for_status()
        except httpx.HTTPError as err:
            logger.warning("OCR: failed to fetch PDF for project %s: %s", req.project_id, err)
            raise HTTPException(status_code=502, detail=f"could not fetch the PDF: {err}") from err

    try:
        images = convert_from_bytes(resp.content, dpi=RASTERIZE_DPI, first_page=req.page, last_page=req.page)
    except Exception as err:  # pdf2image/poppler raise several distinct error types for a malformed PDF
        logger.warning("OCR: failed to rasterize page %s for project %s: %s", req.page, req.project_id, err)
        raise HTTPException(status_code=422, detail=f"could not rasterize page {req.page}: {err}") from err

    if not images:
        raise HTTPException(status_code=422, detail=f"page {req.page} does not exist in this PDF")

    image = _binarize_for_ocr(images[0])
    # image_to_string preserves line breaks (needed for the Node-side
    # title-block regexes, several of which anchor on end-of-line) --
    # image_to_data's per-word boxes do not, and would silently merge
    # every line into one space-joined string.
    text = pytesseract.image_to_string(image)

    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    # Tesseract reports -1 confidence for a box it didn't actually
    # recognize as text (e.g. pure whitespace/layout boxes): excluded
    # from the average rather than dragging it down for no real reason.
    word_confidences = [c for c in data["conf"] if c is not None and int(c) >= 0]
    confidence = (sum(word_confidences) / len(word_confidences) / 100.0) if word_confidences else 0.0

    return OcrExtractResponse(text=text, confidence=confidence)
