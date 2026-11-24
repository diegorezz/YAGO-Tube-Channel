import { useState } from 'react';
import { Download, Loader2, Play, Trash2 } from 'lucide-react';
import type { CutItem, ResolutionType } from '../types';
import { buildCutDownloadUrl, resolveMediaUrl } from '../services/api';
import { exportLocalCutWebm } from '../services/localAnalyzer';
import { formatBytes, formatTimecode } from '../utils/formatters';

interface CutCardProps {
  cut: CutItem;
  isActive?: boolean;
  variant?: 'row' | 'grid';
  backendOnline: boolean;
  onPreview: (cut: CutItem) => void;
  onDelete?: (cut: CutItem) => void;
  onRequireBackend?: () => void;
}

export function CutCard({
  cut,
  isActive = false,
  variant = 'row',
  backendOnline,
  onPreview,
  onDelete,
  onRequireBackend,
}: CutCardProps) {
  const [resolution, setResolution] = useState<ResolutionType>('original');
  const [exporting, setExporting] = useState(false);

  const thumbSrc = resolveMediaUrl(cut.thumbnail_url);

  const handleDownload = async () => {
    if (cut.is_browser_local) {
      setExporting(true);
      try {
        const targetH =
          resolution === '4k'
            ? 1080
            : resolution === '720p'
              ? 720
              : resolution === '480p'
                ? 480
                : 1080;
        await exportLocalCutWebm(cut, targetH);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Falha ao exportar corte no navegador.');
      } finally {
        setExporting(false);
      }
      return;
    }

    if (!backendOnline && cut.id.startsWith('preview_')) {
      onRequireBackend?.();
      return;
    }

    const downloadUrl = buildCutDownloadUrl(cut.id, resolution);
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  };

  if (variant === 'grid') {
    return (
      <article className="library-card">
        <button
          type="button"
          className="library-thumb-wrap"
          onClick={() => onPreview(cut)}
          aria-label={`Pré-visualizar corte ${cut.format} em ${formatTimecode(cut.start_time)}`}
        >
          {thumbSrc ? (
            <img src={thumbSrc} alt={`Miniatura do corte ${cut.format}`} loading="lazy" />
          ) : (
            <div style={{ width: '100%', height: '100%', background: '#181816' }} />
          )}
          <div className="library-thumb-overlay">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="format-tag" style={{ background: 'rgba(15,15,14,0.8)', color: '#fff' }}>
                {cut.format}
              </span>
              <span className="mono-tag" style={{ background: 'rgba(15,15,14,0.8)', color: '#fff', border: 'none' }}>
                {formatTimecode(cut.start_time)} • {cut.duration}s
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#fff', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                Score {cut.score.toFixed(1)}
              </span>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Play size={14} fill="currentColor" />
              </span>
            </div>
          </div>
        </button>

        <div className="library-card-body">
          <h3 className="library-card-title" title={cut.video_title}>
            {cut.video_title || 'Corte sem título'}
          </h3>
          <div className="signal-breakdown">
            <span>Cena: {cut.scene_hits}</span>
            <span>Áudio: {cut.audio_hits}</span>
            <span>Ação: {cut.action_hits}</span>
            <span>{formatBytes(cut.file_size_bytes)}</span>
          </div>
          <div className="cut-actions" style={{ marginTop: 'auto' }}>
            <select
              aria-label="Resolução para download"
              className="mini-select"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as ResolutionType)}
            >
              <option value="original">Original</option>
              <option value="4k">4K</option>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
              <option value="480p">480p</option>
            </select>
            <button
              type="button"
              className="mini-btn primary"
              onClick={handleDownload}
              disabled={exporting}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              <span>{exporting ? 'Exportando...' : 'Baixar'}</span>
            </button>
            {onDelete && (
              <button
                type="button"
                className="mini-btn danger"
                onClick={() => onDelete(cut)}
                aria-label="Excluir corte"
                title="Excluir"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className={`cut-row ${isActive ? 'active' : ''}`}>
      <button
        type="button"
        className="cut-thumb"
        onClick={() => onPreview(cut)}
        aria-label={`Reproduzir corte ${cut.format} de ${formatTimecode(cut.start_time)}`}
      >
        {thumbSrc ? <img src={thumbSrc} alt={`Corte ${cut.format}`} /> : null}
        <span className="cut-thumb-play">
          <Play size={18} fill="currentColor" />
        </span>
      </button>

      <div className="cut-info">
        <div className="cut-top">
          <div className="cut-badges">
            <span className="format-tag">{cut.format}</span>
            <span className="mono-tag">
              {formatTimecode(cut.start_time)} → {formatTimecode(cut.start_time + cut.duration)}
            </span>
            <span className="score-pill">Score {cut.score.toFixed(1)}</span>
          </div>
          <span className="mono-tag">{cut.resolution}</span>
        </div>

        <div className="signal-breakdown">
          <span>Cenas: {cut.scene_hits}</span>
          <span>Picos Áudio: {cut.audio_hits}</span>
          <span>Ação: {cut.action_hits}</span>
        </div>

        <div className="cut-actions">
          <button type="button" className="mini-btn" onClick={() => onPreview(cut)}>
            <Play size={13} />
            <span>Prévia</span>
          </button>

          <select
            aria-label="Resolução de exportação"
            className="mini-select"
            value={resolution}
            onChange={(e) => setResolution(e.target.value as ResolutionType)}
          >
            <option value="original">Original</option>
            <option value="4k">4K</option>
            <option value="1080p">1080p</option>
            <option value="720p">720p</option>
            <option value="480p">480p</option>
          </select>

          <button
            type="button"
            className="mini-btn primary"
            onClick={handleDownload}
            disabled={exporting}
          >
            {exporting ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
            <span>
              {exporting
                ? 'Gravando WebM...'
                : cut.is_browser_local
                  ? 'Exportar Clipe'
                  : 'Baixar MP4'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
