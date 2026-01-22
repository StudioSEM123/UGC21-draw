# UGC Finder for 21Draw

## What is this?
An automated system to find quality UGC creators for 21Draw using competitor tagging.

## Method
We find creators who have already made UGC for similar companies (Skillshare, Domestika, Proko, etc.) - these people have proven they can create sponsored content.

## Tech Stack
- **N8N** - Workflow automation
- **Apify** - Instagram scraping
- **Supabase** - Database (stores profiles, avoids duplicates)
- **Claude API** - AI analysis of creators
- **Google Sheets** - Output for approved candidates

## How it works
1. Scrape profiles that tagged competitors
2. Filter by followers (5k-100k) and engagement (>2%)
3. Fetch their top 3 Reels/Videos
4. Claude analyzes if they talk in videos, camera presence, English, etc.
5. Approved creators go to Google Sheets

## Expected output per run
- Input: 500 posts from 5 competitors
- Output: ~20 quality candidates
- Cost: ~$7-12 per run

## Setup
1. Copy `.env.example` to `.env`
2. Fill in your API keys
3. Import workflow in N8N
4. Create tables in Supabase
5. Run!

## Documentation
See `docs/UGC_FINDER.md` for complete project documentation.

## Files
- `docs/UGC_FINDER.md` - Full business logic & workflow details
- `workflows/` - Exported N8N workflows (backups)
- `.env` - Your API keys (never shared)
- `.env.example` - Template showing required keys