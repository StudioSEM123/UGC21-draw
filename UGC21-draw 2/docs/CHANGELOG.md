# UGC Finder Changelog

All notable changes to the UGC Finder workflow are documented here.

---

## [2.0.0] - 2026-01-26

### 🔴 Critical Fixes
- **FIXED:** Save DB node was disabled - now enabled with auto-mapping
- **FIXED:** Claude API headers referenced wrong credential type (`httpHeaderAuth` → proper header auth)
- **FIXED:** Check DB used 'get' operation instead of 'select' (caused duplicate processing)
- **FIXED:** Google Sheets column mapping was empty (data not written correctly)
- **FIXED:** Apify actor mismatch - now using `instagram-post-scraper` consistently

### 🟡 Major Improvements
- **NEW:** Multi-competitor support (array instead of single competitor)
- **NEW:** Engagement rate calculation in Filter Reels node
- **NEW:** Pre-filtering by follower count before expensive API calls
- **NEW:** Art content detection via hashtag analysis
- **NEW:** Top hashtags extraction for content analysis
- **CHANGED:** Claude prompt completely rewritten to be honest about limitations
- **CHANGED:** Recommendation values: `CONTACT` → `REVIEW_PRIORITY` / `REVIEW`
- **CHANGED:** All recommendations now require manual video review
- **REMOVED:** Phase 2 similar accounts (moved to separate workflow for reliability)

### 🟢 Minor Improvements
- Added error handling on Apify calls (`continueOnError`)
- Extended caption length from 300 to 400 characters
- Added more metadata fields to output (avg_comments, total_qualifying_reels)
- Better console logging for debugging
- Added `analyzed_at` timestamp to all records
- Improved node positioning and flow notes

### ⚠️ Breaking Changes
- Database schema updated - new columns required (run `supabase_schema_v2.sql`)
- Google Sheet columns changed - update sheet headers
- Claude response format changed - new fields in output
- Phase 2 no longer auto-runs - must be triggered separately

### Migration Steps
1. Export any existing data from old workflow
2. Run new Supabase schema (creates new columns)
3. Update Google Sheet headers
4. Import new workflow JSON
5. Reconnect credentials (especially Anthropic - new auth type)
6. Test with 1 competitor, 3 posts

---

## [1.0.0] - 2026-01-22

### Initial Release
- Basic competitor tag scraping from single competitor
- Claude analysis with video quality assessment (later found to be unreliable)
- Phase 2 similar accounts discovery (auto-triggered)
- Supabase storage
- Google Sheets output
- Single competitor support only

### Known Issues (Fixed in 2.0)
- Save DB node was accidentally disabled
- Claude claimed to assess video/audio quality it couldn't actually see
- Check DB operation type was wrong
- Sheet columns weren't mapped
