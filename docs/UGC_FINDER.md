# UGC Finder for 21Draw — Complete Project Documentation

### v2.0 — February 2026

---

## Overview

Automated Instagram creator discovery pipeline for 21Draw (online art education platform). Scrapes competitor-tagged posts, fetches full creator profiles via Apify, analyzes them with Claude AI, reviews via a human review web app, then runs video analysis with Gemini on approved profiles.

**Goal:** Find art creators who are a good fit for UGC partnerships with 21Draw by analyzing their Instagram presence, engagement metrics, and reel content.

---

## Architecture

```
Phase 1 (n8n):
  Start → Settings1 → Apify: Tagged Posts → Extract Profiles → Collect Batch
      → Aggregate All → Dedupe Profiles → Apify: Profile Scraper
          → Check DB (Supabase) → New?
              → [New] Pre-filter (seen_profiles check) → Filter Reels → Claude Analysis
                  → Log to ai_logs → Merge → Save DB (Supabase) → Mark seen_profiles
              → [Exists] → Log to skipped_profiles → Done

Phase 2 (n8n — runs on APPROVED profiles only):
  Get Approved Profiles → Skip Check (already has Gemini data?) → Download Reels
      → Upload to Supabase Storage → Wait 90s → Upload to Gemini Files API
      → Gemini Video Analysis → Parse & Validate Response → Update Profile in DB
      → Log to ai_logs + skipped_profiles

Human Review (Web App):
  localhost:3000 → Score-ranked queue → Embedded Instagram reels
      → Approve/Deny with keyboard shortcuts → Writes to human_reviews table
```

---

## Phase 1: Node-by-Node Reference

### Start
Manual trigger to run the workflow.

### Settings1
Configuration node. Sets competitor usernames to scrape and filter parameters. Reads `mode` from webhook body (`ugc`, `teacher`, or `both`).
- Competitors: domestika, schoolismlive, storyboardart_org, easy_drawing_ideas__, pix_bun
- Follower range: mode-dependent (ugc: 2K-200K, teacher: 10K-1M, both: 2K-1M)
- Results limit: 100
- Discovery mode stored as `discovery_mode` on each profile

### Apify: Tagged Posts
**Type:** HTTP Request (POST)
**What it does:** Calls Apify Instagram scraper to find posts tagged by competitor accounts.
**Output:** ~30 tagged posts with basic user info per competitor.

### Extract Profiles1
**Type:** Code
**What it does:** Extracts unique Instagram usernames from tagged posts.

### Collect Batch
**Type:** Code
**What it does:** Groups extracted profiles into batches for processing.

### Aggregate All
**Type:** Aggregate
**What it does:** Collects all profiles from all competitors into a single array for logging/tracking.

### Dedupe Profiles
**Type:** Code
**What it does:** Removes duplicate usernames (same creator tagged by multiple competitors). Deduplicates on `username` field.

### Run an Actor and get dataset
**Type:** HTTP Request (POST to Apify)
**What it does:** Fetches full Instagram profile data for each unique creator using Apify's Instagram Profile Scraper.

**Important configuration:**
```json
{"usernames": ["{{ $json.username }}"], "resultsLimit": 30}
```
The `resultsLimit: 30` is critical — without it, Apify only returns profile metadata (no posts/reels). With it, the response includes the `latestPosts` array containing up to 30 recent posts with engagement data.

**Key Apify field mappings:**
| Apify Field | Meaning |
|---|---|
| `productType: "clips"` | Instagram Reels |
| `productType: "igtv"` | IGTV videos |
| `productType: "feed"` | Regular feed posts |
| `type: "Video"` | Video content (any type) |
| `type: "Image"` | Image post |
| `likesCount` | Number of likes |
| `commentsCount` | Number of comments |
| `videoDuration` | Duration in seconds (not always available) |

### Check DB
**Type:** Supabase (Select)
**What it does:** Checks if the creator username already exists in the `profiles` table to avoid re-processing.
**Status:** ACTIVE in production.

### Pre-filter (seen_profiles check)
**Type:** Code
**What it does:** Checks `seen_profiles` table for already-processed usernames. Logs skips to `skipped_profiles` table via native `https` POST.

### Filter Reels
**Type:** Code (JavaScript, Run Once for Each Item)
**What it does:** Extracts reel/video data from Apify's `latestPosts` array, calculates engagement metrics, and selects top 3 reels.

**Logic:**
1. Reads `profile.latestPosts` array from Apify output
2. Filters for reels: `productType === "clips"` or `type === "Video"` (excluding IGTV)
3. Applies duration filter (15-90 seconds) when duration data is available
4. Falls back to all video content if no reels match the strict filter
5. Sorts qualifying reels by engagement (likes + comments) descending
6. Takes top 3 reels
7. Calculates: `engagement_rate = avg(likes + comments) / followers * 100`
8. If no reels found, calculates engagement from all posts as fallback

**Output fields:**
| Field | Type | Description |
|---|---|---|
| username | string | Instagram handle |
| followers | number | Follower count |
| bio | string | Profile bio (max 500 chars) |
| source | string | Competitor who tagged them |
| engagement_rate | number | Avg (likes+comments)/followers * 100 |
| total_reels_found | number | Count of qualifying reels |
| reel_1-3_url | string | URLs of top 3 reels |
| reel_1-3_likes/comments/duration/caption | number/string | Stats per reel |

### Claude Analysis
**Type:** HTTP Request (POST to `https://api.anthropic.com/v1/messages`)
**Model:** claude-sonnet-4-20250514
**What it does:** Sends full profile + reel data to Claude for evaluation. Returns JSON with niche_relevance (1-10), profile_score (1-10), recommendation (COLLABORATE/REVIEW/PASS/REJECT), and reasoning.

**Key implementation details:**
- Content wrapped in `JSON.stringify(...)` to escape special characters
- User-generated text uses `.replace(/[\n\r]/g, " ")` to strip newlines
- Results logged to `ai_logs` table with prompt_version (currently v2)

**Evaluation criteria:**
- Art niche relevance is weighted heavily
- 5k+ followers with art content = valuable
- Lower engagement doesn't disqualify if content and following are strong
- REJECT is only for spam, no art content, or very low following
- Claude now evaluates BOTH UGC fit and teaching fit, returning additional fields:
  - `course_teacher_score` (1-10): teaching potential score
  - `suggested_type`: UGC_CREATOR, COURSE_TEACHER, or BOTH

### Merge
**Type:** Code (JavaScript)
**What it does:** Combines Claude's analysis with original profile + reel data. Sets status to `PENDING_REVIEW`.
**Error handling:** If Claude's response can't be parsed as JSON, falls back to `REVIEW` with default scores of 5.

### Save DB
**Type:** Supabase (Upsert on username)
**What it does:** Saves the merged profile + analysis data to the `profiles` table.
**Status:** ACTIVE in production.

### Mark seen_profiles
**Type:** Code
**What it does:** Inserts username into `seen_profiles` table for deduplication. Logs to `skipped_profiles` if profile was skipped.

---

## Phase 2: Video Analysis Nodes

### Get Approved Profiles
**Type:** Supabase (Select) or Code
**What it does:** Fetches profiles that have been approved in human review and don't yet have Gemini data.
**Filter:** `decision = 'APPROVED'` AND `overall_ugc_score IS NULL`

### Skip Check
**Type:** IF (Boolean)
**What it does:** Routes profiles — skip if already has Gemini data or videos failed to download.
**Fixed:** Changed from string comparison to boolean operator.

### Download Reels
**Type:** Code (native `https` module)
**What it does:** Downloads up to 3 reel videos per profile from Instagram CDN URLs.
**Stores:** Uploaded to Supabase Storage bucket `reel-videos` under `{username}/` folder.

### Wait
**Type:** Wait (90 seconds)
**What it does:** Waits for Gemini Files API to process uploaded videos. Increased from 40s to 90s to prevent timeouts.

### Gemini Video Analysis
**Type:** HTTP Request (POST to Gemini API)
**What it does:** Sends uploaded video files to Gemini for analysis of speech, teaching ability, production quality, brand fit.

### Parse & Validate Response
**Type:** Code
**What it does:** Parses Gemini's response, validates quality:
- Detects "no video received" responses (Gemini analyzed captions only)
- Detects hallucinated speech (speech_quote contradicts audio_description)
- Sets status to `ANALYSIS_FAILED` for invalid analyses (auto-retries next run)
- Valid analyses update profile with Gemini scores

### Log to ai_logs
**Type:** Code (native `https`)
**What it does:** Logs Gemini call details (prompt, input, output, model, prompt_version) to `ai_logs` table.

---

## Human Review App

**Location:** `review-app/server.js` (Express server on port 3000)

### Features
- Score-ranked queue (highest profile_score first)
- Embedded Instagram reels (lazy-loaded iframes via `/embed/` URL)
- Keyboard shortcuts: A=approve, D=deny, U=undo, J/K=next/prev
- Search bar for instant username filtering
- Filter buttons: All / Collaborate / Review / Pass / Reject / My Approved / My Denied
- Dynamic counts on filter buttons
- Progress bar showing % reviewed
- Two-column card layout (info left, reels right)
- Gemini data displayed as scores grid
- Score badges with labels (niche, profile, UGC)

### API Endpoints
| Endpoint | Method | Description |
|---|---|---|
| `/api/profiles` | GET | Fetch profiles with optional `?filter=` param |
| `/api/stats` | GET | Review progress + per-category counts |
| `/api/review` | POST | Submit approve/deny decision |
| `/api/undo` | POST | Undo last review action |

---

## Supabase Schema

See full schema at `21draw-ugc-pipeline/database/schema.sql` (62 columns in profiles).

**Key column groups:**
- **Identity:** id, username, profile_url (generated), status, verified, analyzed_at, prompt_version, profile_type, discovery_mode
- **Source:** source, source_type
- **Profile metrics:** followers, engagement_rate, bio, has_art_content, avg_likes, avg_comments
- **Claude analysis:** niche_relevance, profile_score, recommendation, reasoning, content_style, course_teacher_score, suggested_type
- **Gemini video analysis:** talks_in_videos, speaks_english, voice_potential, teaching_potential, brand_fit, production_quality, overall_ugc_score, video_recommendation, ugc_reasoning, next_steps, audio_description, speech_quote, videos_with_speech
- **Reel data:** reel_1-3 (url, post_url, likes, comments, duration, caption), avg_duration, total_reels_found
- **Storage:** reel_1-3_storage_path, videos_downloaded
- **Manual review:** manual_review_notes

---

## Credentials Required

| Credential | Type | Used By |
|---|---|---|
| Apify API Token | HTTP Header Auth | Apify: Tagged Posts, Run an Actor |
| Anthropic API Key | Predefined (Anthropic) | Claude Analysis |
| Gemini API Key | HTTP Header Auth | Gemini Video Analysis |
| Supabase | Supabase native + REST API | Check DB, Save DB, all Code nodes |

---

## Troubleshooting

### Common Issues

**Claude rejects all creators with "0 followers, 0% engagement"**
- Check that `resultsLimit: 30` is set in the Apify actor input
- Verify Filter Reels node reads `profile.latestPosts` (not just top-level fields)
- Ensure Merge node passes through all engagement and reel fields
- Known issue: 4 profiles were wrongly rejected because Apify returned empty data during initial scrape

**"JSON parameter needs to be valid JSON" error in Claude Analysis**
- The prompt body must use `JSON.stringify(...)` around the content value
- User-generated text (bio, captions) must have newlines stripped: `.replace(/[\n\r]/g, " ")`

**n8n Code node crashes or hangs**
- `fetch` is NOT available in n8n Code node sandbox — use `require('https')`
- `require('axios')` crashes task runner due to circular JSON refs
- Ensure `NODE_FUNCTION_ALLOW_BUILTIN=https,http,buffer` is in Docker env

**Gemini "no video received" responses**
- Parse & Validate node detects this and sets status to `ANALYSIS_FAILED`
- Profile will be retried on next run
- Usually caused by Gemini Files API not finishing processing before analysis starts (Wait node increased to 90s)

**Supabase Storage full**
- Run `node scripts/cleanup-storage.js` to delete videos for denied/irrelevant profiles
- Only keep videos for approved profiles

**Reel duration always shows 0**
- Expected — Apify's Instagram Profile Scraper doesn't consistently return `videoDuration` in `latestPosts` data

**Pinned test data causing stale results**
- If you see an orange "This data is pinned for test executions" banner in any node, click "Unpin" before re-executing

---

## Changelog

### v2.0 — February 17, 2026
- **Human Review App built:** Express server with embedded Instagram reels, keyboard shortcuts, search, filters, progress bar
- **130 reviews completed:** 61 approved, 69 denied
- **Storage cleanup:** Deleted 182 video files from denied profiles, reduced from 2.25GB to ~1GB
- **All documentation updated** to reflect current state

### v1.3 — February 16, 2026
- **Phase 2D deployed:** All code nodes rewritten with native `https` (no fetch/axios)
- **Skip Check IF node fixed:** Changed from string comparison to boolean operator
- **Gemini validation added:** Detects no-video and hallucinated speech responses
- **Logging added:** Claude calls to ai_logs, skip reasons to skipped_profiles
- **Wait node increased:** 40s → 90s for Gemini processing

### v1.2 — February 10, 2026
- **Database cleanup:** Dropped 15 unused columns from profiles table (67 → 52)
- **Added profile_overview view:** Organized view grouping columns by pipeline stage
- **Schema files reconciled:** Single source of truth at `21draw-ugc-pipeline/database/schema.sql`

### v1.1 — February 4, 2026
- **Filter Reels node rewritten:** Extracts reels from `latestPosts`, calculates engagement, gets top 3
- **Claude Analysis prompt updated:** Full profile + reel data, tuned criteria
- **Apify actor input updated:** Added `resultsLimit: 30`
- **Deduplication improved:** Added Remove Duplicates safety net node

### v1.0 — January 2026
- Initial workflow setup
- Basic profile scraping and Claude analysis
- Google Sheets and Supabase integration (Google Sheets since removed)
