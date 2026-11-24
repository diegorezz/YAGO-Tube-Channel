export type FormatType = 'youtube' | 'shorts' | 'reels' | 'tiktok';

export type ResolutionType = 'original' | '4k' | '1080p' | '720p' | '480p';

export type ActiveTab = 'studio' | 'library' | 'fair-use';

export type SourceMode = 'url' | 'file';

export interface PipelineOptions {
  scene_threshold: number;
  audio_db_threshold: number;
  use_action_detection: boolean;
  weight_scene: number;
  weight_audio: number;
  weight_action: number;
  max_clips: number;
  preferred_quality: ResolutionType;
}

export interface MomentItem {
  rank: number;
  timestamp: number;
  start: number;
  end: number;
  score: number;
  scene_hits: number;
  audio_hits: number;
  action_hits: number;
  label: string;
}

export interface CutItem {
  id: string;
  job_id: string;
  format: FormatType;
  resolution: string;
  start_time: number;
  duration: number;
  score: number;
  scene_hits: number;
  audio_hits: number;
  action_hits: number;
  url: string;
  thumbnail_url: string;
  file_size_bytes: number;
  download_count: number;
  video_title: string;
  source_url: string;
  created_at: string;
  is_browser_local?: boolean;
  local_file_url?: string;
}

export interface JobItem {
  job_id: string;
  youtube_url: string;
  video_title: string;
  video_duration: number;
  cut_length: number;
  formats: FormatType[];
  status: 'queued' | 'downloading' | 'analyzing' | 'cutting' | 'uploading' | 'completed' | 'failed';
  progress: number;
  stage_message: string;
  error_message?: string;
  moments: MomentItem[];
  cuts: CutItem[];
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
}

export interface FairUseStatus {
  tier: string;
  active_jobs: number;
  max_concurrent_jobs: number;
  jobs_last_24h: number;
  soft_daily_limit: number;
  priority_tier: string;
  cooldown_seconds: number;
  max_clips_per_job: number;
  max_video_minutes: number;
  retention_hours: number;
  can_submit: boolean;
  notice: string;
}

export interface BackendHealth {
  online: boolean;
  storage?: string;
  worker?: string;
  yolo_enabled?: boolean;
  ffmpeg_available?: boolean;
}
