#!/usr/bin/env node
// Recover skipped high-follower profiles as potential course teacher candidates
// 1. Takes usernames from skipped_profiles (outside_follower_range)
// 2. Scrapes each via Apify Instagram Profile Scraper
// 3. Filters for reels, calculates engagement
// 4. Runs Claude v2 analysis (profile_score + course_teacher_score + suggested_type)
// 5. Saves to Supabase profiles + ai_logs
//
// Usage:
//   node scripts/recover-skipped-profiles.js            # all art-relevant skipped
//   node scripts/recover-skipped-profiles.js --dry-run   # preview without scraping
//   node scripts/recover-skipped-profiles.js --limit 5   # test with 5

const path = require('path');
const https = require('https');
const reviewAppModules = path.join(__dirname, '..', 'review-app', 'node_modules');
require(path.join(reviewAppModules, 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require(path.join(reviewAppModules, '@supabase', 'supabase-js'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PROFILE_SCRAPER_ACTOR = 'dSCLg0C3YEZ83HzYX';
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const PROMPT_VERSION = 2;

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
const dryRun = args.includes('--dry-run');

// Non-art accounts to exclude (brands, film festivals, zoos, podcasts, etc.)
const EXCLUDE_USERNAMES = new Set([
  'wacom', 'spotifypodcasts', 'someonesthunderpodcast', 'theacademy',
  'oregonzoo', 'tribeca', 'americanfilminstitute', 'tiranafilmfestival',
  'bendfilm', 'lilgthemalshi', 'movieswmitch', 'blickartmaterials',
  'jetpens', 'butlerpenandink', 'dhruti_journo', 'yahsupreme',
  'shortstick_films', 'pagewebber', 'ctnhappenings'
]);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Apify: Scrape individual profiles ────────────────────────────────────
async function scrapeProfiles(usernames) {
  console.log(`\nScraping ${usernames.length} profiles via Apify...`);

  const input = {
    directUrls: usernames.map(u => `https://www.instagram.com/${u}/`),
    resultsType: 'details',
    resultsLimit: 1,
    searchType: 'user',
    searchLimit: 1,
    addParentData: false
  };

  // Start actor run
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${PROFILE_SCRAPER_ACTOR}/runs?token=${APIFY_TOKEN}&waitForFinish=300`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  );

  const runData = await startRes.json();
  const run = runData.data;

  if (!run) {
    throw new Error(`Apify failed to start: ${JSON.stringify(runData)}`);
  }

  console.log(`  Apify run started: ${run.id} (status: ${run.status})`);

  // Poll until finished if not already done
  let status = run.status;
  while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED') {
    await sleep(5000);
    const pollRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${run.id}?token=${APIFY_TOKEN}`
    );
    const pollData = await pollRes.json();
    status = pollData.data.status;
    console.log(`  Status: ${status}...`);
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify run ${status}: ${run.id}`);
  }

  // Download results
  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_TOKEN}`
  );
  const profiles = await dataRes.json();
  console.log(`  Downloaded ${profiles.length} profiles from Apify`);

  return profiles;
}

// ── Filter & extract reel data ───────────────────────────────────────────
function extractReelData(profile) {
  const followers = Number(profile.followersCount) || 0;
  const posts = profile.latestPosts || [];

  // Filter for reels (15-90s video clips)
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

  if (reels.length === 0) return null;

  // Sort by engagement
  reels.sort((a, b) => {
    const engA = (Number(a.likesCount) || 0) + (Number(a.commentsCount) || 0);
    const engB = (Number(b.likesCount) || 0) + (Number(b.commentsCount) || 0);
    return engB - engA;
  });

  const topReels = reels.slice(0, 3);

  // Calculate metrics
  const totalLikes = reels.reduce((s, r) => s + (Number(r.likesCount) || 0), 0);
  const totalComments = reels.reduce((s, r) => s + (Number(r.commentsCount) || 0), 0);
  const avg_likes = Math.round(totalLikes / reels.length);
  const avg_comments = Math.round(totalComments / reels.length);
  const avgEngagement = (totalLikes + totalComments) / reels.length;
  const engagement_rate = followers > 0 ? Number(((avgEngagement / followers) * 100).toFixed(2)) : 0;

  const getVideoUrl = (post) => post.videoUrl || '';
  const getPostUrl = (post) => {
    if (post.url) return post.url;
    if (post.shortCode) return `https://www.instagram.com/reel/${post.shortCode}/`;
    return '';
  };

  return {
    username: profile.username,
    followers,
    bio: (profile.biography || '').substring(0, 500),
    source: 'skipped_recovery',
    source_type: 'recovery',
    has_art_content: true,
    verified: profile.verified || false,
    business_category: profile.businessCategoryName || '',
    engagement_rate,
    avg_likes,
    avg_comments,
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
    reel_3_caption: topReels[2] ? (topReels[2].caption || '').substring(0, 300) : ''
  };
}

// ── Claude v2 analysis ───────────────────────────────────────────────────
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = parsed.content?.[0]?.text || '';
          const tokens = (parsed.usage?.input_tokens || 0) + (parsed.usage?.output_tokens || 0);
          resolve({ text, tokens });
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildPrompt(profile) {
  const bio = (profile.bio || '').replace(/[\n\r]/g, ' ');

  return `Evaluate this Instagram creator for 21Draw, an online art education platform with 2M+ students.

PROFILE DATA:
Username: ${profile.username}
Followers: ${profile.followers}
Engagement Rate: ${profile.engagement_rate || 0}%
Avg Likes: ${profile.avg_likes || 0}
Avg Comments: ${profile.avg_comments || 0}
Bio: ${bio}
Verified: ${profile.verified}
Total Reels Found: ${profile.total_reels_found || 0}

TOP REELS:
Reel 1: ${profile.reel_1_url || 'none'}
- Likes: ${profile.reel_1_likes || 0} | Comments: ${profile.reel_1_comments || 0}
- Caption: ${(profile.reel_1_caption || '').replace(/[\n\r]/g, ' ')}

Reel 2: ${profile.reel_2_url || 'none'}
- Likes: ${profile.reel_2_likes || 0} | Comments: ${profile.reel_2_comments || 0}
- Caption: ${(profile.reel_2_caption || '').replace(/[\n\r]/g, ' ')}

Reel 3: ${profile.reel_3_url || 'none'}
- Likes: ${profile.reel_3_likes || 0} | Comments: ${profile.reel_3_comments || 0}
- Caption: ${(profile.reel_3_caption || '').replace(/[\n\r]/g, ' ')}

EVALUATION CRITERIA:

UGC CREATOR FIT:
- Niche relevance to art education (drawing, painting, sculpting, digital art, art tutorials)
- Engagement quality (likes, comments relative to followers)
- Content style fit for educational art platform
- Follower count (accounts with 5k+ followers in art niche are valuable)
- Even accounts with lower engagement rates should score well if they have strong art content and decent following

COURSE TEACHER FIT:
- Could this person teach a full online course on their art specialty?
- Professional industry experience mentioned in bio (studio work, freelance clients, publications)
- Published work (books, comics, games, exhibitions)
- Teaching signals in captions (how to, tutorial, step by step, learn, process)
- YouTube channel, Skillshare, or course platform links in bio
- High production quality in reels
- Art specialties that match 21Draw catalog: character design, concept art, digital illustration, comic art, traditional painting, anatomy, figure drawing
- Higher follower counts (50K+) are typical for course teacher candidates but not required

PROFILE TYPE SUGGESTION:
Based on your scores, suggest which type fits best:
- UGC_CREATOR: Strong UGC fit (profile_score >= 6) but lower teaching fit (course_teacher_score < 6)
- COURSE_TEACHER: Strong teaching fit (course_teacher_score >= 6) but lower UGC fit (profile_score < 6)
- BOTH: Strong fit for both (both scores >= 6)
- If both scores are low, still categorize based on which is higher

Recommendation options:
- COLLABORATE: Strong fit for UGC, teaching, or both
- REVIEW: Promising but needs manual review
- PASS: Not a good fit for 21Draw
- REJECT: Clearly unsuitable (spam, no art content, very low following)

Respond with JSON only, no other text:
{"niche_relevance": 1-10, "profile_score": 1-10, "course_teacher_score": 1-10, "suggested_type": "UGC_CREATOR/COURSE_TEACHER/BOTH", "recommendation": "COLLABORATE/REVIEW/PASS/REJECT", "reasoning": "your explanation covering both UGC and teaching potential"}`;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Recover Skipped High-Follower Profiles ===');
  console.log(dryRun ? '(DRY RUN — no changes)\n' : '');

  // 1. Get skipped usernames not already in profiles
  const { data: skipped } = await supabase
    .from('skipped_profiles')
    .select('username')
    .eq('skip_reason', 'outside_follower_range');

  const { data: existing } = await supabase
    .from('profiles')
    .select('username');

  const existingSet = new Set((existing || []).map(p => p.username));
  const uniqueUsernames = [...new Set((skipped || []).map(s => s.username))]
    .filter(u => !existingSet.has(u) && !EXCLUDE_USERNAMES.has(u));

  let toRecover = limit ? uniqueUsernames.slice(0, limit) : uniqueUsernames;

  console.log(`Skipped (outside_follower_range): ${(skipped || []).length} total entries`);
  console.log(`Unique usernames: ${uniqueUsernames.length + EXCLUDE_USERNAMES.size}`);
  console.log(`Excluded (non-art brands): ${EXCLUDE_USERNAMES.size}`);
  console.log(`Already in profiles: ${existingSet.size} checked`);
  console.log(`To recover: ${toRecover.length}${limit ? ` (limit: ${limit})` : ''}`);
  console.log(`Usernames: ${toRecover.join(', ')}\n`);

  if (toRecover.length === 0) {
    console.log('Nothing to recover!');
    return;
  }

  if (dryRun) {
    console.log('DRY RUN complete. Would scrape and analyze the above usernames.');
    return;
  }

  // 2. Scrape via Apify
  const rawProfiles = await scrapeProfiles(toRecover);

  // 3. Extract reel data
  let processed = 0, noReels = 0, errors = 0;
  const profilesWithReels = [];

  for (const raw of rawProfiles) {
    const extracted = extractReelData(raw);
    if (extracted) {
      profilesWithReels.push(extracted);
    } else {
      noReels++;
      console.log(`  ${raw.username}: no reels found, skipping`);
    }
  }

  console.log(`\nExtracted reel data: ${profilesWithReels.length} profiles (${noReels} had no reels)\n`);

  // 4. Claude analysis + save to Supabase
  for (const profile of profilesWithReels) {
    try {
      console.log(`[${processed + errors + 1}/${profilesWithReels.length}] ${profile.username} (${profile.followers} followers)...`);

      const prompt = buildPrompt(profile);
      const { text, tokens } = await callClaude(prompt);

      let analysis;
      try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        analysis = JSON.parse(cleaned);
      } catch (e) {
        console.error(`  Parse error: ${e.message}`);
        errors++;
        continue;
      }

      // Build profile row
      const row = {
        ...profile,
        niche_relevance: analysis.niche_relevance || 5,
        profile_score: analysis.profile_score || 5,
        course_teacher_score: analysis.course_teacher_score || 0,
        suggested_type: analysis.suggested_type || 'UGC_CREATOR',
        recommendation: analysis.recommendation || 'REVIEW',
        reasoning: analysis.reasoning || '',
        status: 'ANALYZED',
        discovery_mode: 'teacher',
        analyzed_at: new Date().toISOString(),
        prompt_version_claude: PROMPT_VERSION
      };

      // Insert into profiles
      const { error: insertError } = await supabase
        .from('profiles')
        .insert(row);

      if (insertError) {
        console.error(`  DB error: ${insertError.message}`);
        errors++;
        continue;
      }

      // Log to ai_logs
      await supabase.from('ai_logs').insert({
        profile_username: profile.username,
        workflow_name: 'Skipped-Recovery',
        model_used: CLAUDE_MODEL,
        prompt_sent: `Recovery: ${profile.username} (${profile.followers} followers)`,
        input_data: { username: profile.username, followers: profile.followers },
        output_raw: text,
        output_parsed: analysis,
        tokens_used: tokens,
        prompt_version: PROMPT_VERSION
      });

      processed++;
      console.log(`  score: ${analysis.profile_score}, teacher: ${analysis.course_teacher_score}, type: ${analysis.suggested_type}, rec: ${analysis.recommendation}`);

      // Rate limit
      await sleep(1000);

    } catch (err) {
      console.error(`  Error: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone! Recovered: ${processed}, No reels: ${noReels}, Errors: ${errors}`);

  // Summary
  if (processed > 0) {
    const { data: summary } = await supabase
      .from('profiles')
      .select('suggested_type, recommendation')
      .eq('discovery_mode', 'teacher');

    const types = { UGC_CREATOR: 0, COURSE_TEACHER: 0, BOTH: 0 };
    const recs = { COLLABORATE: 0, REVIEW: 0, PASS: 0, REJECT: 0 };
    (summary || []).forEach(p => {
      const t = p.suggested_type || 'UGC_CREATOR';
      if (types[t] !== undefined) types[t]++;
      const r = p.recommendation || 'REVIEW';
      if (recs[r] !== undefined) recs[r]++;
    });
    console.log(`\nRecovered profiles: ${JSON.stringify(types)}`);
    console.log(`Recommendations: ${JSON.stringify(recs)}`);
  }
}

main().catch(console.error);
