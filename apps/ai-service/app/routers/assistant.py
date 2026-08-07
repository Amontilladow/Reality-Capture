import asyncio, logging
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel
from app.knowledge.embeddings import embed
from app.knowledge.vector_store import search_vectors
from app.llm.provider import llm_complete

logger = logging.getLogger(__name__)
router = APIRouter()

SYSTEM = """You are an AI assistant embedded in EngineeringOS, a construction reality capture platform.
Answer only from the provided context. Always cite sources using [TYPE ID] notation.
If context is insufficient, say so. Flag safety issues prominently."""

class AssistantRequest(BaseModel):
    question: str
    company_id: str
    # Optional[...] required, not bare `str = None` -- Pydantic v2 rejects an
    # explicit null against a bare type even with that default. Confirmed by
    # hand elsewhere in this service (reports.py, ingest.py had the same bug).
    project_id: Optional[str] = None
    conversation_history: Optional[list] = None
    top_k: int = 8

@router.post("/")
async def ask(req: AssistantRequest):
    qv = embed(req.question)
    cols = ["captures", "documents", "issues", "timeline"]
    raw = await asyncio.gather(*[
        search_vectors(c, qv, req.company_id, req.project_id, req.top_k // len(cols) + 2)
        for c in cols
    ], return_exceptions=True)
    sources, ctx_parts = [], []
    for col, results in zip(cols, raw):
        if isinstance(results, Exception):
            continue
        for r in results[:3]:
            p = r["payload"]
            text = p.get("text_preview", "")
            if not text:
                continue
            sources.append({"resource_type": p.get("resource_type", col), "resource_id": p.get("resource_id"), "score": round(r["score"], 3)})
            ctx_parts.append(f"[{p.get('resource_type','?').upper()} {p.get('resource_id','?')}]\n{text}")
    context = "\n\n---\n\n".join(ctx_parts[:req.top_k]) or "No relevant context found."
    history_text = ""
    if req.conversation_history:
        history_text = "\n".join(f"{'User' if m['role']=='user' else 'Assistant'}: {m['content']}" for m in req.conversation_history[-6:]) + "\n\n"
    prompt = f"Context:\n{context}\n\n{history_text}Question: {req.question}\n\nAnswer (cite sources):"
    answer = await llm_complete(prompt, system=SYSTEM, max_tokens=1024)
    return {"answer": answer, "sources": sources}
