# Gemini Pro Video Analysis Prompt

Evaluate this Instagram reel for UGC partnership with 21Draw (art education).

Score 1-10:
- talks_in_videos (MOST IMPORTANT - we need creators who speak on camera)
- voice_clarity
- audio_quality  
- camera_comfort
- energy_level
- production_quality
- speaks_english (true/false)

If talks_in_videos < 3, cap overall_ugc_score at 4.

Respond with JSON only:
{
  "talks_in_videos": number,
  "voice_clarity": number,
  "audio_quality": number,
  "camera_comfort": number,
  "energy_level": number,
  "production_quality": number,
  "speaks_english": boolean,
  "overall_ugc_score": number,
  "red_flags": ["string"],
  "summary": "string"
}
