// Re-score existing profiles with the updated Claude prompt (v2)
// Populates course_teacher_score and suggested_type for profiles that don't have them.
// Does NOT overwrite existing profile_score, recommendation, or reasoning.
// Each re-score is logged to ai_logs with prompt_version=2.
//
// Usage:
//   node scripts/rescore-profiles.js            # all pending
//   node scripts/rescore-profiles.js --limit 5  # test with 5
//   node scripts/rescore-profiles.js --dry-run  # preview without changes

const path = require('path');
const https = require('https');
const reviewAppModules = path.join(__dirname, '..', 'review-app', 'node_modules');
require(path.join(reviewAppModules, 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require(path.join(reviewAppModules, '@supabase', 'supabase-js'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-5-20250929';
const PROMPT_VERSION = 2;

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
const dryRun = args.includes('--dry-run');

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
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

function buildRescorePrompt(profile) {
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

async function main() {
  console.log(dryRun ? '=== DRY RUN — no changes will be made ===' : '=== Re-scoring profiles ===');
  console.log(`Model: ${MODEL}, Prompt version: ${PROMPT_VERSION}\n`);

  // Fetch profiles that don't have course_teacher_score yet
  let query = supabase
    .from('profiles')
    .select('*')
    .is('course_teacher_score', null)
    .in('recommendation', ['COLLABORATE', 'REVIEW', 'PASS']); // Skip REJECT

  if (limit) query = query.limit(limit);

  const { data: profiles, error } = await query;
  if (error) {
    console.error('DB error:', error.message);
    return;
  }

  console.log(`Found ${(profiles || []).length} profiles to re-score${limit ? ` (limit: ${limit})` : ''}\n`);

  if (!profiles || profiles.length === 0) {
    console.log('Nothing to re-score. All profiles already have course_teacher_score.');
    return;
  }

  let rescored = 0;
  let errors = 0;

  for (const profile of profiles) {
    try {
      console.log(`[${rescored + errors + 1}/${profiles.length}] ${profile.username} (${profile.followers} followers, current score: ${profile.profile_score})...`);

      if (dryRun) {
        console.log('  [DRY RUN] Would call Claude and update profile');
        rescored++;
        continue;
      }

      const prompt = buildRescorePrompt(profile);
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

      // Only update the NEW fields — preserve original scores
      const update = {
        course_teacher_score: analysis.course_teacher_score || 0,
        suggested_type: analysis.suggested_type || 'UGC_CREATOR'
      };

      const { error: updateError } = await supabase
        .from('profiles')
        .update(update)
        .eq('username', profile.username);

      if (updateError) {
        console.error(`  DB update error: ${updateError.message}`);
        errors++;
        continue;
      }

      // Log to ai_logs
      await supabase.from('ai_logs').insert({
        profile_username: profile.username,
        workflow_name: 'Rescore-Profile',
        model_used: MODEL,
        prompt_sent: `Rescore: ${profile.username} (${profile.followers} followers)`,
        input_data: { username: profile.username, followers: profile.followers, original_score: profile.profile_score },
        output_raw: text,
        output_parsed: analysis,
        tokens_used: tokens,
        prompt_version: PROMPT_VERSION
      });

      rescored++;
      console.log(`  course_teacher_score: ${analysis.course_teacher_score}, suggested_type: ${analysis.suggested_type}, tokens: ${tokens}`);

      // Rate limit: 1 second between calls
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.error(`  Error: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone! Re-scored: ${rescored}, Errors: ${errors}`);

  // Summary of suggested types
  if (!dryRun) {
    const { data: summary } = await supabase
      .from('profiles')
      .select('suggested_type')
      .not('suggested_type', 'is', null);

    const types = { UGC_CREATOR: 0, COURSE_TEACHER: 0, BOTH: 0 };
    (summary || []).forEach(p => {
      const t = p.suggested_type || 'UGC_CREATOR';
      if (types[t] !== undefined) types[t]++;
    });
    console.log(`\nSuggested types across all profiles: ${JSON.stringify(types)}`);
  }
}

main().catch(console.error);
