from functools import lru_cache
from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "CortaFlow API"
    app_env: str = "production"
    debug: bool = False
    cors_origins: str = "*"
    public_base_url: str = ""

    # Database: defaults to zero-config SQLite; set postgresql://... for production
    database_url: str = "sqlite:///./storage/cortaflow.db"

    # Local storage & temporary workspace
    storage_dir: str = "./storage"
    tmp_dir: str = "/tmp/cortaflow"

    # Optional S3 / Cloudflare R2 / MinIO + CloudFront CDN
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    s3_endpoint_url: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    cloudfront_domain: str = ""
    signed_url_ttl_seconds: int = 3600

    # Optional Celery + Redis distributed worker
    use_celery: bool = False
    redis_url: str = "redis://redis:6379/0"

    # Analysis pipeline defaults
    enable_yolo: bool = False
    yolo_model: str = "yolov8n.pt"
    default_scene_threshold: float = 30.0
    default_audio_db_threshold: float = -20.0
    default_action_frame_interval: int = 30

    # Optional yt-dlp cookies file path (e.g., Render Secret File /etc/secrets/cookies.txt)
    ytdlp_cookies_file: str = ""

    # Fair-Use Policy (Unlimited Free Tier with cost-management safeguards)
    fair_use_max_concurrent_jobs: int = 2
    fair_use_soft_daily_limit: int = 20
    fair_use_cooldown_seconds: int = 10
    fair_use_max_clips_per_job: int = 50
    fair_use_max_video_minutes: int = 120
    fair_use_retention_hours: int = 72
    fair_use_max_upload_mb: int = 500

    @property
    def cors_origin_list(self) -> List[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def storage_path(self) -> Path:
        path = Path(self.storage_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def tmp_path(self) -> Path:
        path = Path(self.tmp_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()
