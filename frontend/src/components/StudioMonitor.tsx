import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Clapperboard, Loader2 } from 'lucide-react';
import type { CutItem, JobItem, MomentItem } from '../types';
import { resolveMediaUrl } from '../services/api';
import { extractYouTubeId, formatTimecode } from '../utils/formatters';
import { CutCard } from './CutCard';

interface StudioMonitorProps {
  url: string;
  localFileUrl: string | null;
  currentJob: JobItem | null;
  activeCut: CutItem | null;
  onSelectCut: (cut: CutItem) => void;
  backendOnline: boolean;
  onRequireBackend: () => void;
}

type GuideRatio = '16:9' | '1:1' | '9:16';

const PIPELINE_STAGES = [
  { id: 'downloading', label: '1. Download' },
  { id: 'analyzing', label: '2. Análise IA' },
  { id: 'cutting', label: '3. Cortes FFmpeg' },
  { id: 'uploading', label: '4. Armazenamento' },
  { id: 'completed', label: '5. Pronto' },
];

function getStageIndex(status?: JobItem['status']): number {
  switch (status) {
    case 'queued':
    case 'downloading':
      return 0;
    case 'analyzing':
      return 1;
    case 'cutting':
      return 2;
    case 'uploading':
      return 3;
    case 'completed':
      return 5;
    default:
      return -1;
  }
}

export function StudioMonitor({
  url,
  localFileUrl,
  currentJob,
  activeCut,
  onSelectCut,
  backendOnline,
  onRequireBackend,
}: StudioMonitorProps) {
  const [overrideGuide, setOverrideGuide] = useState<{ cutId: string | null; ratio: GuideRatio } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const defaultRatio: GuideRatio =
    activeCut?.format === 'shorts'
      ? '1:1'
      : activeCut?.format === 'reels' || activeCut?.format === 'tiktok'
        ? '9:16'
        : '16:9';

  const currentCutKey = activeCut?.id ?? null;
  const guideRatio: GuideRatio =
    overrideGuide && overrideGuide.cutId === currentCutKey ? overrideGuide.ratio : defaultRatio;

  const setGuideRatio = (ratio: GuideRatio) => {
    setOverrideGuide({ cutId: currentCutKey, ratio });
  };

  // Seek HTML5 video element to active cut start_time and stop at end_time
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !activeCut) return;

    if (activeCut.is_browser_local) {
      vid.currentTime = activeCut.start_time;
      vid.play().catch(() => {});
      const endLimit = activeCut.start_time + activeCut.duration;
      const onTimeUpdate = () => {
        if (vid.currentTime >= endLimit) {
          vid.pause();
        }
      };
      vid.addEventListener('timeupdate', onTimeUpdate);
      return () => vid.removeEventListener('timeupdate', onTimeUpdate);
    }
    return undefined;
  }, [activeCut]);

  const ytId = extractYouTubeId(activeCut?.source_url || currentJob?.youtube_url || url);
  const stageIndex = getStageIndex(currentJob?.status);
  const duration = currentJob?.video_duration || 360;

  const renderPreviewContent = () => {
    // 1. Completed backend MP4 cut
    if (activeCut && !activeCut.is_browser_local && !activeCut.id.startsWith('preview_')) {
      return (
        <video
          key={activeCut.id}
          ref={videoRef}
          src={resolveMediaUrl(activeCut.url)}
          controls
          autoPlay
          playsInline
        />
      );
    }

    // 2. Local file loaded in browser
    if (localFileUrl) {
      return (
        <video
          ref={videoRef}
          src={localFileUrl}
          controls
          playsInline
        />
      );
    }

    // 3. YouTube interactive embed synced to cut start/end
    if (ytId) {
      const startSec = activeCut ? Math.floor(activeCut.start_time) : 0;
      const endSec = activeCut ? Math.floor(activeCut.start_time + activeCut.duration) : 0;
      const embedParams = new URLSearchParams({
        rel: '0',
        modestbranding: '1',
      });
      if (startSec > 0) embedParams.set('start', String(startSec));
      if (endSec > startSec) embedParams.set('end', String(endSec));

      return (
        <iframe
          key={`${ytId}_${startSec}_${endSec}`}
          src={`https://www.youtube.com/embed/${ytId}?${embedParams.toString()}`}
          title="Pré-visualização do vídeo YouTube"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ border: 'none' }}
        />
      );
    }

    return (
      <div className="monitor-placeholder">
        <Clapperboard size={34} strokeWidth={1.6} />
        <p>
          Cole uma URL do YouTube ou carregue um vídeo local para pré-visualizar o enquadramento e
          os momentos detectados.
        </p>
      </div>
    );
  };

  const handleMomentClick = (moment: MomentItem) => {
    if (!currentJob) return;
    const match = currentJob.cuts.find((c) => Math.abs(c.start_time - moment.start) < 1.5);
    if (match) onSelectCut(match);
  };

  return (
    <section className="panel" aria-labelledby="monitor-heading">
      <div className="panel-title-row">
        <h2 id="monitor-heading" className="panel-title">
          Monitor de Estúdio
        </h2>
        {activeCut ? (
          <span className="mono-tag">
            {activeCut.format.toUpperCase()} • {formatTimecode(activeCut.start_time)}–
            {formatTimecode(activeCut.start_time + activeCut.duration)}
          </span>
        ) : (
          <span className="mono-tag">Pré-visualização</span>
        )}
      </div>

      {/* Video Monitor with Live Aspect Crop Guide */}
      <div className="monitor-stage">
        {renderPreviewContent()}
        {guideRatio !== '16:9' && (
          <div className="crop-guide" aria-hidden="true">
            <div className={`crop-frame ${guideRatio === '1:1' ? 'ratio-1-1' : 'ratio-9-16'}`}>
              <span className="crop-badge">Guia {guideRatio}</span>
            </div>
          </div>
        )}
      </div>

      {/* Aspect Guide Switcher */}
      <div className="aspect-switcher">
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Guia de recorte no monitor:
        </span>
        <div className="aspect-pills" role="group" aria-label="Proporção do guia de recorte">
          {(['16:9', '1:1', '9:16'] as GuideRatio[]).map((ratio) => (
            <button
              key={ratio}
              type="button"
              className={`aspect-pill ${guideRatio === ratio ? 'active' : ''}`}
              onClick={() => setGuideRatio(ratio)}
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline Status & Progress */}
      {currentJob && (
        <div className="progress-card" aria-live="polite">
          <div className="progress-header">
            <span style={{ fontWeight: 600 }}>{currentJob.stage_message}</span>
            <span className="mono-tag">{currentJob.progress}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${currentJob.progress}%` }} />
          </div>
          <div className="pipeline-steps">
            {PIPELINE_STAGES.map((step, idx) => {
              const isDone = stageIndex > idx || currentJob.status === 'completed';
              const isCurrent = stageIndex === idx && currentJob.status !== 'failed';
              return (
                <div
                  key={step.id}
                  className={`pipeline-step ${isDone ? 'done' : isCurrent ? 'current' : ''}`}
                >
                  {isDone ? (
                    <CheckCircle2 size={13} />
                  ) : isCurrent ? (
                    <Loader2 size={13} className="spin" />
                  ) : (
                    <Circle size={13} />
                  )}
                  <span>{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Visual Moment Timeline */}
      {currentJob && currentJob.moments.length > 0 && (
        <div className="timeline-section">
          <div className="field-label-row">
            <span className="field-label">
              Linha do Tempo — Top {currentJob.moments.length} Momentos
            </span>
            <div className="timeline-legend">
              <span>
                <span className="legend-dot" style={{ background: 'var(--signal-scene)' }} />
                Cenas
              </span>
              <span>
                <span className="legend-dot" style={{ background: 'var(--signal-audio)' }} />
                Áudio dB
              </span>
              <span>
                <span className="legend-dot" style={{ background: 'var(--signal-action)' }} />
                Ação
              </span>
            </div>
          </div>

          <div className="timeline-track" role="list" aria-label="Segmentos de melhores momentos">
            {currentJob.moments.map((m) => {
              const leftPct = Math.min(96, (m.start / Math.max(duration, 1)) * 100);
              const widthPct = Math.max(3, ((m.end - m.start) / Math.max(duration, 1)) * 100);
              const isSelected = activeCut && Math.abs(activeCut.start_time - m.start) < 1.5;
              return (
                <button
                  key={m.rank}
                  type="button"
                  role="listitem"
                  className={`timeline-segment ${isSelected ? 'active' : ''}`}
                  style={{ left: `${leftPct}%`, width: `${Math.min(100 - leftPct, widthPct)}%` }}
                  title={`#${m.rank} (${formatTimecode(m.start)}–${formatTimecode(m.end)}) • Score ${m.score} • ${m.label}`}
                  onClick={() => handleMomentClick(m)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Generated Cuts List */}
      {currentJob && currentJob.cuts.length > 0 && (
        <div>
          <div className="field-label-row" style={{ marginBottom: '0.65rem' }}>
            <span className="field-label">Cortes Gerados</span>
            <span className="mono-tag">{currentJob.cuts.length} arquivo(s)</span>
          </div>
          <div className="cuts-list">
            {currentJob.cuts.map((cut) => (
              <CutCard
                key={cut.id}
                cut={cut}
                isActive={activeCut?.id === cut.id}
                variant="row"
                backendOnline={backendOnline}
                onPreview={onSelectCut}
                onRequireBackend={onRequireBackend}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
