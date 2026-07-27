import logging
import uuid
from qdrant_client.models import PointStruct
from app.knowledge.embeddings import embed
from app.knowledge.vector_store import upsert_vectors, delete_by_resource

logger = logging.getLogger(__name__)

def _uid(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, key))

async def ingest_capture(capture: dict):
    text = " ".join(filter(None, [
        capture.get("title"), capture.get("description"),
        capture.get("ai_description"), capture.get("location_name"),
        capture.get("phase"), " ".join(capture.get("ai_tags", [])),
    ])).strip()
    if not text:
        return
    await upsert_vectors("captures", [PointStruct(
        id=_uid(f"capture:{capture['id']}"),
        vector=embed(text),
        payload={
            "company_id": capture["company_id"], "project_id": capture["project_id"],
            "resource_type": "capture", "resource_id": capture["id"],
            "capture_type": capture.get("capture_type"), "phase": capture.get("phase"),
            "captured_at": str(capture.get("captured_at", "")),
            "location_name": capture.get("location_name"), "text_preview": text[:300],
        },
    )])
    logger.info(f"Ingested capture {capture['id']}")

async def ingest_document_chunks(document: dict, content: str):
    CHUNK, OVERLAP = 512, 50
    words = content.split()
    chunks = [" ".join(words[i:i+CHUNK]) for i in range(0, len(words), CHUNK - OVERLAP)]
    if not chunks:
        return
    points = [
        PointStruct(
            id=_uid(f"doc:{document['id']}:chunk:{i}"),
            vector=embed(chunk),
            payload={
                "company_id": document["company_id"], "project_id": document["project_id"],
                "resource_type": "document", "resource_id": document["id"],
                "doc_type": document.get("doc_type"), "chunk_index": i,
                "text_preview": chunk[:300],
            },
        )
        for i, chunk in enumerate(chunks)
    ]
    await upsert_vectors("documents", points)
    logger.info(f"Ingested document {document['id']} ({len(chunks)} chunks)")

async def ingest_issue(issue: dict):
    text = " ".join(filter(None, [
        issue.get("issue_number"), issue.get("title"), issue.get("description"),
        issue.get("discipline"), issue.get("location_name"), issue.get("element_name"),
    ])).strip()
    if not text:
        return
    await upsert_vectors("issues", [PointStruct(
        id=_uid(f"issue:{issue['id']}"),
        vector=embed(text),
        payload={
            "company_id": issue["company_id"], "project_id": issue["project_id"],
            "resource_type": "issue", "resource_id": issue["id"],
            "issue_type": issue.get("issue_type"), "priority": issue.get("priority"),
            "status": issue.get("status"), "text_preview": text[:300],
        },
    )])

async def delete_resource(collection: str, resource_id: str):
    await delete_by_resource(collection, resource_id)
