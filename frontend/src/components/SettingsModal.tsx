import { useState } from 'react';
import { CheckCircle2, Loader2, Server, X, XCircle } from 'lucide-react';
import { checkBackendHealth, getSavedApiBaseUrl, setSavedApiBaseUrl } from '../services/api';
import type { BackendHealth } from '../types';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onUpdatedHealth: (health: BackendHealth) => void;
}

export function SettingsModal({ open, onClose, onUpdatedHealth }: SettingsModalProps) {
  const [apiUrl, setApiUrl] = useState(() => getSavedApiBaseUrl());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) return null;

  const handleTestAndSave = async () => {
    setTesting(true);
    setTestResult(null);
    const cleaned = apiUrl.trim().replace(/\/+$/, '');
    const health = await checkBackendHealth(cleaned);
    setTesting(false);

    if (health.online) {
      setSavedApiBaseUrl(cleaned);
      onUpdatedHealth(health);
      setTestResult({
        ok: true,
        text: `Conectado com sucesso! Worker: ${health.worker || 'fastapi'}, Storage: ${health.storage || 'local'}.`,
      });
    } else {
      setTestResult({
        ok: false,
        text: 'Não foi possível alcançar /api/health neste endereço. Verifique se a API FastAPI está rodando e com CORS liberado.',
      });
    }
  };

  const handleUseBrowserMode = () => {
    setApiUrl('');
    setSavedApiBaseUrl('');
    onUpdatedHealth({ online: false });
    setTestResult(null);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog">
        <div className="modal-header">
          <h2 id="settings-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Server size={18} style={{ color: 'var(--accent)' }} />
            <span>Conexão com Servidor FastAPI</span>
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar modal">
            <X size={16} />
          </button>
        </div>

        <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          Se o frontend estiver no <strong>GitHub Pages</strong>, informe abaixo a URL pública do
          seu backend FastAPI (ex: Render, Railway ou Fly.io) para ativar downloads 4K com{' '}
          <code>yt-dlp</code> e cortes <code>FFmpeg</code>. Deixe vazio se estiver no mesmo domínio
          (Docker / Render unificado) ou use o <strong>Modo Navegador</strong> para arquivos locais.
        </p>

        <div className="field-group">
          <label htmlFor="api-base-url-input" className="field-label" style={{ display: 'block', marginBottom: '0.4rem' }}>
            URL do Backend API
          </label>
          <input
            id="api-base-url-input"
            type="url"
            className="text-input"
            placeholder="https://cortaflow-api.onrender.com (ou http://localhost:8000)"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
          />
        </div>

        {testResult && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              padding: '0.7rem 0.85rem',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.83rem',
              background: testResult.ok ? 'rgba(46, 158, 107, 0.14)' : 'rgba(220, 59, 59, 0.12)',
              color: testResult.ok ? 'var(--signal-success)' : 'var(--signal-danger)',
            }}
          >
            {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>{testResult.text}</span>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={handleUseBrowserMode}>
            Usar Modo Navegador
          </button>
          <button
            id="btn-save-api-url"
            type="button"
            className="btn-primary"
            style={{ width: 'auto' }}
            onClick={handleTestAndSave}
            disabled={testing}
          >
            {testing ? <Loader2 size={16} className="spin" /> : null}
            <span>{testing ? 'Testando...' : 'Testar e Salvar'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
