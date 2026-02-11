# 21Draw UGC Creator Discovery — Master Project Plan

### v1.2 — February 2026
### Owner: Noras Shante | Client: 21Draw (Renco Smeding)

---

## Quick Start — If This Chat Breaks

Upload this file to a new Claude.ai chat and say: "Continue from Phase X, Task Y" based on where you left off in the checklist at the bottom.

---

## Project Overview

**What we're building:** An automated pipeline that discovers, analyzes, and qualifies Instagram creators for UGC partnerships with 21Draw, an online art education platform.

**The end-to-end funnel:**
Find Creators → Scrape Profiles → Analyze with Claude AI → Analyze Videos with Gemini → Score & Rank → Outreach

**Current state:** Combined n8n workflow with Phase 1 (discovery + Claude analysis) and Phase 2 (Gemini video analysis). Running on Hostinger VPS. Supabase as database. 24 profiles processed, 20 with full video analysis.

---

## Target Architecture

Currently running as a single combined workflow. Future goal is to split into layered workflows:

WF1-Data-Fetch: Scrape competitor tags → save NEW profiles to Supabase
WF2-Enrichment: Full profile scrape → extract reels → save ENRICHED
WF3-AI-Analysis: Claude analysis → save ANALYZED + log to ai_logs
WF4-Video-Analysis: Gemini video eval → save VIDEO_ANALYZED + log
WF5-Audit: Cross-check AI outputs for hallucinations

Status flow: NEW → ENRICHED → ANALYZED → VIDEO_ANALYZED → OUTREACH_READY

---

## Current Competitors (Settings1 node)

- domestika
- schoolismlive
- storyboardart_org
- easy_drawing_ideas__
- pix_bun

Settings: 2k-150k followers, 100 results limit

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

## Phase 3: Split Workflows — TODO

- [ ] Create WF1-Data-Fetch workflow
- [ ] Create WF2-Enrichment workflow
- [ ] Create WF3-AI-Analysis workflow with logging
- [ ] Create WF4-Video-Analysis workflow
- [ ] Test each independently

## Phase 4: Audit System — TODO

- [ ] Create audit_results table
- [ ] Build audit script/workflow (WF5)
- [ ] Run first audit on existing 24 profiles

## Phase 5: Outreach — TODO

- [ ] Automatic outreach email generation
- [ ] Integration with CRM
- [ ] Dashboard for reviewing candidates

---

## Workflow Export Checklist

After splitting into separate workflows:
- [ ] Export WF1 → `workflows/wf1-data-fetch.json`
- [ ] Export WF2 → `workflows/wf2-enrichment.json`
- [ ] Export WF3 → `workflows/wf3-ai-analysis.json`
- [ ] Export WF4 → `workflows/wf4-video-analysis.json`

---

## Key Rule from Renco

"Every LLM call MUST be logged (prompt, input, output) and have a separate audit task."

---

Last updated: February 10, 2026
