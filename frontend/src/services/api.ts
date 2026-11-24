import axios from 'axios';
import type {
  BackendHealth,
  CutItem,
  FairUseStatus,
  FormatType,
  JobItem,
  PipelineOptions,
  ResolutionType,
} from '../types';
import { getOrCreateClientId } from '../utils/formatters';

const API_URL_STORAGE_KEY = 'cortaflow_api_url';

export function getSavedApiBaseUrl(): string {
  try {
    const saved = localStorage.getItem(API_URL_STORAGE_KEY);
    if (saved !== null) return saved.trim().replace(/\/+$/, '');
  } catch {
    // ignore storage errors
  }
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined) || '';
  return envUrl.trim().replace(/\/+$/, '');
}

export function setSavedApiBaseUrl(url: string): void {
  try {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (!cleaned) {
      localStorage.removeItem(API_URL_STORAGE_KEY);
    } else {
      localStorage.setItem(API_URL_STORAGE_KEY, cleaned);
    }
  } catch {
    // ignore storage errors
  }
}

function createClient(baseUrl?: string) {
  const resolvedBase = baseUrl !== undefined ? baseUrl : getSavedApiBaseUrl();
  return axios.create({
    baseURL: resolvedBase || undefined,
    timeout: 60000,
    headers: {
      'X-User-Id': getOrCreateClientId(),
    },
  });
}

export function resolveMediaUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (
    pathOrUrl.startsWith('http://') ||
    pathOrUrl.startsWith('https://') ||
    pathOrUrl.startsWith('blob:') ||
    pathOrUrl.startsWith('data:')
  ) {
    return pathOrUrl;
  }
  const base = getSavedApiBaseUrl();
  return base ? `${base}${pathOrUrl}` : pathOrUrl;
}

export async function checkBackendHealth(customBaseUrl?: string): Promise<BackendHealth> {
  try {
    const client = createClient(customBaseUrl);
    const res = await client.get('/api/health', { timeout: 3500 });
    if (res.data && res.data.status === 'ok') {
      return {
        online: true,
        storage: res.data.storage,
        worker: res.data.worker,
        yolo_enabled: res.data.yolo_enabled,
        ffmpeg_available: res.data.ffmpeg_available,
      };
    }
    return { online: false };
  } catch {
    return { online: false };
  }
}

export async function fetchFairUseStatus(): Promise<FairUseStatus> {
  const client = createClient();
  const res = await client.get<FairUseStatus>('/api/fair-use');
  return res.data;
}

export async function submitUrlJob(
  url: string,
  cutLength: number,
  formats: FormatType[],
  options: PipelineOptions,
): Promise<JobItem> {
  const client = createClient();
  const res = await client.post<JobItem>('/api/jobs', {
    url,
    cutLength,
    formats,
    options,
  });
  return res.data;
}

export async function submitFileJob(
  file: File,
  cutLength: number,
  formats: FormatType[],
  options: PipelineOptions,
): Promise<JobItem> {
  const client = createClient();
  const form = new FormData();
  form.append('file', file);
  form.append('cut_length', String(cutLength));
  form.append('formats', JSON.stringify(formats));
  form.append('options_json', JSON.stringify(options));

  const res = await client.post<JobItem>('/api/jobs/upload', form, {
    timeout: 300000,
  });
  return res.data;
}

export async function fetchJob(jobId: string): Promise<JobItem> {
  const client = createClient();
  const res = await client.get<JobItem>(`/api/jobs/${jobId}`);
  return res.data;
}

export async function fetchLibrary(format?: FormatType | 'all', search?: string): Promise<CutItem[]> {
  const client = createClient();
  const params: Record<string, string> = {};
  if (format && format !== 'all') params.format = format;
  if (search && search.trim()) params.search = search.trim();
  const res = await client.get<CutItem[]>('/api/library', { params });
  return res.data;
}

export async function deleteJob(jobId: string): Promise<void> {
  const client = createClient();
  await client.delete(`/api/jobs/${jobId}`);
}

export function buildCutDownloadUrl(cutId: string, resolution: ResolutionType = 'original'): string {
  const base = getSavedApiBaseUrl();
  const path = `/api/cuts/${cutId}/download?resolution=${encodeURIComponent(resolution)}`;
  return base ? `${base}${path}` : path;
}

export function subscribeJobUpdates(
  jobId: string,
  onUpdate: (update: Partial<JobItem>) => void,
  onError?: (err: string) => void,
): () => void {
  const base = getSavedApiBaseUrl();
  let wsUrl = '';
  if (base) {
    wsUrl = base.replace(/^http/i, 'ws') + `/ws/${jobId}`;
  } else {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${proto}//${window.location.host}/ws/${jobId}`;
  }

  let closed = false;
  let ws: WebSocket | null = null;
  let pollTimer: number | null = null;

  const startPolling = () => {
    if (pollTimer !== null || closed) return;
    pollTimer = window.setInterval(async () => {
      if (closed) return;
      try {
        const job = await fetchJob(jobId);
        onUpdate(job);
        if (job.status === 'completed' || job.status === 'failed') {
          cleanup();
        }
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Falha ao consultar status do job.');
      }
    }, 2000);
  };

  try {
    ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onUpdate(data);
        if (data.status === 'completed' || data.status === 'failed') {
          cleanup();
        }
      } catch {
        // ignore malformed message
      }
    };
    ws.onerror = () => {
      startPolling();
    };
    ws.onclose = () => {
      if (!closed) startPolling();
    };
  } catch {
    startPolling();
  }

  const cleanup = () => {
    closed = true;
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
    }
  };

  return cleanup;
}
