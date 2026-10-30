from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Same shared secret as engineeringos-api (the only legitimate caller).
    # Unset fails closed: every request is rejected.
    internal_service_secret: str = ""
    # The conversion engine (tools/evacuation-3d) and the interpreter that runs it.
    engine_dir: str = "/opt/evac3d-engine"
    engine_python: str = "python3"
    work_dir: str = "/tmp/evac3d-jobs"
    # Limits for one conversion batch.
    max_files: int = 40
    max_file_mb: int = 60
    max_logo_mb: int = 10
    job_timeout_s: int = 3 * 60 * 60
    # Finished jobs are deleted after this long if the API never collected them.
    keep_finished_s: int = 24 * 60 * 60


settings = Settings()
