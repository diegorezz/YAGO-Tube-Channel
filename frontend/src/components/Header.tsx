import { Film, FolderHeart, Moon, Scissors, Server, ShieldCheck, Sun } from 'lucide-react';
import type { ActiveTab, BackendHealth } from '../types';

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  libraryCount: number;
  backendHealth: BackendHealth;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export function Header({
  activeTab,
  onSelectTab,
  libraryCount,
  backendHealth,
  theme,
  onToggleTheme,
  onOpenSettings,
}: HeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a
          href="#top"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('studio');
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            <Scissors size={17} strokeWidth={2.2} />
          </span>
          <span>CortaFlow</span>
        </a>

        <nav className="nav-tabs" aria-label="Navegação principal">
          <button
            id="nav-tab-studio"
            type="button"
            className={`nav-tab ${activeTab === 'studio' ? 'active' : ''}`}
            onClick={() => onSelectTab('studio')}
          >
            <Film size={15} />
            <span>Estúdio</span>
          </button>
          <button
            id="nav-tab-library"
            type="button"
            className={`nav-tab ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => onSelectTab('library')}
          >
            <FolderHeart size={15} />
            <span>Biblioteca</span>
            {libraryCount > 0 && <span className="nav-badge">{libraryCount}</span>}
          </button>
          <button
            id="nav-tab-fair-use"
            type="button"
            className={`nav-tab ${activeTab === 'fair-use' ? 'active' : ''}`}
            onClick={() => onSelectTab('fair-use')}
          >
            <ShieldCheck size={15} />
            <span>Fair-Use</span>
          </button>
        </nav>

        <div className="topbar-actions">
          <button
            id="btn-backend-settings"
            type="button"
            className="status-btn"
            onClick={onOpenSettings}
            title="Configurar servidor FastAPI ou modo navegador"
          >
            <span className={`status-dot ${backendHealth.online ? 'online' : ''}`} />
            <Server size={14} />
            <span className="status-label-text">
              {backendHealth.online ? 'API Conectada' : 'Modo Navegador'}
            </span>
          </button>

          <button
            id="btn-toggle-theme"
            type="button"
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </header>
  );
}
