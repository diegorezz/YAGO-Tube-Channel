import subprocess
from pathlib import Path
from typing import Dict, Tuple

# Blueprint target resolutions (width, height, max_duration)
FORMAT_SPECS: Dict[str, Tuple[int, int, int]] = {
    "youtube": (1920, 1080, 0),   # 16:9 Full HD, unlimited duration
    "shorts": (1920, 1920, 60),   # 1:1 Square, <= 60s
    "reels": (1080, 1920, 60),    # 9:16 Portrait, <= 60s
    "tiktok": (1080, 1920, 60),   # 9:16 Portrait, <= 60s
}

RESOLUTION_HEIGHTS: Dict[str, int] = {
    "4k": 2160,
    "1080p": 1080,
    "720p": 720,
    "480p": 480,
}


def cut_video(input_path: str, start: float, duration: float, output_path: str) -> str:
    """Slice a segment from input video using FFmpeg fast seek and faststart MP4 flags."""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{max(0.0, start):.2f}",
        "-i",
        input_path,
        "-t",
        f"{max(1.0, duration):.2f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return output_path


def convert_format(input_path: str, output_path: str, fmt: str) -> str:
    """
    Convert a cut to target social media format (YouTube 16:9, Shorts 1:1, Reels/TikTok 9:16).
    Uses center crop + scale to fill the frame cleanly without awkward stretching.
    """
    if fmt not in FORMAT_SPECS:
        raise ValueError(f"Formato não suportado: {fmt}")

    width, height, max_dur = FORMAT_SPECS[fmt]
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Smart scale + center crop filter preserving aspect ratio
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},setsar=1"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
    ]
    if max_dur > 0:
        cmd.extend(["-t", str(max_dur)])

    cmd.extend(
        [
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            output_path,
        ]
    )
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return output_path


def cut_and_convert(
    input_path: str,
    start: float,
    duration: float,
    output_path: str,
    fmt: str,
) -> str:
    """
    Single-pass fast seek + cut + aspect-ratio conversion (YouTube, Shorts, Reels, TikTok).
    Avoids double H.264 encoding for 3x faster throughput and lower RAM on constrained CPUs.
    """
    if fmt not in FORMAT_SPECS:
        raise ValueError(f"Formato não suportado: {fmt}")

    width, height, max_dur = FORMAT_SPECS[fmt]
    effective_dur = min(duration, float(max_dur)) if max_dur > 0 else duration
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},setsar=1"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{max(0.0, start):.2f}",
        "-i",
        input_path,
        "-t",
        f"{max(1.0, effective_dur):.2f}",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-threads",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return output_path


def transcode_resolution(input_path: str, output_path: str, resolution: str) -> str:
    """On-demand resolution export (4K, 1080p, 720p, 480p) preserving aspect ratio."""
    target_h = RESOLUTION_HEIGHTS.get(resolution)
    if not target_h:
        return input_path

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    vf = f"scale=-2:{target_h}:flags=lanczos"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "21",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return output_path


def extract_thumbnail(video_path: str, output_jpg: str, at_second: float = 1.0) -> str:
    """Generate a crisp JPEG preview frame for the private library."""
    Path(output_jpg).parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{max(0.0, at_second):.2f}",
        "-i",
        video_path,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        output_jpg,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return output_jpg
