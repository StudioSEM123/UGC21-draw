# UGC Finder Workflow for 21Draw

> **Version:** 2.0 (Fixed)  
> **Last Updated:** 2026-01-26  
> **Status:** Phase 1 Production Ready | Phase 2 Separate Workflow

---

## Overview

An n8n automation workflow that discovers Instagram UGC creators for 21Draw by:
1. Scraping tagged posts from art education competitors
2. Filtering for creators with qualifying video content
3. Analyzing profiles using Claude AI
4. Outputting qualified leads to Google Sheets for manual review

---

## Quick Links

- **n8n Workflow:** `/workflows/UGC_Finder_v2_Fixed.json`
- **Google Sheet:** [21Draw UGC Candidates](https://docs.google.com/spreadsheets/d/1HqsIaxnz3elGDOAd4njxkUkFqF-OBljY-bkYWMtdWvM/edit)
- **Notion Docs:** [UGC Finder Documentation](https://www.notion.so/2f45ed39b54f81d68f3edf707773bf0b)

---

## Architecture - Phase 1 Flow

```
Start → Settings → Prep Competitors → Loop Competitors
                                           ↓
                                    Apify: Tagged Posts
                                           ↓
                                    Extract Profiles
                                           ↓
                                    Aggregate + Dedupe
                                           ↓
                                    Phase 1 Loop
                                           ↓
                                    Check DB → New?
                                              ↙    ↘
                                        [YES]      [NO]
                                          ↓          ↓
                                   Apify: Profile  Skip
                                          ↓          
                                    Filter Reels   
                                          ↓
                                   Claude Analysis
                                          ↓
                                       Merge
                                          ↓
                                      Save DB
                                          ↓
                                     Approved?
                                     ↙      ↘
                               [YES]        [NO]
                                 ↓           ↓
                              Sheets       Skip
                                 ↓           
                              Loop Back ←←←
```

---

## Configuration

### Settings Node - Edit These Values

| Setting | Default | Description |
|---------|---------|-------------|
| COMPETITORS | prokotv, marcbrunet, sinixdesign, ethanmbecker, rossdraws | Instagram accounts to scrape tagged posts from |
| POSTS_PER_COMPETITOR | 10 | Tagged posts to fetch per competitor |
| MIN_FOLLOWERS | 5,000 | Minimum follower count |
| MAX_FOLLOWERS | 100,000 | Maximum follower count |
| MIN_REELS_REQUIRED | 3 | Minimum qualifying video reels |
| MIN_REEL_DURATION | 15 | Minimum reel length (seconds) |
| MAX_REEL_DURATION | 90 | Maximum reel length (seconds) |

### Adding New Competitors

1. Find the Instagram username (not display name)
2. Verify the account has tagged posts from creators
3. Add to the `COMPETITORS` array in Settings node
4. Test with `POSTS_PER_COMPETITOR = 3` first

---

## Credentials Required

| Credential | Node | How to Set Up |
|------------|------|---------------|
| **Apify API** | HTTP Request nodes | Create HTTP Query Auth with `token` parameter |
| **Anthropic API** | Claude Analysis | Create HTTP Header Auth with `x-api-key` header |
| **Supabase** | Check DB, Save DB | Project URL + anon key |
| **Google Sheets OAuth** | Sheets | OAuth2 connection |

---

## Database Schema (Supabase)

See `/supabase_schema_v2.sql` for the complete schema.

Key tables:
- `profiles` - Main table for storing analyzed creators

Key indexes:
- `idx_profiles_status` - For filtering by review status
- `idx_profiles_recommendation` - For filtering by AI recommendation

---

## Google Sheets Columns

| Column | Description |
|--------|-------------|
| Handle | @username |
| Followers | Follower count |
| Engagement % | Calculated engagement rate |
| Profile Score | AI overall score (1-10) |
| Niche Score | Art education relevance |
| Engagement Score | Engagement health |
| Style | Content categories |
| Art Content | Has art hashtags |
| Avg Duration | Average reel length |
| Source | Which competitor |
| Top Video 1-3 | Video links for review |
| AI Notes | Claude's analysis |
| Review Notes | What to check manually |
| Priority | REVIEW_PRIORITY / REVIEW / SKIP |
| Status | PENDING_REVIEW (default) |
| Date Added | Timestamp |

---

## Claude Analysis - What It CAN and CANNOT Do

### ✅ Claude CAN analyze:
- Bio text and keywords
- Hashtag themes
- Caption content and style
- Engagement rate calculations
- Red flag indicators in text

### ❌ Claude CANNOT:
- Watch videos
- Hear audio/voice
- Assess speaking ability
- Evaluate camera presence
- Judge production quality

**Important:** The workflow outputs profiles for MANUAL VIDEO REVIEW. Claude scores profile quality, not video quality.

---

## Manual Review Process

1. Open Google Sheet "21Draw UGC Candidates"
2. Filter by Priority = "REVIEW_PRIORITY" first
3. For each row:
   - Click Video 1, 2, 3 links
   - Check: Does creator speak? Is voice clear?
   - Check: Camera presence, energy, authenticity
   - Update Status: APPROVED / REJECTED
   - Add notes if needed

---

## Cost Estimates

| Component | Cost per Unit | Typical Run (50 profiles) |
|-----------|--------------|---------------------------|
| Apify Tagged Posts | ~$0.05/competitor | $0.25 (5 competitors) |
| Apify Profile Fetch | ~$0.08/profile | $4.00 |
| Claude Analysis | ~$0.025/call | $1.25 |
| **Total** | | **~$5.50** |

---

## Troubleshooting

### "No profiles found"
- Check if competitor username is correct
- Verify competitor has tagged posts
- Check Apify actor logs for errors

### "All profiles filtered out"
- Adjust MIN_FOLLOWERS / MAX_FOLLOWERS
- Reduce MIN_REELS_REQUIRED to 2
- Check if Apify returns video data

### "Claude parse error"
- Check Anthropic API key is valid
- Look at raw response in execution log
- May need to adjust prompt format

### "Duplicate key" in Supabase
- Profile already exists
- Check DB node is properly filtering

---

## Files

| File | Purpose |
|------|---------|
| `/workflows/UGC_Finder_v2_Fixed.json` | n8n workflow (import this) |
| `/supabase_schema_v2.sql` | Database schema |
| `/docs/UGC_FINDER.md` | This documentation |
| `/docs/CHANGELOG.md` | Version history |
| `/docs/SETUP.md` | Setup guide |
