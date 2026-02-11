-- Export top UGC candidates
-- Copy results from Supabase SQL Editor to CSV/spreadsheet

-- All COLLABORATE candidates with video analysis
SELECT
  username,
  followers,
  engagement_rate,
  recommendation,
  profile_score,
  niche_relevance,
  talks_in_videos,
  speaks_english,
  voice_potential,
  teaching_potential,
  brand_fit,
  production_quality,
  overall_ugc_score,
  video_recommendation,
  ugc_reasoning,
  next_steps,
  bio,
  source,
  reel_1_post_url,
  reel_2_post_url,
  reel_3_post_url
FROM profiles
WHERE recommendation = 'COLLABORATE'
  AND status = 'VIDEO_ANALYZED'
ORDER BY overall_ugc_score DESC;

-- Quick shortlist: English speakers who talk in videos
SELECT
  username,
  followers,
  overall_ugc_score,
  voice_potential,
  teaching_potential,
  brand_fit,
  speech_quote,
  reel_1_post_url
FROM profiles
WHERE video_recommendation IN ('STRONG_YES', 'YES')
  AND talks_in_videos = true
  AND speaks_english = true
ORDER BY overall_ugc_score DESC;

-- Profiles needing manual review
SELECT
  username,
  followers,
  recommendation,
  reasoning,
  manual_review_notes,
  reel_1_post_url
FROM profiles
WHERE recommendation = 'REVIEW'
  OR video_recommendation = 'MAYBE'
ORDER BY profile_score DESC;
