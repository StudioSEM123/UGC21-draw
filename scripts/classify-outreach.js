// Classify approved profiles for outreach using Claude
// Assigns priority tier, extracts contact info, generates personalized messages
// Type-aware: generates different messages for UGC_CREATOR, COURSE_TEACHER, and BOTH
// Logs every Claude call to ai_logs table

const path = require('path');
const reviewAppModules = path.join(__dirname, '..', 'review-app', 'node_modules');
require(path.join(reviewAppModules, 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require(path.join(reviewAppModules, '@supabase', 'supabase-js'));

const { classifyProfile } = require('./lib/classify');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function main() {
  // Get approved profiles not yet in outreach table
  const { data: existingOutreach } = await supabase
    .from('outreach')
    .select('profile_username');
  const existingSet = new Set((existingOutreach || []).map(o => o.profile_username));

  const { data: reviews } = await supabase
    .from('human_reviews')
    .select('profile_username')
    .eq('decision', 'APPROVED');
  const approvedUsernames = (reviews || []).map(r => r.profile_username);

  // Filter out already-classified
  const toClassify = approvedUsernames.filter(u => !existingSet.has(u));
  console.log(`Approved: ${approvedUsernames.length}, Already classified: ${existingSet.size}, To classify: ${toClassify.length}`);

  if (toClassify.length === 0) {
    console.log('Nothing to classify. Done!');
    return;
  }

  // Fetch full profile data (including new type fields)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('username, followers, engagement_rate, bio, profile_score, course_teacher_score, recommendation, reasoning, overall_ugc_score, speaks_english, talks_in_videos, voice_potential, teaching_potential, brand_fit, production_quality, video_recommendation, profile_type, suggested_type, reel_1_caption, reel_2_caption, reel_3_caption, reel_1_likes, reel_2_likes, reel_3_likes')
    .in('username', toClassify);

  console.log(`Fetched ${(profiles || []).length} profiles\n`);

  let classified = 0;
  let errors = 0;

  for (const profile of (profiles || [])) {
    try {
      // Use profile_type if set (human-assigned), otherwise fall back to suggested_type (AI)
      if (!profile.profile_type && profile.suggested_type) {
        profile.profile_type = profile.suggested_type;
      }

      console.log(`Classifying ${profile.username} (${profile.profile_type || 'UGC_CREATOR'})...`);

      const result = await classifyProfile(supabase, profile, ANTHROPIC_API_KEY);

      classified++;
      console.log(`  ${result.priority_tier} | ${result.contact_method} | ${result.contact_email || 'no email'}`);
      if (result.teacher_dm_message) {
        console.log(`  + Teacher message generated`);
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.error(`  Error for ${profile.username}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone! Classified: ${classified}, Errors: ${errors}`);

  // Show summary
  const { data: summary } = await supabase
    .from('outreach')
    .select('priority_tier, contact_method, status, profile_type');

  const tiers = { TIER_1: 0, TIER_2: 0, TIER_3: 0 };
  const methods = { EMAIL: 0, DM: 0, BOTH: 0 };
  const types = { UGC_CREATOR: 0, COURSE_TEACHER: 0, BOTH: 0 };
  (summary || []).forEach(o => {
    if (tiers[o.priority_tier] !== undefined) tiers[o.priority_tier]++;
    if (methods[o.contact_method] !== undefined) methods[o.contact_method]++;
    const t = o.profile_type || 'UGC_CREATOR';
    if (types[t] !== undefined) types[t]++;
  });

  console.log(`\nOutreach summary:`);
  console.log(`  Tiers: ${JSON.stringify(tiers)}`);
  console.log(`  Methods: ${JSON.stringify(methods)}`);
  console.log(`  Types: ${JSON.stringify(types)}`);
}

main().catch(console.error);
