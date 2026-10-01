import hmac
import logging

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import search, assistant, progress, change_detection, reports, ingest, risk
from app.knowledge.vector_store import init_collections

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="EngineeringOS AI Service",
    description="Knowledge layer and RAG pipeline for the Reality Capture Module",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# This service has no identity/tenant checks of its own -- every router trusts
# whatever company_id/project_id a caller supplies. The only thing standing
# between that and cross-tenant data access used to be network placement
# (Render private service, docker-compose internal network), and an audit
# found a real path where that placement wasn't actually enforced
# (docker-compose.prod.yml published this service's port to the host).
# This dependency makes apps/api (the only legitimate caller) prove its
# identity with a shared secret on every request, independent of network
# topology. An unset secret fails closed -- every request is rejected --
# rather than silently running unauthenticated.
async def require_service_auth(x_internal_service_secret: str = Header(default="")) -> None:
    expected = settings.internal_service_secret
    if not expected or not hmac.compare_digest(x_internal_service_secret, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


_auth = [Depends(require_service_auth)]

app.include_router(search.router,           prefix="/search",           tags=["search"],        dependencies=_auth)
app.include_router(assistant.router,        prefix="/assistant",        tags=["assistant"],      dependencies=_auth)
app.include_router(progress.router,         prefix="/progress",         tags=["progress"],       dependencies=_auth)
app.include_router(change_detection.router, prefix="/change-detection", tags=["change-detection"], dependencies=_auth)
app.include_router(reports.router,          prefix="/report",           tags=["reports"],        dependencies=_auth)
app.include_router(ingest.router,           prefix="/ingest",           tags=["ingestion"],      dependencies=_auth)
app.include_router(risk.router,             prefix="/risk",             tags=["risk"],           dependencies=_auth)

@app.on_event("startup")
async def startup():
    logger.info("Initialising Qdrant collections...")
    await init_collections()
    logger.info("AI Service ready")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-service", "version": "1.1.0"}
