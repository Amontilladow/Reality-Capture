import logging
from fastapi import APIRouter
from pydantic import BaseModel
import asyncpg
from app.config import settings
from app.llm.provider import llm_complete

logger = logging.getLogger(__name__)
router = APIRouter()

class ProgressRequest(BaseModel):
    company_id: str
    project_id: str
    narrative: bool = False

@router.post("/summary")
async def progress_summary(req: ProgressRequest):
    conn = await asyncpg.connect(settings.database_url)
    try:
        issues = await conn.fetch(
            "SELECT phase, discipline, status, COUNT(*) AS count, "
            "COUNT(*) FILTER (WHERE priority='critical') AS critical, "
            "COUNT(*) FILTER (WHERE deadline < NOW() AND status NOT IN ('closed','void')) AS overdue "
            "FROM issues WHERE project_id=$1 AND company_id=$2 GROUP BY phase, discipline, status",
            req.project_id, req.company_id)
        captures = await conn.fetch(
            "SELECT TO_CHAR(captured_at,'YYYY-MM') AS month, phase, COUNT(*) AS count "
            "FROM captures WHERE project_id=$1 AND company_id=$2 AND status='ready' "
            "GROUP BY month, phase ORDER BY month",
            req.project_id, req.company_id)
        bim = await conn.fetch(
            "SELECT ifc_type, COUNT(*) AS total, "
            "COUNT(*) FILTER (WHERE construction_status='complete') AS complete, "
            "COUNT(*) FILTER (WHERE construction_status='in_progress') AS in_progress, "
            "COUNT(*) FILTER (WHERE construction_status='defective') AS defective "
            "FROM bim_elements WHERE project_id=$1 AND company_id=$2 GROUP BY ifc_type ORDER BY total DESC LIMIT 20",
            req.project_id, req.company_id)
    finally:
        await conn.close()
    data = {
        "issues_by_phase": [dict(r) for r in issues],
        "capture_activity": [dict(r) for r in captures],
        "bim_progress": [dict(r) for r in bim],
    }
    if req.narrative:
        prompt = (
            "Analyse this construction project data and write a concise 3-paragraph progress summary "
            "for a project manager. Highlight risks, bottlenecks, and positive progress. Cite specific numbers.\n\n"
            f"Issues: {data['issues_by_phase'][:20]}\n"
            f"Capture activity: {data['capture_activity']}\n"
            f"BIM progress: {data['bim_progress']}"
        )
        data["narrative"] = await llm_complete(prompt, max_tokens=600)
    return data
