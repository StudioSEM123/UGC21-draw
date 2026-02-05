-- UGC Finder v2 - Supabase Schema
-- Last Updated: 2026-01-26
-- 
-- Run this in Supabase SQL Editor to create/update the profiles table
-- WARNING: If updating existing table, backup data first!

-- Drop existing table if recreating (CAUTION: loses data)
-- DROP TABLE IF EXISTS profiles;

CREATE TABLE IF NOT EXISTS profiles (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    followers INTEGER,
    bio TEXT,
    engagement_rate DECIMAL(5,2),
    source VARCHAR(100),
    source_type VARCHAR(50),
    
    -- Engagement metrics
    avg_likes INTEGER,
    avg_comments INTEGER,
    total_qualifying_reels INTEGER,
    
    -- Content analysis
    has_art_content BOOLEAN,
    top_hashtags TEXT,
    
    -- Reel URLs and engagement
    reel_1_url TEXT,
    reel_1_likes INTEGER,
    reel_2_url TEXT,
    reel_2_likes INTEGER,
    reel_3_url TEXT,
    reel_3_likes INTEGER,
    
    -- AI Analysis scores (1-10)
    niche_relevance INTEGER,
    engagement_quality INTEGER,
    content_consistency INTEGER,
    audience_fit INTEGER,
    profile_score DECIMAL(3,1),
    
    -- AI Analysis text
    content_themes TEXT,
    recommendation VARCHAR(50),
    reasoning TEXT,
    red_flags TEXT[],
    manual_review_notes TEXT,
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'PENDING_REVIEW',
    avg_duration INTEGER,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    
    -- Manual review fields (filled by human)
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMP,
    talks_in_videos BOOLEAN,
    voice_quality INTEGER,
    camera_comfort INTEGER,
    final_score DECIMAL(3,1),
    
    -- Outreach tracking
    contacted_at TIMESTAMP,
    contact_method VARCHAR(50),
    response_status VARCHAR(50),
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_recommendation ON profiles(recommendation);
CREATE INDEX IF NOT EXISTS idx_profiles_source ON profiles(source);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_profile_score ON profiles(profile_score DESC);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- View for pending reviews (convenience)
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
WHERE status = 'PENDING_REVIEW'
ORDER BY 
    CASE recommendation 
        WHEN 'REVIEW_PRIORITY' THEN 1 
        WHEN 'REVIEW' THEN 2 
        ELSE 3 
    END,
    profile_score DESC;

-- View for approved creators ready for outreach
CREATE OR REPLACE VIEW approved_for_outreach AS
SELECT 
    username,
    followers,
    engagement_rate,
    profile_score,
    final_score,
    reel_1_url,
    notes
FROM profiles
WHERE status = 'APPROVED'
  AND contacted_at IS NULL
ORDER BY final_score DESC NULLS LAST;

-- Sample queries for reporting
/*
-- Count by status
SELECT status, COUNT(*) FROM profiles GROUP BY status;

-- Top rated profiles
SELECT username, profile_score, recommendation 
FROM profiles 
WHERE recommendation IN ('REVIEW_PRIORITY', 'REVIEW')
ORDER BY profile_score DESC 
LIMIT 20;

-- Profiles by source
SELECT source, COUNT(*) as count, AVG(profile_score) as avg_score
FROM profiles 
GROUP BY source
ORDER BY count DESC;

-- Conversion funnel
SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'PENDING_REVIEW') as pending,
    COUNT(*) FILTER (WHERE status = 'APPROVED') as approved,
    COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected,
    COUNT(*) FILTER (WHERE contacted_at IS NOT NULL) as contacted,
    COUNT(*) FILTER (WHERE response_status = 'POSITIVE') as positive_response
FROM profiles;
*/
