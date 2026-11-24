-- Schema PostgreSQL para o CortaFlow (Auto-Cut Video)
-- Compatível com PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(128) NOT NULL DEFAULT 'anonymous',
    youtube_url TEXT NOT NULL,
    video_title TEXT DEFAULT '',
    video_duration DOUBLE PRECISION DEFAULT 0,
    cut_length INTEGER NOT NULL DEFAULT 15,
    formats TEXT NOT NULL DEFAULT '["youtube","shorts"]',
    status VARCHAR(32) NOT NULL DEFAULT 'queued', -- queued, downloading, analyzing, cutting, uploading, completed, failed
    progress INTEGER NOT NULL DEFAULT 0,
    stage_message TEXT DEFAULT '',
    error_message TEXT DEFAULT '',
    moments_json TEXT DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS cuts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL DEFAULT 'anonymous',
    format VARCHAR(32) NOT NULL, -- youtube, shorts, reels, tiktok
    resolution VARCHAR(32) NOT NULL DEFAULT '1080p',
    start_time DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 15,
    score DOUBLE PRECISION NOT NULL DEFAULT 0,
    scene_hits INTEGER NOT NULL DEFAULT 0,
    audio_hits INTEGER NOT NULL DEFAULT 0,
    action_hits INTEGER NOT NULL DEFAULT 0,
    storage_key TEXT NOT NULL,
    url TEXT NOT NULL,
    thumbnail_url TEXT DEFAULT '',
    file_size_bytes BIGINT DEFAULT 0,
    download_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_cuts_job_id ON cuts (job_id);
CREATE INDEX IF NOT EXISTS idx_cuts_user_format ON cuts (user_id, format);
