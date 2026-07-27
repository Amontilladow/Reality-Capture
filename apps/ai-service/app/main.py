from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
from app.config import settings
from app.routers import search, assistant, progress, change_detection, reports, ingest
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

app.include_router(search.router,           prefix="/search",           tags=["search"])
app.include_router(assistant.router,        prefix="/assistant",        tags=["assistant"])
app.include_router(progress.router,         prefix="/progress",         tags=["progress"])
app.include_router(change_detection.router, prefix="/change-detection", tags=["change-detection"])
app.include_router(reports.router,          prefix="/report",           tags=["reports"])
app.include_router(ingest.router,           prefix="/ingest",           tags=["ingestion"])

@app.on_event("startup")
async def startup():
    logger.info("Initialising Qdrant collections...")
    await init_collections()
    logger.info("AI Service ready")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-service", "version": "1.1.0"}
