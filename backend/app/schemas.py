from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, Field, field_validator


FormatType = Literal["youtube", "shorts", "reels", "tiktok"]
ResolutionType = Literal["original", "4k", "1080p", "720p", "480p"]


class PipelineOptions(BaseModel):
    scene_threshold: float = Field(default=30.0, ge=5.0, le=90.0)
    audio_db_threshold: float = Field(default=-20.0, ge=-50.0, le=-1.0)
    use_action_detection: bool = True
    weight_scene: float = Field(default=2.0, ge=0.0, le=10.0)
    weight_audio: float = Field(default=3.0, ge=0.0, le=10.0)
    weight_action: float = Field(default=4.0, ge=0.0, le=10.0)
    max_clips: int = Field(default=10, ge=1, le=50)
    preferred_quality: ResolutionType = "1080p"


class JobCreateRequest(BaseModel):
    url: str = Field(..., min_length=5, max_length=2048)
    cut_length: int = Field(default=15, ge=5, le=180, alias="cutLength")
    formats: List[FormatType] = Field(default_factory=lambda: ["youtube", "shorts"])
    options: PipelineOptions = Field(default_factory=PipelineOptions)

    model_config = {"populate_by_name": True}

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not (cleaned.startswith("http://") or cleaned.startswith("https://")):
            raise ValueError("A URL deve começar com http:// ou https://")
        return cleaned

    @field_validator("formats")
    @classmethod
    def validate_formats(cls, value: List[FormatType]) -> List[FormatType]:
        if not value:
            raise ValueError("Selecione pelo menos um formato de saída.")
        # Preserve order while deduplicating
        return list(dict.fromkeys(value))


class MomentOut(BaseModel):
    rank: int
    timestamp: float
    start: float
    end: float
    score: float
    scene_hits: int = 0
    audio_hits: int = 0
    action_hits: int = 0
    label: str = ""


class CutOut(BaseModel):
    id: str
    job_id: str
    format: FormatType
    resolution: str
    start_time: float
    duration: int
    score: float
    scene_hits: int
    audio_hits: int
    action_hits: int
    url: str
    thumbnail_url: str = ""
    file_size_bytes: int = 0
    download_count: int = 0
    video_title: str = ""
    source_url: str = ""
    created_at: datetime


class JobOut(BaseModel):
    job_id: str
    youtube_url: str
    video_title: str
    video_duration: float
    cut_length: int
    formats: List[str]
    status: str
    progress: int
    stage_message: str
    error_message: str = ""
    moments: List[MomentOut] = Field(default_factory=list)
    cuts: List[CutOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    expires_at: Optional[datetime] = None


class FairUseStatusOut(BaseModel):
    tier: str = "Gratuito Ilimitado (Fair-Use)"
    active_jobs: int
    max_concurrent_jobs: int
    jobs_last_24h: int
    soft_daily_limit: int
    priority_tier: str
    cooldown_seconds: int
    max_clips_per_job: int
    max_video_minutes: int
    retention_hours: int
    can_submit: bool
    notice: str = ""
