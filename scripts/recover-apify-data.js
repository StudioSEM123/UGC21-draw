#!/usr/bin/env node
// Recovery Script: Fetch existing Apify data → Claude analysis → Supabase insert
// SAFE: Only READ from Apify (GET requests). Never triggers new scrapes.

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');

const MIN_FOLLOWERS = 2000;
const MAX_FOLLOWERS = 150000;
const CLAUDE_CONCURRENCY = 3;
const CLAUDE_MAX_RETRIES = 3;
const CLAUDE_BASE_DELAY = 5000;
const CLAUDE_LAUNCH_DELAY = 500;
const APIFY_REQUEST_DELAY = 200;

// Target date for Apify run discovery (change if running on a different day)
const TARGET_DATE = process.env.RECOVERY_DATE || '2026-02-10';

const TAGGED_POSTS_ACTOR = 'apify~instagram-scraper';
const PROFILE_SCRAPER_ACTOR = 'dSCLg0C3YEZ83HzYX';

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
  return {
    started_at: new Date().toISOString(),
    tagged_posts_downloaded: false,
    profiles_downloaded: false,
    source_map_built: false,
    filtering_complete: false,
    analyzed_usernames: [],
    inserted_usernames: [],
    errors: []
  };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function loadJsonFile(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (fs.existsSync(filepath)) {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }
  return null;
}

function saveJsonFile(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, options = {}, maxRetries = 3, baseDelay = 2000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : baseDelay * Math.pow(2, attempt);
        console.log(`    Rate limited, waiting ${(delay / 1000).toFixed(0)}s...`);
        await sleep(delay);
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`    Server error ${res.status}, retry ${attempt + 1}/${maxRetries} in ${(delay / 1000).toFixed(0)}s...`);
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`    Network error, retry ${attempt + 1}/${maxRetries} in ${(delay / 1000).toFixed(0)}s...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

// ── Step 1: Discover Apify Runs ─────────────────────────────────────────────
async function discoverApifyRuns(config) {
  console.log('\n[1/7] Discovering Apify runs from today...');
  const token = config.APIFY_API_TOKEN;
  const today = TARGET_DATE;

  // Fetch tagged-posts actor runs
  const taggedRes = await fetchWithRetry(
    `https://api.apify.com/v2/acts/${TAGGED_POSTS_ACTOR}/runs?token=${token}&desc=true&limit=100`
  );
  const taggedData = await taggedRes.json();
  const taggedRuns = (taggedData.data?.items || []).filter(
    r => r.status === 'SUCCEEDED' && r.startedAt?.startsWith(today)
  );
  console.log(`  Tagged Posts actor: ${taggedRuns.length} runs found today`);

  // Fetch profile-scraper actor runs (may need pagination)
  let profileRuns = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const profileRes = await fetchWithRetry(
      `https://api.apify.com/v2/acts/${PROFILE_SCRAPER_ACTOR}/runs?token=${token}&desc=true&limit=${limit}&offset=${offset}`
    );
    const profileData = await profileRes.json();
    const items = profileData.data?.items || [];
    const todayItems = items.filter(
      r => r.status === 'SUCCEEDED' && r.startedAt?.startsWith(today)
    );
    profileRuns.push(...todayItems);

    // If we got fewer items than limit, or none of the last batch are from today, stop
    if (items.length < limit || todayItems.length === 0) break;
    offset += limit;
  }
  console.log(`  Profile Scraper actor: ${profileRuns.length} runs found today`);

  if (taggedRuns.length === 0 && profileRuns.length === 0) {
    console.error('\n  ERROR: No Apify runs found for today. Check the date or API token.');
    process.exit(1);
  }

  return { taggedRuns, profileRuns };
}

// ── Step 2: Download Tagged Posts & Build Source Map ─────────────────────────
async function downloadTaggedPostsAndBuildSourceMap(taggedRuns, config, progress) {
  console.log('\n[2/7] Downloading tagged posts & building source map...');
  const token = config.APIFY_API_TOKEN;

  // Check resume
  let allPosts = loadJsonFile('raw-tagged-posts.json');
  let sourceMap = loadJsonFile('source-map.json');
  if (allPosts && sourceMap && progress.source_map_built) {
    console.log(`  Resuming: ${allPosts.length} tagged posts already downloaded`);
    return { allPosts, sourceMap };
  }

  allPosts = [];
  sourceMap = {};

  for (const run of taggedRuns) {
    // Get run details to find the competitor name from input.directUrls
    const runDetailRes = await fetchWithRetry(
      `https://api.apify.com/v2/actor-runs/${run.id}?token=${token}`
    );
    const runDetail = await runDetailRes.json();
    const directUrl = runDetail.data?.input?.directUrls?.[0] || '';
    const match = directUrl.match(/instagram\.com\/([^/]+)\/tagged/);
    const competitor = match ? match[1] : 'unknown';

    // Download dataset items
    const itemsRes = await fetchWithRetry(
      `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${token}`
    );
    const items = await itemsRes.json();
    console.log(`  ${competitor}: ${items.length} posts`);

    allPosts.push(...items);

    // Build source map: username → { source, sourceType }
    for (const post of items) {
      const username = post.ownerUsername;
      if (username && !sourceMap[username]) {
        sourceMap[username] = { source: competitor, sourceType: 'tagged' };
      }
    }

    await sleep(APIFY_REQUEST_DELAY);
  }

  saveJsonFile('raw-tagged-posts.json', allPosts);
  saveJsonFile('source-map.json', sourceMap);
  progress.tagged_posts_downloaded = true;
  progress.source_map_built = true;
  saveProgress(progress);

  console.log(`  Total: ${allPosts.length} posts, ${Object.keys(sourceMap).length} unique usernames mapped`);
  return { allPosts, sourceMap };
}

// ── Step 3: Download Profile Data ───────────────────────────────────────────
async function downloadProfiles(profileRuns, config, progress) {
  console.log('\n[3/7] Downloading profile data...');
  const token = config.APIFY_API_TOKEN;

  // Check resume
  let existing = loadJsonFile('raw-profiles.json');
  if (existing && progress.profiles_downloaded) {
    console.log(`  Resuming: ${existing.length} profiles already downloaded`);
    return existing;
  }

  const profiles = [];
  const total = profileRuns.length;
  console.log(`  Downloading ${total} datasets...`);

  for (let i = 0; i < profileRuns.length; i++) {
    const run = profileRuns[i];
    try {
      const itemsRes = await fetchWithRetry(
        `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${token}`
      );
      const items = await itemsRes.json();
      if (Array.isArray(items)) {
        profiles.push(...items);
      }
    } catch (err) {
      console.log(`    Warning: Failed to download dataset for run ${run.id}: ${err.message}`);
    }

    if ((i + 1) % 50 === 0 || i === total - 1) {
      console.log(`  [${i + 1}/${total}] ${profiles.length} profiles collected`);
    }
    await sleep(APIFY_REQUEST_DELAY);
  }

  saveJsonFile('raw-profiles.json', profiles);
  progress.profiles_downloaded = true;
  saveProgress(progress);

  console.log(`  Total profiles downloaded: ${profiles.length}`);
  return profiles;
}

// ── Step 4: Filter & Enrich Profiles ────────────────────────────────────────
function filterAndEnrichProfiles(rawProfiles, sourceMap, progress) {
  console.log('\n[4/7] Filtering profiles (reels + engagement)...');

  // Check resume
  let existing = loadJsonFile('filtered-profiles.json');
  if (existing && progress.filtering_complete) {
    console.log(`  Resuming: ${existing.length} filtered profiles already exist`);
    return existing;
  }

  const stats = { private_or_empty: 0, outside_range: 0, no_posts: 0, no_reels: 0 };
  const filtered = [];

  for (const profile of rawProfiles) {
    const followers = Number(profile.followersCount) || 0;

    if (!profile.followersCount || followers === 0) {
      stats.private_or_empty++;
      continue;
    }
    if (followers < MIN_FOLLOWERS || followers > MAX_FOLLOWERS) {
      stats.outside_range++;
      continue;
    }

    const posts = profile.latestPosts || [];
    if (posts.length === 0) {
      stats.no_posts++;
      continue;
    }

    // Filter for qualifying reels (exact logic from filter-reels.js)
    let reels = posts.filter(post => {
      const isClip = post.productType === 'clips';
      const isVideo = post.type === 'Video' && post.productType !== 'igtv';
      if (post.videoDuration) {
        const dur = Number(post.videoDuration);
        if (dur < 15 || dur > 90) return false;
      }
      return isClip || isVideo;
    });

    // Fallback to all video content
    if (reels.length === 0) {
      reels = posts.filter(post =>
        post.type === 'Video' || post.productType === 'clips' || post.productType === 'igtv'
      );
    }

    if (reels.length === 0) {
      stats.no_reels++;
      continue;
    }

    // Sort by engagement
    reels.sort((a, b) => {
      const engA = (Number(a.likesCount) || 0) + (Number(a.commentsCount) || 0);
      const engB = (Number(b.likesCount) || 0) + (Number(b.commentsCount) || 0);
      return engB - engA;
    });

    const topReels = reels.slice(0, 3);

    // Calculate metrics
    let engagement_rate = 0, avg_likes = 0, avg_comments = 0, avg_duration = 0;
    const totalLikes = reels.reduce((s, r) => s + (Number(r.likesCount) || 0), 0);
    const totalComments = reels.reduce((s, r) => s + (Number(r.commentsCount) || 0), 0);
    const totalDuration = reels.reduce((s, r) => s + (Number(r.videoDuration) || 0), 0);
    avg_likes = Math.round(totalLikes / reels.length);
    avg_comments = Math.round(totalComments / reels.length);
    const reelsWithDur = reels.filter(r => r.videoDuration);
    avg_duration = reelsWithDur.length > 0 ? Math.round(totalDuration / reelsWithDur.length) : 0;
    const avgEngagement = (totalLikes + totalComments) / reels.length;
    engagement_rate = Number(((avgEngagement / followers) * 100).toFixed(2));

    // Source mapping
    const source = sourceMap[profile.username] || { source: 'unknown', sourceType: 'tagged' };

    // Helper functions
    const getVideoUrl = (post) => post.videoUrl || '';
    const getPostUrl = (post) => {
      if (post.url) return post.url;
      if (post.shortCode) return `https://www.instagram.com/reel/${post.shortCode}/`;
      return '';
    };

    filtered.push({
      username: profile.username,
      followers,
      bio: (profile.biography || '').substring(0, 500),
      source: source.source,
      source_type: source.sourceType,
      has_art_content: true,
      verified: profile.verified || false,
      business_category: profile.businessCategoryName || '',
      engagement_rate,
      avg_likes,
      avg_comments,
      avg_duration,
      total_reels_found: reels.length,
      reel_1_url: topReels[0] ? getVideoUrl(topReels[0]) : '',
      reel_1_post_url: topReels[0] ? getPostUrl(topReels[0]) : '',
      reel_1_likes: topReels[0] ? (Number(topReels[0].likesCount) || 0) : 0,
      reel_1_comments: topReels[0] ? (Number(topReels[0].commentsCount) || 0) : 0,
      reel_1_duration: topReels[0] ? (Number(topReels[0].videoDuration) || 0) : 0,
      reel_1_caption: topReels[0] ? (topReels[0].caption || '').substring(0, 300) : '',
      reel_2_url: topReels[1] ? getVideoUrl(topReels[1]) : '',
      reel_2_post_url: topReels[1] ? getPostUrl(topReels[1]) : '',
      reel_2_likes: topReels[1] ? (Number(topReels[1].likesCount) || 0) : 0,
      reel_2_comments: topReels[1] ? (Number(topReels[1].commentsCount) || 0) : 0,
      reel_2_duration: topReels[1] ? (Number(topReels[1].videoDuration) || 0) : 0,
      reel_2_caption: topReels[1] ? (topReels[1].caption || '').substring(0, 300) : '',
      reel_3_url: topReels[2] ? getVideoUrl(topReels[2]) : '',
      reel_3_post_url: topReels[2] ? getPostUrl(topReels[2]) : '',
      reel_3_likes: topReels[2] ? (Number(topReels[2].likesCount) || 0) : 0,
      reel_3_comments: topReels[2] ? (Number(topReels[2].commentsCount) || 0) : 0,
      reel_3_duration: topReels[2] ? (Number(topReels[2].videoDuration) || 0) : 0,
      reel_3_caption: topReels[2] ? (topReels[2].caption || '').substring(0, 300) : '',
      analyzed_at: new Date().toISOString()
    });
  }

  saveJsonFile('filtered-profiles.json', filtered);
  progress.filtering_complete = true;
  saveProgress(progress);

  console.log(`  Skipped: ${stats.private_or_empty} private/empty, ${stats.outside_range} outside follower range, ${stats.no_posts} no posts, ${stats.no_reels} no reels`);
  console.log(`  Qualified: ${filtered.length} profiles with reels data`);
  return filtered;
}

// ── Step 5: Claude Analysis ─────────────────────────────────────────────────
function buildClaudePrompt(p) {
  const bio = (p.bio || '').replace(/[\n\r]/g, ' ');
  const cap1 = (p.reel_1_caption || '').replace(/[\n\r]/g, ' ');
  const cap2 = (p.reel_2_caption || '').replace(/[\n\r]/g, ' ');
  const cap3 = (p.reel_3_caption || '').replace(/[\n\r]/g, ' ');

  return `Evaluate this Instagram creator for potential UGC partnership with 21Draw, an online art education platform.

PROFILE DATA:
Username: ${p.username}
Followers: ${p.followers}
Engagement Rate: ${p.engagement_rate || 0}%
Avg Likes: ${p.avg_likes || 0}
Avg Comments: ${p.avg_comments || 0}
Bio: ${bio}
Verified: ${p.verified}
Business Category: ${p.business_category || 'none'}
Total Reels Found: ${p.total_reels_found || 0}

TOP REELS:
Reel 1: ${p.reel_1_url || 'none'}
- Likes: ${p.reel_1_likes || 0} | Comments: ${p.reel_1_comments || 0}
- Caption: ${cap1}

Reel 2: ${p.reel_2_url || 'none'}
- Likes: ${p.reel_2_likes || 0} | Comments: ${p.reel_2_comments || 0}
- Caption: ${cap2}

Reel 3: ${p.reel_3_url || 'none'}
- Likes: ${p.reel_3_likes || 0} | Comments: ${p.reel_3_comments || 0}
- Caption: ${cap3}

EVALUATION CRITERIA:
- Niche relevance to art education (drawing, painting, sculpting, digital art, art tutorials)
- Engagement quality (likes, comments relative to followers)
- Content style fit for educational art platform
- Follower count (accounts with 5k+ followers in art niche are valuable)
- Even accounts with lower engagement rates should be COLLABORATE if they have strong art content and decent following

Recommendation options:
- COLLABORATE: Strong fit, good metrics, art-relevant content
- REVIEW: Promising but needs manual review
- PASS: Not a good fit for 21Draw
- REJECT: Clearly unsuitable (spam, no art content, very low following)

Respond with JSON only, no other text:
{"niche_relevance": 1-10, "profile_score": 1-10, "recommendation": "COLLABORATE/REVIEW/PASS/REJECT", "reasoning": "your explanation here"}`;
}

function parseClaudeResponse(data) {
  try {
    let text = data.content?.[0]?.text || '{}';
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(text);
  } catch (e) {
    return {
      recommendation: 'REVIEW',
      reasoning: 'Could not parse AI analysis',
      profile_score: 5,
      niche_relevance: 5
    };
  }
}

function mergeProfileWithAnalysis(profile, analysis) {
  return {
    username: profile.username,
    followers: profile.followers || 0,
    bio: profile.bio || '',
    source: profile.source || '',
    source_type: profile.source_type || '',
    has_art_content: profile.has_art_content || false,
    verified: profile.verified || false,
    niche_relevance: analysis.niche_relevance || 5,
    profile_score: analysis.profile_score || 5,
    recommendation: analysis.recommendation || 'REVIEW',
    reasoning: analysis.reasoning || '',
    status: 'PENDING_REVIEW',
    analyzed_at: new Date().toISOString(),
    engagement_rate: profile.engagement_rate || 0,
    avg_likes: profile.avg_likes || 0,
    avg_comments: profile.avg_comments || 0,
    avg_duration: profile.avg_duration || 0,
    total_reels_found: profile.total_reels_found || 0,
    reel_1_url: profile.reel_1_url || '',
    reel_1_post_url: profile.reel_1_post_url || '',
    reel_1_likes: profile.reel_1_likes || 0,
    reel_1_comments: profile.reel_1_comments || 0,
    reel_1_duration: profile.reel_1_duration || 0,
    reel_1_caption: profile.reel_1_caption || '',
    reel_2_url: profile.reel_2_url || '',
    reel_2_post_url: profile.reel_2_post_url || '',
    reel_2_likes: profile.reel_2_likes || 0,
    reel_2_comments: profile.reel_2_comments || 0,
    reel_2_duration: profile.reel_2_duration || 0,
    reel_2_caption: profile.reel_2_caption || '',
    reel_3_url: profile.reel_3_url || '',
    reel_3_post_url: profile.reel_3_post_url || '',
    reel_3_likes: profile.reel_3_likes || 0,
    reel_3_comments: profile.reel_3_comments || 0,
    reel_3_duration: profile.reel_3_duration || 0,
    reel_3_caption: profile.reel_3_caption || ''
  };
}

// Separate store for ai_log data (keyed by username) — not persisted to JSON
const aiLogStore = new Map();

async function analyzeOneProfile(profile, config) {
  const promptText = buildClaudePrompt(profile);

  for (let attempt = 0; attempt <= CLAUDE_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{ role: 'user', content: promptText }]
        })
      });

      if (res.status === 429 || res.status === 529) {
        const retryAfter = res.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : CLAUDE_BASE_DELAY * Math.pow(2, attempt);
        console.log(`    Rate limited on ${profile.username}, waiting ${(delay / 1000).toFixed(0)}s...`);
        await sleep(delay);
        continue;
      }

      if (res.status >= 500) {
        if (attempt < CLAUDE_MAX_RETRIES) {
          const delay = CLAUDE_BASE_DELAY * Math.pow(2, attempt);
          console.log(`    Server error ${res.status} on ${profile.username}, retry ${attempt + 1}/${CLAUDE_MAX_RETRIES} in ${(delay / 1000).toFixed(0)}s...`);
          await sleep(delay);
          continue;
        }
        console.error(`    FAILED after retries: ${profile.username} (${res.status})`);
        return null;
      }

      if (res.status < 200 || res.status >= 300) {
        console.error(`    Fatal error ${res.status} on ${profile.username}`);
        return null;
      }

      const data = await res.json();
      const analysis = parseClaudeResponse(data);
      const merged = mergeProfileWithAnalysis(profile, analysis);
      const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

      return { merged, promptText, rawText: data.content?.[0]?.text || '', analysis, tokens, profile };

    } catch (err) {
      if (attempt < CLAUDE_MAX_RETRIES) {
        const delay = CLAUDE_BASE_DELAY * Math.pow(2, attempt);
        console.log(`    Network error on ${profile.username}, retry ${attempt + 1}/${CLAUDE_MAX_RETRIES}...`);
        await sleep(delay);
      } else {
        console.error(`    FAILED: ${profile.username} - ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

async function runClaudeAnalysis(filteredProfiles, progress, config) {
  console.log('\n[5/7] Running Claude analysis...');

  const alreadyDone = new Set(progress.analyzed_usernames);
  const todo = filteredProfiles.filter(p => !alreadyDone.has(p.username));
  const total = filteredProfiles.length;
  console.log(`  ${todo.length} to analyze (${total - todo.length} already done)`);

  if (todo.length === 0) {
    return loadJsonFile('analyzed-profiles.json') || [];
  }

  // Load existing analyzed results
  let analyzedResults = loadJsonFile('analyzed-profiles.json') || [];

  // Simple sequential processing with concurrency via Promise pool
  let running = 0;
  let queue = [...todo];
  let resolveSlot = null;

  function waitForSlot() {
    if (running < CLAUDE_CONCURRENCY) return Promise.resolve();
    return new Promise(resolve => { resolveSlot = resolve; });
  }

  function releaseSlot() {
    running--;
    if (resolveSlot) {
      const r = resolveSlot;
      resolveSlot = null;
      r();
    }
  }

  const allWork = [];

  for (const profile of todo) {
    await waitForSlot();
    running++;

    const work = analyzeOneProfile(profile, config).then(result => {
      if (result) {
        analyzedResults.push(result.merged);
        progress.analyzed_usernames.push(result.merged.username);
        saveJsonFile('analyzed-profiles.json', analyzedResults);
        saveProgress(progress);

        // Store ai_log data in memory for Supabase insert step
        aiLogStore.set(result.merged.username, {
          prompt_sent: result.promptText,
          output_raw: result.rawText,
          output_parsed: result.analysis,
          tokens_used: result.tokens,
          input_data: result.profile
        });

        const done = progress.analyzed_usernames.length;
        console.log(`  [${done}/${total}] ${result.merged.username} - ${result.merged.recommendation} (score: ${result.merged.profile_score})`);
      }
      releaseSlot();
    });

    allWork.push(work);
    await sleep(CLAUDE_LAUNCH_DELAY);
  }

  await Promise.all(allWork);
  console.log(`  Analysis complete: ${analyzedResults.length} profiles`);
  return analyzedResults;
}

// ── Step 6: Insert into Supabase ────────────────────────────────────────────
async function insertIntoSupabase(analyzedProfiles, progress, config) {
  console.log('\n[6/7] Inserting into Supabase...');

  const todo = analyzedProfiles.filter(p => !progress.inserted_usernames.includes(p.username));
  console.log(`  ${todo.length} to insert (${analyzedProfiles.length - todo.length} already done)`);

  let inserted = 0, skipped = 0, errors = 0;

  for (const profile of todo) {
    try {
      // Check if profile already exists in Supabase
      const checkRes = await fetch(
        `${config.SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(profile.username)}&select=username`,
        {
          headers: {
            'apikey': config.SUPABASE_KEY,
            'Authorization': `Bearer ${config.SUPABASE_KEY}`
          }
        }
      );
      const existing = await checkRes.json();
      if (existing.length > 0) {
        skipped++;
        progress.inserted_usernames.push(profile.username);
        saveProgress(progress);
        continue;
      }

      // Prepare profile row
      const aiLog = aiLogStore.get(profile.username);
      const row = { ...profile };

      // Insert profile
      const insertRes = await fetch(`${config.SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'apikey': config.SUPABASE_KEY,
          'Authorization': `Bearer ${config.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(row)
      });

      if (!insertRes.ok) {
        const errText = await insertRes.text();
        if (insertRes.status === 409) {
          skipped++;
        } else {
          console.error(`    ERROR inserting ${profile.username}: ${insertRes.status} ${errText}`);
          errors++;
          continue;
        }
      } else {
        inserted++;
      }

      // Insert ai_log entry
      if (aiLog) {
        await fetch(`${config.SUPABASE_URL}/rest/v1/ai_logs`, {
          method: 'POST',
          headers: {
            'apikey': config.SUPABASE_KEY,
            'Authorization': `Bearer ${config.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            profile_username: profile.username,
            workflow_name: 'recovery-script',
            model_used: 'claude-sonnet-4-20250514',
            prompt_sent: aiLog.prompt_sent,
            input_data: aiLog.input_data,
            output_raw: aiLog.output_raw,
            output_parsed: aiLog.output_parsed,
            tokens_used: aiLog.tokens_used,
            audit_status: 'PENDING'
          })
        });
      }

      progress.inserted_usernames.push(profile.username);
      saveProgress(progress);

    } catch (err) {
      console.error(`    ERROR on ${profile.username}: ${err.message}`);
      errors++;
    }
  }

  console.log(`  Inserted: ${inserted}, Skipped (existing): ${skipped}, Errors: ${errors}`);
}

// ── Step 7: Summary ─────────────────────────────────────────────────────────
function printSummary(rawProfiles, filteredProfiles, analyzedProfiles, progress) {
  console.log('\n[7/7] Summary');
  console.log('─'.repeat(50));

  const recs = { COLLABORATE: 0, REVIEW: 0, PASS: 0, REJECT: 0 };
  for (const p of analyzedProfiles) {
    const rec = p.recommendation || 'REVIEW';
    recs[rec] = (recs[rec] || 0) + 1;
  }

  console.log(`  Total profiles from Apify:  ${rawProfiles.length}`);
  console.log(`  After filtering:            ${filteredProfiles.length}`);
  console.log(`  Claude analysis complete:    ${analyzedProfiles.length}`);
  console.log(`  Inserted to Supabase:        ${progress.inserted_usernames.length}`);
  console.log('');
  console.log(`  Recommendations:`);
  console.log(`    COLLABORATE: ${recs.COLLABORATE}`);
  console.log(`    REVIEW:      ${recs.REVIEW}`);
  console.log(`    PASS:        ${recs.PASS}`);
  console.log(`    REJECT:      ${recs.REJECT}`);
  console.log('');
  console.log(`  Backup files in: ${DATA_DIR}`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== UGC Finder Recovery Script ===');
  console.log(`Started: ${new Date().toISOString()}`);
  const startTime = Date.now();

  // Setup
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const config = loadEnv();
  const progress = loadProgress();

  // Step 1: Discover runs
  const { taggedRuns, profileRuns } = await discoverApifyRuns(config);

  // Step 2: Download tagged posts + build source map
  const { sourceMap } = await downloadTaggedPostsAndBuildSourceMap(taggedRuns, config, progress);

  // Step 3: Download profiles
  const rawProfiles = await downloadProfiles(profileRuns, config, progress);

  // Step 4: Filter & enrich
  const filteredProfiles = filterAndEnrichProfiles(rawProfiles, sourceMap, progress);

  // Step 5: Claude analysis
  const analyzedProfiles = await runClaudeAnalysis(filteredProfiles, progress, config);

  // Step 6: Insert into Supabase
  await insertIntoSupabase(analyzedProfiles, progress, config);

  // Step 7: Summary
  printSummary(rawProfiles, filteredProfiles, analyzedProfiles, progress);

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n  Done! Duration: ${duration} minutes`);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err);
  process.exit(1);
});
