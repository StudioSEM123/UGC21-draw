-- Utility: Reset profiles for re-analysis
-- Use these queries when you need to re-run analysis on existing profiles

-- Reset video analysis fields (re-run Phase 2)
-- Updates VIDEO_ANALYZED profiles back to ANALYZED so Phase 2 picks them up again
UPDATE profiles
SET
  status = 'PENDING_REVIEW',
  talks_in_videos = NULL,
  speaks_english = NULL,
  voice_potential = NULL,
  teaching_potential = NULL,
  production_quality = NULL,
  brand_fit = NULL,
  overall_ugc_score = NULL,
  video_recommendation = NULL,
  ugc_reasoning = NULL,
  content_style = NULL,
  next_steps = NULL,
  audio_description = NULL,
  speech_quote = NULL,
  videos_with_speech = NULL
WHERE status = 'VIDEO_ANALYZED';
-- Add AND username = 'specific_user' to reset a single profile

-- Reset ALL analysis (re-run Phase 1 + Phase 2)
-- WARNING: This clears Claude analysis too
UPDATE profiles
SET
  status = 'NEW',
  niche_relevance = NULL,
  profile_score = NULL,
  recommendation = NULL,
  reasoning = NULL,
  talks_in_videos = NULL,
  speaks_english = NULL,
  voice_potential = NULL,
  teaching_potential = NULL,
  production_quality = NULL,
  brand_fit = NULL,
  overall_ugc_score = NULL,
  video_recommendation = NULL,
  ugc_reasoning = NULL,
  content_style = NULL,
  next_steps = NULL,
  audio_description = NULL,
  speech_quote = NULL,
  videos_with_speech = NULL
WHERE username = 'REPLACE_WITH_USERNAME';

-- Delete a profile entirely (use with caution)
-- DELETE FROM profiles WHERE username = 'REPLACE_WITH_USERNAME';
