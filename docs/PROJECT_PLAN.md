# 21Draw UGC Creator Discovery — Master Project Plan

### v1.5 — February 18, 2026
### Owner: Noras Shante | Client: 21Draw (Renco Smeding)

---

## Quick Start — If This Chat Breaks

Upload this file to a new Claude.ai chat and say: "Continue from Phase X, Task Y" based on where you left off in the checklist at the bottom.

---

## Project Overview

**What we're building:** An automated pipeline that discovers, analyzes, and qualifies Instagram creators for UGC partnerships and course teaching opportunities with 21Draw, an online art education platform. Supports discovery modes: `ugc` (2K-200K), `teacher` (10K-1M), `both` (2K-1M, default).

**The end-to-end funnel:**
Find Creators → Scrape Profiles → Analyze with Claude AI → Human Review → Analyze Videos with Gemini → Score & Rank → Outreach

**Current state:** n8n workflow (Phase 1 discovery) on VPS + standalone scripts (Phase 2 Gemini, outreach classification) + review/outreach web app. All phases operational.

**Pipeline progress:** 177 profiles discovered → 132 human-reviewed (61 approved, 71 denied) → 67 with Gemini video analysis → 61 in outreach queue (29 TIER_1, 27 TIER_2, 5 TIER_3).

---

## Target Architecture (Updated after Renco call, Feb 12 2026)

**Pipeline (n8n, automatic):**
Phase 1 → Human Review → Phase 2 → profiles scored in Supabase

**Human Review (web app, manual):**
Open review app → score-ranked queue → watch embedded reels → approve/deny → logged to human_reviews table

**Future: Auto-triage (script/workflow):**
Uses past human review decisions as examples → auto-approve obvious good, auto-reject obvious bad → only ambiguous profiles go to human review

**Key principle (Renco):** "The main pipeline assumes the prompt is good and just scores. Making the prompt better is a separate human process supported by the review interface."

Status flow: NEW → ENRICHED → ANALYZED/PENDING_REVIEW → HUMAN_REVIEWED → VIDEO_ANALYZED → OUTREACH_READY

---

## Current Competitors (Settings1 node)

- domestika
- schoolismlive
- storyboardart_org
- easy_drawing_ideas__
- pix_bun

Settings: mode-dependent follower range (ugc: 2K-200K, teacher: 10K-1M, both: 2K-1M), 100 results limit

---

## Database (62 columns in profiles)

**Tables:**
- `profiles` — 62 columns (identity, source, metrics, Claude scores, Gemini scores, reel data, storage paths, prompt_version, profile_type, course_teacher_score, suggested_type, discovery_mode)
- `ai_logs` — LLM call audit trail (Claude + Gemini, includes prompt_version)
- `seen_profiles` — deduplication (all discovered usernames including rejected)
- `human_reviews` — approve/deny decisions with reasoning + profile_type, linked to profile_id
- `skipped_profiles` — logs why profiles were skipped at each stage
- `top_videos` — reserved for future use
- `debug_log` — temporary debugging entries

**Schema file:** `21draw-ugc-pipeline/database/schema.sql`
**Migrations:** `21draw-ugc-pipeline/database/migrations/`

---

## Phase 1A: Stabilize — DONE

- [x] Re-enable Supabase "Save DB" node
- [x] Add status column to profiles table
- [x] Create ai_logs table in Supabase
- [x] Test run with existing creators
- [x] Updated competitors list (5 accounts)

## Phase 1B: Organize Workflow — DONE

- [x] Add stage sticky notes to workflow
- [x] Clean up unused nodes
- [x] Export and save workflow to git

## Phase 2: Video Analysis — DONE

- [x] Create Gemini API key
- [x] Build video analysis (download reels → upload to Gemini → analyze)
- [x] Test on creators
- [x] Add logging for Gemini calls to ai_logs

## Phase 2B: Database Cleanup — DONE

- [x] Drop 15 unused columns from profiles table (67 → 52)
- [x] Create profile_overview view
- [x] Reconcile schema files
- [x] Update all documentation

## Phase 2C: Pipeline Improvements (Renco call action items) — DONE

- [x] Create `human_reviews` table (migration applied to Supabase)
- [x] Create `skipped_profiles` table (migration applied to Supabase)
- [x] Add `prompt_version` column to profiles and ai_logs (migration applied)
- [x] Update canonical schema.sql with new tables/columns/indexes
- [x] Save migration files locally
- [x] Data audit: 145 profiles analyzed, found 3 hallucinations + 3 no-video-received issues
- [x] Fix Gemini timeout: Wait node 40s → 90s
- [x] Add Claude logging to ai_logs (was completely missing for Phase 1)
- [x] Add skipped_profiles logging to pre-filter, save-to-seen, and handle-skipped nodes
- [x] Add prompt_version to Phase 2 AI logs node
- [x] Add Gemini response validation: detects "no video received" and hallucinated speech
- [x] Dynamic status: ANALYSIS_FAILED for invalid analyses (auto-retries next run)

## Phase 2D: Deploy Pipeline Fixes — DONE

- [x] Import updated workflow JSON into n8n on VPS
- [x] Discovered `fetch` is NOT available in n8n Code node sandbox
- [x] Tried axios (`NODE_FUNCTION_ALLOW_EXTERNAL=axios`) — caused task runner crash (circular refs)
- [x] Rewrote all 5 code nodes to use Node.js native `https` module (zero dependencies)
- [x] Fixed Skip Check IF node: changed from string comparison to boolean operator
- [x] Added `NODE_FUNCTION_ALLOW_BUILTIN=https,http,buffer` to Docker env
- [x] Test with 2 profiles: Execution #469 completed successfully (0 errors)
- [x] Verified ai_logs entries: `WF-Video-Analysis` with `prompt_version=1`
- [x] Verified skipped_profiles entries: `Phase2-VideoAnalysis` stage logged
- [x] Verified DOWNLOAD_FAILED status correctly set for profiles with no videos
- [x] Restored production settings: 23h schedule, limit=20, workflow deactivated

## Phase 3: Human Review UI — DONE

- [x] Build local Node.js app (Express + vanilla HTML/JS + Supabase JS client)
- [x] Score-ranked queue (highest profile_score first)
- [x] Show: Instagram link, AI reasoning, scores, bio, reel stats
- [x] Approve/deny buttons with notes field → writes to human_reviews table
- [x] Filtering: All / Collaborate / Review / Pass / Reject / My Approved / My Denied
- [x] Dynamic filter counts from `/api/stats` endpoint
- [x] Embedded Instagram reels (lazy-loaded iframes, click "Watch" to load)
- [x] Two-column card layout (info left, reels right)
- [x] Keyboard shortcuts: A=approve, D=deny, U=undo, J/K=next/prev
- [x] Search bar for username filtering
- [x] Progress bar showing % reviewed
- [x] Gemini video analysis data displayed (scores grid)
- [x] Score badges with labels (niche, profile, UGC)
- [x] Review status bar for already-reviewed profiles
- [x] Completed 130 reviews (61 approved, 69 denied)

## Phase 3B: Storage Cleanup — DONE

- [x] Identified Supabase Storage exceeded (2.25GB / 1GB free tier)
- [x] Created `scripts/cleanup-storage.js` utility
- [x] Deleted 182 video files from 82 profiles (DENIED + unreviewed PASS/REJECT)
- [x] Cleared storage paths in DB for cleaned profiles
- [x] 57 profiles with 155 video files remaining (all APPROVED)
- [x] Storage reduced from ~2.25GB to ~1GB

## Phase 4: Run Phase 2 on Approved Profiles — DONE

- [x] n8n Phase 2 had silent failures with large video uploads
- [x] Created standalone `scripts/gemini-analyze.js` with retry logic, rate limit handling, JSON repair
- [x] Made Supabase Storage bucket public for reliable video access (CDN URLs expire)
- [x] Changed storage URL pattern from `/authenticated/` to `/public/`
- [x] Fixed Handle Skipped Profile to not permanently block profiles with videos in storage
- [x] Reset 35 DOWNLOAD_FAILED profiles that had videos back to HUMAN_REVIEWED
- [x] Ran Gemini analysis on 48 approved profiles (3 batches: 15 + 8 retries + 25)
- [x] Results: 67 total with Gemini data, avg score 7.4/10, 38 English speakers
- [x] Breakdown: 10 STRONG_YES, 31 YES, 26 MAYBE, 0 NO
- [x] All 888 AI calls logged to ai_logs table

## Phase 5: Auto-Triage Layer — TODO (after 50+ human reviews)

- [ ] Script that pulls past human review decisions as few-shot examples
- [ ] Claude API call to auto-classify: AUTO_APPROVED / AUTO_REJECTED / NEEDS_REVIEW
- [ ] New statuses in profiles table
- [ ] Logging every auto-decision to ai_logs
- [ ] Reduces manual review from 200+ to ~30-50 profiles

## Phase 5B: n8n Workflow Cleanup — DONE

- [x] Replaced 3 confusing triggers (Start, Webhook+Router, Schedule) with 2 separate webhooks
- [x] Phase 1: `/webhook/phase-1` → Settings1
- [x] Phase 2: `/webhook/phase-2` → Get COLLABORATE Profiles
- [x] Removed orphan "Sheets" node (leftover from Google Sheets migration)
- [x] Renamed 7 generic nodes to descriptive names (e.g., "Code in JavaScript" → "Prepare Gemini Input")
- [x] Realigned all nodes into two clean horizontal rows (Phase 1 at y=300, Phase 2 at y=800)
- [x] Added 7 organized sticky notes covering both phases
- [x] Deployed as workflow v7 (superseded by v8)

## Phase 6: Outreach System — DONE

- [x] Created `outreach` table in Supabase (tiers, contact method, messages, status, timestamps)
- [x] Built `scripts/classify-outreach.js` — Claude assigns tier, extracts email, writes DM + email messages
- [x] Classified all 61 approved profiles (29 TIER_1, 27 TIER_2, 5 TIER_3, 6 with emails)
- [x] Built Outreach tab in review app with:
  - Status dropdown (QUEUED → CONTACTED → FOLLOW_UP_1/2 → REPLIED → NEGOTIATING → CONFIRMED/DECLINED/NO_RESPONSE)
  - DM button: copies message + opens Instagram DM directly via `https://ig.me/m/{username}`
  - Email button: opens mailto with pre-filled subject/body
  - Tier badges with tooltip descriptions on hover
  - Contact timeline showing timestamps for each status change
  - Search and filter by tier/status

## Phase 6B: Review App Fixes — DONE

- [x] Fixed filter counts showing total profiles instead of unreviewed count
- [x] Added `unreviewed` counts to `/api/stats` API (cross-references profiles with human_reviews)
- [x] Filter buttons (All, Collaborate, Review) now show only profiles you haven't reviewed yet
- [x] Created pipeline architecture diagram (`docs/pipeline-diagram.html`)
- [x] Confirmed n8n Phase 2 nodes are NOT USED — replaced by standalone `scripts/gemini-analyze.js`

## Phase 6C: Dual-Purpose Pipeline (UGC + Teachers) — DONE

- [x] Added discovery modes: `ugc` (2K-200K), `teacher` (10K-1M), `both` (2K-1M, default)
- [x] Webhook accepts `{ "mode": "ugc" | "teacher" | "both" }` body parameter
- [x] Claude now evaluates both UGC and teaching fit: `course_teacher_score`, `suggested_type`
- [x] Human reviewer selects `profile_type` during review (pre-filled from AI suggestion)
- [x] Outreach generates type-specific messages (UGC pitch vs teaching pitch)
- [x] New columns: `profiles.profile_type`, `profiles.course_teacher_score`, `profiles.suggested_type`, `profiles.discovery_mode`; `human_reviews.profile_type`; `outreach.profile_type`
- [x] Created `scripts/rescore-profiles.js` for re-scoring existing profiles
- [x] Created `scripts/lib/classify.js` shared module
- [x] Updated prompt to v2
- [x] Deployed as workflow v8 (v7 archived)

## Phase 7: Re-classify Outreach Tiers — TODO

- [ ] Outreach tiers were classified before Gemini data was available
- [ ] 11 TIER_2 profiles now qualify as TIER_1 (score >= 8, speaks English)
- [ ] Re-run `scripts/classify-outreach.js` or update tiers directly with Gemini data

## Phase 7B: Fix Stuck Profiles — TODO

- [ ] 2 profiles (sophneu, angothemango) stuck in DOWNLOAD_FAILED with partial video data
- [ ] Need to reset status or re-download videos

## Phase 9: Split Workflows (WF1-WF5) — TODO

- [ ] Create WF1-Data-Fetch workflow
- [ ] Create WF2-Enrichment workflow
- [ ] Create WF3-AI-Analysis workflow with logging
- [ ] Create WF4-Video-Analysis workflow
- [ ] Test each independently

## Phase 10: Future Improvements — TODO

- [ ] Prompt improvement flow (uses human review feedback to suggest prompt changes)
- [ ] Re-fetch/re-analyze workflow (re-evaluate old profiles, separate from main pipeline)
- [ ] Multiple search strategy tracking (hashtags, Domestika, Skillshare scraping)
- [ ] Batch processing optimizations
- [ ] Auto-triage layer (auto-approve/reject obvious profiles based on past human decisions)

---

## Data Audit Results (Feb 18, 2026)

| Metric | Value |
|--------|-------|
| Total profiles | 177 |
| COLLABORATE | 87 |
| REVIEW | 23 |
| PASS | 28 |
| REJECT | 39 |
| Human reviews completed | 132 (61 approved, 71 denied) |
| Profiles with videos in storage | 57 (all approved) |
| Profiles with Gemini data | 67 (avg score 7.4/10) |
| Gemini: STRONG_YES | 10 |
| Gemini: YES | 31 |
| Gemini: MAYBE | 26 |
| English speakers (video-confirmed) | 38 |
| Outreach profiles | 61 (29 TIER_1, 27 TIER_2, 5 TIER_3) |
| ai_logs entries | 888 |
| seen_profiles | 174 |
| skipped_profiles | 863 |
| Supabase Storage | ~1GB (cleaned from 2.25GB) |

---

## Key Files Modified (All Phases)

| File | What changed |
|------|-------------|
| `review-app/server.js` | Full review + outreach app (embeds, keyboard shortcuts, search, filters, outreach tab with status tracking) |
| `review-app/public/style.css` | UI for review and outreach tabs (two-column cards, progress bar, tier tooltips, contact timeline) |
| `scripts/gemini-analyze.js` | Standalone Gemini video analysis with retry logic, rate limit handling, hallucination detection |
| `scripts/classify-outreach.js` | Claude-powered outreach classification (tier assignment, DM/email generation) |
| `scripts/cleanup-storage.js` | Supabase Storage cleanup for denied profiles |
| `scripts/recover-videos.js` | Profile recovery from Apify data |
| `scripts/sync-code-to-workflow.js` | Auto-sync JS files into workflow JSON |
| `21draw-ugc-pipeline/database/schema.sql` | Tables, columns, indexes, views |
| `21draw-ugc-pipeline/database/migrations/` | human_reviews, skipped_profiles, prompt_version, outreach |
| `21draw-ugc-pipeline/code-nodes/phase1/` | Claude logging, pre-filter logging, seen_profiles logging |
| `21draw-ugc-pipeline/code-nodes/phase2/` | Gemini validation, skipped logging, native https, public storage URLs |
| `workflows/n8n UGC latest (8).json` | Current workflow (v8): dual-purpose pipeline with discovery modes, profile_type support |
| `docs/pipeline-diagram.html` | Visual pipeline architecture diagram (5 stages, where each runs, how to trigger) |

## VPS Deployment Notes

| Setting | Value |
|---------|-------|
| VPS IP | 76.13.3.180 |
| SSH key | `~/.ssh/hostinger_vps` |
| n8n URL | https://n8n.srv1275163.hstgr.cloud |
| Docker compose | /docker/n8n/docker-compose.yml |
| n8n API key | n8n_api_39f7de4cd8ae8d181f7f60ad16a168a6f240ee01 |
| Workflow ID | 4Nqc0B8DU_OcFoxfK3tMD |
| UFW firewall | Enabled (ports 22, 80, 443, 5678) |

**Deploy steps:**
1. Edit JS files locally in `code-nodes/`
2. Run `node scripts/sync-code-to-workflow.js` to sync into workflow JSON
3. `scp` workflow JSON to VPS
4. `docker exec ... n8n import:workflow` via stdin
5. `n8n update:workflow --active=true` then `docker compose restart n8n`

**Critical n8n Code node limitations:**
- `fetch` is NOT available (sandboxed)
- `require('axios')` crashes task runner (circular refs in response objects)
- Use `require('https')` with native Node.js HTTP — no external deps needed
- `NODE_FUNCTION_ALLOW_BUILTIN=https,http,buffer` must be in Docker env

---

## Key Principles (Renco)

1. "Every LLM call MUST be logged (prompt, input, output) and have a separate audit task."
2. "Keep each workflow doing ONE thing."
3. "The main pipeline assumes the prompt is good and just scores. Making the prompt better is a separate human process."
4. "Mark profiles as done once 3 most popular reels are pulled and analyzed."
5. "Once done, the profile should never re-enter any loop unless forced via a separate workflow."

---

## Test Results (Feb 16, 2026 — Phase 2D Deploy)

| Metric | Before | After |
|--------|--------|-------|
| ai_logs count | 196 | 471 (+275) |
| skipped_profiles count | 0 | 275 (all new) |
| DOWNLOAD_FAILED profiles | 0 | 32 |
| Test execution #469 | — | SUCCESS (0 errors) |
| Nodes verified | — | All 15 nodes ran successfully |
| Skip Check IF node | Broken (string compare) | Fixed (boolean operator) |
| Code node HTTP method | fetch (crashes) | native https (works) |

**Issues found & fixed during deployment:**
1. `fetch` not available in n8n Code node sandbox
2. `axios` via require crashes task runner (circular JSON references)
3. Skip Check IF node used string comparison on boolean value
4. Schedule trigger requires CLI publish + restart (API updates alone don't register triggers)
5. Recovered executions from restarts can block new scheduled triggers
6. batch=20 with 90s Wait = 30+ minute executions — too long for testing

---

Last updated: February 18, 2026 (session 2: filter fix, pipeline diagram, n8n Phase 2 deprecation)
