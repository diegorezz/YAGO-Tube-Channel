import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Header } from './components/Header';
import { JobComposer } from './components/JobComposer';
import { StudioMonitor } from './components/StudioMonitor';
import { LibraryView } from './components/LibraryView';
import { FairUseView } from './components/FairUseView';
import { SettingsModal } from './components/SettingsModal';
import {
  checkBackendHealth,
  deleteJob,
  fetchFairUseStatus,
  fetchLibrary,
  submitFileJob,
  submitUrlJob,
  subscribeJobUpdates,
} from './services/api';
import { analyzeLocalVideoFile, simulateYouTubePreviewJob } from './services/localAnalyzer';
import type {
  ActiveTab,
  BackendHealth,
  CutItem,
  FairUseStatus,
  FormatType,
  JobItem,
  PipelineOptions,
  SourceMode,
} from './types';

const DEFAULT_OPTIONS: PipelineOptions = {
  scene_threshold: 30,
  audio_db_threshold: -20,
  use_action_detection: true,
  weight_scene: 2,
  weight_audio: 3,
  weight_action: 4,
  max_clips: 6,
  preferred_quality: '1080p',
};

const DEFAULT_FAIR_USE: FairUseStatus = {
  tier: 'Gratuito Ilimitado (Fair-Use)',
  active_jobs: 0,
  max_concurrent_jobs: 2,
  jobs_last_24h: 0,
  soft_daily_limit: 20,
  priority_tier: 'Prioridade Padrão',
  cooldown_seconds: 0,
  max_clips_per_job: 50,
  max_video_minutes: 120,
  retention_hours: 72,
  can_submit: true,
  notice: 'Modo navegador ativo — processamento local gratuito e ilimitado.',
};

const LOCAL_LIBRARY_KEY = 'cortaflow_local_library_v1';

function loadLocalLibrary(): CutItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('studio');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'light' ? 'light' : 'dark';
  });

  const [backendHealth, setBackendHealth] = useState<BackendHealth>({ online: false });
  const [fairUse, setFairUse] = useState<FairUseStatus>(DEFAULT_FAIR_USE);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Composer State
  const [sourceMode, setSourceMode] = useState<SourceMode>('url');
  const [url, setUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localFileUrl, setLocalFileUrl] = useState<string | null>(null);
  const [cutLength, setCutLength] = useState(15);
  const [formats, setFormats] = useState<FormatType[]>(['youtube', 'shorts']);
  const [options, setOptions] = useState<PipelineOptions>(DEFAULT_OPTIONS);

  // Active Job & Library State
  const [currentJob, setCurrentJob] = useState<JobItem | null>(null);
  const [activeCut, setActiveCut] = useState<CutItem | null>(null);
  const [libraryCuts, setLibraryCuts] = useState<CutItem[]>(() => loadLocalLibrary());
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Persist non-blob cuts to localStorage when running statically
  useEffect(() => {
    if (backendHealth.online) return;
    try {
      const serializable = libraryCuts
        .filter((c) => !c.is_browser_local)
        .slice(0, 60);
      localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(serializable));
    } catch {
      // ignore quota errors
    }
  }, [libraryCuts, backendHealth.online]);

  const handleSelectFile = (file: File | null) => {
    setSelectedFile(file);
    if (!file) {
      setLocalFileUrl(null);
      return;
    }
    const objUrl = URL.createObjectURL(file);
    setLocalFileUrl(objUrl);
  };

  const refreshBackendState = useCallback(async (healthOverride?: BackendHealth) => {
    const health = healthOverride || (await checkBackendHealth());
    setBackendHealth(health);
    if (health.online) {
      try {
        const [fu, lib] = await Promise.all([fetchFairUseStatus(), fetchLibrary()]);
        setFairUse(fu);
        setLibraryCuts(lib);
      } catch {
        // keep defaults on transient error
      }
    } else {
      setFairUse(DEFAULT_FAIR_USE);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const health = await checkBackendHealth();
      if (!active) return;
      setBackendHealth(health);
      if (health.online) {
        try {
          const [fu, lib] = await Promise.all([fetchFairUseStatus(), fetchLibrary()]);
          if (!active) return;
          setFairUse(fu);
          setLibraryCuts(lib);
        } catch {
          // keep defaults
        }
      }
    })();
    return () => {
      active = false;
      unsubscribeRef.current?.();
    };
  }, []);

  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('cortaflow_theme', next);
    } catch {
      // ignore
    }
  };

  const handleToggleFormat = (fmt: FormatType) => {
    setFormats((prev) =>
      prev.includes(fmt) ? prev.filter((item) => item !== fmt) : [...prev, fmt],
    );
  };

  const handleSubmit = async () => {
    setErrorMessage('');
    unsubscribeRef.current?.();

    if (formats.length === 0) {
      setErrorMessage('Selecione pelo menos um formato de saída.');
      return;
    }

    setIsProcessing(true);
    setActiveCut(null);

    try {
      // PATH A: Connected FastAPI Backend (Real yt-dlp 4K + OpenCV + FFmpeg + S3/Local + WebSocket)
      if (backendHealth.online) {
        const createdJob =
          sourceMode === 'url'
            ? await submitUrlJob(url.trim(), cutLength, formats, options)
            : await submitFileJob(selectedFile!, cutLength, formats, options);

        setCurrentJob(createdJob);
        unsubscribeRef.current = subscribeJobUpdates(
          createdJob.job_id,
          (update) => {
            setCurrentJob((prev) => {
              const merged = { ...(prev || createdJob), ...update } as JobItem;
              if (merged.status === 'completed') {
                setIsProcessing(false);
                if (merged.cuts && merged.cuts.length > 0) {
                  setActiveCut(merged.cuts[0]);
                }
                refreshBackendState({ ...backendHealth, online: true });
              } else if (merged.status === 'failed') {
                setIsProcessing(false);
                setErrorMessage(merged.error_message || 'Falha no processamento do vídeo.');
              }
              return merged;
            });
          },
          (err) => {
            setErrorMessage(err);
          },
        );
        return;
      }

      // PATH B: Browser Studio Mode (Static GitHub Pages without remote server)
      const now = new Date().toISOString();
      const draftJob: JobItem = {
        job_id: `browser_${Date.now()}`,
        youtube_url: sourceMode === 'url' ? url.trim() : `local://${selectedFile?.name}`,
        video_title: sourceMode === 'file' && selectedFile ? selectedFile.name : 'Analisando...',
        video_duration: 0,
        cut_length: cutLength,
        formats,
        status: 'downloading',
        progress: 5,
        stage_message: 'Inicializando motor de análise no navegador...',
        moments: [],
        cuts: [],
        created_at: now,
        updated_at: now,
      };
      setCurrentJob(draftJob);

      const onProgress = (progress: number, status: JobItem['status'], stage_message: string) => {
        setCurrentJob((prev) => (prev ? { ...prev, progress, status, stage_message } : prev));
      };

      const completed =
        sourceMode === 'file' && selectedFile
          ? await analyzeLocalVideoFile(selectedFile, cutLength, formats, options, onProgress)
          : await simulateYouTubePreviewJob(url.trim(), cutLength, formats, options, onProgress);

      setCurrentJob(completed);
      if (completed.cuts.length > 0) {
        setActiveCut(completed.cuts[0]);
        setLibraryCuts((prev) => [...completed.cuts, ...prev]);
      }
      setIsProcessing(false);
    } catch (err: unknown) {
      setIsProcessing(false);
      const axiosMsg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrorMessage(
        axiosMsg || (err instanceof Error ? err.message : 'Erro inesperado ao iniciar o corte.'),
      );
    }
  };

  const handlePreviewFromLibrary = (cut: CutItem) => {
    setActiveCut(cut);
    if (cut.local_file_url) {
      setLocalFileUrl(cut.local_file_url);
    } else if (cut.source_url && cut.source_url.startsWith('http')) {
      setUrl(cut.source_url);
    }
    setActiveTab('studio');
  };

  const handleDeleteCut = async (cut: CutItem) => {
    if (backendHealth.online && !cut.is_browser_local && !cut.id.startsWith('preview_')) {
      try {
        await deleteJob(cut.job_id);
        setLibraryCuts((prev) => prev.filter((item) => item.job_id !== cut.job_id));
      } catch {
        setErrorMessage('Não foi possível excluir este item no servidor.');
      }
    } else {
      setLibraryCuts((prev) => prev.filter((item) => item.id !== cut.id));
    }
  };

  return (
    <div className="app-shell" id="top">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        libraryCount={libraryCuts.length}
        backendHealth={backendHealth}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="main-container">
        {activeTab === 'studio' && (
          <>
            <div className="page-header">
              <div>
                <h1>Cortes automáticos dos melhores momentos</h1>
                <p className="page-subtitle">
                  Detecte mudanças de cena, picos de áudio e alta ação automaticamente para gerar
                  cortes prontos em 16:9, 1:1 e 9:16.
                </p>
              </div>
              <span className="mono-tag">
                {backendHealth.online
                  ? `Fair-Use: ${fairUse.active_jobs}/${fairUse.max_concurrent_jobs} ativos`
                  : 'Hospedagem Estática / Híbrida'}
              </span>
            </div>

            {!backendHealth.online && (
              <div className="mode-callout">
                <span>
                  <strong>Modo Navegador Ativo:</strong> envie um{' '}
                  <strong>Arquivo Local</strong> para análise real (cenas + áudio) e exportação de
                  clipes no navegador, ou conecte seu servidor FastAPI para baixar vídeos do YouTube
                  em 4K.
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setSettingsOpen(true)}
                >
                  <span>Conectar API FastAPI</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            )}

            <div className="studio-grid">
              <JobComposer
                sourceMode={sourceMode}
                onChangeSourceMode={setSourceMode}
                url={url}
                onChangeUrl={setUrl}
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
                cutLength={cutLength}
                onChangeCutLength={setCutLength}
                formats={formats}
                onToggleFormat={handleToggleFormat}
                options={options}
                onChangeOptions={setOptions}
                isProcessing={isProcessing}
                errorMessage={errorMessage}
                backendHealth={backendHealth}
                onSubmit={handleSubmit}
              />

              <StudioMonitor
                url={url}
                localFileUrl={localFileUrl}
                currentJob={currentJob}
                activeCut={activeCut}
                onSelectCut={setActiveCut}
                backendOnline={backendHealth.online}
                onRequireBackend={() => setSettingsOpen(true)}
              />
            </div>
          </>
        )}

        {activeTab === 'library' && (
          <LibraryView
            cuts={libraryCuts}
            backendOnline={backendHealth.online}
            onPreviewCut={handlePreviewFromLibrary}
            onDeleteCut={handleDeleteCut}
            onGoToStudio={() => setActiveTab('studio')}
            onRequireBackend={() => setSettingsOpen(true)}
          />
        )}

        {activeTab === 'fair-use' && (
          <FairUseView
            fairUse={fairUse}
            backendHealth={backendHealth}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>CortaFlow • Pipeline Open-Source (yt-dlp, FFmpeg, OpenCV, FastAPI, React)</span>
          <span>Plano Gratuito Ilimitado com Política Fair-Use</span>
        </div>
      </footer>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onUpdatedHealth={(health) => {
          refreshBackendState(health);
        }}
      />
    </div>
  );
}

export default App;
