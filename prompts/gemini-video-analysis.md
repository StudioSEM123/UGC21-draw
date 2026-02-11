# Gemini Video Analysis Prompt

Evaluate Instagram reels for UGC partnership with 21Draw (art education).
Up to 3 videos are uploaded to Gemini Files API and analyzed together.

## Evaluation Criteria

| Field | Type | Description |
|-------|------|-------------|
| talks_in_videos | boolean | Does creator SPEAK in any video? (most important) |
| audio_description | string | What sounds in each reel (Reel 1: ..., Reel 2: ...) |
| speech_quote | string | Short quote if they speak, "N/A" if not |
| speaks_english | boolean | Is speech in English? (false if no speech) |
| videos_with_speech | 0-3 | How many videos have creator speaking |
| voice_potential | 0-10 | Could they do voiceover work? |
| teaching_potential | 0-10 | Could they teach art concepts? |
| content_quality | 0-10 | Production quality and visual appeal |
| brand_fit | 0-10 | Fit with art education brand |
| overall_ugc_score | 0-10 | Overall UGC partnership potential |
| video_summary | string | What happens across all videos |
| ugc_reasoning | string | Why good/bad UGC partner |
| recommendation | string | STRONG_YES / YES / MAYBE / NO |
| next_steps | string | What to verify before outreach |

## Important Rules
- Background music does NOT count as talking
- Text overlays do NOT count as talking
- Songs with lyrics do NOT count as the creator talking
- If talks_in_videos is true, speech_quote must have actual words (hallucination check)

## Field Mapping to Supabase
Some Gemini output fields are renamed when saved to the profiles table:
- `content_quality` → `production_quality`
- `video_summary` → `content_style`
- `recommendation` → `video_recommendation`
