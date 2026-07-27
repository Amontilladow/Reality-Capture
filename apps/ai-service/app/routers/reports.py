import logging
from fastapi import APIRouter
from pydantic import BaseModel
import asyncpg
from app.config import settings
from app.llm.provider import llm_complete

logger = logging.getLogger(__name__)
router = APIRouter()

class ReportRequest(BaseModel):
    company_id: str
    project_id: str
    report_type: str  # progress, site_condition, handover, dispute_evidence
    date_from: str = None
    date_to: str = None
    format: str = "pdf"

@router.post("/generate")
async def generate_report(req: ReportRequest):
    conn = await asyncpg.connect(settings.database_url)
    try:
        proj = await conn.fetchrow("SELECT name, code, location FROM projects WHERE id=$1 AND company_id=$2", req.project_id, req.company_id)
        if not proj:
            return {"error": "Project not found."}
        issue_summary = await conn.fetch(
            "SELECT status, priority, COUNT(*) AS count FROM issues WHERE project_id=$1 AND company_id=$2 GROUP BY status, priority",
            req.project_id, req.company_id)
        capture_count = await conn.fetchval(
            "SELECT COUNT(*) FROM captures WHERE project_id=$1 AND company_id=$2 AND status='ready'",
            req.project_id, req.company_id)
    finally:
        await conn.close()
    data_summary = f"Project: {proj['name']} ({proj['code'] or 'N/A'})\nLocation: {proj['location'] or 'N/A'}\nTotal captures: {capture_count}\nIssue breakdown: {[dict(r) for r in issue_summary]}"
    prompt = (
        f"Write a professional construction {req.report_type.replace('_', ' ')} report.\n\n"
        f"Project data:\n{data_summary}\n\n"
        "Write 3-4 professional paragraphs: 1) Executive summary 2) Current site status 3) Key issues and risks 4) Recommended actions."
    )
    narrative = await llm_complete(prompt, max_tokens=800)
    return {
        "project": dict(proj),
        "narrative": narrative,
        "data": {"captureCount": capture_count, "issueSummary": [dict(r) for r in issue_summary]},
        "format": req.format,
        "note": "Full PDF/DOCX binary output active in Phase 5 production deployment.",
    }
