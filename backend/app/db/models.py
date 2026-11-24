import uuid
from datetime import datetime, timezone
from sqlalchemy import BigInteger, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(128), nullable=False, default="anonymous", index=True)
    youtube_url = Column(Text, nullable=False)
    video_title = Column(Text, nullable=False, default="")
    video_duration = Column(Float, nullable=False, default=0.0)
    cut_length = Column(Integer, nullable=False, default=15)
    formats = Column(Text, nullable=False, default='["youtube","shorts"]')
    status = Column(String(32), nullable=False, default="queued", index=True)
    progress = Column(Integer, nullable=False, default=0)
    stage_message = Column(Text, nullable=False, default="Na fila de processamento")
    error_message = Column(Text, nullable=False, default="")
    moments_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    cuts = relationship("Cut", back_populates="job", cascade="all, delete-orphan")


class Cut(Base):
    __tablename__ = "cuts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id = Column(String(36), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(128), nullable=False, default="anonymous", index=True)
    format = Column(String(32), nullable=False, index=True)
    resolution = Column(String(32), nullable=False, default="1080p")
    start_time = Column(Float, nullable=False, default=0.0)
    duration = Column(Integer, nullable=False, default=15)
    score = Column(Float, nullable=False, default=0.0)
    scene_hits = Column(Integer, nullable=False, default=0)
    audio_hits = Column(Integer, nullable=False, default=0)
    action_hits = Column(Integer, nullable=False, default=0)
    storage_key = Column(Text, nullable=False)
    url = Column(Text, nullable=False)
    thumbnail_url = Column(Text, nullable=False, default="")
    file_size_bytes = Column(BigInteger, nullable=False, default=0)
    download_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)

    job = relationship("Job", back_populates="cuts")
