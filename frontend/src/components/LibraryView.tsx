import { useMemo, useState } from 'react';
import { FolderOpen, Search } from 'lucide-react';
import type { CutItem, FormatType } from '../types';
import { CutCard } from './CutCard';

interface LibraryViewProps {
  cuts: CutItem[];
  backendOnline: boolean;
  onPreviewCut: (cut: CutItem) => void;
  onDeleteCut: (cut: CutItem) => void;
  onGoToStudio: () => void;
  onRequireBackend: () => void;
}

const FORMAT_FILTERS: Array<{ id: FormatType | 'all'; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'reels', label: 'Reels' },
  { id: 'tiktok', label: 'TikTok' },
];

export function LibraryView({
  cuts,
  backendOnline,
  onPreviewCut,
  onDeleteCut,
  onGoToStudio,
  onRequireBackend,
}: LibraryViewProps) {
  const [formatFilter, setFormatFilter] = useState<FormatType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'score'>('recent');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cuts
      .filter((c) => (formatFilter === 'all' ? true : c.format === formatFilter))
      .filter((c) => {
        if (!term) return true;
        return (
          c.video_title.toLowerCase().includes(term) ||
          c.format.toLowerCase().includes(term) ||
          c.source_url.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        if (sortBy === 'score') return b.score - a.score;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [cuts, formatFilter, search, sortBy]);

  return (
    <section aria-labelledby="library-heading">
      <div className="page-header">
        <div>
          <h1 id="library-heading">Biblioteca Privada</h1>
          <p className="page-subtitle">
            Todos os cortes salvos da sua sessão ou vinculados ao armazenamento privado (S3 / Local),
            prontos para download em qualquer resolução.
          </p>
        </div>
        <span className="mono-tag">{filtered.length} corte(s) exibido(s)</span>
      </div>

      <div className="toolbar-row">
        <div className="filter-pills" role="group" aria-label="Filtrar por formato">
          {FORMAT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`filter-pill ${formatFilter === f.id ? 'active' : ''}`}
              onClick={() => setFormatFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="input-wrap" style={{ minWidth: '220px' }}>
            <Search size={15} className="input-icon" />
            <input
              id="library-search-input"
              type="search"
              className="text-input with-icon"
              placeholder="Buscar título ou link..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingTop: '0.5rem', paddingBottom: '0.5rem' }}
            />
          </div>
          <select
            aria-label="Ordenar cortes"
            className="select-input"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'score')}
            style={{ width: 'auto', paddingTop: '0.5rem', paddingBottom: '0.5rem' }}
          >
            <option value="recent">Mais recentes</option>
            <option value="score">Maior pontuação</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <FolderOpen size={36} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          <h3>Sua biblioteca ainda está vazia</h3>
          <p>
            Processe uma URL do YouTube ou carregue um vídeo local no Estúdio para gerar e salvar
            seus primeiros cortes automaticamente.
          </p>
          <button type="button" className="btn-secondary" onClick={onGoToStudio}>
            Ir para o Estúdio
          </button>
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((cut) => (
            <CutCard
              key={cut.id}
              cut={cut}
              variant="grid"
              backendOnline={backendOnline}
              onPreview={onPreviewCut}
              onDelete={onDeleteCut}
              onRequireBackend={onRequireBackend}
            />
          ))}
        </div>
      )}
    </section>
  );
}
