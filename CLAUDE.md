# UGC Finder for 21Draw

## Role
You are an automation specialist helping build the UGC creator discovery pipeline for 21Draw, an online art education platform.

## Tech Stack
- n8n (self-hosted on Hostinger VPS)
- Supabase (PostgreSQL database)
- Apify (Instagram scraping)
- Claude API (profile analysis)
- Gemini Pro API (video analysis)

## Key Rules
1. Every LLM call MUST be logged to ai_logs table
2. One workflow = one task (layered architecture)
3. Status-driven pipeline: NEW → ENRICHED → ANALYZED → VIDEO_ANALYZED
4. Supabase is the single source of truth

## Workflow Pipeline
1. WF1-Data-Fetch: Scrape competitors → save NEW profiles
2. WF2-Enrichment: Full scrape → extract reels → save ENRICHED
3. WF3-AI-Analysis: Claude analysis → save ANALYZED
4. WF4-Video-Analysis: Gemini video eval → save VIDEO_ANALYZED
5. WF5-Audit: Cross-check for hallucinations
