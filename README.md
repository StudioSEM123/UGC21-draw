# UGC Finder for 21Draw

## What is this?
An automated two-phase system to find quality UGC creators for 21Draw.

## Method
**Phase 1:** Find creators who tagged competitor accounts (e.g., @proko)
**Phase 2:** Find similar accounts to approved Phase 1 creators

## Tech Stack
- **N8N** - Workflow automation (37 nodes)
- **Apify** - Instagram scraping (sync API)
- **Supabase** - Database (profiles table with reels)
- **Claude API** - AI analysis with 8 detailed scores
- **Google Sheets** - Output for approved candidates

## How it works
1. Scrape posts tagging @proko (or configured competitor)
2. Filter by followers (5k-100k)
3. Fetch profiles + filter for videos 15-90 seconds
4. Skip profiles with < 3 qualifying videos
5. Claude analyzes: talks in videos, 8 scores, English, red flags
6. Save all to Supabase, export approved to Google Sheets
7. **Phase 2:** Use approved profiles as seeds to find similar accounts
8. Repeat analysis for similar accounts

## Expected output per run
- **Phase 1:** ~5-8 approved from ~100 tagged posts
- **Phase 2:** ~10-15 approved from ~180 similar accounts
- **Total:** ~15-23 quality candidates
- **Cost:** ~$2.65 per run

## Setup
1. Import `workflows/n8n-workflow.json` into N8N
2. Configure credentials in N8N:
   - HTTP Query Auth (Apify token)
   - Supabase
   - HTTP Header Auth (Anthropic API key)
   - Google Sheets OAuth2
3. Create profiles table in Supabase (see docs)
4. Create Google Sheet with columns (see docs)
5. Run!

## Documentation
See `docs/UGC_FINDER.md` for complete project documentation including:
- Full workflow architecture diagram
- Supabase schema with SQL
- Claude analysis prompt
- Google Sheets column structure
- Cost breakdown

## Files
- `docs/UGC_FINDER.md` - Full documentation
- `workflows/n8n-workflow.json` - Importable N8N workflow
- `.env.example` - Template for API keys (optional reference)
