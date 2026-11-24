import { useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Link2,
  Loader2,
  Scissors,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import type { BackendHealth, FormatType, PipelineOptions, ResolutionType, SourceMode } from '../types';
import { detectSourceLabel, FORMAT_CATALOG, formatBytes } from '../utils/formatters';

interface JobComposerProps {
  sourceMode: SourceMode;
  onChangeSourceMode: (mode: SourceMode) => void;
  url: string;
  onChangeUrl: (url: string) => void;
  selectedFile: File | null;
  onSelectFile: (file: File | null) => void;
  cutLength: number;
  onChangeCutLength: (sec: number) => void;
  formats: FormatType[];
  onToggleFormat: (fmt: FormatType) => void;
  options: PipelineOptions;
  onChangeOptions: (opts: PipelineOptions) => void;
  isProcessing: boolean;
  errorMessage: string;
  backendHealth: BackendHealth;
  onSubmit: () => void;
}

const DURATION_PRESETS = [10, 15, 30, 45, 60];

export function JobComposer({
  sourceMode,
  onChangeSourceMode,
  url,
  onChangeUrl,
  selectedFile,
  onSelectFile,
  cutLength,
  onChangeCutLength,
  formats,
  onToggleFormat,
  options,
  onChangeOptions,
  isProcessing,
  errorMessage,
  backendHealth,
  onSubmit,
}: JobComposerProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sourceLabel = detectSourceLabel(url);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      onSelectFile(file);
    }
  };

  const canSubmit =
    !isProcessing &&
    formats.length > 0 &&
    (sourceMode === 'url' ? url.trim().length > 5 : selectedFile !== null);

  return (
    <section className="panel" aria-labelledby="composer-heading">
      <div className="panel-title-row">
        <h2 id="composer-heading" className="panel-title">
          Configuração do Corte
        </h2>
        <span className="mono-tag">
          {backendHealth.online ? 'yt-dlp + FFmpeg' : 'Canvas + WebAudio'}
        </span>
      </div>

      {/* Source Toggle */}
      <div className="segmented-control" role="tablist" aria-label="Origem do vídeo">
        <button
          id="source-tab-url"
          type="button"
          role="tab"
          aria-selected={sourceMode === 'url'}
          className={`segment-btn ${sourceMode === 'url' ? 'active' : ''}`}
          onClick={() => onChangeSourceMode('url')}
        >
          <Link2 size={15} />
          <span>URL (YouTube / Link)</span>
        </button>
        <button
          id="source-tab-file"
          type="button"
          role="tab"
          aria-selected={sourceMode === 'file'}
          className={`segment-btn ${sourceMode === 'file' ? 'active' : ''}`}
          onClick={() => onChangeSourceMode('file')}
        >
          <Upload size={15} />
          <span>Arquivo Local</span>
        </button>
      </div>

      {/* URL Input or File Dropzone */}
      {sourceMode === 'url' ? (
        <div className="field-group">
          <div className="field-label-row">
            <label htmlFor="video-url-input" className="field-label">
              Endereço do vídeo
            </label>
            {sourceLabel && <span className="mono-tag">{sourceLabel}</span>}
          </div>
          <div className="input-wrap">
            <Link2 size={16} className="input-icon" />
            <input
              id="video-url-input"
              type="url"
              className="text-input with-icon"
              placeholder="https://www.youtube.com/watch?v=... ou link .mp4"
              value={url}
              onChange={(e) => onChangeUrl(e.target.value)}
              disabled={isProcessing}
            />
          </div>
          <div className="sample-links">
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Testar rápido:</span>
            <button
              type="button"
              className="chip-btn"
              onClick={() => onChangeUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ')}
              disabled={isProcessing}
            >
              Big Buck Bunny (4K)
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => onChangeUrl('https://www.youtube.com/watch?v=YE7VzlLtp-4')}
              disabled={isProcessing}
            >
              Curta Blender
            </button>
          </div>
        </div>
      ) : (
        <div className="field-group">
          <div className="field-label-row">
            <span className="field-label">Vídeo do dispositivo</span>
            {selectedFile && <span className="mono-tag">{formatBytes(selectedFile.size)}</span>}
          </div>
          <div
            className={`dropzone ${isDragging ? 'dragging' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
          >
            <Upload size={22} style={{ color: 'var(--accent)' }} />
            <p className="dropzone-title">
              {selectedFile ? selectedFile.name : 'Arraste um vídeo MP4, WebM ou MOV aqui'}
            </p>
            <p className="dropzone-hint">
              {backendHealth.online
                ? 'Enviado com segurança ao backend FastAPI (até 500 MB)'
                : 'Processado localmente no seu navegador — sem upload e 100% privado'}
            </p>
            <input
              ref={fileInputRef}
              id="video-file-input"
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={(e) => onSelectFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>
      )}

      {/* Duration Control */}
      <div className="field-group">
        <div className="field-label-row">
          <label htmlFor="cut-length-range" className="field-label">
            Duração de cada corte
          </label>
          <span className="field-value">{cutLength}s</span>
        </div>
        <input
          id="cut-length-range"
          type="range"
          min={5}
          max={90}
          step={1}
          value={cutLength}
          onChange={(e) => onChangeCutLength(Number(e.target.value))}
          className="range-slider"
          disabled={isProcessing}
        />
        <div className="preset-row">
          {DURATION_PRESETS.map((sec) => (
            <button
              key={sec}
              type="button"
              className={`preset-pill ${cutLength === sec ? 'active' : ''}`}
              onClick={() => onChangeCutLength(sec)}
              disabled={isProcessing}
            >
              {sec}s
            </button>
          ))}
        </div>
      </div>

      {/* Format Selection */}
      <div className="field-group">
        <div className="field-label-row">
          <span className="field-label">Formatos de saída</span>
          <span className="mono-tag">{formats.length} selecionado(s)</span>
        </div>
        <div className="format-grid">
          {FORMAT_CATALOG.map((spec) => {
            const isSelected = formats.includes(spec.id);
            return (
              <button
                key={spec.id}
                id={`format-btn-${spec.id}`}
                type="button"
                className={`format-option ${isSelected ? 'selected' : ''}`}
                onClick={() => onToggleFormat(spec.id)}
                disabled={isProcessing}
                aria-pressed={isSelected}
              >
                <span className="aspect-box" aria-hidden="true">
                  <span className={`aspect-wire ${spec.aspectClass}`} />
                </span>
                <span className="format-meta">
                  <span className="format-name">{spec.label}</span>
                  <span className="format-dims">
                    {spec.ratioLabel} • {spec.dimensions}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Collapsible Pipeline Fine-Tuning */}
      <button
        id="btn-toggle-advanced"
        type="button"
        className="advanced-toggle"
        onClick={() => setShowAdvanced((prev) => !prev)}
        aria-expanded={showAdvanced}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
          <SlidersHorizontal size={15} />
          <span>Ajustes do pipeline (OpenCV, Áudio dB, YOLO, 4K)</span>
        </span>
        {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {showAdvanced && (
        <div className="advanced-box">
          <div>
            <div className="field-label-row">
              <label htmlFor="opt-scene" className="field-label">
                Limiar de Cena
              </label>
              <span className="field-value">{options.scene_threshold}</span>
            </div>
            <input
              id="opt-scene"
              type="range"
              min={10}
              max={60}
              value={options.scene_threshold}
              onChange={(e) =>
                onChangeOptions({ ...options, scene_threshold: Number(e.target.value) })
              }
              className="range-slider"
            />
          </div>

          <div>
            <div className="field-label-row">
              <label htmlFor="opt-audio" className="field-label">
                Pico de Áudio (dB)
              </label>
              <span className="field-value">{options.audio_db_threshold} dB</span>
            </div>
            <input
              id="opt-audio"
              type="range"
              min={-40}
              max={-5}
              value={options.audio_db_threshold}
              onChange={(e) =>
                onChangeOptions({ ...options, audio_db_threshold: Number(e.target.value) })
              }
              className="range-slider"
            />
          </div>

          <div>
            <div className="field-label-row">
              <label htmlFor="opt-max-clips" className="field-label">
                Máx. de Momentos
              </label>
              <span className="field-value">{options.max_clips}</span>
            </div>
            <input
              id="opt-max-clips"
              type="range"
              min={1}
              max={50}
              value={options.max_clips}
              onChange={(e) =>
                onChangeOptions({ ...options, max_clips: Number(e.target.value) })
              }
              className="range-slider"
            />
          </div>

          <div>
            <div className="field-label-row">
              <label htmlFor="opt-quality" className="field-label">
                Qualidade de Download
              </label>
            </div>
            <select
              id="opt-quality"
              className="select-input"
              value={options.preferred_quality}
              onChange={(e) =>
                onChangeOptions({
                  ...options,
                  preferred_quality: e.target.value as ResolutionType,
                })
              }
            >
              <option value="4k">4K Ultra HD (2160p)</option>
              <option value="1080p">Full HD (1080p)</option>
              <option value="720p">HD (720p)</option>
              <option value="original">Melhor Disponível</option>
            </select>
          </div>

          <div>
            <div className="field-label-row">
              <label htmlFor="opt-weight-audio" className="field-label">
                Peso Áudio / Ação
              </label>
              <span className="field-value">
                {options.weight_scene}/{options.weight_audio}/{options.weight_action}
              </span>
            </div>
            <input
              id="opt-weight-audio"
              type="range"
              min={1}
              max={6}
              value={options.weight_action}
              onChange={(e) =>
                onChangeOptions({ ...options, weight_action: Number(e.target.value) })
              }
              className="range-slider"
            />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={options.use_action_detection}
              onChange={(e) =>
                onChangeOptions({ ...options, use_action_detection: e.target.checked })
              }
            />
            <span>Ativar detecção de ação / rostos (YOLOv5 ou Energia de Movimento)</span>
          </label>
        </div>
      )}

      {/* Primary Action */}
      <button
        id="btn-generate-cuts"
        type="button"
        className="btn-primary"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {isProcessing ? (
          <>
            <Loader2 size={18} className="spin" />
            <span>Processando vídeo...</span>
          </>
        ) : (
          <>
            <Scissors size={18} />
            <span>Analisar e Gerar Cortes</span>
          </>
        )}
      </button>

      {errorMessage && (
        <div className="error-banner" role="alert">
          <AlertCircle size={17} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>{errorMessage}</span>
        </div>
      )}
    </section>
  );
}
