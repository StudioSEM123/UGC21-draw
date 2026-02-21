#!/usr/bin/env python3
"""
Modify n8n UGC workflow (6) -> (7):
  1. Rename "Webhook Trigger" to "Phase 1: Discovery", update path/webhookId/position
  2. Remove "Phase Router" node
  3. Remove connections FROM "Webhook Trigger" and FROM "Phase Router"
  4. Add connection "Phase 1: Discovery" -> "Settings1"
  5. Create new webhook node "Phase 2: Video Analysis"
  6. Add connection "Phase 2: Video Analysis" -> "Get COLLABORATE Profiles"
  7. Update first Sticky Note content
"""

import json
import sys

INPUT  = "/Users/norasshante/Desktop/ugc-finder-21draw/workflows/n8n UGC latest (6).json"
OUTPUT = "/Users/norasshante/Desktop/ugc-finder-21draw/workflows/n8n UGC latest (7).json"

with open(INPUT, "r") as f:
    wf = json.load(f)

# ── 1. Rename "Webhook Trigger" → "Phase 1: Discovery" ──────────────────────
for node in wf["nodes"]:
    if node["name"] == "Webhook Trigger":
        node["name"] = "Phase 1: Discovery"
        node["parameters"]["path"] = "phase-1"
        node["webhookId"] = "phase-1"
        node["position"] = [-6752, 304]
        print(f"[OK] Renamed 'Webhook Trigger' -> 'Phase 1: Discovery' (path=phase-1, pos={node['position']})")
        break
else:
    print("[ERROR] 'Webhook Trigger' node not found!")
    sys.exit(1)

# ── 2. Remove "Phase Router" node ────────────────────────────────────────────
before = len(wf["nodes"])
wf["nodes"] = [n for n in wf["nodes"] if n["name"] != "Phase Router"]
after = len(wf["nodes"])
if after < before:
    print(f"[OK] Removed 'Phase Router' node ({before} -> {after} nodes)")
else:
    print("[WARN] 'Phase Router' node not found in nodes array")

# ── 3. Remove connections FROM old names ─────────────────────────────────────
for key in ["Webhook Trigger", "Phase Router"]:
    if key in wf["connections"]:
        del wf["connections"][key]
        print(f"[OK] Removed connections from '{key}'")

# ── 4. Add connection: "Phase 1: Discovery" → "Settings1" ───────────────────
wf["connections"]["Phase 1: Discovery"] = {
    "main": [
        [
            {
                "node": "Settings1",
                "type": "main",
                "index": 0
            }
        ]
    ]
}
print("[OK] Added connection: 'Phase 1: Discovery' -> 'Settings1'")

# ── 5. Create new "Phase 2: Video Analysis" webhook node ─────────────────────
phase2_node = {
    "parameters": {
        "path": "phase-2",
        "options": {}
    },
    "id": "webhook-phase-2",
    "name": "Phase 2: Video Analysis",
    "type": "n8n-nodes-base.webhook",
    "typeVersion": 2,
    "position": [-6752, 784],
    "webhookId": "phase-2"
}
wf["nodes"].append(phase2_node)
print(f"[OK] Created 'Phase 2: Video Analysis' node (path=phase-2, pos={phase2_node['position']})")

# ── 6. Add connection: "Phase 2: Video Analysis" → "Get COLLABORATE Profiles"
wf["connections"]["Phase 2: Video Analysis"] = {
    "main": [
        [
            {
                "node": "Get COLLABORATE Profiles",
                "type": "main",
                "index": 0
            }
        ]
    ]
}
print("[OK] Added connection: 'Phase 2: Video Analysis' -> 'Get COLLABORATE Profiles'")

# ── 7. Update first Sticky Note content ──────────────────────────────────────
NEW_STICKY = """## TRIGGERS

Phase 1 — Discovery + Claude Analysis:
GET /webhook/phase-1

Phase 2 — Gemini Video Analysis:
GET /webhook/phase-2

Each phase has its own trigger.
Phase 1 discovers new creators, Phase 2 analyzes approved creators' videos."""

for node in wf["nodes"]:
    if node.get("type", "").endswith(".stickyNote") and node.get("position") == [-6832, -64]:
        node["parameters"]["content"] = NEW_STICKY
        print("[OK] Updated Sticky Note content")
        break
else:
    print("[WARN] Target Sticky Note not found")

# ── Write output ─────────────────────────────────────────────────────────────
with open(OUTPUT, "w") as f:
    json.dump(wf, f, indent=2)
print(f"\n[OK] Saved to: {OUTPUT}")

# ── Verification ─────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("VERIFICATION")
print("=" * 60)

# Reload and verify
with open(OUTPUT, "r") as f:
    check = json.load(f)
print("[OK] Output is valid JSON")

# Print all webhook nodes
print("\nWebhook nodes:")
for node in check["nodes"]:
    if node["type"] == "n8n-nodes-base.webhook":
        print(f"  - name: {node['name']!r}, path: {node['parameters']['path']!r}")

# Print connections from both webhook nodes
for name in ["Phase 1: Discovery", "Phase 2: Video Analysis"]:
    if name in check["connections"]:
        targets = []
        for output_group in check["connections"][name].get("main", []):
            for conn in output_group:
                targets.append(conn["node"])
        print(f"\nConnections from {name!r}: {targets}")
    else:
        print(f"\n[ERROR] No connections found from {name!r}")

# Confirm Phase Router is gone
router_found = any(n["name"] == "Phase Router" for n in check["nodes"])
router_conn = "Phase Router" in check["connections"]
if not router_found and not router_conn:
    print("\n[OK] 'Phase Router' is fully removed (no node, no connections)")
else:
    if router_found:
        print("\n[ERROR] 'Phase Router' node still exists!")
    if router_conn:
        print("\n[ERROR] 'Phase Router' connections still exist!")

print(f"\nTotal nodes: {len(check['nodes'])}")
print(f"Total connection sources: {len(check['connections'])}")
