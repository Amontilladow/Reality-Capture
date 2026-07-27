import logging, base64, io
from fastapi import APIRouter
from pydantic import BaseModel
import boto3
from botocore.client import Config as BotoConfig
from app.config import settings
from app.llm.provider import llm_complete

logger = logging.getLogger(__name__)
router = APIRouter()

def s3_client():
    return boto3.client("s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        config=BotoConfig(signature_version="s3v4"),
    )

class ChangeRequest(BaseModel):
    capture_id_before: str
    capture_id_after: str
    storage_key_before: str
    storage_key_after: str
    company_id: str
    describe: bool = True

@router.post("/")
async def detect_changes(req: ChangeRequest):
    result = {"capture_id_before": req.capture_id_before, "capture_id_after": req.capture_id_after, "pixel_diff_score": None, "description": None, "error": None}
    try:
        s3 = s3_client()
        def get_bytes(key):
            return s3.get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()
        from PIL import Image, ImageChops
        import numpy as np
        b = Image.open(io.BytesIO(get_bytes(req.storage_key_before))).convert("RGB").resize((800, 400))
        a = Image.open(io.BytesIO(get_bytes(req.storage_key_after))).convert("RGB").resize((800, 400))
        diff_arr = np.array(ImageChops.difference(b, a))
        score = round(float(diff_arr.mean()) / 255.0, 4)
        result["pixel_diff_score"] = score
        if req.describe and score > 0.01:
            prompt = (
                f"Two construction photos at the same location. Pixel diff score: {score:.4f} (0=identical, 1=completely different).\n"
                "Describe in 2-3 sentences: (1) what construction work was completed between these captures, "
                "(2) current visible state, (3) any quality or safety observations."
            )
            result["description"] = await llm_complete(prompt, max_tokens=300)
    except Exception as e:
        logger.error(f"Change detection failed: {e}")
        result["error"] = str(e)
    return result
