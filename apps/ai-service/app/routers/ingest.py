import logging
from fastapi import APIRouter
from pydantic import BaseModel
from app.knowledge.ingestion import ingest_capture, ingest_issue, delete_resource

logger = logging.getLogger(__name__)
router = APIRouter()

class IngestCaptureReq(BaseModel):
    id: str; company_id: str; project_id: str
    title: str = None; description: str = None; ai_description: str = None
    ai_tags: list = []; capture_type: str = None; phase: str = None
    captured_at: str = None; location_name: str = None

class IngestIssueReq(BaseModel):
    id: str; company_id: str; project_id: str; title: str
    issue_number: str = None; description: str = None; issue_type: str = None
    priority: str = None; status: str = None; discipline: str = None
    location_name: str = None; element_name: str = None

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
