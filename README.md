# UGC Finder for 21Draw

Automated pipeline to discover and evaluate Instagram creators for UGC partnerships and course teaching opportunities with 21Draw (online art education platform).

## How It Works

**Phase 1 — Discovery + Profile Analysis (n8n):**
1. Scrape posts tagging competitor accounts (domestika, schoolismlive, etc.)
2. Fetch full profiles via Apify (followers, bio, reels)
3. Filter by followers (mode-dependent: 2K-1M) and qualifying video content (15-90s reels)
4. Claude AI evaluates both UGC fit and teaching fit → COLLABORATE / REVIEW / PASS / REJECT
5. Save to Supabase, log to ai_logs + skipped_profiles

**Phase 2 — Video Analysis (n8n):**
1. Download top 3 reels per approved profile to Supabase Storage
2. Upload to Gemini Files API
3. Gemini analyzes speech, teaching ability, production quality
4. Validates response (detects no-video and hallucinated speech)
5. Save video scores to Supabase → status VIDEO_ANALYZED

**Phase 3 — Human Review (Web App):**
1. Open review app at localhost:3000
2. Score-ranked queue with embedded Instagram reels
3. Approve/deny with keyboard shortcuts (A/D/U/J/K)
4. Filter by recommendation, search by username
5. Decisions saved to human_reviews table

## Tech Stack
- **n8n** — Workflow automation (self-hosted on Hostinger VPS)
- **Apify** — Instagram scraping
- **Claude API** — Profile analysis (Phase 1)
- **Gemini** — Video analysis with actual video files (Phase 2)
- **Supabase** — PostgreSQL database + Storage (8 tables, 62 columns in profiles)
- **Express** — Human review web app (vanilla HTML/JS)

## Current Stats (Feb 17, 2026)
- 177 profiles discovered and analyzed
- 130 human reviews completed (61 approved, 69 denied)
- 57 profiles with videos in Supabase Storage
- 19 profiles with Phase 2 (Gemini) video analysis

## Discovery Modes
- **`ugc`** — UGC creators (2K-200K followers)
- **`teacher`** — Course teachers (10K-1M followers)
- **`both`** — Combined search (2K-1M followers, default)

Trigger via webhook: `POST /webhook/phase-1` with body `{ "mode": "ugc" | "teacher" | "both" }`

## Current Competitors
domestika, schoolismlive, storyboardart_org, easy_drawing_ideas__, pix_bun

## Setup

### Pipeline (n8n)
1. Import the workflow JSON into n8n
2. Run `21draw-ugc-pipeline/database/schema.sql` in Supabase
3. Configure API keys in n8n credentials (Apify, Anthropic, Gemini, Supabase)
4. Set `NODE_FUNCTION_ALLOW_BUILTIN=https,http,buffer` in Docker env
5. Run Phase 1 to discover creators, then Phase 2 for video analysis

### Review App
1. `cd review-app && npm install`
2. Copy `.env.example` to `.env` and fill in Supabase credentials
3. `node server.js` → open http://localhost:3000

## Project Structure
```
review-app/                # Human review web app
  server.js                # Express server + HTML template + JS
  public/style.css         # UI styling
docs/                      # Project documentation
  PROJECT_PLAN.md          # Master project plan with phase tracking
  UGC_FINDER.md            # Workflow node-by-node reference
  supabase_schema.sql      # Quick reference schema
prompts/                   # AI prompt templates
  claude-profile-analysis.md
  gemini-video-analysis.md
workflows/                 # n8n workflow JSON exports
scripts/                   # Utility scripts
  cleanup-storage.js       # Delete videos for denied profiles
  recover-videos.js        # Recover profiles from Apify data
  rescore-profiles.js      # Re-score existing profiles with v2 prompt
  sync-code-to-workflow.js # Sync JS code into workflow JSON
  lib/classify.js          # Shared classification module
  audit/                   # Hallucination detection
  utils/                   # DB utilities
21draw-ugc-pipeline/       # Pipeline code and config
  code-nodes/              # JavaScript for n8n Code nodes
    phase1/                # Discovery + Claude analysis nodes
    phase2/                # Video download + Gemini analysis nodes
  database/                # Schema, migrations, queries
  docs/                    # Pipeline-specific docs
  prompts/                 # Pipeline-specific prompts
```

## Documentation
- `docs/PROJECT_PLAN.md` — Master plan with phase tracking and deployment notes
- `docs/UGC_FINDER.md` — Complete node-by-node workflow reference
- `CLAUDE.md` — AI assistant context file
