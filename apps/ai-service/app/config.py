from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    port: int = 8001
    database_url: str = "postgresql://postgres:postgres@localhost:5432/engineeringos"
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    ollama_url: str = "http://localhost:11434"
    omniroute_base_url: str = "http://localhost:20128/v1"
    omniroute_model: str = "auto/best-coding"
    default_llm_provider: str = "anthropic"
    embedding_model: str = "all-MiniLM-L6-v2"
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_bucket: str = "engineeringos"

    # Shared secret that apps/api must present (via the X-Internal-Service-Secret
    # header) on every request. This service has no auth of its own otherwise and
    # trusts whatever company_id/project_id a caller supplies -- network placement
    # (Render private service, docker-compose internal network) was the only prior
    # boundary, and the repo's own docker-compose.prod.yml showed that isn't
    # reliable. Left empty by default so the service fails closed (rejects every
    # request) until an operator explicitly sets it, rather than silently running
    # unauthenticated.
    internal_service_secret: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
