-- Audit Summary Report
-- Run in Supabase SQL Editor for a quick health check

-- Pipeline funnel
SELECT
  'Pipeline Status' as report,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'NEW') as new,
  COUNT(*) FILTER (WHERE status = 'ENRICHED') as enriched,
  COUNT(*) FILTER (WHERE status = 'ANALYZED') as analyzed,
  COUNT(*) FILTER (WHERE status = 'VIDEO_ANALYZED') as video_analyzed,
  COUNT(*) FILTER (WHERE status = 'PENDING_REVIEW') as pending_review
FROM profiles;

-- Recommendation breakdown
SELECT
  recommendation,
  COUNT(*) as count,
  ROUND(AVG(profile_score), 1) as avg_profile_score,
  ROUND(AVG(niche_relevance), 1) as avg_niche_relevance
FROM profiles
GROUP BY recommendation
ORDER BY count DESC;

-- Video recommendation breakdown
SELECT
  video_recommendation,
  COUNT(*) as count,
  ROUND(AVG(overall_ugc_score::numeric), 1) as avg_ugc_score,
  COUNT(*) FILTER (WHERE talks_in_videos = true) as talks_count,
  COUNT(*) FILTER (WHERE speaks_english = true) as english_count
FROM profiles
WHERE status = 'VIDEO_ANALYZED'
GROUP BY video_recommendation
ORDER BY count DESC;

-- Top UGC candidates (final output)
SELECT
  username,
  followers,
  overall_ugc_score,
  video_recommendation,
  talks_in_videos,
  speaks_english,
  voice_potential,
  teaching_potential,
  brand_fit
FROM profiles
WHERE video_recommendation IN ('STRONG_YES', 'YES')
  AND talks_in_videos = true
  AND speaks_english = true
ORDER BY overall_ugc_score DESC;

-- AI logs summary
SELECT
  workflow_name,
  model_used,
  COUNT(*) as total_calls,
  MIN(created_at) as first_call,
  MAX(created_at) as last_call
FROM ai_logs
GROUP BY workflow_name, model_used
ORDER BY last_call DESC;

-- Source effectiveness
SELECT
  source,
  COUNT(*) as profiles_found,
  COUNT(*) FILTER (WHERE recommendation = 'COLLABORATE') as collaborations,
  ROUND(AVG(profile_score), 1) as avg_score
FROM profiles
GROUP BY source
ORDER BY collaborations DESC;
