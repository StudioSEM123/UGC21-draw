# 21Draw UGC Creator Discovery — Master Project Plan

### v1.0 — February 2026
### Owner: Noras Shante | Client: 21Draw (Renco Smeding)

---

## Quick Start — If This Chat Breaks

Upload this file to a new Claude.ai chat and say: "Continue from Phase X, Task Y" based on where you left off in the checklist at the bottom.

---

## Project Overview

**What we're building:** An automated pipeline that discovers, analyzes, and qualifies Instagram creators for UGC partnerships with 21Draw, an online art education platform.

**The end-to-end funnel:**
Find Creators → Scrape Profiles → Analyze with AI → Analyze Videos → Score & Rank → Personalize Outreach → Send → Track Replies

**Current state:** Working n8n workflow that scrapes prokotv tagged posts, enriches profiles via Apify, analyzes with Claude AI, saves to Google Sheets. Supabase node is disabled.

**Next steps:** Re-enable Supabase, split into layered workflows, add Gemini Pro video analysis.

---

## Target Architecture (Per Renco)

WF1-Data-Fetch: Scrape competitor tags → save NEW profiles to Supabase
WF2-Enrichment: Full profile scrape → extract reels → save ENRICHED  
WF3-AI-Analysis: Claude analysis → save ANALYZED + log to ai_logs
WF4-Video-Analysis: Gemini Pro video eval → save VIDEO_ANALYZED + log
WF5-Audit: Cross-check AI outputs for hallucinations

Status flow: NEW → ENRICHED → ANALYZED → VIDEO_ANALYZED → OUTREACH_READY

---

## Phase 1A: Stabilize (Week 1, Day 1)

- [x ] Re-enable Supabase "Save DB" node
- [ x] Add status column to profiles table
- [x ] Create ai_logs table in Supabase
- [x ] Test run with 5 existing creators
- [ ] Add 2 more competitors to Settings1

## Phase 1B: Organize Workflow (Week 1, Day 2)

- [x] Add stage sticky notes to workflow (Data Fetch, Enrichment, AI Analysis, Save)
- [x] Remove Google Sheets nodes
- [x] Clean up unused AI Agent/Gemini nodes
- [x] Export and save workflow to git

## Phase 1B: Split Workflows (Week 1, Day 2)

- [ ] Create WF1-Data-Fetch workflow
- [ ] Create WF2-Enrichment workflow  
- [ ] Create WF3-AI-Analysis workflow with logging
- [ ] Test each independently

## Workflow Export Checklist

After completing each workflow, export and save (will skip til its needed in a later stage), have added sticky notes to current workflow:
- [ ] Export WF1 from n8n → save as `workflows/wf1-data-fetch.json`
- [ ] Export WF2 from n8n → save as `workflows/wf2-enrichment.json`
- [ ] Export WF3 from n8n → save as `workflows/wf3-ai-analysis.json`
- [ ] Export WF4 from n8n → save as `workflows/wf4-video-analysis.json`

**How to export:** In n8n, open the workflow → click the three dots menu (top right) → Download → saves as JSON
```

Or I can give you a command to append it — let me know.

---

## Question 5: How to export and commit to git

**Step 1 — Export from n8n:**
1. Open your workflow in n8n (in browser)
2. Click the three dots `⋯` in the top right corner
3. Click "Download"
4. It downloads a `.json` file to your Downloads folder

**Step 2 — Move to your project:**
```
cp ~/Downloads/your-workflow-name.json workflows/wf1-data-fetch.json
```

**Step 3 — Commit to git:**
```
git add workflows/wf1-data-fetch.json
git commit -m "Add WF1 data fetch workflow"
git push
```

**Why this matters:** Git keeps history. If you break something next week, you can go back to today's working version. It's your undo button.

---

## Question 6: Checking if Claude Code is installed

Claude Code is different from the Claude.ai website you're using right now. It's a separate command-line tool. Let's check if you have it:

Run this in your terminal:
```
claude --version

## Phase 2: Video Analysis (Week 2)

- [ ] Create Gemini Pro API key at aistudio.google.com
- [ ] Build WF4-Video-Analysis workflow
- [ ] Test on 5 creators
- [ ] Add logging for Gemini calls

## Phase 3: Audit System (Week 3)

- [ ] Create audit_results table
- [ ] Build audit script/workflow
- [ ] Run first audit

---

## Database Tables Needed

### profiles table — add columns:
- status (text): NEW, ENRICHED, ANALYZED, VIDEO_ANALYZED
- instagram_url (text): https://instagram.com/{username}

### ai_logs table — create new:
- id (serial)
- profile_username (text)
- workflow_name (text)
- model_used (text)
- prompt_sent (text)
- input_data (jsonb)
- output_raw (text)
- output_parsed (jsonb)
- created_at (timestamptz)
- audit_status (text)

---

## Competitors to Scrape

- prokotv (current)
- drawlikeasir
- sinixdesign
- marcobucci

---

## Key Rule from Renco

"Every LLM call MUST be logged (prompt, input, output) and have a separate audit task."

---

Last updated: February 5, 2026


---

## Workflow Export Checklist

After completing each workflow, export and save:
- [ ] Export WF1 from n8n → save as workflows/wf1-data-fetch.json
- [ ] Export WF2 from n8n → save as workflows/wf2-enrichment.json
- [ ] Export WF3 from n8n → save as workflows/wf3-ai-analysis.json
- [ ] Export WF4 from n8n → save as workflows/wf4-video-analysis.json

How to export: In n8n, open workflow → click three dots menu (top right) → Download