import logging
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel
from app.knowledge.ingestion import ingest_capture, ingest_issue, delete_resource

logger = logging.getLogger(__name__)
router = APIRouter()

# Every optional field here MUST be Optional[str] (or Optional[list]), not a
# bare `str = None` -- Pydantic v2 validates the declared type even when the
# default is None, so a bare `str` field rejects an explicit null with a 422.
# Confirmed by hand: apps/api's AiClientService always sends these fields as
# `value ?? null` (never omits the key), so this bug fired on essentially
# every real capture/issue that had any optional field left blank -- silently,
# since ingestion calls are fire-and-forget and only logged as a warning.
class IngestCaptureReq(BaseModel):
    id: str; company_id: str; project_id: str
    title: Optional[str] = None; description: Optional[str] = None; ai_description: Optional[str] = None
    ai_tags: list = []; capture_type: Optional[str] = None; phase: Optional[str] = None
    captured_at: Optional[str] = None; location_name: Optional[str] = None

class IngestIssueReq(BaseModel):
    id: str; company_id: str; project_id: str; title: str
    issue_number: Optional[str] = None; description: Optional[str] = None; issue_type: Optional[str] = None
    priority: Optional[str] = None; status: Optional[str] = None; discipline: Optional[str] = None
    location_name: Optional[str] = None; element_name: Optional[str] = None

class DeleteReq(BaseModel):
    collection: str; resource_id: str

@router.post("/capture")
async def ingest_capture_ep(req: IngestCaptureReq):
    await ingest_capture(req.model_dump())
    return {"status": "ingested", "resource_type": "capture", "id": req.id}

@router.post("/issue")
async def ingest_issue_ep(req: IngestIssueReq):
    await ingest_issue(req.model_dump())
    return {"status": "ingested", "resource_type": "issue", "id": req.id}

@router.delete("/resource")
async def delete_ep(req: DeleteReq):
    await delete_resource(req.collection, req.resource_id)
    return {"status": "deleted", "collection": req.collection, "resource_id": req.resource_id}
