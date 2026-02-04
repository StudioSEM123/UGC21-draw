# UGC Finder for 21Draw — Complete Project Documentation

### v1.1 — February 2026

---

## Overview

Automated Instagram creator discovery pipeline for 21Draw (online art education platform). Scrapes competitor-tagged posts, fetches full creator profiles via Apify, analyzes them with Claude AI, and stores approved UGC candidates in Supabase + Google Sheets.

**Goal:** Find art creators who are a good fit for UGC partnerships with 21Draw by analyzing their Instagram presence, engagement metrics, and reel content.

---

## Architecture

```
Start → Settings1 → Apify: Tagged Posts → Extract Profiles1 → Collect Batch
    → Aggregate All (logging)
    → Dedupe Profiles → Run an Actor and get dataset (Apify Profile Scraper)
        → Check DB (Supabase) → New?
            → [New] Filter Reels → Claude Analysis → Merge → Save DB → Approved? → Sheets1
            → [Exists] → Done
            → [New, not approved] → Skip
```

---

## Node-by-Node Reference

### Start
Manual trigger to run the workflow.

### Settings1
Configuration node. Sets competitor usernames to scrape (e.g., `prokotv`).

### Apify: Tagged Posts
**Type:** HTTP Request (POST)
**What it does:** Calls Apify Instagram scraper to find posts tagged by competitor accounts.
**Output:** ~30 tagged posts with basic user info.

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

**Output structure (per profile):**
```json
{
  "username": "shapecarver",
  "followersCount": 60056,
  "biography": "...",
  "verified": true,
  "businessCategoryName": "Artist",
  "postsCount": 393,
  "latestPosts": [
    {
      "type": "Video",
      "productType": "clips",
      "shortCode": "DJw1vklSUXs",
      "caption": "...",
      "likesCount": 36100,
      "commentsCount": 259,
      "videoDuration": null,
      "videoUrl": "https://...",
      "url": "https://www.instagram.com/p/DJw1vklSUXs/",
      "displayUrl": "https://...",
      "hashtags": ["conceptart", ...],
      "mentions": ["eleeza", ...],
      "timestamp": "2025-..."
    }
  ]
}
```

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
**Status:** Should be ACTIVE in production to prevent duplicate processing.

### New?
**Type:** IF/Switch
**What it does:** Routes creators to processing (new) or skip (already exists in DB).

### Filter Reels ⚠️ (Updated Feb 4, 2026)
**Type:** Code (JavaScript, Run Once for Each Item)
**What it does:** Extracts reel/video data from Apify's `latestPosts` array, calculates engagement metrics, and selects top 3 reels.

**Logic:**
1. Reads `profile.latestPosts` array from Apify output
2. Filters for reels: `productType === "clips"` or `type === "Video"` (excluding IGTV)
3. Applies duration filter (15-90 seconds) when duration data is available
4. Falls back to all video content if no reels match the strict filter
5. Sorts qualifying reels by engagement (likes + comments) descending
6. Takes top 3 reels
7. Calculates: `engagement_rate = avg(likes + comments) / followers × 100`
8. If no reels found, calculates engagement from all posts as fallback

**Full code:**
```javascript
const index = $itemIndex;
const profile = $input.item.json;
const sourceData = $('Dedupe Profiles').all()[index].json;

const posts = profile.latestPosts || [];

const reels = posts.filter(post => {
  const isClip = (post.productType === 'clips');
  const isVideo = (post.type === 'Video' && post.productType !== 'igtv');
  if (post.videoDuration) {
    const dur = Number(post.videoDuration);
    if (dur < 15 || dur > 90) return false;
  }
  return isClip || isVideo;
});

let qualifyingReels = reels;
if (qualifyingReels.length === 0) {
  qualifyingReels = posts.filter(post =>
    post.type === 'Video' || post.productType === 'clips' || post.productType === 'igtv'
  );
}

qualifyingReels.sort((a, b) => {
  const engA = (Number(a.likesCount) || 0) + (Number(a.commentsCount) || 0);
  const engB = (Number(b.likesCount) || 0) + (Number(b.commentsCount) || 0);
  return engB - engA;
});

const topReels = qualifyingReels.slice(0, 3);
const followers = Number(profile.followersCount) || 0;
let engagement_rate = 0, avg_likes = 0, avg_comments = 0, avg_duration = 0;

if (qualifyingReels.length > 0 && followers > 0) {
  const totalLikes = qualifyingReels.reduce((sum, r) => sum + (Number(r.likesCount) || 0), 0);
  const totalComments = qualifyingReels.reduce((sum, r) => sum + (Number(r.commentsCount) || 0), 0);
  const totalDuration = qualifyingReels.reduce((sum, r) => sum + (Number(r.videoDuration) || 0), 0);
  avg_likes = Math.round(totalLikes / qualifyingReels.length);
  avg_comments = Math.round(totalComments / qualifyingReels.length);
  const reelsWithDur = qualifyingReels.filter(r => r.videoDuration);
  avg_duration = reelsWithDur.length > 0 ? Math.round(totalDuration / reelsWithDur.length) : 0;
  const avgEngagement = (totalLikes + totalComments) / qualifyingReels.length;
  engagement_rate = Number(((avgEngagement / followers) * 100).toFixed(2));
}

if (qualifyingReels.length === 0 && posts.length > 0 && followers > 0) {
  const totalLikes = posts.reduce((sum, p) => sum + (Number(p.likesCount) || 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (Number(p.commentsCount) || 0), 0);
  avg_likes = Math.round(totalLikes / posts.length);
  avg_comments = Math.round(totalComments / posts.length);
  engagement_rate = Number((((totalLikes + totalComments) / posts.length / followers) * 100).toFixed(2));
}

function getReelUrl(post) {
  if (post.url) return post.url;
  if (post.shortCode) return `https://www.instagram.com/reel/${post.shortCode}/`;
  return '';
}

return {
  json: {
    username: profile.username,
    followers: followers,
    bio: (profile.biography || '').substring(0, 500),
    source: sourceData.source || 'unknown',
    source_type: sourceData.sourceType || 'tagged',
    has_art_content: true,
    verified: profile.verified || false,
    business_category: profile.businessCategoryName || '',
    engagement_rate: engagement_rate,
    avg_likes: avg_likes,
    avg_comments: avg_comments,
    avg_duration: avg_duration,
    total_reels_found: qualifyingReels.length,
    reel_1_url: topReels[0] ? getReelUrl(topReels[0]) : '',
    reel_1_likes: topReels[0] ? (Number(topReels[0].likesCount) || 0) : 0,
    reel_1_comments: topReels[0] ? (Number(topReels[0].commentsCount) || 0) : 0,
    reel_1_duration: topReels[0] ? (Number(topReels[0].videoDuration) || 0) : 0,
    reel_1_caption: topReels[0] ? (topReels[0].caption || '').substring(0, 300) : '',
    reel_2_url: topReels[1] ? getReelUrl(topReels[1]) : '',
    reel_2_likes: topReels[1] ? (Number(topReels[1].likesCount) || 0) : 0,
    reel_2_comments: topReels[1] ? (Number(topReels[1].commentsCount) || 0) : 0,
    reel_2_duration: topReels[1] ? (Number(topReels[1].videoDuration) || 0) : 0,
    reel_2_caption: topReels[1] ? (topReels[1].caption || '').substring(0, 300) : '',
    reel_3_url: topReels[2] ? getReelUrl(topReels[2]) : '',
    reel_3_likes: topReels[2] ? (Number(topReels[2].likesCount) || 0) : 0,
    reel_3_comments: topReels[2] ? (Number(topReels[2].commentsCount) || 0) : 0,
    reel_3_duration: topReels[2] ? (Number(topReels[2].videoDuration) || 0) : 0,
    reel_3_caption: topReels[2] ? (topReels[2].caption || '').substring(0, 300) : '',
    analyzed_at: new Date().toISOString()
  }
};
```

**Output fields:**
| Field | Type | Description |
|---|---|---|
| username | string | Instagram handle |
| followers | number | Follower count |
| bio | string | Profile bio (max 500 chars) |
| source | string | Competitor who tagged them |
| source_type | string | "tagged" or "hashtag" |
| has_art_content | boolean | Always true (pre-filtered) |
| verified | boolean | Blue checkmark |
| business_category | string | IG business category |
| engagement_rate | number | Avg (likes+comments)/followers × 100 |
| avg_likes | number | Average likes across qualifying reels |
| avg_comments | number | Average comments across qualifying reels |
| avg_duration | number | Average reel duration in seconds (0 if unavailable) |
| total_reels_found | number | Number of qualifying reels found |
| reel_1_url | string | URL of highest-engagement reel |
| reel_1_likes | number | Likes on reel 1 |
| reel_1_comments | number | Comments on reel 1 |
| reel_1_duration | number | Duration of reel 1 (0 if unavailable) |
| reel_1_caption | string | Caption of reel 1 (max 300 chars) |
| reel_2_* | | Same fields for 2nd best reel |
| reel_3_* | | Same fields for 3rd best reel |
| analyzed_at | string | ISO timestamp |

### Claude Analysis ⚠️ (Updated Feb 4, 2026)
**Type:** HTTP Request (POST to `https://api.anthropic.com/v1/messages`)
**Model:** claude-sonnet-4-20250514
**Authentication:** Predefined Credential Type → Anthropic
**Headers:**
- `anthropic-version: 2023-06-01`
- `content-type: application/json`

**What it does:** Sends full profile + reel data to Claude for evaluation. Claude returns a JSON with niche_relevance (1-10), profile_score (1-10), recommendation (COLLABORATE/REVIEW/PASS/REJECT), and reasoning.

**JSON Body:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": {{ JSON.stringify("Evaluate this Instagram creator for potential UGC partnership with 21Draw, an online art education platform.\n\nPROFILE DATA:\nUsername: " + $json.username + "\nFollowers: " + $json.followers + "\nEngagement Rate: " + ($json.engagement_rate || 0) + "%\nAvg Likes: " + ($json.avg_likes || 0) + "\nAvg Comments: " + ($json.avg_comments || 0) + "\nBio: " + ($json.bio || "").replace(/[\n\r]/g, " ") + "\nVerified: " + $json.verified + "\nBusiness Category: " + ($json.business_category || "none") + "\nTotal Reels Found: " + ($json.total_reels_found || 0) + "\n\nTOP REELS:\nReel 1: " + ($json.reel_1_url || "none") + "\n- Likes: " + ($json.reel_1_likes || 0) + " | Comments: " + ($json.reel_1_comments || 0) + "\n- Caption: " + ($json.reel_1_caption || "").replace(/[\n\r]/g, " ") + "\n\nReel 2: " + ($json.reel_2_url || "none") + "\n- Likes: " + ($json.reel_2_likes || 0) + " | Comments: " + ($json.reel_2_comments || 0) + "\n- Caption: " + ($json.reel_2_caption || "").replace(/[\n\r]/g, " ") + "\n\nReel 3: " + ($json.reel_3_url || "none") + "\n- Likes: " + ($json.reel_3_likes || 0) + " | Comments: " + ($json.reel_3_comments || 0) + "\n- Caption: " + ($json.reel_3_caption || "").replace(/[\n\r]/g, " ") + "\n\nEVALUATION CRITERIA:\n- Niche relevance to art education (drawing, painting, sculpting, digital art, art tutorials)\n- Engagement quality (likes, comments relative to followers)\n- Content style fit for educational art platform\n- Follower count (accounts with 5k+ followers in art niche are valuable)\n- Even accounts with lower engagement rates should be COLLABORATE if they have strong art content and decent following\n\nRecommendation options:\n- COLLABORATE: Strong fit, good metrics, art-relevant content\n- REVIEW: Promising but needs manual review\n- PASS: Not a good fit for 21Draw\n- REJECT: Clearly unsuitable (spam, no art content, very low following)\n\nRespond with JSON only, no other text:\n{\"niche_relevance\": 1-10, \"profile_score\": 1-10, \"recommendation\": \"COLLABORATE/REVIEW/PASS/REJECT\", \"reasoning\": \"your explanation here\"}") }}
    }
  ]
}
```

**Key implementation detail:** The `content` value is wrapped in `JSON.stringify(...)` to properly escape newlines, quotes, and special characters from bios and captions. User-generated text fields also use `.replace(/[\n\r]/g, " ")` to strip embedded newlines before insertion.

**Evaluation criteria built into the prompt:**
- Art niche relevance is weighted heavily
- 5k+ followers with art content = valuable
- Lower engagement doesn't disqualify if content and following are strong
- REJECT is only for spam, no art content, or very low following

### Merge ⚠️ (Updated Feb 4, 2026)
**Type:** Code (JavaScript, Run Once for Each Item)
**What it does:** Combines Claude's analysis output (recommendation, reasoning, scores) with the original profile + reel data from Filter Reels. Passes all fields through to downstream nodes.

**Full code:**
```javascript
const index = $itemIndex;
const profile = $('Filter Reels').all()[index].json;
const claudeResponse = $input.item.json;
let analysis = {};
try {
  let text = claudeResponse.content?.[0]?.text || '{}';
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  analysis = JSON.parse(text);
} catch (e) {
  analysis = {
    recommendation: 'REVIEW',
    reasoning: 'Could not parse AI analysis',
    profile_score: 5,
    niche_relevance: 5
  };
}
return {
  json: {
    username: profile.username,
    followers: profile.followers || 0,
    bio: profile.bio || '',
    source: profile.source || '',
    source_type: profile.source_type || '',
    has_art_content: profile.has_art_content || false,
    verified: profile.verified || false,
    niche_relevance: analysis.niche_relevance || 5,
    profile_score: analysis.profile_score || 5,
    recommendation: analysis.recommendation || 'REVIEW',
    reasoning: analysis.reasoning || '',
    status: 'PENDING_REVIEW',
    analyzed_at: new Date().toISOString(),
    engagement_rate: profile.engagement_rate || 0,
    avg_likes: profile.avg_likes || 0,
    avg_comments: profile.avg_comments || 0,
    avg_duration: profile.avg_duration || 0,
    total_reels_found: profile.total_reels_found || 0,
    reel_1_url: profile.reel_1_url || '',
    reel_1_likes: profile.reel_1_likes || 0,
    reel_1_comments: profile.reel_1_comments || 0,
    reel_1_duration: profile.reel_1_duration || 0,
    reel_1_caption: profile.reel_1_caption || '',
    reel_2_url: profile.reel_2_url || '',
    reel_2_likes: profile.reel_2_likes || 0,
    reel_2_comments: profile.reel_2_comments || 0,
    reel_2_duration: profile.reel_2_duration || 0,
    reel_2_caption: profile.reel_2_caption || '',
    reel_3_url: profile.reel_3_url || '',
    reel_3_likes: profile.reel_3_likes || 0,
    reel_3_comments: profile.reel_3_comments || 0,
    reel_3_duration: profile.reel_3_duration || 0,
    reel_3_caption: profile.reel_3_caption || ''
  }
};
```

**Error handling:** If Claude's response can't be parsed as JSON (e.g., it includes markdown fencing), the node falls back to `REVIEW` with default scores of 5.

### Save DB (Deactivated)
**Type:** Supabase (Insert)
**What it does:** Saves the merged profile + analysis data to the `profiles` table.
**Status:** Currently DEACTIVATED. Re-enable when ready for production.

### Approved?
**Type:** IF/Switch
**What it does:** Routes creators based on Claude's recommendation.
**True Branch conditions (any match):**
- `recommendation` equals `REVIEW_PRIORITY`
- `recommendation` equals `REVIEW`
- `recommendation` equals `COLLABORATE`
- `recommendation` equals `PARTNER`

**False Branch:** Routes to Skip (not added to Google Sheets).

### Sheets1
**Type:** Google Sheets (Append Row)
**Credential:** Google Sheets account 2
**Document:** 21Draw UGC Candidates
**Sheet:** Sheet1
**Mapping:** Map Automatically (all fields from Merge node become columns)

### Skip
**Type:** NoOp
**What it does:** End node for rejected creators.

### Done
**Type:** NoOp
**What it does:** End node for creators that already exist in DB.

---

## Google Sheets Output Columns

The sheet receives all fields from the Merge node. Columns include:

| Column | Description |
|---|---|
| username | Instagram handle |
| followers | Follower count |
| bio | Profile bio |
| source | Competitor (e.g., prokotv) |
| source_type | tagged or hashtag |
| has_art_content | TRUE/FALSE |
| verified | TRUE/FALSE |
| niche_relevance | 1-10 score from Claude |
| profile_score | 1-10 score from Claude |
| recommendation | COLLABORATE / REVIEW / PASS / REJECT |
| reasoning | Claude's explanation |
| status | PENDING_REVIEW |
| analyzed_at | Timestamp |
| engagement_rate | Percentage |
| avg_likes | Average likes across reels |
| avg_comments | Average comments across reels |
| avg_duration | Average reel duration (seconds) |
| total_reels_found | Count of qualifying reels |
| reel_1_url | URL of top reel |
| reel_1_likes | Likes on top reel |
| reel_1_comments | Comments on top reel |
| reel_1_duration | Duration (seconds, 0 if unavailable) |
| reel_1_caption | Caption text |
| reel_2_* | Same fields for 2nd reel |
| reel_3_* | Same fields for 3rd reel |

---

## Supabase Schema

```sql
-- Single table for all profile data including reels
CREATE TABLE profiles (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    followers INTEGER,
    bio TEXT,
    source VARCHAR(100),          -- competitor or seed username
    source_type VARCHAR(50),      -- 'tagged' or 'similar'

    -- Top 3 reels (stored in same table)
    reel_1_url TEXT,
    reel_1_likes INTEGER,
    reel_1_caption TEXT,
    reel_2_url TEXT,
    reel_2_likes INTEGER,
    reel_2_caption TEXT,
    reel_3_url TEXT,
    reel_3_likes INTEGER,
    reel_3_caption TEXT,
    avg_duration INTEGER,

    -- Analysis fields
    engagement_rate DECIMAL(5,2),
    avg_likes INTEGER,
    avg_comments INTEGER,
    has_art_content BOOLEAN DEFAULT false,
    verified BOOLEAN DEFAULT false,
    business_category VARCHAR(100),
    niche_relevance INTEGER,
    profile_score INTEGER,
    recommendation VARCHAR(50),
    reasoning TEXT,
    status VARCHAR(50) DEFAULT 'PENDING_REVIEW',
    analyzed_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Credentials Required

| Credential | Type | Used By |
|---|---|---|
| Apify API Token | HTTP Header Auth | Apify: Tagged Posts, Run an Actor |
| Anthropic API Key | Predefined (Anthropic) | Claude Analysis |
| Google Sheets account 2 | OAuth2 | Sheets1 |
| Supabase | Supabase native | Check DB, Save DB |

**⚠️ Google Sheets OAuth Note:** If the OAuth consent screen is in "Testing" mode, refresh tokens expire after 7 days. Publish to production in Google Cloud Console to get long-lived tokens.

---

## Troubleshooting

### Common Issues

**Claude rejects all creators with "0 followers, 0% engagement"**
- Check that `resultsLimit: 30` is set in the Apify actor input
- Verify Filter Reels node reads `profile.latestPosts` (not just top-level fields)
- Ensure Merge node passes through all engagement and reel fields

**"JSON parameter needs to be valid JSON" error in Claude Analysis**
- The prompt body must use `JSON.stringify(...)` around the content value
- User-generated text (bio, captions) must have newlines stripped: `.replace(/[\n\r]/g, " ")`

**Google Sheets OAuth token expired**
- Re-authenticate in n8n → Credentials → Google Sheets account 2
- Long-term fix: publish OAuth consent screen to production in Google Cloud Console

**Duplicate creators in Google Sheet**
- Ensure Check DB node is ACTIVE (checks Supabase before processing)
- Dedupe Profiles node removes duplicates on username before Apify call

**Reel duration always shows 0**
- This is expected — Apify's Instagram Profile Scraper doesn't consistently return `videoDuration` in `latestPosts` data. The workflow handles this gracefully.

**Pinned test data causing stale results**
- If you see an orange "This data is pinned for test executions" banner in any node, click "Unpin" before re-executing.

---

## Changelog

### v1.1 — February 4, 2026
- **Filter Reels node rewritten:** Now extracts reels from `latestPosts` array, calculates engagement_rate, gets top 3 reel URLs with likes/comments/captions
- **Claude Analysis prompt updated:** Sends full profile + reel data to Claude (bio, engagement metrics, reel URLs, captions). Uses `JSON.stringify()` to handle special characters. Evaluation criteria tuned to not reject art creators just for lower engagement
- **Merge node updated:** Passes through all new reel and engagement fields to Google Sheets
- **Apify actor input updated:** Added `resultsLimit: 30` to fetch posts, not just profile metadata
- **Google Sheets OAuth fixed:** Re-authenticated expired refresh token
- **Deduplication improved:** Added Remove Duplicates safety net node

### v1.0 — January 2026
- Initial workflow setup
- Basic profile scraping and Claude analysis
- Google Sheets and Supabase integration
