-- Hallucination Detection Queries
-- Run these against Supabase to find potential AI hallucinations

-- 1. Claims talking but no speech quote
-- If talks_in_videos is true, speech_quote should have actual words
SELECT
  username,
  talks_in_videos,
  speaks_english,
  videos_with_speech,
  speech_quote,
  audio_description
FROM profiles
WHERE status = 'VIDEO_ANALYZED'
  AND talks_in_videos = true
  AND (speech_quote = 'N/A' OR speech_quote IS NULL OR speech_quote = '');

-- 2. Claims multiple videos with speech but speech_quote is short/generic
SELECT
  username,
  videos_with_speech,
  speech_quote,
  audio_description
FROM profiles
WHERE status = 'VIDEO_ANALYZED'
  AND videos_with_speech >= 2
  AND LENGTH(speech_quote) < 10;

-- 3. High UGC score but no speech (suspicious for UGC)
SELECT
  username,
  overall_ugc_score,
  talks_in_videos,
  speaks_english,
  video_recommendation
FROM profiles
WHERE status = 'VIDEO_ANALYZED'
  AND overall_ugc_score > 7
  AND talks_in_videos = false;

-- 4. Claims English but audio description suggests otherwise
SELECT
  username,
  speaks_english,
  audio_description,
  speech_quote
FROM profiles
WHERE status = 'VIDEO_ANALYZED'
  AND speaks_english = true
  AND talks_in_videos = true
ORDER BY username;

-- 5. Parse failures (Gemini response couldn't be parsed)
SELECT
  username,
  content_style,
  overall_ugc_score,
  video_recommendation,
  ugc_reasoning
FROM profiles
WHERE status = 'VIDEO_ANALYZED'
  AND (content_style LIKE '%Failed%' OR ugc_reasoning LIKE '%Parse%' OR overall_ugc_score = 0);

-- 6. Summary: AI log entries without matching profile updates
SELECT
  al.profile_username,
  al.workflow_name,
  al.model_used,
  al.created_at,
  p.status
FROM ai_logs al
LEFT JOIN profiles p ON p.username = al.profile_username
WHERE p.status IS NULL OR p.status != 'VIDEO_ANALYZED'
ORDER BY al.created_at DESC;
