-- UGC Finder v2 - Supabase Schema Reference
-- Last Updated: 2026-02-21
-- Matches live Supabase database (62 columns in profiles, 8 tables total)
--
-- Canonical schema is at: 21draw-ugc-pipeline/database/schema.sql
-- This file is kept for quick reference in the docs folder.

-- ══════════════════════════════════════════════════════════════════════════
-- TABLES OVERVIEW
-- ══════════════════════════════════════════════════════════════════════════
-- profiles          — 177 rows, 62 columns (main pipeline data)
-- human_reviews     — 130 rows (approve/deny decisions)
-- ai_logs           — 682 rows (Claude + Gemini audit trail)
-- seen_profiles     — 174 rows (deduplication)
-- skipped_profiles  — 544 rows (skip reasons per stage)
-- top_videos        — 0 rows (reserved for future use)
-- debug_log         — 62 rows (temporary debugging)

-- ══════════════════════════════════════════════════════════════════════════
-- KEY COLUMN GROUPS (profiles table)
-- ══════════════════════════════════════════════════════════════════════════
-- Identity:        id, username, profile_url (generated), status, verified, analyzed_at, prompt_version,
--                  profile_type (UGC_CREATOR/COURSE_TEACHER/BOTH), discovery_mode (ugc/teacher/both)
-- Source:          source, source_type
-- Profile metrics: followers, engagement_rate, bio, has_art_content, avg_likes, avg_comments
-- Claude (Phase 1): niche_relevance, profile_score, recommendation, reasoning, content_style,
--                   course_teacher_score (1-10), suggested_type (UGC_CREATOR/COURSE_TEACHER/BOTH)
-- Gemini (Phase 2): talks_in_videos, speaks_english, voice_potential, teaching_potential,
--                   brand_fit, production_quality, overall_ugc_score, video_recommendation,
--                   ugc_reasoning, next_steps, audio_description, speech_quote, videos_with_speech
-- Reel data:       reel_1-3 (url, post_url, likes, comments, duration, caption)
--                  avg_duration, total_reels_found
-- Storage:         reel_1-3_storage_path, videos_downloaded
-- Manual:          manual_review_notes

-- ══════════════════════════════════════════════════════════════════════════
-- VIEWS
-- ══════════════════════════════════════════════════════════════════════════

-- View for pending reviews (used by review app)
CREATE OR REPLACE VIEW pending_reviews AS
SELECT
    username, followers, engagement_rate,
    profile_score, recommendation,
    reel_1_post_url, reel_2_post_url, reel_3_post_url,
    videos_downloaded,
    manual_review_notes, analyzed_at
FROM profiles
WHERE status IN ('ANALYZED', 'VIDEO_ANALYZED', 'PENDING_REVIEW')
ORDER BY
    CASE recommendation
        WHEN 'COLLABORATE' THEN 1
        WHEN 'REVIEW' THEN 2
        ELSE 3
    END,
    profile_score DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- USEFUL QUERIES
-- ══════════════════════════════════════════════════════════════════════════

-- Count by recommendation
-- SELECT recommendation, COUNT(*) FROM profiles GROUP BY recommendation ORDER BY count DESC;

-- Count by status
-- SELECT status, COUNT(*) FROM profiles GROUP BY status ORDER BY count DESC;

-- Human review summary
-- SELECT decision, COUNT(*) FROM human_reviews GROUP BY decision;

-- Approved profiles needing Phase 2 (Gemini)
-- SELECT p.username, p.followers, p.profile_score, p.recommendation
-- FROM profiles p
-- JOIN human_reviews hr ON hr.profile_username = p.username
-- WHERE hr.decision = 'APPROVED' AND p.overall_ugc_score IS NULL
-- ORDER BY p.profile_score DESC;

-- Top rated profiles with Gemini data
-- SELECT username, profile_score, overall_ugc_score, video_recommendation
-- FROM profiles
-- WHERE overall_ugc_score IS NOT NULL
-- ORDER BY overall_ugc_score DESC;

-- Pipeline funnel
-- SELECT
--     COUNT(*) as total,
--     COUNT(*) FILTER (WHERE status = 'PENDING_REVIEW') as pending_review,
--     COUNT(*) FILTER (WHERE status = 'HUMAN_REVIEWED') as human_reviewed,
--     COUNT(*) FILTER (WHERE status = 'VIDEO_ANALYZED') as video_analyzed,
--     COUNT(*) FILTER (WHERE overall_ugc_score IS NOT NULL) as has_gemini_data,
--     COUNT(*) FILTER (WHERE videos_downloaded = true) as has_videos
-- FROM profiles;

-- Storage usage (profiles with videos)
-- SELECT username, reel_1_storage_path, reel_2_storage_path, reel_3_storage_path
-- FROM profiles WHERE videos_downloaded = true ORDER BY username;
