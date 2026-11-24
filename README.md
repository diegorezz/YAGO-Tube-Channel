# CortaFlow — Cortes Automáticos Inteligentes de Vídeos

Aplicação web responsiva e completa para extrair automaticamente os melhores momentos de vídeos (YouTube até 4K, links diretos ou arquivos locais), cortar nos formatos **YouTube (16:9)**, **Shorts (1:1)**, **Reels (9:16)** e **TikTok (9:16)**, salvar em uma **Biblioteca Privada** e gerenciar custos através de uma **política Fair-Use**.

---

## Arquitetura Incluída

- **Frontend (`frontend/`)**: React + TypeScript + Vite com design responsivo (tema escuro/claro), monitor de estúdio com guia de recorte (`16:9`, `1:1`, `9:16`), linha do tempo interativa de momentos, biblioteca privada e painel Fair-Use.
  - **Modo Híbrido Inteligente**:
    - **Com Backend FastAPI conectado**: baixa vídeos do YouTube em até 4K (`yt-dlp`), executa OpenCV + FFmpeg + NumPy + YOLO (opcional), envia progresso em tempo real via WebSocket (`/ws/{job_id}`) e exporta MP4 em múltiplas resoluções (`Original`, `4K`, `1080p`, `720p`, `480p`).
    - **No GitHub Pages (sem servidor)**: funciona imediatamente como estúdio local no navegador — analisa arquivos de vídeo locais usando Canvas Frame Diff + Web Audio API dB Peaks e exporta clipes `.webm` recortados direto no dispositivo, além de permitir conectar sua URL da API FastAPI a qualquer momento no menu superior.
- **Backend (`backend/`)**: FastAPI + WebSockets + SQLAlchemy (SQLite zero-config ou PostgreSQL) + Celery/Redis opcional + adaptador unificado de armazenamento **Amazon S3 / R2 + CloudFront (URLs assinadas)** com fallback local automático.

---

## Como Hospedar Facilmente pelo GitHub

### Opção 1: Deploy Grátis no GitHub Pages (Frontend em 2 minutos)

1. Crie um repositório no GitHub e envie todo o conteúdo desta pasta:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: CortaFlow app"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/cortaflow-app.git
   git push -u origin main
   ```
2. No GitHub, acesse **Settings → Pages → Build and deployment → Source** e selecione **GitHub Actions**.
3. O workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) será executado automaticamente e publicará seu app em `https://SEU_USUARIO.github.io/cortaflow-app/`.
4. *(Opcional)* Se você hospedar o backend no Render/Railway, defina a variável `VITE_API_URL` em **Settings → Secrets and variables → Actions → Variables** (ou cole a URL diretamente no botão **Modo Navegador / API Conectada** dentro do próprio site).

---

### Opção 2: Deploy Full-Stack (Frontend + API FastAPI + FFmpeg) via GitHub no Render / Railway

Este projeto já inclui um `Dockerfile` multi-stage que compila o React e serve o frontend + API FastAPI juntos na mesma porta, além do arquivo `render.yaml`:

1. Suba o projeto para o seu repositório no GitHub.
2. No **Render** (`dashboard.render.com/blueprints`) ou **Railway**:
   - Clique em **New Blueprint / New Project → Deploy from GitHub repo** e selecione seu repositório.
   - O `render.yaml` / `Dockerfile` instalará `ffmpeg`, `yt-dlp`, `opencv`, `fastapi` e servirá a interface completa automaticamente.
3. Para usar **Amazon S3 / Cloudflare R2 / PostgreSQL**, configure as variáveis do arquivo `.env.example` no painel do provedor.

---

### Opção 3: Rodar Localmente (Desenvolvimento ou Docker Compose)

#### Com Docker Compose (Stack completa com PostgreSQL + Redis + Celery Worker)
```bash
cp .env.example .env
docker compose up --build
```
Acesse: `http://localhost:8000`

#### Sem Docker (Desenvolvimento rápido)
**1. Backend (requer Python 3.12+ e FFmpeg instalado):**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Opcional para YOLOv5/v8: pip install -r requirements-ml.txt
uvicorn app.main:app --reload --port 8000
```

**2. Frontend (Node.js 20+):**
```bash
cd frontend
npm install
npm run dev
```
Acesse: `http://localhost:5173` (proxy automático para `/api` e `/ws` na porta `8000`).

---

## Endpoints Principais da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/health` | Status da API, FFmpeg, worker e storage |
| `GET` | `/api/fair-use` | Cotas em tempo real da política Fair-Use |
| `POST` | `/api/jobs` | Cria um job a partir de URL (YouTube até 4K ou link direto) |
| `POST` | `/api/jobs/upload` | Cria um job a partir de upload de arquivo local |
| `GET` | `/api/jobs/{job_id}` | Consulta progresso, momentos ranqueados e cortes |
| `DELETE` | `/api/jobs/{job_id}` | Remove job e arquivos associados |
| `GET` | `/api/library` | Lista cortes da biblioteca privada (filtros por formato e busca) |
| `GET` | `/api/cuts/{cut_id}/download?resolution=1080p` | Download em `original`, `4k`, `1080p`, `720p` ou `480p` |
| `WS` | `/ws/{job_id}` | Progresso do pipeline em tempo real |
