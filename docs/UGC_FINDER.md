# UGC Finder for 21Draw - Complete Project Documentation

## Project Overview

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║              UGC FINDER FOR 21DRAW                                        ║
║              Method: Competitor Tagging                                   ║
║                                                                           ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║  GOAL:                                                                    ║
║  Find 20-50 quality UGC creators who can create content for 21Draw       ║
║                                                                           ║
║  METHOD:                                                                  ║
║  Scrape profiles that have already created UGC for similar companies     ║
║  (Skillshare, Domestika, etc)                                            ║
║                                                                           ║
║  OUTPUT:                                                                  ║
║  Google Sheet with:                                                       ║
║  • Handle                                                                 ║
║  • UGC Score                                                              ║
║  • Top 3 Reels (clickable links)                                         ║
║  • Claude's assessment                                                    ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## N8N Workflow Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  MANUAL TRIGGER                                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  SELECT METHOD (dropdown in N8N)                                        │
│                                                                         │
│  ○ Competitor Tagging (recommended)                                     │
│  ○ Similar Accounts                                                     │
│  ○ Agency Followers                                                     │
│  ○ Hashtags                                                             │
│  ○ All methods                                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌───────────┐   ┌───────────┐   ┌───────────┐
            │ APIFY:    │   │ APIFY:    │   │ APIFY:    │
            │ Tagged    │   │ Similar   │   │ Hashtag   │
            │ Posts     │   │ Accounts  │   │ Scraper   │
            └───────────┘   └───────────┘   └───────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                                    ▼
                          ┌─────────────────┐
                          │  MERGE +        │
                          │  REMOVE DUPES   │
                          └─────────────────┘
                                    │
                                    ▼
                          ┌─────────────────┐
                          │  FILTER +       │
                          │  FETCH REELS +  │
                          │  CLAUDE ANALYSIS│
                          └─────────────────┘
                                    │
                                    ▼
                          ┌─────────────────┐
                          │  GOOGLE SHEETS  │
                          └─────────────────┘
```

---

## STEP 1: Define Competitors to Scrape

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  COMPETITORS TO SCRAPE                                                  │
│                                                                         │
│  Tier 1: Direct competitors (course platforms)                          │
│  ─────────────────────────────────────────────────────────────────────  │
│  │ @skillshare          │ Largest - lots of UGC                      │  │
│  │ @domestikisglobal    │ Creative courses - relevant audience       │  │
│  │ @proko               │ Art-specific - perfect match               │  │
│  │ @schoolism           │ Digital art - exact target audience        │  │
│  │ @cubebrush           │ Digital art marketplace                    │  │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  Tier 2: Related brands (creative tools)                                │
│  ─────────────────────────────────────────────────────────────────────  │
│  │ @procreate           │ Tool many artists use                      │  │
│  │ @clipstudiopaint     │ Another popular tool                       │  │
│  │ @adobe               │ Large - but relevant content               │  │
│  │ @wacom               │ Hardware for digital art                   │  │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  Tier 3: General learning platforms                                     │
│  ─────────────────────────────────────────────────────────────────────  │
│  │ @udemy               │ Large - filter for creative content        │  │
│  │ @creativelive        │ Creative courses                           │  │
│  │ @masterclass         │ Premium - high-quality creators            │  │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                         │
│  RECOMMENDATION: Start with Tier 1 (5 accounts)                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## STEP 2: Complete Workflow (10 Steps)

### STEP 1: TRIGGER

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 1: TRIGGER                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐                                                       │
│  │   MANUAL     │  ← You click "Execute" when you want to run          │
│  │   TRIGGER    │                                                       │
│  └──────────────┘                                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### STEP 2: FETCH MOST POPULAR TAGGED POSTS

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 2: FETCH MOST POPULAR TAGGED POSTS                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  APIFY: Instagram Tagged Posts Scraper                           │  │
│  │                                                                   │  │
│  │  Settings:                                                        │  │
│  │  • username: "@skillshare" (and other competitors)               │  │
│  │  • resultsLimit: 100                                              │  │
│  │  • sortBy: "popular"  ← MOST POPULAR FIRST                       │  │
│  │                                                                   │  │
│  │  Output: 500 posts (100 per competitor × 5 competitors)          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### STEP 3: EXTRACT UNIQUE PROFILES

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 3: EXTRACT UNIQUE PROFILES                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  N8N: Code Node                                                   │  │
│  │                                                                   │  │
│  │  • Take all 500 posts                                             │  │
│  │  • Extract unique usernames                                       │  │
│  │  • Remove duplicates                                              │  │
│  │                                                                   │  │
│  │  500 posts → ~300 unique profiles                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### STEP 4: CHECK AGAINST DATABASE (avoid re-scraping)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 4: CHECK AGAINST DATABASE (avoid re-scraping)                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  SUPABASE: Check duplicates                                       │  │
│  │                                                                   │  │
│  │  For each profile:                                                │  │
│  │  "Does @username already exist in our database?"                 │  │
│  │                                                                   │  │
│  │  • YES → Skip (save Apify credits)                               │  │
│  │  • NO → Continue                                                  │  │
│  │                                                                   │  │
│  │  300 profiles → ~250 new ones                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### STEP 5: BASIC FILTER

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 5: BASIC FILTER                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  N8N: IF Node                                                     │  │
│  │                                                                   │  │
│  │  Keep only profiles where:                                        │  │
│  │  • followers >= 5,000                                             │  │
│  │  • followers <= 100,000                                           │  │
│  │  • engagement_rate >= 2%                                          │  │
│  │                                                                   │  │
│  │  250 profiles → ~80 remaining                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

─────────────────────────────────────────────────────────────────────────┐
│ ### STEP 6: FETCH PROFILE DATA + REELS/VIDEOS ONLY                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  LOOP: For each profile that passed the filter                   │  │
│  │                                                                   │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │  APIFY: Instagram Profile Scraper                          │  │  │
│  │  │                                                             │  │  │
│  │  │  Settings:                                                  │  │  │
│  │  │  • username: the profile                                    │  │  │
│  │  │  • resultsType: "posts"                                     │  │  │
│  │  │  • resultsLimit: 30                                         │  │  │
│  │  │                                                             │  │  │
│  │  │  THEN IN N8N - Code Node:                                   │  │  │
│  │  │  • Filter: ONLY type="Video" or type="Reel"                 │  │  │
│  │  │  • Filter: duration >= 15 seconds                           │  │  │
│  │  │  • Filter: duration <= 90 seconds                           │  │  │
│  │  │  • Remove all images/carousels                              │  │  │
│  │  │  • If < 3 qualifying videos → Skip the profile              │  │  │
│  │  │                                                             │  │  │
│  │  │  WHY 15-90 SECONDS?                                         │  │  │
│  │  │  • < 15 sec = transitions, music clips, memes               │  │  │
│  │  │  • 15-60 sec = talking head, quick tips ✓                   │  │  │
│  │  │  • 60-90 sec = tutorials, explanations ✓                    │  │  │
│  │  │  • > 90 sec = long-form (less common for UGC)               │  │  │
│  │  │                                                             │  │  │
│  │  │  80 profiles → ~50 with enough qualifying videos            │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### STEP 7: FILTER & SORT REELS

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 7: FILTER & SORT REELS                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  N8N: Code Node                                                   │  │
│  │                                                                   │  │
│  │  For each profile:                                                │  │
│  │  1. Filter: Only Reels (not images)                              │  │
│  │  2. Check: Do they have at least 3 Reels?                        │  │
│  │     • NO → Skip the profile                                      │  │
│  │     • YES → Continue                                              │  │
│  │  3. Sort: Highest engagement first                               │  │
│  │  4. Take: Top 3 Reels                                            │  │
│  │  5. Save: URL + likes + caption for each                         │  │
│  │                                                                   │  │
│  │  100 profiles → ~70 with enough Reels                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```
---

## N8N Code Snippets

### Duration Filter Code (Step 6)
```javascript
// Filter for reels with "talking" duration (15-90 seconds)
const reels = items.filter(item => {
  const duration = item.json.videoDuration || 0;
  const type = item.json.type;
  
  return (
    (type === 'Video' || type === 'Reel') &&
    duration >= 15 &&
    duration <= 90
  );
});

// Skip profile if less than 3 qualifying reels
if (reels.length < 3) {
  return []; // Skip this profile
}

// Sort by engagement (likes + comments)
reels.sort((a, b) => {
  const engagementA = (a.json.likesCount || 0) + (a.json.commentsCount || 0);
  const engagementB = (b.json.likesCount || 0) + (b.json.commentsCount || 0);
  return engagementB - engagementA;
});

// Return top 3
return reels.slice(0, 3);
```

### STEP 8: CLAUDE ANALYZES UGC ABILITY

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 8: CLAUDE ANALYZES UGC ABILITY                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  LOOP: For each profile                                          │  │
│  │                                                                   │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │  CLAUDE API: Analyze UGC potential                         │  │  │
│  │  │                                                             │  │  │
│  │  │  Input:                                                     │  │  │
│  │  │  • Username, followers, bio                                 │  │  │
│  │  │  • Top 3 Reel URLs + captions                              │  │  │
│  │  │                                                             │  │  │
│  │  │  Claude evaluates:                                          │  │  │
│  │  │  • Do they talk in videos? (YES/NO) ← MUST BE YES          │  │  │
│  │  │  • Voice & audio (1-10)                                     │  │  │
│  │  │  • Camera presence (1-10)                                   │  │  │
│  │  │  • Energy level (1-10)                                      │  │  │
│  │  │  • Authenticity (1-10)                                      │  │  │
│  │  │  • Production quality (1-10)                                │  │  │
│  │  │  • STYLE (Tutorial/Review/Entertainment/Inspiration)        │  │  │
│  │  │  • ENGLISH (YES/NO)                                         │  │  │
│  │  │  • Red flags                                                │  │  │
│  │  │                                                             │  │  │
│  │  │  Output:                                                    │  │  │
│  │  │  • overall_ugc_score (average)                              │  │  │
│  │  │  • recommendation: CONTACT_PRIORITY / CONTACT / SKIP       │  │  │
│  │  │  • reasoning (short explanation)                            │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                   │  │
│  │  50 profiles → ~20 approved (CONTACT or CONTACT_PRIORITY)       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### STEP 9: SAVE ALL RESULTS

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 9: SAVE ALL RESULTS                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  SUPABASE: Save ALL analyzed profiles                            │  │
│  │                                                                   │  │
│  │  Table: profiles                                                  │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │ • id (auto)                                                 │  │  │
│  │  │ • username                                                  │  │  │
│  │  │ • followers                                                 │  │  │
│  │  │ • engagement_rate                                           │  │  │
│  │  │ • bio                                                       │  │  │
│  │  │ • source (which competitor they tagged)                    │  │  │
│  │  │ • talks_in_video (true/false)                              │  │  │
│  │  │ • voice_score                                               │  │  │
│  │  │ • camera_score                                              │  │  │
│  │  │ • energy_score                                              │  │  │
│  │  │ • authenticity_score                                        │  │  │
│  │  │ • production_score                                          │  │  │
│  │  │ • content_style                                             │  │  │
│  │  │ • speaks_english                                            │  │  │
│  │  │ • overall_ugc_score                                         │  │  │
│  │  │ • recommendation                                            │  │  │
│  │  │ • reasoning                                                 │  │  │
│  │  │ • analyzed_at                                               │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                   │  │
│  │  Table: top_videos                                                │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │ • id (auto)                                                 │  │  │
│  │  │ • profile_id (link to profiles)                            │  │  │
│  │  │ • video_url                                                 │  │  │
│  │  │ • likes                                                     │  │  │
│  │  │ • comments                                                  │  │  │
│  │  │ • caption                                                   │  │  │
│  │  │ • rank (1, 2, or 3)                                        │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### STEP 10: EXPORT APPROVED TO GOOGLE SHEETS

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 10: EXPORT APPROVED TO GOOGLE SHEETS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  FILTER: Only recommendation = CONTACT or CONTACT_PRIORITY       │  │
│  │                                                                   │  │
│  │  GOOGLE SHEETS: Add row for each                                 │  │
│  │                                                                   │  │
│  Columns:                                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ A: Handle (@username)                                       │  │
│  │ B: Followers                                                │  │
│  │ C: Engagement %                                             │  │
│  │ D: UGC Score (overall)                                      │  │
│  │ E: Voice Score                                              │  │
│  │ F: Camera Score                                             │  │
│  │ G: Energy Score                                             │  │
│  │ H: Style (Tutorial/Review/Entertainment/Inspiration)        │  │
│  │ I: English (YES/NO)                                         │  │
│  │ J: Avg Video Duration (sec)  ← NEW                          │  │
│  │ K: Source (which competitor)                                │  │
│  │ L: Top Video 1 (clickable link)                             │  │
│  │ M: Top Video 2 (clickable link)                             │  │
│  │ N: Top Video 3 (clickable link)                             │  │
│  │ O: Claude's Notes                                           │  │
│  │ P: Priority (PRIORITY or normal)                            │  │
│  │ Q: Status (empty - you fill in)                             │  │
│  │ R: Date Added                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
```

---

## Claude Prompt for UGC Analysis

```markdown
# UGC CREATOR ANALYSIS FOR 21DRAW

## Profile Data:
- Username: {{ username }}
- Followers: {{ followers }}
- Engagement Rate: {{ engagement_rate }}%
- Bio: {{ bio }}
- Source: Tagged @{{ source_competitor }}

## Top 3 Videos/Reels:

### Video 1 (Highest Engagement)
- URL: {{ video_1_url }}
- Likes: {{ video_1_likes }}
- Comments: {{ video_1_comments }}
- Caption: {{ video_1_caption }}

### Video 2
- URL: {{ video_2_url }}
- Likes: {{ video_2_likes }}
- Comments: {{ video_2_comments }}
- Caption: {{ video_2_caption }}

### Video 3
- URL: {{ video_3_url }}
- Likes: {{ video_3_likes }}
- Comments: {{ video_3_comments }}
- Caption: {{ video_3_caption }}

---

## ANALYZE:

### A. CRITICAL - TALKS IN VIDEOS? (YES/NO)
Does this person speak/talk in their videos?
- Music-only or text-overlay = NO
- Must have actual voice/speech = YES

IF NO → Return recommendation "SKIP" immediately.

### B. VOICE & AUDIO (1-10 each)
- Voice clarity (clear, easy to understand?)
- Audio quality (good mic, no noise?)
- Tone stability (confident, stable tone?)

### C. CAMERA PRESENCE (1-10 each)
- Comfort on camera (natural, relaxed?)
- Energy level (engaging, good pacing?)
- Authenticity (genuine, not overly scripted?)

### D. PRODUCTION (1-10)
- Visual quality (lighting, camera stability?)
- Editing quality (well-edited, professional?)

### E. CONTENT STYLE
Categorize their primary style:
- **Tutorial** - Teaches/explains how to do things
- **Review** - Reviews products, courses, tools
- **Entertainment** - Funny, engaging, personality-driven
- **Inspiration** - Shows their work, motivational

### F. LANGUAGE
- **speaks_english**: Does this person speak English in their videos? (YES/NO)
- If bio/captions are in English but they don't SPEAK, still mark as NO

### G. RED FLAGS (YES/NO each)
- Sells competing courses/products?
- Fake/bought followers?
- Inappropriate content?
- Controversial topics?
- Inactive (no posts 30+ days)?

### H. RECOMMENDATION
- **CONTACT_PRIORITY**: Talks clearly ✓, scores >= 8, English YES, no red flags
- **CONTACT**: Talks ✓, scores >= 6, minor issues OK
- **SKIP**: Doesn't talk, OR scores < 6, OR red flags

---

## RESPOND IN THIS EXACT JSON:
```json
{
  "talks_in_videos": true,
  "voice_clarity": 8,
  "audio_quality": 7,
  "tone_stability": 8,
  "camera_comfort": 8,
  "energy_level": 7,
  "authenticity": 9,
  "production_quality": 7,
  "content_style": "Tutorial",
  "speaks_english": true,
  "overall_ugc_score": 7.8,
  "red_flags": [],
  "recommendation": "CONTACT_PRIORITY",
  "reasoning": "Clear English speaker with stable tone. Very comfortable on camera, authentic personality. Creates tutorial-style content. Previously made UGC for Skillshare. Perfect for 21Draw."
}
```
```

---

## Setup Checklist

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║                    SETUP CHECKLIST                                        ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝

ACCOUNTS (create if you don't have):
────────────────────────────────────
□ Apify - apify.com (free credits to start)
□ Supabase - supabase.com (free tier)
□ Google Sheets - (you probably already have)
□ Anthropic API - console.anthropic.com (for Claude)

N8N CREDENTIALS (add in N8N):
─────────────────────────────
□ Apify API Token
□ Supabase URL + API Key
□ Google Sheets OAuth
□ Anthropic API Key (for Claude calls)

SUPABASE TABLES (create):
─────────────────────────
□ profiles (see structure above)
□ top_videos (see structure above)

GOOGLE SHEET (create):
──────────────────────
□ New sheet: "21Draw UGC Candidates"
□ Add column headers (A-Q)

GITHUB (create):
────────────────
□ Repository: "ugc-finder-21draw"
□ Folder: docs/
□ File: docs/UGC_FINDER.md
□ File: .env.example
□ File: .gitignore
```

---

## Implementation Timeline

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║                    IMPLEMENTATION TIMELINE                                ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝

DAY 1: Setup (2-3 hours)
────────────────────────
□ 09:00 - Create Apify account, get API token
□ 09:30 - Create Supabase project, create tables
□ 10:00 - Create Google Sheet with correct columns
□ 10:30 - Add credentials in N8N
□ 11:00 - Create GitHub repo, folder structure
□ 11:30 - Write UGC_FINDER.md (business logic)

DAY 2: Build workflow (3-4 hours)
─────────────────────────────────
□ 09:00 - Build Steps 1-3 (Trigger → Apify → Extract)
□ 10:00 - Test with 1 competitor, 10 posts
□ 10:30 - Build Steps 4-5 (Duplicate check → Filter)
□ 11:00 - Build Steps 6-7 (Profile scraper → Top reels)
□ 12:00 - Test entire first half
□ 13:00 - Build Step 8 (Claude analysis)
□ 14:00 - Build Steps 9-10 (Supabase → Sheets)
□ 15:00 - Test entire workflow with 20 profiles

DAY 3: Test & fine-tuning (2 hours)
───────────────────────────────────
□ 09:00 - Run full test with all 5 competitors
□ 10:00 - Review results in Google Sheets
□ 10:30 - Adjust Claude prompt if necessary
□ 11:00 - Document in GitHub
□ 11:30 - Export workflow as backup

AFTER DAY 3: Ready to use!
──────────────────────────
□ Run workflow when you want to find new creators
□ Review Google Sheet
□ Start contacting!
```

---

## Expected Results Per Run

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║                    EXPECTED RESULTS PER RUN                               ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝

INPUT:
──────
5 competitors × 100 posts = 500 posts

AFTER STEP 3 (Extract unique):
──────────────────────────────
~300 unique profiles

AFTER STEP 4 (Duplicate check):
───────────────────────────────
~250 new profiles (first run: all are new)

AFTER STEP 5 (Basic filter):
────────────────────────────
~80 profiles (5k-100k followers, >2% engagement)

AFTER STEP 7 (Has videos/reels):
────────────────────────────────
~50 profiles with at least 3 reels

AFTER STEP 8 (Claude approves):
───────────────────────────────
~20 profiles who talk in video + good scores

OUTPUT IN GOOGLE SHEETS:
────────────────────────
~20 quality candidates per run

ESTIMATED COST PER RUN:
───────────────────────
Apify: ~$5-10 (depending on number of profiles)
Claude: ~$1-2 (50 analyses × ~$0.02)
Total: ~$7-12 per run
```

---

## Supabase SQL Schema

```sql
-- Table for all analyzed profiles
CREATE TABLE profiles (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    followers INTEGER,
    engagement_rate DECIMAL(5,2),
    bio TEXT,
    source_competitor VARCHAR(100),
    
    -- Analysis results
    talks_in_videos BOOLEAN,
    voice_clarity INTEGER,
    audio_quality INTEGER,
    tone_stability INTEGER,
    camera_comfort INTEGER,
    energy_level INTEGER,
    authenticity INTEGER,
    production_quality INTEGER,
    overall_ugc_score DECIMAL(3,1),
    
    -- Style and language
    content_style VARCHAR(50),
    speaks_english BOOLEAN,
    
    -- Recommendation
    recommendation VARCHAR(50),
    reasoning TEXT,
    red_flags TEXT[],
    
    -- Metadata
    analyzed_at TIMESTAMP DEFAULT NOW(),
    
    -- Avoid duplicates
    UNIQUE(username)
);

-- Table for top videos/reels
CREATE TABLE top_videos (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
    video_url TEXT,
    likes INTEGER,
    comments INTEGER,
    caption TEXT,
    rank INTEGER, -- 1, 2, or 3
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for faster searches
CREATE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_profiles_recommendation ON profiles(recommendation);
CREATE INDEX idx_top_videos_profile ON top_videos(profile_id);
```

---

## VS Code Project Structure

```
ugc-finder-21draw/
│
├── docs/
│   └── UGC_FINDER.md         ← Business logic (this document)
│
├── workflows/
│   └── n8n-workflow.json     ← Exported N8N workflow
│
├── .env                      ← Your REAL API keys (NEVER to GitHub)
├── .env.example              ← Template for API keys (safe to share)
├── .gitignore                ← Protects .env from GitHub
└── README.md                 ← Project overview
```

---

## .env.example Template

```
# Copy this file to .env and fill in your actual keys
# NEVER share your .env file with anyone!

# Apify (for Instagram scraping)
APIFY_API_TOKEN=your_apify_token_here

# Supabase (database)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=your_supabase_key_here

# Anthropic (Claude AI)
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

---

## .gitignore

```
# Secret files - NEVER upload to GitHub
.env

# System files
.DS_Store
Thumbs.db

# Logs
*.log

# Node modules (if you ever use them)
node_modules/
```

---

*Last updated: January 2026*
*Project: UGC Finder for 21Draw*
*Method: Competitor Tagging*
---

## Changelog

### v1.1 - January 2026
- Added video duration filter (15-90 seconds) to Step 6
- Added N8N code snippets section
- Added "Avg Video Duration" column to Google Sheets output
- Rationale: Videos under 15 sec are typically music/transitions, not talking content

### v1.0 - January 2026
- Initial documentation