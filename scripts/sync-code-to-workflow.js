#!/usr/bin/env node
/**
 * Syncs local JS files into the n8n workflow JSON's jsCode properties.
 * Maps each JS file to the correct workflow node by name.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'n8n UGC latest (4).json');
const CODE_DIR = path.join(__dirname, '..', '21draw-ugc-pipeline', 'code-nodes');

// Mapping: workflow node name -> JS file path
const NODE_FILE_MAP = {
  'Merge': path.join(CODE_DIR, 'phase1', 'claude-analysis.js'),
  'Pre-Filter Known Profiles': path.join(CODE_DIR, 'phase1', 'pre-filter-known-profiles.js'),
  'Save to Seen Profiles': path.join(CODE_DIR, 'phase1', 'save-to-seen-profiles.js'),
  'Handle Skipped Profile': path.join(CODE_DIR, 'phase2', 'handle-skipped-profile.js'),
  'Parse Gemini Response': path.join(CODE_DIR, 'phase2', 'parse-gemini-response.js'),
  'Code in JavaScript': path.join(CODE_DIR, 'phase2', 'build-gemini-request.js'),
};

// Read workflow
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));

let updatedCount = 0;

for (const node of workflow.nodes) {
  const jsFilePath = NODE_FILE_MAP[node.name];
  if (!jsFilePath) continue;

  if (!node.parameters || typeof node.parameters.jsCode === 'undefined') {
    console.log(`WARNING: Node "${node.name}" has no jsCode parameter, skipping.`);
    continue;
  }

  if (!fs.existsSync(jsFilePath)) {
    console.log(`WARNING: File not found: ${jsFilePath}, skipping node "${node.name}".`);
    continue;
  }

  const newCode = fs.readFileSync(jsFilePath, 'utf-8');
  const oldCode = node.parameters.jsCode;

  if (oldCode === newCode) {
    console.log(`SKIP (no changes): "${node.name}" <- ${path.basename(jsFilePath)}`);
    continue;
  }

  node.parameters.jsCode = newCode;
  updatedCount++;
  console.log(`UPDATED: "${node.name}" <- ${path.basename(jsFilePath)}`);
}

// Write back
fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(workflow, null, 2), 'utf-8');
console.log(`\nDone! Updated ${updatedCount} node(s) in workflow.`);
