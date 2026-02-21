// Classify approved profiles for outreach using Claude
// Assigns priority tier, extracts contact info, generates personalized messages
// Logs every Claude call to ai_logs table

const path = require('path');
const reviewAppModules = path.join(__dirname, '..', 'review-app', 'node_modules');
require(path.join(reviewAppModules, 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require(path.join(reviewAppModules, '@supabase', 'supabase-js'));
const https = require('https');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-5-20250929';
const PROMPT_VERSION = 1;

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
          resolve({ text, tokens, raw: data });
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
  const hasGemini = profile.overall_ugc_score != null;

  let geminiInfo = '';
  if (hasGemini) {
    geminiInfo = `
Gemini Video Analysis:
- Speaks English: ${profile.speaks_english ? 'Yes' : 'No'}
- Talks in Videos: ${profile.talks_in_videos ? 'Yes' : 'No'}
- Voice Potential: ${profile.voice_potential}/10
- Teaching Potential: ${profile.teaching_potential}/10
- Brand Fit: ${profile.brand_fit}/10
- Production Quality: ${profile.production_quality}/10
- Overall UGC Score: ${profile.overall_ugc_score}/10
- Video Recommendation: ${profile.video_recommendation}`;
  }

  return `You are helping with UGC creator outreach for 21Draw, an online art education platform with 2M+ students. Analyze this creator and prepare outreach.

CREATOR PROFILE:
Username: ${profile.username}
Followers: ${profile.followers}
Engagement Rate: ${profile.engagement_rate}%
Bio: ${bio}
Claude Profile Score: ${profile.profile_score}/10
Claude Recommendation: ${profile.recommendation}
Claude Reasoning: ${profile.reasoning || 'N/A'}
${geminiInfo}

TASKS:
1. Extract any email address from the bio (return null if none found)
2. Determine contact method: EMAIL (if email found), DM (if no email), BOTH (if email found and they mention DMs)
3. Assign priority tier:
   - TIER_1: Strong art educator/creator, high scores, ideally speaks English and creates video content. Perfect UGC fit.
   - TIER_2: Good creator but missing something (doesn't talk in videos, lower engagement, or unclear language)
   - TIER_3: Approved but lower potential for video UGC specifically
4. Write a short, natural outreach message for Instagram DM (max 300 chars). Make it sound human, not corporate. Reference something specific from their bio or work. Mention 21Draw briefly and that it's paid work. Don't use emojis excessively.
5. Write a short email (3-4 sentences max). Subject line included. Natural tone, not salesy. Reference their specific work.

Respond with JSON only:
{
  "contact_email": "email@example.com or null",
  "contact_method": "EMAIL/DM/BOTH",
  "priority_tier": "TIER_1/TIER_2/TIER_3",
  "dm_message": "the DM text",
  "email_subject": "subject line",
  "email_body": "the email body"
}`;
}

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

  // Fetch full profile data
  const { data: profiles } = await supabase
    .from('profiles')
    .select('username, followers, engagement_rate, bio, profile_score, recommendation, reasoning, overall_ugc_score, speaks_english, talks_in_videos, voice_potential, teaching_potential, brand_fit, production_quality, video_recommendation')
    .in('username', toClassify);

  console.log(`Fetched ${(profiles || []).length} profiles\n`);

  let classified = 0;
  let errors = 0;

  for (const profile of (profiles || [])) {
    try {
      const prompt = buildPrompt(profile);
      console.log(`Classifying ${profile.username}...`);

      const { text, tokens, raw } = await callClaude(prompt);

      // Parse response
      let result;
      try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        result = JSON.parse(cleaned);
      } catch (e) {
        console.error(`  Parse error for ${profile.username}: ${e.message}`);
        errors++;
        continue;
      }

      // Insert into outreach table
      const { error: insertError } = await supabase
        .from('outreach')
        .insert({
          profile_username: profile.username,
          priority_tier: result.priority_tier || 'TIER_2',
          contact_method: result.contact_method || 'DM',
          contact_email: result.contact_email || null,
          message_sent: result.dm_message || '',
          status: 'QUEUED',
          notes: JSON.stringify({
            email_subject: result.email_subject,
            email_body: result.email_body
          })
        });

      if (insertError) {
        console.error(`  DB error for ${profile.username}: ${insertError.message}`);
        errors++;
        continue;
      }

      // Log to ai_logs
      await supabase.from('ai_logs').insert({
        profile_username: profile.username,
        workflow_name: 'Outreach-Classification',
        model_used: MODEL,
        prompt_sent: prompt.substring(0, 2000),
        input_data: { username: profile.username, followers: profile.followers },
        output_raw: text,
        output_parsed: result,
        tokens_used: tokens,
        prompt_version: PROMPT_VERSION
      });

      classified++;
      console.log(`  ${result.priority_tier} | ${result.contact_method} | ${result.contact_email || 'no email'}`);

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
    .select('priority_tier, contact_method, status');

  const tiers = { TIER_1: 0, TIER_2: 0, TIER_3: 0 };
  const methods = { EMAIL: 0, DM: 0, BOTH: 0 };
  (summary || []).forEach(o => {
    if (tiers[o.priority_tier] !== undefined) tiers[o.priority_tier]++;
    if (methods[o.contact_method] !== undefined) methods[o.contact_method]++;
  });

  console.log(`\nOutreach summary:`);
  console.log(`  Tiers: ${JSON.stringify(tiers)}`);
  console.log(`  Methods: ${JSON.stringify(methods)}`);
}

main().catch(console.error);
