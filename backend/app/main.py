import asyncio
import json
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import get_db, init_db
from app.db.models import Cut, Job
from app.schemas import (
    CutOut,
    FairUseStatusOut,
    FormatType,
    JobCreateRequest,
    JobOut,
    MomentOut,
    PipelineOptions,
    ResolutionType,
)
from app.services.cutter import transcode_resolution
from app.services.fair_use import get_fair_use_status
from app.services.pipeline import process_job, serialize_cut, ws_manager
from app.services.storage import StorageService

settings = get_settings()
storage = StorageService()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    ws_manager.set_loop(asyncio.get_running_loop())
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="API de corte automático inteligente de vídeos para YouTube, Shorts, Reels e TikTok.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_user_id(request: Request, x_user_id: Optional[str] = None) -> str:
    if x_user_id and x_user_id.strip():
        return x_user_id.strip()[:120]
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return f"ip:{forwarded.split(',')[0].strip()}"
    client_host = request.client.host if request.client else "anonymous"
    return f"ip:{client_host}"


def _job_to_schema(job: Job) -> JobOut:
    raw_moments = json.loads(job.moments_json or "[]")
    moments = [MomentOut(**m) for m in raw_moments]
    cuts = [
        CutOut(
            id=c.id,
            job_id=c.job_id,
            format=c.format,  # type: ignore[arg-type]
            resolution=c.resolution,
            start_time=c.start_time,
            duration=c.duration,
            score=c.score,
            scene_hits=c.scene_hits,
            audio_hits=c.audio_hits,
            action_hits=c.action_hits,
            url=storage.get_download_url(c.storage_key) if storage.is_s3_enabled else c.url,
            thumbnail_url=c.thumbnail_url,
            file_size_bytes=c.file_size_bytes,
            download_count=c.download_count,
            video_title=job.video_title,
            source_url=job.youtube_url,
            created_at=c.created_at,
        )
        for c in job.cuts
    ]
    return JobOut(
        job_id=job.id,
        youtube_url=job.youtube_url,
        video_title=job.video_title,
        video_duration=job.video_duration,
        cut_length=job.cut_length,
        formats=json.loads(job.formats or "[]"),
        status=job.status,
        progress=job.progress,
        stage_message=job.stage_message,
        error_message=job.error_message,
        moments=moments,
        cuts=cuts,
        created_at=job.created_at,
        updated_at=job.updated_at,
        expires_at=job.expires_at,
    )


def _dispatch_job(
    background_tasks: BackgroundTasks,
    job_id: str,
    youtube_url: str,
    cut_length: int,
    formats: List[str],
    options_dict: dict,
    local_source_path: Optional[str] = None,
) -> None:
    if settings.use_celery:
        from app.workers.celery_app import process_job_task

        process_job_task.delay(
            job_id,
            youtube_url,
            cut_length,
            formats,
            options_dict,
            local_source_path,
        )
    else:
        background_tasks.add_task(
            process_job,
            job_id,
            youtube_url,
            cut_length,
            formats,
            options_dict,
            local_source_path,
        )


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": settings.app_name,
        "storage": "s3" if storage.is_s3_enabled else "local",
        "worker": "celery" if settings.use_celery else "fastapi-background",
        "yolo_enabled": settings.enable_yolo,
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
    }


@app.get("/api/fair-use", response_model=FairUseStatusOut)
def fair_use_status(
    request: Request,
    x_user_id: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _resolve_user_id(request, x_user_id)
    return get_fair_use_status(db, user_id)


@app.post("/api/jobs", response_model=JobOut, status_code=202)
def create_job(
    payload: JobCreateRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    x_user_id: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _resolve_user_id(request, x_user_id)
    fair_use = get_fair_use_status(db, user_id)
    if not fair_use.can_submit:
        raise HTTPException(status_code=429, detail=fair_use.notice)

    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        user_id=user_id,
        youtube_url=payload.url,
        cut_length=payload.cut_length,
        formats=json.dumps(payload.formats),
        status="queued",
        progress=2,
        stage_message="Job na fila. Preparando pipeline de download...",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    _dispatch_job(
        background_tasks=background_tasks,
        job_id=job_id,
        youtube_url=payload.url,
        cut_length=payload.cut_length,
        formats=list(payload.formats),
        options_dict=payload.options.model_dump(),
    )
    return _job_to_schema(job)


@app.post("/api/jobs/upload", response_model=JobOut, status_code=202)
async def create_job_from_upload(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...),
    cut_length: int = Form(default=15, ge=5, le=180),
    formats: str = Form(default='["youtube","shorts"]'),
    options_json: str = Form(default="{}"),
    x_user_id: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _resolve_user_id(request, x_user_id)
    fair_use = get_fair_use_status(db, user_id)
    if not fair_use.can_submit:
        raise HTTPException(status_code=429, detail=fair_use.notice)

    try:
        parsed_formats = json.loads(formats)
        if not isinstance(parsed_formats, list) or not parsed_formats:
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="Lista de formatos inválida.")

    try:
        options = PipelineOptions(**json.loads(options_json or "{}"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Opções inválidas: {exc}")

    job_id = str(uuid.uuid4())
    upload_dir = settings.tmp_path / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_suffix = Path(file.filename or "video.mp4").suffix or ".mp4"
    dest_path = upload_dir / f"{job_id}{safe_suffix}"

    max_bytes = settings.fair_use_max_upload_mb * 1024 * 1024
    written = 0
    with dest_path.open("wb") as out_f:
        while chunk := await file.read(1024 * 1024):
            written += len(chunk)
            if written > max_bytes:
                out_f.close()
                dest_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"Arquivo excede o limite Fair-Use de {settings.fair_use_max_upload_mb} MB.",
                )
            out_f.write(chunk)

    title = Path(file.filename or "Upload Local").stem
    job = Job(
        id=job_id,
        user_id=user_id,
        youtube_url=f"upload://{file.filename or 'video.mp4'}",
        video_title=title,
        cut_length=cut_length,
        formats=json.dumps(parsed_formats),
        status="queued",
        progress=5,
        stage_message="Upload concluído. Iniciando análise...",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    _dispatch_job(
        background_tasks=background_tasks,
        job_id=job_id,
        youtube_url=job.youtube_url,
        cut_length=cut_length,
        formats=parsed_formats,
        options_dict=options.model_dump(),
        local_source_path=str(dest_path),
    )
    return _job_to_schema(job)


@app.get("/api/jobs", response_model=List[JobOut])
def list_jobs(
    request: Request,
    limit: int = Query(default=25, ge=1, le=100),
    x_user_id: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _resolve_user_id(request, x_user_id)
    jobs = (
        db.query(Job)
        .filter(Job.user_id == user_id)
        .order_by(Job.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_job_to_schema(j) for j in jobs]


@app.get("/api/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado.")
    return _job_to_schema(job)


@app.delete("/api/jobs/{job_id}")
def delete_job(
    job_id: str,
    request: Request,
    x_user_id: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _resolve_user_id(request, x_user_id)
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == user_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado.")

    for cut in job.cuts:
        storage.delete_object(cut.storage_key)
    db.delete(job)
    db.commit()
    return {"deleted": True, "job_id": job_id}


@app.get("/api/library", response_model=List[CutOut])
def get_private_library(
    request: Request,
    fmt: Optional[FormatType] = Query(default=None, alias="format"),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    x_user_id: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id = _resolve_user_id(request, x_user_id)
    query = db.query(Cut).join(Job).filter(Cut.user_id == user_id)
    if fmt:
        query = query.filter(Cut.format == fmt)
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter((Job.video_title.ilike(term)) | (Job.youtube_url.ilike(term)))

    cuts = query.order_by(Cut.created_at.desc()).limit(limit).all()
    results = []
    for c in cuts:
        job = c.job
        results.append(
            CutOut(
                id=c.id,
                job_id=c.job_id,
                format=c.format,  # type: ignore[arg-type]
                resolution=c.resolution,
                start_time=c.start_time,
                duration=c.duration,
                score=c.score,
                scene_hits=c.scene_hits,
                audio_hits=c.audio_hits,
                action_hits=c.action_hits,
                url=storage.get_download_url(c.storage_key) if storage.is_s3_enabled else c.url,
                thumbnail_url=c.thumbnail_url,
                file_size_bytes=c.file_size_bytes,
                download_count=c.download_count,
                video_title=job.video_title if job else "",
                source_url=job.youtube_url if job else "",
                created_at=c.created_at,
            )
        )
    return results


@app.get("/api/cuts/{cut_id}/download")
def download_cut(
    cut_id: str,
    resolution: ResolutionType = Query(default="original"),
    db: Session = Depends(get_db),
):
    cut = db.query(Cut).filter(Cut.id == cut_id).first()
    if not cut:
        raise HTTPException(status_code=404, detail="Corte não encontrado.")

    cut.download_count += 1
    db.commit()

    # Direct S3/CloudFront download for original resolution
    if resolution == "original" and storage.is_s3_enabled:
        return RedirectResponse(url=storage.get_download_url(cut.storage_key))

    local_path = storage.resolve_local_path(cut.storage_key)
    if not local_path or not local_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo do corte não disponível no armazenamento.")

    filename = f"cortaflow_{cut.format}_{cut.id[:8]}_{resolution}.mp4"
    if resolution == "original":
        return FileResponse(path=str(local_path), media_type="video/mp4", filename=filename)

    export_cache = settings.tmp_path / "exports" / f"{cut.id}_{resolution}.mp4"
    if not export_cache.exists():
        transcode_resolution(str(local_path), str(export_cache), resolution)

    return FileResponse(path=str(export_cache), media_type="video/mp4", filename=filename)


@app.get("/api/media/{media_path:path}")
def serve_local_media(media_path: str):
    local_path = storage.resolve_local_path(media_path)
    if not local_path or not local_path.exists():
        raise HTTPException(status_code=404, detail="Mídia não encontrada.")
    media_type = "image/jpeg" if local_path.suffix.lower() in {".jpg", ".jpeg"} else "video/mp4"
    return FileResponse(path=str(local_path), media_type=media_type)


@app.websocket("/ws/{job_id}")
async def job_websocket(websocket: WebSocket, job_id: str):
    await ws_manager.connect(job_id, websocket)
    db = SessionLocal()
    try:
        # Send immediate snapshot upon connection
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            await websocket.send_json(
                {
                    "job_id": job.id,
                    "status": job.status,
                    "progress": job.progress,
                    "stage_message": job.stage_message,
                    "video_title": job.video_title,
                    "video_duration": job.video_duration,
                    "error_message": job.error_message,
                    "moments": json.loads(job.moments_json or "[]"),
                    "cuts": [serialize_cut(c, job) for c in job.cuts],
                }
            )
        while True:
            # Keep alive; client may send ping messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(job_id, websocket)
    finally:
        db.close()


# Serve built React frontend in single-container production deploys (Docker / Render / Railway)
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Not found")
        target = FRONTEND_DIST / full_path
        if full_path and target.exists() and target.is_file():
            return FileResponse(str(target))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
