import type { FormatType } from '../types';

export interface FormatSpec {
  id: FormatType;
  label: string;
  dimensions: string;
  width: number;
  height: number;
  aspectClass: 'w-16-9' | 'w-1-1' | 'w-9-16';
  ratioLabel: '16:9' | '1:1' | '9:16';
  maxDuration: number | null;
  bitrate: string;
}

export const FORMAT_CATALOG: FormatSpec[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    dimensions: '1920×1080',
    width: 1920,
    height: 1080,
    aspectClass: 'w-16-9',
    ratioLabel: '16:9',
    maxDuration: null,
    bitrate: '8–15 Mbps',
  },
  {
    id: 'shorts',
    label: 'Shorts',
    dimensions: '1920×1920',
    width: 1920,
    height: 1920,
    aspectClass: 'w-1-1',
    ratioLabel: '1:1',
    maxDuration: 60,
    bitrate: '5–10 Mbps',
  },
  {
    id: 'reels',
    label: 'Reels',
    dimensions: '1080×1920',
    width: 1080,
    height: 1920,
    aspectClass: 'w-9-16',
    ratioLabel: '9:16',
    maxDuration: 60,
    bitrate: '5–10 Mbps',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    dimensions: '1080×1920',
    width: 1080,
    height: 1920,
    aspectClass: 'w-9-16',
    ratioLabel: '9:16',
    maxDuration: 60,
    bitrate: '5–10 Mbps',
  },
];

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const regex of patterns) {
    const match = url.match(regex);
    if (match && match[1]) return match[1];
  }
  return null;
}

export function detectSourceLabel(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.includes('youtube.com/shorts')) return 'YouTube Shorts';
  if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) return 'YouTube (até 4K)';
  if (trimmed.includes('vimeo.com')) return 'Vimeo';
  if (trimmed.includes('twitch.tv')) return 'Twitch';
  if (/\.(mp4|mov|mkv|webm)(\?|$)/.test(trimmed)) return 'Stream Direto FFmpeg';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return 'Link de Vídeo';
  return '';
}

export function getOrCreateClientId(): string {
  const key = 'cortaflow_client_id';
  try {
    let existing = localStorage.getItem(key);
    if (!existing) {
      existing = `cf_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, existing);
    }
    return existing;
  } catch {
    return 'cf_browser';
  }
}
