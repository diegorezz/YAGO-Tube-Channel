import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlparse

import yt_dlp

logger = logging.getLogger(__name__)

DIRECT_VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".ts", ".avi"}


@dataclass
class DownloadedVideo:
    file_path: str
    title: str
    duration: float
    width: int
    height: int
    source_type: str


def is_direct_media_url(url: str) -> bool:
    parsed = urlparse(url)
    path_lower = parsed.path.lower()
    return any(path_lower.endswith(ext) for ext in DIRECT_VIDEO_EXTENSIONS)


def probe_video_metadata(video_path: str) -> tuple[float, int, int]:
    """Use ffprobe to retrieve duration, width, and height accurately."""
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        video_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        info = json.loads(result.stdout)
        duration = float(info.get("format", {}).get("duration", 0.0) or 0.0)
        width, height = 1920, 1080
        for stream in info.get("streams", []):
            if stream.get("codec_type") == "video":
                width = int(stream.get("width", 1920) or 1920)
                height = int(stream.get("height", 1080) or 1080)
                if duration <= 0 and stream.get("duration"):
                    duration = float(stream["duration"])
                break
        return duration, width, height
    except Exception as exc:
        logger.warning("ffprobe failed for %s: %s", video_path, exc)
        return 0.0, 1920, 1080


def download_generic_url(url: str, out_path: str) -> DownloadedVideo:
    """Download non-YouTube direct video URL using FFmpeg stream copy."""
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        url,
        "-c",
        "copy",
        "-movflags",
        "faststart",
        out_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    duration, width, height = probe_video_metadata(out_path)
    title = Path(urlparse(url).path).stem or "Vídeo Externo"
    return DownloadedVideo(
        file_path=out_path,
        title=title,
        duration=duration,
        width=width,
        height=height,
        source_type="direct",
    )


def download_video(
    url: str,
    out_path: str,
    preferred_quality: str = "1080p",
    max_duration_seconds: Optional[int] = None,
    progress_hook: Optional[Callable[[float], None]] = None,
) -> DownloadedVideo:
    """
    Download a YouTube (or yt-dlp supported) video up to 4K, or fall back to
    FFmpeg direct stream pull for generic media URLs.
    """
    if is_direct_media_url(url):
        return download_generic_url(url, out_path)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    base_stem = str(Path(out_path).with_suffix(""))

    # Map quality preference to yt-dlp format selector (4K when requested/original)
    quality_selectors = {
        "original": "bestvideo+bestaudio/best",
        "4k": "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best",
        "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "480p": "bestvideo[height<=480]+bestaudio/best[height<=480]/best",
    }
    fmt_selector = quality_selectors.get(preferred_quality, "bestvideo+bestaudio/best")

    def _hook(d: dict):
        if progress_hook and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            if total > 0:
                progress_hook(min(1.0, downloaded / total))

    ydl_opts = {
        "format": fmt_selector,
        "outtmpl": f"{base_stem}.%(ext)s",
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "progress_hooks": [_hook],
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            duration = float(info.get("duration") or 0.0)
            if max_duration_seconds and duration > max_duration_seconds:
                raise ValueError(
                    f"Vídeo excede o limite Fair-Use de {max_duration_seconds // 60} minutos "
                    f"(duração detectada: {int(duration // 60)} min)."
                )
            info = ydl.extract_info(url, download=True)
            title = str(info.get("title") or "Vídeo YouTube")

        # Locate resulting mp4 (or fallback extension)
        final_path = Path(f"{base_stem}.mp4")
        if not final_path.exists():
            matches = list(Path(out_path).parent.glob(f"{Path(base_stem).name}.*"))
            if not matches:
                raise FileNotFoundError("Arquivo de vídeo baixado não encontrado.")
            final_path = matches[0]

        probed_duration, width, height = probe_video_metadata(str(final_path))
        return DownloadedVideo(
            file_path=str(final_path),
            title=title,
            duration=probed_duration or duration,
            width=width,
            height=height,
            source_type="yt-dlp",
        )
    except ValueError:
        raise
    except Exception as exc:
        logger.warning("yt-dlp failed for %s (%s), trying direct FFmpeg fallback", url, exc)
        try:
            return download_generic_url(url, out_path)
        except Exception:
            raise RuntimeError(f"Falha ao baixar vídeo da URL informada: {exc}") from exc
