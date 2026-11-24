from typing import List, Optional
from celery import Celery

from app.config import get_settings
from app.services.pipeline import process_job

settings = get_settings()

celery_app = Celery(
    "cortaflow_worker",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)


@celery_app.task(name="cortaflow.process_job")
def process_job_task(
    job_id: str,
    youtube_url: str,
    user_cut_length: int,
    formats: List[str],
    options_dict: Optional[dict] = None,
    local_source_path: Optional[str] = None,
) -> dict:
    process_job(
        job_id=job_id,
        youtube_url=youtube_url,
        user_cut_length=user_cut_length,
        formats=formats,
        options_dict=options_dict,
        local_source_path=local_source_path,
    )
    return {"job_id": job_id, "status": "done"}
