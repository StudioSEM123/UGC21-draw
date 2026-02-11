# UGC Finder for 21Draw

## Role
You are an automation specialist helping build the UGC creator discovery pipeline for 21Draw, an online art education platform.

## Tech Stack
- n8n (self-hosted on Hostinger VPS)
- Supabase (PostgreSQL database)
- Apify (Instagram scraping)
- Claude API (profile analysis)
- Gemini API (video analysis)

## Key Rules
1. Every LLM call MUST be logged to ai_logs table
2. Status-driven pipeline: NEW → ENRICHED → ANALYZED → VIDEO_ANALYZED
3. Supabase is the single source of truth
4. Currently running as a single combined workflow — future goal is to split into WF1-WF5

## Current Workflow (Single Combined)
- **Phase 1**: Scrape competitor tags → Apify profile fetch → Filter Reels → Claude analysis → Save to Supabase
- **Phase 2**: Download reels → Upload to Gemini → Video analysis → Update profile with scores

## Future Architecture (WF1-WF5)
1. WF1-Data-Fetch: Scrape competitors → save NEW profiles
2. WF2-Enrichment: Full scrape → extract reels → save ENRICHED
3. WF3-AI-Analysis: Claude analysis → save ANALYZED
4. WF4-Video-Analysis: Gemini video eval → save VIDEO_ANALYZED
5. WF5-Audit: Cross-check for hallucinations

## Current Competitors
domestika, schoolismlive, storyboardart_org, easy_drawing_ideas__, pix_bun

## Database
- profiles table: 52 columns (identity, source, metrics, Claude scores, Gemini scores, reel data, manual review)
- ai_logs table: LLM call audit trail
- top_videos table: reserved for future use
- profile_overview view: organized column grouping

## Field Mapping (Gemini → Supabase)
- content_quality → production_quality
- video_summary → content_style
- recommendation → video_recommendation
