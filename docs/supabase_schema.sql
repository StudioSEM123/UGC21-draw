-- UGC Finder v2 - Supabase Schema
-- Last Updated: 2026-02-10
-- Matches live Supabase database (52 columns)
--
-- Canonical schema is at: 21draw-ugc-pipeline/database/schema.sql
-- This file is kept for reference in the docs folder.

-- See 21draw-ugc-pipeline/database/schema.sql for the full CREATE TABLE statements.
-- Below are convenience views and sample queries only.

-- View for pending reviews
CREATE OR REPLACE VIEW pending_reviews AS
SELECT
    username,
    followers,
    engagement_rate,
    profile_score,
    recommendation,
    reel_1_url,
    reel_2_url,
    reel_3_url,
    manual_review_notes,
    analyzed_at
FROM profiles
WHERE status IN ('ANALYZED', 'VIDEO_ANALYZED')
ORDER BY
    CASE recommendation
        WHEN 'COLLABORATE' THEN 1
        WHEN 'REVIEW' THEN 2
        ELSE 3
    END,
    profile_score DESC;

-- Sample queries for reporting
/*
-- Count by status
SELECT status, COUNT(*) FROM profiles GROUP BY status;

-- Top rated profiles
SELECT username, profile_score, recommendation
FROM profiles
WHERE recommendation IN ('COLLABORATE', 'REVIEW')
ORDER BY profile_score DESC
LIMIT 20;

-- Profiles by source
SELECT source, COUNT(*) as count, AVG(profile_score) as avg_score
FROM profiles
GROUP BY source
ORDER BY count DESC;

-- Pipeline funnel
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'NEW') as new,
    COUNT(*) FILTER (WHERE status = 'ENRICHED') as enriched,
    COUNT(*) FILTER (WHERE status = 'ANALYZED') as analyzed,
    COUNT(*) FILTER (WHERE status = 'VIDEO_ANALYZED') as video_analyzed
FROM profiles;
*/
