import asyncio
import logging
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel
from app.knowledge.embeddings import embed
from app.knowledge.vector_store import search_vectors

logger = logging.getLogger(__name__)
router = APIRouter()

class SearchRequest(BaseModel):
    query: str
    company_id: str
    project_id: Optional[str] = None
    collections: Optional[list] = None
    limit: int = 10

@router.post("/")
async def search(req: SearchRequest):
    if not req.query.strip():
        return {"query": req.query, "total": 0, "results": []}
    qv = embed(req.query)
    cols = req.collections or ["captures", "documents", "issues", "timeline", "bim_elements"]
    raw = await asyncio.gather(*[
        search_vectors(c, qv, req.company_id, req.project_id, req.limit)
        for c in cols
    ], return_exceptions=True)
    all_results = []
    for col, res in zip(cols, raw):
        if isinstance(res, Exception):
            logger.warning(f"Search failed for {col}: {res}")
            continue
        for r in res:
            all_results.append({
                "resource_type": r["payload"].get("resource_type", col),
                "resource_id":   r["payload"].get("resource_id", r["id"]),
                "score":         round(r["score"], 4),
                "text_preview":  r["payload"].get("text_preview"),
                "payload":       r["payload"],
            })
    seen, deduped = set(), []
    for r in sorted(all_results, key=lambda x: x["score"], reverse=True):
        k = f"{r['resource_type']}:{r['resource_id']}"
        if k not in seen:
            seen.add(k)
            deduped.append(r)
    return {"query": req.query, "total": len(deduped), "results": deduped[:req.limit]}
