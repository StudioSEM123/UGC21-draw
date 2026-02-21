# UGC Finder for 21Draw

## Role
You are an automation specialist helping build the UGC creator discovery pipeline for 21Draw, an online art education platform.

## Tech Stack
- n8n (self-hosted on Hostinger VPS)
- Supabase (PostgreSQL database + Storage for reel videos)
- Apify (Instagram scraping)
- Claude API (profile analysis — Phase 1, outreach classification)
- Gemini API (video analysis — Phase 2, via standalone script)
- Review App (Express + vanilla HTML/JS, localhost:3000 — review + outreach tabs)

## Key Rules
1. Every LLM call MUST be logged to ai_logs table (with prompt_version)
2. Status-driven pipeline: NEW → ENRICHED → ANALYZED → HUMAN_REVIEWED → VIDEO_ANALYZED
3. Supabase is the single source of truth
4. Only APPROVED profiles (via human review) go to Phase 2 (Gemini video analysis)
5. Profiles with existing Gemini data (overall_ugc_score IS NOT NULL) skip Phase 2

## Pipeline Overview (5 stages — see docs/pipeline-diagram.html)
1. **Stage 1 — Discovery + AI Screening (n8n on VPS, automatic)**: Scrape competitor tags → Apify profile fetch → Filter Reels → Download & store videos → Claude analysis → Save to Supabase
2. **Stage 2 — Human Review (web app, manual)**: Score-ranked queue → approve/deny → logged to human_reviews
3. **Stage 3 — Gemini Video Analysis (local script, manual)**: Download videos from Supabase Storage → Upload to Gemini → 14-field video analysis → Update profile → Log to ai_logs
4. **Stage 4 — Outreach Classification (local script, manual)**: Claude assigns tier + writes DM/email messages → Saved to outreach table
5. **Stage 5 — Outreach Management (web app, manual)**: Track contact status, copy DMs, send emails, timeline tracking

## n8n Workflow
- **Phase 1 trigger**: `https://n8n.srv1275163.hstgr.cloud/webhook/phase-1` → Settings1 → Discovery pipeline
- **Phase 2 nodes**: Still in workflow but NOT USED. Replaced by `scripts/gemini-analyze.js`. Safe to deactivate or remove.
- Only Phase 1 runs on n8n. All other stages run locally on your Mac.

## Human Review (Web App — Review Tab)
- Express server at `review-app/server.js` (port 3000)
- Score-ranked queue with embedded Instagram reels (lazy-loaded iframes)
- Keyboard shortcuts: A=approve, D=deny, U=undo, J/K=next/prev
- Search bar, filter buttons (All/Collaborate/Review/Pass/Reject/Approved/Denied)
- Writes decisions to `human_reviews` table, updates profile status to HUMAN_REVIEWED

## Outreach System (Web App — Outreach Tab)
- Same Express server, separate tab at `/outreach`
- Cards sorted by tier and score, showing profile metrics + AI-generated DM message
- Status dropdown: QUEUED → CONTACTED → FOLLOW_UP_1 → FOLLOW_UP_2 → REPLIED → NEGOTIATING → CONFIRMED / DECLINED / NO_RESPONSE
- DM button: copies message + opens Instagram DM directly (`https://ig.me/m/{username}`)
- Email button: opens mailto with pre-filled subject/body (shown when email exists)
- Contact timeline showing timestamps for each status change
- Tier badges with tooltip descriptions on hover

## Future Architecture (WF1-WF5)
1. WF1-Data-Fetch: Scrape competitors → save NEW profiles
2. WF2-Enrichment: Full scrape → extract reels → save ENRICHED
3. WF3-AI-Analysis: Claude analysis → save ANALYZED
4. WF4-Video-Analysis: Gemini video eval → save VIDEO_ANALYZED
5. WF5-Audit: Cross-check for hallucinations

## Current Competitors
domestika, schoolismlive, storyboardart_org, easy_drawing_ideas__, pix_bun

## Database (8 tables)
- `profiles` — 55 columns (identity, source, metrics, Claude scores, Gemini scores, reel data, storage paths, prompt_version)
- `human_reviews` — approve/deny decisions with reasoning, linked to profile_id
- `ai_logs` — LLM call audit trail (Claude + Gemini, with prompt_version)
- `outreach` — outreach queue with tiers, contact method, messages, status tracking, timestamps
- `seen_profiles` — deduplication (all discovered usernames including rejected)
- `skipped_profiles` — logs why profiles were skipped at each pipeline stage
- `top_videos` — reserved for future use
- `debug_log` — temporary debugging entries

## Database Stats (Feb 18, 2026)
- 177 profiles (87 COLLABORATE, 23 REVIEW, 28 PASS, 39 REJECT)
- 132 human reviews (61 approved, 71 denied)
- 888 ai_logs, 174 seen_profiles, 863 skipped_profiles
- 57 profiles with videos in storage (all approved)
- 67 profiles with Phase 2 (Gemini) data (avg score 7.4, 38 English speakers)
- 61 profiles in outreach table (29 TIER_1, 27 TIER_2, 5 TIER_3)

## Outreach Tier Definitions
- **TIER_1**: Strong art educator/creator, high scores (8+), speaks English, creates video content. Perfect UGC fit.
- **TIER_2**: Good creator but missing something (doesn't talk in videos, lower engagement, unclear language)
- **TIER_3**: Approved but lower potential for video UGC specifically

## Field Mapping (Gemini → Supabase)
- content_quality → production_quality
- video_summary → content_style
- recommendation → video_recommendation

## n8n Code Node Limitations
- `fetch` is NOT available (sandboxed)
- `require('axios')` crashes task runner (circular refs)
- Use `require('https')` with native Node.js HTTP
- `NODE_FUNCTION_ALLOW_BUILTIN=https,http,buffer` must be in Docker env

## VPS Deployment
- VPS IP: 76.13.3.180 | SSH key: `~/.ssh/hostinger_vps`
- n8n URL: https://n8n.srv1275163.hstgr.cloud
- Workflow ID: 4Nqc0B8DU_OcFoxfK3tMD
- UFW firewall: enabled (ports 22, 80, 443, 5678)
- Deploy: edit JS in `code-nodes/` → `node scripts/sync-code-to-workflow.js` → scp to VPS → docker import → publish → restart

## Supabase Storage
- Bucket: `reel-videos` (set to **public** for reliable access)
- Public URL pattern: `{SUPABASE_URL}/storage/v1/object/public/reel-videos/{username}/reel_1.mp4`
- Instagram CDN URLs expire — always use Supabase Storage paths for Phase 2

## Key Project Files
- `review-app/server.js` — Human review + outreach web app (Express server, port 3000)
- `review-app/public/style.css` — UI styles for review and outreach tabs
- `scripts/gemini-analyze.js` — Standalone Gemini video analysis (replaces n8n Phase 2)
- `scripts/classify-outreach.js` — Claude-powered outreach classification and message generation
- `scripts/cleanup-storage.js` — Supabase storage cleanup utility
- `scripts/recover-videos.js` — Profile recovery from Apify data
- `scripts/sync-code-to-workflow.js` — Syncs JS files into workflow JSON
- `21draw-ugc-pipeline/code-nodes/` — JavaScript for n8n Code nodes
- `21draw-ugc-pipeline/database/schema.sql` — Canonical DB schema
- `workflows/n8n UGC latest (7).json` — Current n8n workflow (v7)
- `docs/pipeline-diagram.html` — Visual pipeline architecture diagram (open in browser)
- `prompts/` — AI prompt templates (Claude + Gemini)

## Scripts Usage
```bash
# Run Gemini video analysis on approved profiles
node scripts/gemini-analyze.js          # all pending
node scripts/gemini-analyze.js --limit 5  # test with 5

# Classify approved profiles for outreach
node scripts/classify-outreach.js

# Start review + outreach app
node review-app/server.js   # → localhost:3000
```
