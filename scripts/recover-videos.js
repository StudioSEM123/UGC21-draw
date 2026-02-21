#!/usr/bin/env node
// Recovery Script: Re-scrape profiles via Apify → Download videos → Store in Supabase Storage
// For existing profiles that have expired CDN URLs but no stored videos.
//
// Usage: node scripts/recover-videos.js
// Requires: .env with APIFY_API_TOKEN, SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// What it does:
// 1. Queries Supabase for profiles where videos_downloaded = false
// 2. Runs Apify profile scraper to get fresh CDN URLs
// 3. Matches reels by shortcode from reel_X_post_url
// 4. Downloads videos and uploads to Supabase Storage
// 5. Updates profiles with storage paths

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const PROGRESS_FILE = path.join(DATA_DIR, 'video-recovery-progress.json');
const BUCKET = 'reel-videos';
const PROFILE_SCRAPER_ACTOR = 'dSCLg0C3YEZ83HzYX';
const BATCH_SIZE = 5; // Profiles per Apify run
const APIFY_POLL_INTERVAL = 5000; // 5 seconds

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const config = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    config[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return config;
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { started_at: new Date().toISOString(), recovered: [], errors: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, options = {}, maxRetries = 3, baseDelay = 2000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`    Rate limited, waiting ${(delay / 1000).toFixed(0)}s...`);
        await sleep(delay);
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`    Server error ${res.status}, retry in ${(delay / 1000).toFixed(0)}s...`);
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`    Network error, retry in ${(delay / 1000).toFixed(0)}s...`);
        await sleep(delay);
      } else throw err;
    }
  }
}

function extractShortcode(postUrl) {
  if (!postUrl) return null;
  const match = postUrl.match(/\/(p|reel)\/([^/?]+)/);
  return match ? match[2] : null;
}

// ── Step 1: Get profiles needing recovery ───────────────────────────────────
async function getProfilesNeedingRecovery(config, progress) {
  console.log('\n[1/4] Fetching profiles that need video recovery...');

  const res = await fetch(
    `${config.SUPABASE_URL}/rest/v1/profiles?or=(videos_downloaded.is.null,videos_downloaded.eq.false)&reel_1_url=not.is.null&reel_1_url=not.eq.&select=username,reel_1_url,reel_1_post_url,reel_2_url,reel_2_post_url,reel_3_url,reel_3_post_url&order=username`,
    {
      headers: {
        'apikey': config.SUPABASE_KEY,
        'Authorization': `Bearer ${config.SUPABASE_KEY}`
      }
    }
  );
  const profiles = await res.json();

  // Filter out already recovered
  const recoveredSet = new Set(progress.recovered);
  const todo = profiles.filter(p => !recoveredSet.has(p.username));

  console.log(`  Total needing recovery: ${profiles.length}`);
  console.log(`  Already recovered: ${progress.recovered.length}`);
  console.log(`  Remaining: ${todo.length}`);

  return todo;
}

// ── Step 2: Re-scrape profile to get fresh CDN URLs ─────────────────────────
async function scrapeProfileBatch(usernames, config) {
  console.log(`  Scraping batch: ${usernames.join(', ')}...`);

  // Start Apify run
  const startRes = await fetchWithRetry(
    `https://api.apify.com/v2/acts/${PROFILE_SCRAPER_ACTOR}/runs?token=${config.APIFY_API_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames,
        resultsType: 'details',
        resultsLimit: usernames.length
      })
    }
  );
  const startData = await startRes.json();
  const runId = startData.data?.id;

  if (!runId) {
    console.error('    Failed to start Apify run');
    return [];
  }

  // Poll for completion
  console.log(`    Apify run ${runId} started, waiting...`);
  while (true) {
    await sleep(APIFY_POLL_INTERVAL);
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${config.APIFY_API_TOKEN}`
    );
    const statusData = await statusRes.json();
    const status = statusData.data?.status;

    if (status === 'SUCCEEDED') break;
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      console.error(`    Apify run ${status}`);
      return [];
    }
    process.stdout.write('.');
  }
  console.log('');

  // Download results
  const datasetId = startData.data?.defaultDatasetId;
  const itemsRes = await fetchWithRetry(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${config.APIFY_API_TOKEN}`
  );
  return await itemsRes.json();
}

// ── Step 3: Download video and upload to Supabase Storage ───────────────────
async function downloadAndStoreVideo(videoUrl, username, reelNumber, config) {
  if (!videoUrl) return null;

  try {
    // Download from Instagram CDN
    const downloadRes = await fetchWithRetry(videoUrl);
    if (!downloadRes.ok) {
      throw new Error(`Download failed: ${downloadRes.status}`);
    }

    const videoBuffer = await downloadRes.arrayBuffer();
    const storagePath = `${username}/reel_${reelNumber}.mp4`;

    // Upload to Supabase Storage
    const uploadRes = await fetch(
      `${config.SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'video/mp4',
          'x-upsert': 'true'
        },
        body: videoBuffer
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Upload failed: ${uploadRes.status} ${errText}`);
    }

    return storagePath;
  } catch (err) {
    console.log(`      Reel ${reelNumber} error: ${err.message}`);
    return null;
  }
}

// ── Step 4: Process one profile ─────────────────────────────────────────────
async function processProfile(profile, scrapedData, config) {
  const username = profile.username;

  // Find this profile in scraped data
  const freshProfile = scrapedData.find(p => p.username === username);
  if (!freshProfile) {
    console.log(`    ${username}: not found in Apify results, skipping`);
    return false;
  }

  const posts = freshProfile.latestPosts || [];
  if (posts.length === 0) {
    console.log(`    ${username}: no posts returned`);
    return false;
  }

  // Match reels by shortcode from post URLs
  const targetShortcodes = [
    extractShortcode(profile.reel_1_post_url),
    extractShortcode(profile.reel_2_post_url),
    extractShortcode(profile.reel_3_post_url)
  ];

  const freshUrls = [null, null, null];
  for (const post of posts) {
    const postShortcode = post.shortCode;
    for (let i = 0; i < 3; i++) {
      if (targetShortcodes[i] && postShortcode === targetShortcodes[i] && post.videoUrl) {
        freshUrls[i] = post.videoUrl;
      }
    }
  }

  // If no shortcode matches, try using the fresh top 3 reels by engagement
  const matchCount = freshUrls.filter(Boolean).length;
  if (matchCount === 0) {
    console.log(`    ${username}: no shortcode matches, using top reels by engagement`);
    const reels = posts.filter(p =>
      (p.productType === 'clips' || p.type === 'Video') && p.videoUrl
    );
    reels.sort((a, b) => {
      const engA = (Number(a.likesCount) || 0) + (Number(a.commentsCount) || 0);
      const engB = (Number(b.likesCount) || 0) + (Number(b.commentsCount) || 0);
      return engB - engA;
    });
    for (let i = 0; i < Math.min(3, reels.length); i++) {
      freshUrls[i] = reels[i].videoUrl;
    }
  }

  // Download and store each reel
  const paths = [];
  for (let i = 0; i < 3; i++) {
    const p = await downloadAndStoreVideo(freshUrls[i], username, i + 1, config);
    paths.push(p);
  }

  const downloadedCount = paths.filter(Boolean).length;
  if (downloadedCount === 0) {
    console.log(`    ${username}: no videos downloaded`);
    return false;
  }

  // Update Supabase with storage paths and fresh CDN URLs
  const updateData = {
    reel_1_storage_path: paths[0],
    reel_2_storage_path: paths[1],
    reel_3_storage_path: paths[2],
    videos_downloaded: true
  };

  // Also update CDN URLs if we got fresh ones
  if (freshUrls[0]) updateData.reel_1_url = freshUrls[0];
  if (freshUrls[1]) updateData.reel_2_url = freshUrls[1];
  if (freshUrls[2]) updateData.reel_3_url = freshUrls[2];

  await fetch(
    `${config.SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': config.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updateData)
    }
  );

  console.log(`    ${username}: ${downloadedCount}/3 videos stored`);
  return true;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== UGC Finder Video Recovery Script ===');
  console.log(`Started: ${new Date().toISOString()}`);
  const startTime = Date.now();

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const config = loadEnv();
  const progress = loadProgress();

  // Step 1: Get profiles needing recovery
  const profiles = await getProfilesNeedingRecovery(config, progress);
  if (profiles.length === 0) {
    console.log('\nAll profiles already have stored videos!');
    return;
  }

  // Step 2-4: Process in batches
  let recovered = 0, failed = 0;
  const batches = [];
  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    batches.push(profiles.slice(i, i + BATCH_SIZE));
  }

  console.log(`\n[2/4] Processing ${batches.length} batches of ${BATCH_SIZE}...`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const usernames = batch.map(p => p.username);
    console.log(`\n  Batch ${b + 1}/${batches.length}:`);

    // Scrape fresh data for this batch
    const scrapedData = await scrapeProfileBatch(usernames, config);

    // Process each profile in the batch
    for (const profile of batch) {
      const success = await processProfile(profile, scrapedData, config);
      if (success) {
        recovered++;
        progress.recovered.push(profile.username);
      } else {
        failed++;
        progress.errors.push(profile.username);
      }
      saveProgress(progress);
    }

    // Delay between batches to be nice to APIs
    if (b < batches.length - 1) {
      console.log('  Waiting 3s between batches...');
      await sleep(3000);
    }
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n[4/4] Summary');
  console.log('─'.repeat(40));
  console.log(`  Recovered: ${recovered}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Duration:  ${duration} minutes`);
  console.log(`\n  Progress saved to: ${PROGRESS_FILE}`);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err);
  process.exit(1);
});
