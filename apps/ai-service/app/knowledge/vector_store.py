import logging
import uuid
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue, HnswConfigDiff,
)
from app.config import settings

logger = logging.getLogger(__name__)
VECTOR_SIZE = 384
COLLECTIONS = ["captures", "documents", "issues", "timeline", "bim_elements"]
_client = None

def get_client():
    global _client
    if _client is None:
        _client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key or None,
        )
    return _client

async def init_collections():
    client = get_client()
    for name in COLLECTIONS:
        try:
            await client.get_collection(name)
            logger.info(f"Collection {name!r} exists")
        except Exception:
            await client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
                hnsw_config=HnswConfigDiff(m=16, ef_construct=200),
            )
            logger.info(f"Collection {name!r} created")

async def upsert_vectors(collection: str, points: list):
    await get_client().upsert(collection_name=collection, points=points, wait=True)

async def search_vectors(collection, query_vector, company_id, project_id=None, limit=10, score_threshold=0.35):
    must = [FieldCondition(key="company_id", match=MatchValue(value=company_id))]
    if project_id:
        must.append(FieldCondition(key="project_id", match=MatchValue(value=project_id)))
    # AsyncQdrantClient.search() was removed in qdrant-client 1.19 in favor of
    # query_points(), which wraps results in a QueryResponse (.points) instead
    # of returning the list directly. Confirmed by hand: the old .search()
    # call raised AttributeError, which the /assistant endpoint's
    # asyncio.gather(..., return_exceptions=True) silently swallowed per
    # collection -- surfacing as an empty "no context found" answer instead
    # of a visible error.
    response = await get_client().query_points(
        collection_name=collection,
        query=query_vector,
        query_filter=Filter(must=must),
        limit=limit,
        score_threshold=score_threshold,
        with_payload=True,
    )
    return [{"id": str(r.id), "score": r.score, "payload": r.payload} for r in response.points]

async def delete_by_resource(collection: str, resource_id: str):
    await get_client().delete(
        collection_name=collection,
        points_selector=Filter(must=[FieldCondition(key="resource_id", match=MatchValue(value=resource_id))]),
    )
