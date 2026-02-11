# UGC Finder for 21Draw

Automated pipeline to discover and evaluate Instagram creators for UGC partnerships with 21Draw (online art education platform).

## How It Works

**Phase 1 — Discovery + Profile Analysis:**
1. Scrape posts tagging competitor accounts (domestika, schoolismlive, etc.)
2. Fetch full profiles via Apify (followers, bio, reels)
3. Filter by followers (2k-150k) and qualifying video content (15-90s reels)
4. Claude AI evaluates profile fit → COLLABORATE / REVIEW / PASS / REJECT
5. Save to Supabase

**Phase 2 — Video Analysis:**
1. Download top 3 reels per profile
2. Upload to Gemini Files API
3. Gemini analyzes speech, teaching ability, production quality
4. Save video scores to Supabase → status VIDEO_ANALYZED

## Tech Stack
- **n8n** — Workflow automation (self-hosted on Hostinger VPS)
- **Apify** — Instagram scraping
- **Claude API** — Profile analysis (Phase 1)
- **Gemini** — Video analysis with actual video files (Phase 2)
- **Supabase** — PostgreSQL database (52 columns, 3 tables)

## Current Competitors
domestika, schoolismlive, storyboardart_org, easy_drawing_ideas__, pix_bun

## Setup
1. Import the workflow JSON into n8n
2. Run `21draw-ugc-pipeline/database/schema.sql` in Supabase
3. Configure API keys in n8n credentials (Apify, Anthropic, Gemini, Supabase)
4. Run Phase 1 to discover creators, then Phase 2 for video analysis

## Project Structure
```
docs/                      # Project documentation
  UGC_FINDER.md            # Full workflow reference
  PROJECT_PLAN.md          # Master project plan
  supabase_schema.sql      # Quick reference schema
prompts/                   # AI prompt templates
  claude-profile-analysis.md
  gemini-video-analysis.md
workflows/                 # n8n workflow exports
scripts/                   # Utility and audit scripts
  audit/                   # Hallucination detection
  utils/                   # DB utilities
21draw-ugc-pipeline/       # Pipeline code and config
  code-nodes/              # JavaScript for n8n Code nodes
  database/                # Schema and queries
  docs/                    # Pipeline-specific docs
  prompts/                 # Pipeline-specific prompts
  workflows/               # Pipeline workflow exports
```

## Documentation
See `docs/UGC_FINDER.md` for the complete node-by-node workflow reference.
