import logging
from functools import lru_cache
from app.config import settings

logger = logging.getLogger(__name__)

@lru_cache(maxsize=1)
def _get_model():
    from sentence_transformers import SentenceTransformer
    logger.info(f"Loading embedding model: {settings.embedding_model}")
    return SentenceTransformer(settings.embedding_model)

def embed(text: str) -> list:
    if not text or not text.strip():
        return [0.0] * 384
    return _get_model().encode(text, normalize_embeddings=True).tolist()

def embed_batch(texts: list) -> list:
    return _get_model().encode(texts, normalize_embeddings=True, batch_size=32).tolist()
