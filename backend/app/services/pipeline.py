import asyncio
import json
import logging
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from app.config import get_settings
from app.db.database import SessionLocal
from app.db.models import Cut, Job
from app.schemas import PipelineOptions
from app.services.analyzer import (
    detect_high_action,
    loudness_peaks,
    rank_moments,
    scene_changes,
)
from app.services.cutter import FORMAT_SPECS, convert_format, cut_video, extract_thumbnail
from app.services.downloader import download_video, probe_video_metadata
from app.services.storage import StorageService

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Broadcasts live job status updates to connected frontend WebSocket clients."""

    def __init__(self):
        self._connections: Dict[str, List[Any]] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, job_id: str, websocket: Any) -> None:
        await websocket.accept()
        self._connections.setdefault(job_id, []).append(websocket)

    def disconnect(self, job_id: str, websocket: Any) -> None:
        conns = self._connections.get(job_id, [])
        if websocket in conns:
            conns.remove(websocket)
        if not conns and job_id in self._connections:
            del self._connections[job_id]

    async def broadcast(self, job_id: str, payload: dict) -> None:
        conns = list(self._connections.get(job_id, []))
        for ws in conns:
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(job_id, ws)

    def broadcast_threadsafe(self, job_id: str, payload: dict) -> None:
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(job_id, payload), self._loop)


ws_manager = WebSocketManager()


def serialize_cut(cut: Cut, job: Optional[Job] = None) -> dict:
    return {
        "id": cut.id,
        "job_id": cut.job_id,
        "format": cut.format,
        "resolution": cut.resolution,
        "start_time": cut.start_time,
        "duration": cut.duration,
        "score": cut.score,
        "scene_hits": cut.scene_hits,
        "audio_hits": cut.audio_hits,
        "action_hits": cut.action_hits,
        "url": cut.url,
        "thumbnail_url": cut.thumbnail_url,
        "file_size_bytes": cut.file_size_bytes,
        "download_count": cut.download_count,
        "video_title": job.video_title if job else "",
        "source_url": job.youtube_url if job else "",
        "created_at": cut.created_at.isoformat() if cut.created_at else datetime.now(timezone.utc).isoformat(),
    }


def process_job(
    job_id: str,
    youtube_url: str,
    user_cut_length: int,
    formats: List[str],
    options_dict: Optional[dict] = None,
    local_source_path: Optional[str] = None,
    notify: Optional[Callable[[str, dict], None]] = None,
) -> None:
    """
    End-to-end video pipeline:
    1. Download (yt-dlp up to 4K / FFmpeg fallback / uploaded local file)
    2. Scene change detection (OpenCV)
    3. Audio loudness peak detection (FFmpeg + NumPy)
    4. High-action / facial detection (YOLOv5/v8 or OpenCV motion fallback)
    5. Weighted scoring & non-overlapping moment ranking
    6. FFmpeg cutting, format conversion (YouTube, Shorts, Reels, TikTok) & thumbnail generation
    7. Upload to private storage (S3 + presigned URLs or local disk) & persist metadata
    """
    settings = get_settings()
    storage = StorageService()
    options = PipelineOptions(**(options_dict or {}))
    emit = notify or ws_manager.broadcast_threadsafe

    tmp_dir = settings.tmp_path / job_id
    tmp_dir.mkdir(parents=True, exist_ok=True)
    db = SessionLocal()

    def update_job(status: str, progress: int, stage_message: str, **extra) -> None:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return
        job.status = status
        job.progress = progress
        job.stage_message = stage_message
        job.updated_at = datetime.now(timezone.utc)
        for key, value in extra.items():
            setattr(job, key, value)
        db.commit()
        db.refresh(job)
        payload = {
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
        emit(job_id, payload)

    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return

        # Step 1: Retrieve video
        if local_source_path and Path(local_source_path).exists():
            update_job("downloading", 12, "Lendo arquivo enviado e extraindo metadados...")
            duration, _, _ = probe_video_metadata(local_source_path)
            video_path = local_source_path
            video_title = job.video_title or Path(local_source_path).stem
        else:
            update_job("downloading", 10, f"Baixando vídeo em qualidade {options.preferred_quality.upper()}...")
            downloaded = download_video(
                url=youtube_url,
                out_path=str(tmp_dir / "source.mp4"),
                preferred_quality=options.preferred_quality,
                max_duration_seconds=settings.fair_use_max_video_minutes * 60,
            )
            video_path = downloaded.file_path
            video_title = downloaded.title
            duration = downloaded.duration

        update_job(
            "analyzing",
            28,
            "Detectando mudanças de cena (OpenCV)...",
            video_title=video_title,
            video_duration=duration,
        )

        # Step 2: Scene Change Detection
        scene_ts = scene_changes(video_path, threshold=options.scene_threshold)

        # Step 3: Audio Peak Detection
        update_job("analyzing", 45, f"{len(scene_ts)} cenas detectadas. Analisando picos de áudio (dB)...")
        audio_ts = loudness_peaks(video_path, db_threshold=options.audio_db_threshold)

        # Step 4: Action / Facial Detection
        action_ts: List[float] = []
        if options.use_action_detection:
            update_job("analyzing", 60, f"{len(audio_ts)} picos de áudio encontrados. Detectando alta ação...")
            action_ts = detect_high_action(
                video_path,
                frame_interval=settings.default_action_frame_interval,
            )

        # Step 5: Merge & Rank Moments
        max_clips = min(options.max_clips, settings.fair_use_max_clips_per_job)
        update_job("analyzing", 70, "Combinando pontuações e ranqueando os melhores momentos...")
        ranked = rank_moments(
            scene_ts=scene_ts,
            audio_ts=audio_ts,
            action_ts=action_ts,
            cut_length=float(user_cut_length),
            video_duration=duration,
            weight_scene=options.weight_scene,
            weight_audio=options.weight_audio,
            weight_action=options.weight_action,
            max_moments=max_clips,
        )

        moments_payload = [
            {
                "rank": m.rank,
                "timestamp": m.timestamp,
                "start": m.start,
                "end": m.end,
                "score": m.score,
                "scene_hits": m.scene_hits,
                "audio_hits": m.audio_hits,
                "action_hits": m.action_hits,
                "label": m.label,
            }
            for m in ranked
        ]
        update_job(
            "cutting",
            75,
            f"Top {len(ranked)} momentos selecionados. Recortando com FFmpeg...",
            moments_json=json.dumps(moments_payload),
        )

        # Step 6 & 7: Cut, Format Conversion & Upload
        total_ops = max(1, len(ranked) * len(formats))
        done_ops = 0

        for idx, moment in enumerate(ranked):
            base_cut_path = str(tmp_dir / f"cut_{idx}.mp4")
            actual_duration = max(1.0, moment.end - moment.start)
            cut_video(video_path, moment.start, actual_duration, base_cut_path)

            for fmt in formats:
                out_path = str(tmp_dir / f"cut_{idx}_{fmt}.mp4")
                thumb_path = str(tmp_dir / f"cut_{idx}_{fmt}.jpg")
                convert_format(base_cut_path, out_path, fmt)
                try:
                    extract_thumbnail(out_path, thumb_path, at_second=min(1.0, actual_duration / 2))
                except Exception:
                    thumb_path = ""

                cut_id = str(uuid.uuid4())
                video_key = f"jobs/{job_id}/{cut_id}_{fmt}.mp4"
                media_url = storage.upload_file(out_path, video_key, content_type="video/mp4")

                thumb_url = ""
                if thumb_path and Path(thumb_path).exists():
                    thumb_key = f"jobs/{job_id}/{cut_id}_{fmt}.jpg"
                    thumb_url = storage.upload_file(thumb_path, thumb_key, content_type="image/jpeg")

                spec_w, spec_h, max_fmt_dur = FORMAT_SPECS[fmt]
                effective_dur = int(round(min(actual_duration, max_fmt_dur) if max_fmt_dur > 0 else actual_duration))
                size_bytes = Path(out_path).stat().st_size if Path(out_path).exists() else 0

                cut_row = Cut(
                    id=cut_id,
                    job_id=job_id,
                    user_id=job.user_id,
                    format=fmt,
                    resolution=f"{spec_w}x{spec_h}",
                    start_time=moment.start,
                    duration=effective_dur,
                    score=moment.score,
                    scene_hits=moment.scene_hits,
                    audio_hits=moment.audio_hits,
                    action_hits=moment.action_hits,
                    storage_key=video_key,
                    url=media_url,
                    thumbnail_url=thumb_url,
                    file_size_bytes=size_bytes,
                )
                db.add(cut_row)
                db.commit()

                done_ops += 1
                pct = 75 + int((done_ops / total_ops) * 23)
                update_job(
                    "uploading",
                    min(98, pct),
                    f"Exportando corte {done_ops}/{total_ops} ({fmt.upper()})...",
                )

        expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.fair_use_retention_hours)
        update_job(
            "completed",
            100,
            f"Concluído! {done_ops} cortes salvos na sua biblioteca privada.",
            expires_at=expires_at,
        )

    except Exception as exc:
        logger.exception("Job %s failed: %s", job_id, exc)
        update_job(
            "failed",
            100,
            "Ocorreu um erro durante o processamento.",
            error_message=str(exc),
        )
    finally:
        db.close()
        shutil.rmtree(tmp_dir, ignore_errors=True)
        if local_source_path and Path(local_source_path).exists():
            try:
                Path(local_source_path).unlink(missing_ok=True)
            except Exception:
                pass
