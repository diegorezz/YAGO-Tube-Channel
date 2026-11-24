from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Job
from app.schemas import FairUseStatusOut

ACTIVE_STATUSES = {"queued", "downloading", "analyzing", "cutting", "uploading"}


def get_fair_use_status(db: Session, user_id: str) -> FairUseStatusOut:
    """
    Evaluate Fair-Use policy for the Unlimited Free Tier:
    - Never hard-blocks total usage, instead manages compute cost through:
      1. Concurrency limit per user/IP
      2. Short submission cooldown
      3. Soft daily priority tiering (Normal -> Econômica after soft daily threshold)
      4. Max clips per job & automatic storage retention TTL
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    active_jobs = (
        db.query(Job)
        .filter(Job.user_id == user_id, Job.status.in_(ACTIVE_STATUSES))
        .count()
    )

    jobs_24h = (
        db.query(Job)
        .filter(Job.user_id == user_id, Job.created_at >= since_24h)
        .count()
    )

    latest_job = (
        db.query(Job)
        .filter(Job.user_id == user_id)
        .order_by(Job.created_at.desc())
        .first()
    )

    cooldown_remaining = 0
    if latest_job and latest_job.created_at:
        created = latest_job.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        elapsed = (now - created).total_seconds()
        if elapsed < settings.fair_use_cooldown_seconds:
            cooldown_remaining = int(settings.fair_use_cooldown_seconds - elapsed) + 1

    priority_tier = (
        "Prioridade Padrão"
        if jobs_24h < settings.fair_use_soft_daily_limit
        else "Fila Econômica (Fair-Use)"
    )

    can_submit = True
    notice = "Plano gratuito ilimitado ativo com gerenciamento automático de recursos."

    if active_jobs >= settings.fair_use_max_concurrent_jobs:
        can_submit = False
        notice = (
            f"Limite simultâneo atingido ({active_jobs}/{settings.fair_use_max_concurrent_jobs}). "
            "Aguarde a conclusão de um job em andamento para iniciar o próximo."
        )
    elif cooldown_remaining > 0:
        can_submit = False
        notice = f"Aguarde {cooldown_remaining}s antes de enviar outro vídeo (proteção anti-rajada Fair-Use)."
    elif jobs_24h >= settings.fair_use_soft_daily_limit:
        notice = (
            "Uso intenso nas últimas 24h detectado. Seus cortes continuam ilimitados e gratuitos "
            "na fila de prioridade econômica."
        )

    return FairUseStatusOut(
        active_jobs=active_jobs,
        max_concurrent_jobs=settings.fair_use_max_concurrent_jobs,
        jobs_last_24h=jobs_24h,
        soft_daily_limit=settings.fair_use_soft_daily_limit,
        priority_tier=priority_tier,
        cooldown_seconds=cooldown_remaining,
        max_clips_per_job=settings.fair_use_max_clips_per_job,
        max_video_minutes=settings.fair_use_max_video_minutes,
        retention_hours=settings.fair_use_retention_hours,
        can_submit=can_submit,
        notice=notice,
    )
