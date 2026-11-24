import type { CutItem, FormatType, JobItem, MomentItem, PipelineOptions } from '../types';
import { extractYouTubeId, FORMAT_CATALOG } from '../utils/formatters';

function rankMomentsClient(
  sceneTs: number[],
  audioTs: number[],
  actionTs: number[],
  cutLength: number,
  duration: number,
  options: PipelineOptions,
): MomentItem[] {
  const windowSec = 5;
  const candidates = Array.from(new Set([...sceneTs, ...audioTs, ...actionTs])).sort((a, b) => a - b);

  if (candidates.length === 0 && duration > 0) {
    const count = Math.min(options.max_clips, Math.max(2, Math.floor(duration / Math.max(cutLength, 10))));
    const step = duration / (count + 1);
    for (let i = 1; i <= count; i += 1) {
      candidates.push(Number((step * i).toFixed(2)));
    }
  }

  const scored = candidates.map((ts) => {
    const sHits = sceneTs.filter((s) => Math.abs(ts - s) <= windowSec).length;
    const aHits = audioTs.filter((a) => Math.abs(ts - a) <= windowSec).length;
    const actHits = actionTs.filter((ac) => Math.abs(ts - ac) <= windowSec).length;
    const score = Number(
      (sHits * options.weight_scene + aHits * options.weight_audio + actHits * options.weight_action).toFixed(2),
    );
    return { ts, score, sHits, aHits, actHits };
  });

  scored.sort((a, b) => b.score - a.score || a.ts - b.ts);

  const minSpacing = Math.max(windowSec, cutLength * 0.65);
  const selected: MomentItem[] = [];

  for (const item of scored) {
    if (selected.some((m) => Math.abs(item.ts - m.timestamp) < minSpacing)) {
      continue;
    }
    let start = Math.max(0, Number((item.ts - cutLength / 2).toFixed(2)));
    if (duration > 0 && start + cutLength > duration) {
      start = Math.max(0, Number((duration - cutLength).toFixed(2)));
    }
    const end = Number(Math.min(duration || start + cutLength, start + cutLength).toFixed(2));
    const tags: string[] = [];
    if (item.actHits > 0) tags.push('Alta Ação');
    if (item.aHits > 0) tags.push('Pico de Áudio');
    if (item.sHits > 0) tags.push('Corte de Cena');

    selected.push({
      rank: selected.length + 1,
      timestamp: item.ts,
      start,
      end,
      score: Math.max(1, item.score),
      scene_hits: item.sHits,
      audio_hits: item.aHits,
      action_hits: item.actHits,
      label: tags.join(' + ') || 'Destaque Uniforme',
    });

    if (selected.length >= options.max_clips) break;
  }

  return selected;
}

async function detectAudioPeaksBrowser(file: File, dbThreshold: number): Promise<number[]> {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return [];
    const ctx = new AudioCtx();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const windowSize = Math.max(1, Math.floor(sampleRate * 0.5));
    const peaks: number[] = [];

    for (let i = 0; i < channelData.length - windowSize; i += windowSize) {
      let sumSq = 0;
      for (let j = 0; j < windowSize; j += 4) {
        const s = channelData[i + j];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / (windowSize / 4));
      if (rms > 1e-6) {
        const db = 20 * Math.log10(rms);
        if (db > dbThreshold) {
          peaks.push(Number((i / sampleRate).toFixed(2)));
        }
      }
    }
    await ctx.close();
    return peaks;
  } catch {
    return [];
  }
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = Math.min(Math.max(0, timeSec), Math.max(0, video.duration - 0.05));
  });
}

/**
 * Genuine client-side video analysis for local video files:
 * - Samples frames via offscreen <canvas> for scene change & high-action detection
 * - Decodes audio via Web Audio API for RMS dB peak detection
 * - Captures real JPEG frame thumbnails for every ranked highlight
 */
export async function analyzeLocalVideoFile(
  file: File,
  cutLength: number,
  formats: FormatType[],
  options: PipelineOptions,
  onProgress: (progress: number, status: JobItem['status'], message: string) => void,
): Promise<JobItem> {
  const objectUrl = URL.createObjectURL(file);
  const jobId = `local_${Date.now()}`;
  const now = new Date().toISOString();

  onProgress(8, 'downloading', 'Carregando vídeo local no motor do navegador...');

  const video = document.createElement('video');
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Não foi possível ler este arquivo de vídeo no navegador.'));
  });

  const duration = video.duration || 30;
  const sampleWidth = 160;
  const sampleHeight = 90;
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const sceneTs: number[] = [];
  const actionTs: number[] = [];

  onProgress(22, 'analyzing', 'Detectando mudanças de cena e movimento (Canvas Frame Diff)...');

  const maxSamples = Math.min(72, Math.max(12, Math.floor(duration / 1.5)));
  const step = duration / maxSamples;
  let prevGray: Uint8Array | null = null;

  if (ctx) {
    for (let i = 0; i < maxSamples; i += 1) {
      const t = Number((i * step).toFixed(2));
      await seekVideo(video, t);
      ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight);
      const imgData = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
      const gray = new Uint8Array(sampleWidth * sampleHeight);

      for (let p = 0, g = 0; p < imgData.length; p += 4, g += 1) {
        gray[g] = Math.round(0.299 * imgData[p] + 0.587 * imgData[p + 1] + 0.114 * imgData[p + 2]);
      }

      if (prevGray) {
        let diffSum = 0;
        let highMotionPixels = 0;
        for (let g = 0; g < gray.length; g += 1) {
          const d = Math.abs(gray[g] - prevGray[g]);
          diffSum += d;
          if (d > 26) highMotionPixels += 1;
        }
        const meanDiff = diffSum / gray.length;
        const motionRatio = highMotionPixels / gray.length;

        if (meanDiff > options.scene_threshold) {
          sceneTs.push(t);
        }
        if (options.use_action_detection && motionRatio > 0.15) {
          actionTs.push(t);
        }
      }
      prevGray = gray;
      const pct = 22 + Math.round(((i + 1) / maxSamples) * 38);
      onProgress(pct, 'analyzing', `Analisando quadros (${i + 1}/${maxSamples})...`);
    }
  }

  onProgress(65, 'analyzing', 'Extraindo envelope de volume e picos de áudio (Web Audio API)...');
  const audioTs = await detectAudioPeaksBrowser(file, options.audio_db_threshold);

  onProgress(76, 'analyzing', 'Ranqueando os melhores momentos...');
  const moments = rankMomentsClient(sceneTs, audioTs, actionTs, cutLength, duration, options);

  onProgress(84, 'cutting', `Gerando miniaturas e preparando ${moments.length * formats.length} cortes...`);
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 480;
  thumbCanvas.height = 270;
  const thumbCtx = thumbCanvas.getContext('2d');

  const cuts: CutItem[] = [];
  for (let i = 0; i < moments.length; i += 1) {
    const m = moments[i];
    let thumbUrl = '';
    if (thumbCtx) {
      await seekVideo(video, Math.min(duration - 0.1, m.start + Math.min(1.5, cutLength / 3)));
      thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
      thumbUrl = thumbCanvas.toDataURL('image/jpeg', 0.78);
    }

    for (const fmt of formats) {
      const spec = FORMAT_CATALOG.find((f) => f.id === fmt)!;
      const effDuration = spec.maxDuration ? Math.min(cutLength, spec.maxDuration) : cutLength;
      cuts.push({
        id: `${jobId}_${i}_${fmt}`,
        job_id: jobId,
        format: fmt,
        resolution: spec.dimensions,
        start_time: m.start,
        duration: Math.round(Math.min(effDuration, Math.max(1, m.end - m.start))),
        score: m.score,
        scene_hits: m.scene_hits,
        audio_hits: m.audio_hits,
        action_hits: m.action_hits,
        url: objectUrl,
        thumbnail_url: thumbUrl,
        file_size_bytes: Math.round((file.size / Math.max(duration, 1)) * effDuration),
        download_count: 0,
        video_title: file.name.replace(/\.[^.]+$/, ''),
        source_url: `local://${file.name}`,
        created_at: now,
        is_browser_local: true,
        local_file_url: objectUrl,
      });
    }
  }

  onProgress(100, 'completed', `Análise local concluída! ${cuts.length} cortes prontos para pré-visualizar e exportar.`);

  return {
    job_id: jobId,
    youtube_url: `local://${file.name}`,
    video_title: file.name.replace(/\.[^.]+$/, ''),
    video_duration: duration,
    cut_length: cutLength,
    formats,
    status: 'completed',
    progress: 100,
    stage_message: `Concluído no navegador! ${cuts.length} cortes prontos.`,
    moments,
    cuts,
    created_at: now,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Exports a real cropped WebM clip in the browser from a local video Object URL
 * using HTML5 Canvas + MediaRecorder (16:9, 1:1, or 9:16).
 */
export async function exportLocalCutWebm(cut: CutItem, targetHeight = 720): Promise<void> {
  if (!cut.local_file_url) {
    throw new Error('Arquivo local não está mais carregado na sessão.');
  }
  const spec = FORMAT_CATALOG.find((f) => f.id === cut.format) || FORMAT_CATALOG[0];
  const aspect = spec.width / spec.height;
  const outH = Math.min(spec.height, targetHeight);
  const outW = Math.round((outH * aspect) / 2) * 2;

  const video = document.createElement('video');
  video.src = cut.local_file_url;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Erro ao carregar vídeo para exportação.'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexto Canvas 2D indisponível.');

  const canvasStream = canvas.captureStream(30);
  // Attempt to capture audio track if supported
  const maybeCapture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
  if (typeof maybeCapture === 'function') {
    const vidStream = maybeCapture.call(video);
    vidStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
  }

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';

  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 4_500_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const donePromise = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });

  await seekVideo(video, cut.start_time);
  const endTime = Math.min(video.duration, cut.start_time + cut.duration);

  recorder.start(250);
  await video.play();

  let rafId = 0;
  const drawLoop = () => {
    if (video.paused || video.ended || video.currentTime >= endTime) {
      video.pause();
      if (recorder.state !== 'inactive') recorder.stop();
      cancelAnimationFrame(rafId);
      return;
    }

    // Center-crop source video into target aspect ratio
    const srcRatio = video.videoWidth / Math.max(1, video.videoHeight);
    let sx = 0;
    let sy = 0;
    let sw = video.videoWidth;
    let sh = video.videoHeight;

    if (srcRatio > aspect) {
      sw = video.videoHeight * aspect;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = video.videoWidth / aspect;
      sy = (video.videoHeight - sh) / 2;
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
    rafId = requestAnimationFrame(drawLoop);
  };
  rafId = requestAnimationFrame(drawLoop);

  const blob = await donePromise;
  const dlUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = dlUrl;
  anchor.download = `cortaflow_${cut.format}_${Math.round(cut.start_time)}s.webm`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(dlUrl), 5000);
}

/**
 * Interactive preview simulation for YouTube URLs when hosted statically on GitHub Pages
 * without a connected FastAPI backend yet.
 */
export async function simulateYouTubePreviewJob(
  url: string,
  cutLength: number,
  formats: FormatType[],
  options: PipelineOptions,
  onProgress: (progress: number, status: JobItem['status'], message: string) => void,
): Promise<JobItem> {
  const ytId = extractYouTubeId(url);
  const thumb = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '';
  const jobId = `preview_${Date.now()}`;
  const now = new Date().toISOString();

  const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
  onProgress(15, 'downloading', 'Conectando metadados do vídeo (Modo Pré-visualização)...');
  await wait(450);
  onProgress(38, 'analyzing', 'Simulando detecção de mudanças de cena (OpenCV)...');
  await wait(450);
  onProgress(62, 'analyzing', 'Simulando picos de áudio (dB) e detecção de ação (YOLO)...');
  await wait(450);
  onProgress(85, 'cutting', 'Ranqueando momentos e preparando janelas sincronizadas...');
  await wait(400);

  const duration = 360;
  const clipCount = Math.min(options.max_clips, 6);
  const seedTimestamps = [28, 84, 146, 205, 268, 318].slice(0, clipCount);
  const moments: MomentItem[] = seedTimestamps.map((ts, idx) => {
    const start = Math.max(0, ts - Math.floor(cutLength / 2));
    const end = Math.min(duration, start + cutLength);
    const sHits = 2 + ((idx + 1) % 3);
    const aHits = 3 - (idx % 2);
    const actHits = options.use_action_detection ? 2 - (idx % 2) : 0;
    const score = Number(
      (sHits * options.weight_scene + aHits * options.weight_audio + actHits * options.weight_action).toFixed(1),
    );
    return {
      rank: idx + 1,
      timestamp: ts,
      start,
      end,
      score,
      scene_hits: sHits,
      audio_hits: aHits,
      action_hits: actHits,
      label: actHits > 0 ? 'Alta Ação + Pico de Áudio' : 'Pico de Áudio + Corte de Cena',
    };
  });

  const cuts: CutItem[] = [];
  moments.forEach((m, idx) => {
    formats.forEach((fmt) => {
      const spec = FORMAT_CATALOG.find((f) => f.id === fmt)!;
      const effDur = spec.maxDuration ? Math.min(cutLength, spec.maxDuration) : cutLength;
      cuts.push({
        id: `${jobId}_${idx}_${fmt}`,
        job_id: jobId,
        format: fmt,
        resolution: spec.dimensions,
        start_time: m.start,
        duration: effDur,
        score: m.score,
        scene_hits: m.scene_hits,
        audio_hits: m.audio_hits,
        action_hits: m.action_hits,
        url,
        thumbnail_url: thumb,
        file_size_bytes: effDur * 850_000,
        download_count: 0,
        video_title: ytId ? `Vídeo YouTube (${ytId})` : 'Vídeo Externo (Pré-visualização)',
        source_url: url,
        created_at: now,
      });
    });
  });

  onProgress(
    100,
    'completed',
    'Pré-visualização pronta! Conecte a API FastAPI nas configurações para exportar MP4 em 4K via yt-dlp + FFmpeg.',
  );

  return {
    job_id: jobId,
    youtube_url: url,
    video_title: ytId ? `Vídeo YouTube (${ytId})` : 'Vídeo Externo (Pré-visualização)',
    video_duration: duration,
    cut_length: cutLength,
    formats,
    status: 'completed',
    progress: 100,
    stage_message: 'Pré-visualização pronta. Conecte o servidor FastAPI para downloads MP4 reais do YouTube.',
    moments,
    cuts,
    created_at: now,
    updated_at: new Date().toISOString(),
  };
}
