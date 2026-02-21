#!/usr/bin/env python3
"""
Modifies the n8n workflow JSON to:
1. Update the existing TRIGGERS sticky note (height=1700, new content)
2. Add 4 new Phase 2 sticky note nodes with unique UUIDs
Then overwrites the file in-place and prints verification info.
"""

import json
import uuid

WORKFLOW_PATH = "/Users/norasshante/Desktop/ugc-finder-21draw/workflows/n8n UGC latest (7).json"

# --- Load ---
with open(WORKFLOW_PATH, "r") as f:
    workflow = json.load(f)

nodes = workflow["nodes"]

# --- 1. Update the existing TRIGGERS sticky note at [-6832, -64] ---
triggers_content = """## TRIGGERS

Phase 1 — Discovery + Claude Analysis
GET /webhook/phase-1

Phase 2 — Gemini Video Analysis
GET /webhook/phase-2

Each phase has its own trigger.
Phase 1 discovers new creators.
Phase 2 analyzes approved creators' videos."""

for node in nodes:
    if (
        node["type"] == "n8n-nodes-base.stickyNote"
        and node["position"] == [-6832, -64]
    ):
        node["parameters"]["height"] = 1700
        node["parameters"]["content"] = triggers_content
        print(f"Updated TRIGGERS sticky note: height=1700, content refreshed")
        break
else:
    raise RuntimeError("Could not find the TRIGGERS sticky note at [-6832, -64]")

# --- 2. Add 4 new Phase 2 sticky notes ---
new_stickies = [
    {
        "name": "Sticky Note - Phase 2 Stage 1",
        "position": [-6550, 750],
        "width": 700,
        "height": 900,
        "color": 2,
        "content": (
            "PHASE 2 \u2014 STAGE 1: FETCH APPROVED\n"
            "Gets approved profiles that need video analysis.\n"
            "Loops through each profile.\n"
            "Builds Supabase storage URLs for reels."
        ),
    },
    {
        "name": "Sticky Note - Phase 2 Stage 2",
        "position": [-5800, 750],
        "width": 1050,
        "height": 900,
        "color": 3,
        "content": (
            "PHASE 2 \u2014 STAGE 2: DOWNLOAD & UPLOAD\n"
            "Downloads up to 3 reels per profile from Instagram CDN.\n"
            "Uploads each reel to Supabase Storage bucket.\n"
            "Wait 90s for Gemini Files API to process."
        ),
    },
    {
        "name": "Sticky Note - Phase 2 Stage 3",
        "position": [-4700, 750],
        "width": 1000,
        "height": 900,
        "color": 5,
        "content": (
            "PHASE 2 \u2014 STAGE 3: GEMINI ANALYSIS\n"
            "Prepares video URLs for Gemini.\n"
            "Skip Check: skips if already analyzed.\n"
            "Sends videos to Gemini for analysis:\n"
            "  - Speech detection, teaching ability\n"
            "  - Production quality, brand fit\n"
            "  - Overall UGC score"
        ),
    },
    {
        "name": "Sticky Note - Phase 2 Stage 4",
        "position": [-3700, 750],
        "width": 500,
        "height": 900,
        "color": 6,
        "content": (
            "PHASE 2 \u2014 STAGE 4: SAVE RESULTS\n"
            "Parses Gemini response.\n"
            "Logs to ai_logs table.\n"
            "Updates profile with video scores.\n"
            "Status: VIDEO_ANALYZED"
        ),
    },
]

for spec in new_stickies:
    node = {
        "parameters": {
            "content": spec["content"],
            "height": spec["height"],
            "width": spec["width"],
            "color": spec["color"],
        },
        "type": "n8n-nodes-base.stickyNote",
        "typeVersion": 1,
        "position": spec["position"],
        "id": str(uuid.uuid4()),
        "name": spec["name"],
    }
    nodes.append(node)
    print(f"Added: {spec['name']} at {spec['position']} (id={node['id']})")

# --- Save in-place ---
with open(WORKFLOW_PATH, "w") as f:
    json.dump(workflow, f, indent=2, ensure_ascii=False)

print(f"\nWorkflow saved to: {WORKFLOW_PATH}")

# --- Verification ---
# Re-read to confirm valid JSON
with open(WORKFLOW_PATH, "r") as f:
    verified = json.load(f)

print(f"\nValid JSON: Yes")
print(f"Total node count: {len(verified['nodes'])}")

print("\n--- All Sticky Notes ---")
for node in verified["nodes"]:
    if node["type"] == "n8n-nodes-base.stickyNote":
        content_preview = node["parameters"]["content"][:40].replace("\n", " ")
        pos = node["position"]
        print(f"  Name: {node['name']}")
        print(f"    Position: {pos}")
        print(f"    Content:  {content_preview}...")
        print()
