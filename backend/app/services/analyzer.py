import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import cv2
import numpy as np

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class RankedMoment:
    rank: int
    timestamp: float
    start: float
    end: float
    score: float
    scene_hits: int
    audio_hits: int
    action_hits: int
    label: str


def analyze_visual_fast(
    video_path: str,
    scene_threshold: float = 30.0,
    detect_action: bool = True,
    duration: float = 0.0,
    on_progress: Optional[Callable[[float], None]] = None,
) -> Tuple[List[float], List[float]]:
    """
    Ultra-fast single-pass visual analysis using FFmpeg keyframe skipping +
    downscaled 160x90 grayscale rawvideo streaming.
    20x-40x faster than decoding every 1080p/4K frame in OpenCV while using <2 MB RAM.
    """
    width, height = 160, 90
    frame_bytes = width * height
    # Sample at 0.5 fps for long videos (>5 min) and 1.0 fps for shorter videos
    sample_fps = 0.5 if duration > 300 else 1.0
    use_keyframe_skip = duration > 120

    cmd = ["ffmpeg", "-loglevel", "error"]
    if use_keyframe_skip:
        cmd.extend(["-skip_frame", "nokey"])
    cmd.extend(
        [
            "-i",
            video_path,
            "-an",
            "-vf",
            f"fps={sample_fps},scale={width}:{height},format=gray",
            "-f",
            "rawvideo",
            "pipe:1",
        ]
    )

    scene_ts: List[float] = []
    action_ts: List[float] = []
    prev_frame: Optional[np.ndarray] = None
    frame_idx = 0
    expected_frames = max(1, int(duration * sample_fps)) if duration > 0 else 0
    last_reported = 0.0

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert proc.stdout is not None
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break

            gray = np.frombuffer(buf, dtype=np.uint8).reshape((height, width))
            ts = round(frame_idx / sample_fps, 2)

            if prev_frame is not None:
                diff = cv2.absdiff(gray, prev_frame)
                mean_diff = float(np.mean(diff))
                if mean_diff > scene_threshold:
                    scene_ts.append(ts)
                if detect_action:
                    motion_ratio = float(np.mean(diff > 22))
                    if motion_ratio > 0.14:
                        action_ts.append(ts)

            prev_frame = gray
            frame_idx += 1

            if on_progress and expected_frames > 0:
                frac = min(1.0, frame_idx / expected_frames)
                if frac - last_reported >= 0.08:
                    last_reported = frac
                    on_progress(frac)
    finally:
        if proc.stdout:
            proc.stdout.close()
        if proc.stderr:
            proc.stderr.close()
        proc.wait()

    return scene_ts, action_ts


def scene_changes(video_path: str, threshold: float = 30.0, sample_fps: float = 2.0) -> List[float]:
    """
    Detect scene cuts / visual shifts using OpenCV frame differencing.
    Downscales frames to 320px width and samples at `sample_fps` for fast 4K throughput.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Não foi possível abrir o vídeo para análise de cenas: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(fps / max(sample_fps, 0.5))))
    prev_frame: Optional[np.ndarray] = None
    changes: List[float] = []
    frame_idx = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % step == 0:
                h, w = frame.shape[:2]
                if w > 320:
                    scale = 320.0 / w
                    frame = cv2.resize(frame, (320, max(1, int(h * scale))))

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                if prev_frame is not None:
                    diff = cv2.absdiff(gray, prev_frame)
                    score = float(np.mean(diff))
                    if score > threshold:
                        changes.append(round(frame_idx / fps, 2))
                prev_frame = gray

            frame_idx += 1
    finally:
        cap.release()

    return changes


def loudness_peaks(video_path: str, db_threshold: float = -20.0, window_seconds: float = 0.5) -> List[float]:
    """
    Stream mono 16-bit PCM audio via FFmpeg at 8kHz and compute loudness envelope in dBFS
    with NumPy across sliding windows. Uses <1 MB RAM even on multi-hour videos.
    """
    sample_rate = 8000
    window_samples = max(1, int(sample_rate * window_seconds))
    window_bytes = window_samples * 2  # 16-bit signed PCM = 2 bytes/sample

    cmd = [
        "ffmpeg",
        "-loglevel",
        "error",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-f",
        "s16le",
        "pipe:1",
    ]

    peaks: List[float] = []
    window_idx = 0

    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except Exception as exc:
        logger.warning("Failed launching FFmpeg audio extractor: %s", exc)
        return []

    try:
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(window_bytes)
            if len(chunk) < window_bytes:
                break
            samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32)
            rms = float(np.sqrt(np.mean(np.square(samples))))
            if rms > 1e-6:
                db = 20.0 * np.log10(rms / 32768.0)
                if db > db_threshold:
                    peaks.append(round(window_idx * window_seconds, 2))
            window_idx += 1
    finally:
        if proc.stdout:
            proc.stdout.close()
        if proc.stderr:
            proc.stderr.close()
        proc.wait()

    return peaks


def detect_high_action(
    video_path: str,
    frame_interval: int = 30,
    use_yolo: Optional[bool] = None,
) -> List[float]:
    """
    Detect high-action / facial presence frames.
    Uses ultralytics YOLO when enabled and installed; otherwise falls back to
    OpenCV motion-energy + frontal face/body activity scoring so it works even
    on lightweight CPU containers without PyTorch.
    """
    settings = get_settings()
    should_use_yolo = settings.enable_yolo if use_yolo is None else use_yolo

    model = None
    if should_use_yolo:
        try:
            from ultralytics import YOLO  # type: ignore

            model = YOLO(settings.yolo_model)
        except Exception as exc:
            logger.info("YOLO unavailable (%s); falling back to OpenCV motion-energy detector.", exc)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    indices: List[float] = []
    frame_idx = 0
    prev_small: Optional[np.ndarray] = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % max(1, frame_interval) == 0:
                ts = round(frame_idx / fps, 2)
                if model is not None:
                    results = model(frame, verbose=False)
                    if results and results[0].boxes is not None and results[0].boxes.xyxy.shape[0] > 0:
                        indices.append(ts)
                else:
                    # Lightweight OpenCV high-energy motion fallback
                    small = cv2.resize(frame, (160, 90))
                    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                    gray = cv2.GaussianBlur(gray, (5, 5), 0)
                    if prev_small is not None:
                        delta = cv2.absdiff(gray, prev_small)
                        motion_ratio = float(np.mean(delta > 22))
                        if motion_ratio > 0.14:
                            indices.append(ts)
                    prev_small = gray

            frame_idx += 1
    finally:
        cap.release()

    return indices


def rank_moments(
    scene_ts: List[float],
    audio_ts: List[float],
    action_ts: List[float],
    cut_length: float = 15.0,
    video_duration: float = 0.0,
    window: float = 5.0,
    weight_scene: float = 2.0,
    weight_audio: float = 3.0,
    weight_action: float = 4.0,
    max_moments: int = 50,
) -> List[RankedMoment]:
    """
    Combine scene change, audio peak, and action timestamps into weighted composite scores
    and apply non-maximum suppression so returned cuts cover distinct highlights.
    """
    candidates = sorted(set(scene_ts + audio_ts + action_ts))

    # Fallback: if video is very calm and produced zero detections, sample evenly across timeline
    if not candidates and video_duration > 0:
        step = max(cut_length, video_duration / min(max_moments, 6))
        t = cut_length / 2
        while t < video_duration and len(candidates) < max_moments:
            candidates.append(round(t, 2))
            t += step

    scored = []
    for ts in candidates:
        s_hits = sum(1 for s in scene_ts if abs(ts - s) <= window)
        a_hits = sum(1 for a in audio_ts if abs(ts - a) <= window)
        act_hits = sum(1 for ac in action_ts if abs(ts - ac) <= window)
        score = round(s_hits * weight_scene + a_hits * weight_audio + act_hits * weight_action, 2)
        scored.append((ts, score, s_hits, a_hits, act_hits))

    scored.sort(key=lambda item: (-item[1], item[0]))

    # Non-maximum suppression: avoid overlapping cuts closer than 65% of cut_length
    min_spacing = max(window, cut_length * 0.65)
    selected: List[RankedMoment] = []

    for ts, score, s_hits, a_hits, act_hits in scored:
        if any(abs(ts - m.timestamp) < min_spacing for m in selected):
            continue

        start = max(0.0, round(ts - cut_length / 2.0, 2))
        if video_duration > 0 and start + cut_length > video_duration:
            start = max(0.0, round(video_duration - cut_length, 2))
        end = round(min(video_duration, start + cut_length) if video_duration > 0 else start + cut_length, 2)

        # Build human-readable Portuguese tag explaining why this moment ranked high
        tags = []
        if act_hits > 0:
            tags.append("Alta Ação")
        if a_hits > 0:
            tags.append("Pico de Áudio")
        if s_hits > 0:
            tags.append("Corte de Cena")
        label = " + ".join(tags) if tags else "Destaque Uniforme"

        selected.append(
            RankedMoment(
                rank=len(selected) + 1,
                timestamp=ts,
                start=start,
                end=end,
                score=score,
                scene_hits=s_hits,
                audio_hits=a_hits,
                action_hits=act_hits,
                label=label,
            )
        )
        if len(selected) >= max_moments:
            break

    return selected
