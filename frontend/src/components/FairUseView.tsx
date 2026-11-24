import { CheckCircle2, Cloud, Cpu, Database, ShieldCheck } from 'lucide-react';
import type { BackendHealth, FairUseStatus } from '../types';

interface FairUseViewProps {
  fairUse: FairUseStatus;
  backendHealth: BackendHealth;
  onOpenSettings: () => void;
}

export function FairUseView({ fairUse, backendHealth, onOpenSettings }: FairUseViewProps) {
  return (
    <section aria-labelledby="fairuse-heading">
      <div className="page-header">
        <div>
          <h1 id="fairuse-heading">Plano Gratuito Ilimitado & Fair-Use</h1>
          <p className="page-subtitle">
            O CortaFlow oferece cortes tecnicamente ilimitados mantendo os custos de servidor sob
            controle através de políticas automáticas de uso justo e retenção inteligente.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onOpenSettings}>
          Configurar Backend API
        </button>
      </div>

      <div className="metrics-grid">
        <div className="metric-tile">
          <span className="metric-label">Plano Atual</span>
          <span className="metric-value" style={{ fontSize: '1.22rem' }}>
            {fairUse.tier}
          </span>
          <p className="metric-sub">{fairUse.priority_tier}</p>
        </div>

        <div className="metric-tile">
          <span className="metric-label">Jobs Simultâneos</span>
          <span className="metric-value">
            {fairUse.active_jobs} / {fairUse.max_concurrent_jobs}
          </span>
          <p className="metric-sub">Evita sobrecarga de CPU/FFmpeg</p>
        </div>

        <div className="metric-tile">
          <span className="metric-label">Cortes nas Últimas 24h</span>
          <span className="metric-value">
            {fairUse.jobs_last_24h} / {fairUse.soft_daily_limit}*
          </span>
          <p className="metric-sub">*Limite suave: após isso entra na fila econômica</p>
        </div>

        <div className="metric-tile">
          <span className="metric-label">Retenção na Biblioteca</span>
          <span className="metric-value">{fairUse.retention_hours}h</span>
          <p className="metric-sub">URLs assinadas S3 / Limpeza automática</p>
        </div>
      </div>

      <div className="two-col-info">
        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">
              <ShieldCheck size={18} style={{ color: 'var(--signal-success)' }} />
              <span>Regras de Gestão de Custo (Fair-Use)</span>
            </h2>
          </div>
          <ul className="policy-list">
            <li>
              <CheckCircle2 size={16} style={{ color: 'var(--signal-success)', flexShrink: 0, marginTop: 3 }} />
              <span>
                <strong>Sem bloqueio rígido mensal:</strong> após {fairUse.soft_daily_limit} jobs
                em 24h, seus envios continuam gratuitos na fila econômica de menor prioridade.
              </span>
            </li>
            <li>
              <CheckCircle2 size={16} style={{ color: 'var(--signal-success)', flexShrink: 0, marginTop: 3 }} />
              <span>
                <strong>Teto inteligente por vídeo:</strong> até {fairUse.max_clips_per_job} cortes
                ranqueados por vídeo e duração máxima de {fairUse.max_video_minutes} minutos por job.
              </span>
            </li>
            <li>
              <CheckCircle2 size={16} style={{ color: 'var(--signal-success)', flexShrink: 0, marginTop: 3 }} />
              <span>
                <strong>Expiração automática (TTL):</strong> os arquivos temporários são removidos
                logo após o corte e os clipes expiram após {fairUse.retention_hours}h para manter o
                S3 enxuto.
              </span>
            </li>
            <li>
              <CheckCircle2 size={16} style={{ color: 'var(--signal-success)', flexShrink: 0, marginTop: 3 }} />
              <span>
                <strong>Modo Híbrido no Navegador:</strong> arquivos locais podem ser analisados e
                exportados diretamente no dispositivo do usuário a custo zero de servidor.
              </span>
            </li>
          </ul>
        </div>

        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">
              <Cloud size={18} style={{ color: 'var(--accent)' }} />
              <span>Status da Arquitetura & Deploy GitHub</span>
            </h2>
            <span className="mono-tag">{backendHealth.online ? 'ONLINE' : 'ESTÁTICO'}</span>
          </div>
          <ul className="policy-list" style={{ marginBottom: '1rem' }}>
            <li>
              <Cpu size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 3 }} />
              <span>
                <strong>Worker:</strong>{' '}
                {backendHealth.online
                  ? `${backendHealth.worker} • FFmpeg ${backendHealth.ffmpeg_available ? 'ativo' : 'indisponível'} • YOLO ${backendHealth.yolo_enabled ? 'ativo' : 'modo leve OpenCV'}`
                  : 'Motor local do navegador (Canvas + Web Audio API)'}
              </span>
            </li>
            <li>
              <Database size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 3 }} />
              <span>
                <strong>Armazenamento:</strong>{' '}
                {backendHealth.online
                  ? backendHealth.storage === 's3'
                    ? 'Amazon S3 / R2 com URLs assinadas'
                    : 'Disco local persistente do container'
                  : 'Sessão privada no navegador'}
              </span>
            </li>
          </ul>
          <pre className="code-block">
{`# Deploy rápido via GitHub:
1. GitHub Pages: push na branch main (Workflow já incluso)
2. Full-Stack (Render/Railway): conecte o repo usando render.yaml ou Dockerfile
3. Local completo: docker compose up --build`}
          </pre>
        </div>
      </div>
    </section>
  );
}
