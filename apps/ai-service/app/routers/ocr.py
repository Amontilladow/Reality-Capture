import logging

import httpx
import pytesseract
from fastapi import APIRouter, HTTPException
from pdf2image import convert_from_bytes
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Drawing Intelligence & Control, Decision 1 step 3: "use image
# preprocessing and appropriate resolution to improve title-block
# recognition." 300 DPI is the commonly cited floor for Tesseract to
# reliably segment small title-block text -- a page rendered at ordinary
# screen resolution (72-96 DPI) is usually too blurry for accurate
# character recognition, especially for the dense, small-font title
# blocks typical of construction drawings.
RASTERIZE_DPI = 300


class OcrExtractRequest(BaseModel):
    company_id: str
    project_id: str
    # A short-lived, already-authorized URL (apps/api's own
    # StorageService.getReadUrl(), the same presigned-GET mechanism every
    # other download in that app uses) -- never a raw storage key or
    # credential. This service fetches the bytes itself; nothing is
    # pushed to it.
    pdf_url: str
    page: int = 1


class OcrExtractResponse(BaseModel):
    text: str
    # Tesseract's own mean per-word confidence for the page, normalized to
    # 0-1 -- the caller (apps/api's title-block extractor) treats this as
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

    image = images[0]
    # image_to_string preserves line breaks (needed for the Node-side
    # title-block regexes, several of which anchor on end-of-line) --
    # image_to_data's per-word boxes do not, and would silently merge
    # every line into one space-joined string.
    text = pytesseract.image_to_string(image)

    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    # Tesseract reports -1 confidence for a box it didn't actually
    # recognize as text (e.g. pure whitespace/layout boxes) -- excluded
    # from the average rather than dragging it down for no real reason.
    word_confidences = [c for c in data["conf"] if c is not None and int(c) >= 0]
    confidence = (sum(word_confidences) / len(word_confidences) / 100.0) if word_confidences else 0.0

    return OcrExtractResponse(text=text, confidence=confidence)
