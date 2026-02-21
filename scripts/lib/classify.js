// Shared outreach classification logic
// Used by scripts/classify-outreach.js (batch) and review-app/server.js (re-classify)

const https = require('https');

const MODEL = 'claude-sonnet-4-5-20250929';
const PROMPT_VERSION = 4;

function callClaude(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
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

function getAudienceContext(followers) {
  if (followers < 20000) {
    return `AUDIENCE CONTEXT: Micro-creator (${formatNum(followers)} followers). Keep it casual and short.`;
  } else if (followers < 100000) {
    return `AUDIENCE CONTEXT: Mid-tier creator (${formatNum(followers)} followers). Be specific about the paid opportunity. They get some brand DMs so stand out by being direct.`;
  }
  return `AUDIENCE CONTEXT: Large creator (${formatNum(followers)} followers). Be brief and direct, no fluff. They get tons of brand pitches.`;
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function getLanguageContext(profile) {
  const hasGemini = profile.overall_ugc_score != null;
  if (hasGemini && profile.speaks_english === false) {
    return `LANGUAGE NOTE: This creator likely does NOT speak English based on video analysis. Write the DM in simple, clear English. Avoid idioms and complex phrasing. Add at the end: "(We can also communicate in your preferred language if needed.)" Set language_note to "non-english speaker" in your response.`;
  }
  return '';
}

function buildPrompt(profile) {
  const bio = (profile.bio || '').replace(/[\n\r]/g, ' ').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  const hasGemini = profile.overall_ugc_score != null;
  const profileType = profile.profile_type || 'UGC_CREATOR';
  const isTeacher = profileType === 'COURSE_TEACHER' || profileType === 'BOTH';
  const isUGC = profileType === 'UGC_CREATOR' || profileType === 'BOTH';

  // Gemini video analysis data
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

  // Reel captions for personalization
  const cleanText = (s) => (s || '').replace(/[\n\r]/g, ' ').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  const cap1 = cleanText(profile.reel_1_caption).substring(0, 200);
  const cap2 = cleanText(profile.reel_2_caption).substring(0, 200);
  const cap3 = cleanText(profile.reel_3_caption).substring(0, 200);
  let reelContent = '';
  if (cap1 || cap2 || cap3) {
    reelContent = `\nTHEIR CONTENT (use this to personalize your message, reference specific work):`;
    if (cap1) reelContent += `\n- Reel 1: "${cap1}" (${profile.reel_1_likes || 0} likes)`;
    if (cap2) reelContent += `\n- Reel 2: "${cap2}" (${profile.reel_2_likes || 0} likes)`;
    if (cap3) reelContent += `\n- Reel 3: "${cap3}" (${profile.reel_3_likes || 0} likes)`;
  }

  // Dynamic context
  const audienceContext = getAudienceContext(profile.followers || 0);
  const languageContext = getLanguageContext(profile);

  // Type-specific role context, tier definitions, and message instructions
  let roleContext, tierDefs, messageInstructions, jsonFormat, examples;

  if (isTeacher && isUGC) {
    roleContext = 'This creator is flagged as BOTH a UGC Creator AND a potential Course Teacher for 21Draw.';
    tierDefs = `   - TIER_1: Perfect fit for BOTH roles. Strong art educator, high scores, English speaker, video creator
   - TIER_2: Strong for one role, decent for the other
   - TIER_3: Approved but better suited for only one role`;
    messageInstructions = `Write TWO sets of outreach messages:
a) UGC DM + email — about creating paid promotional content for 21Draw
b) Teaching DM + email — about teaching an online course for 21Draw's 2M+ students. This is a significant paid opportunity with upfront payment + ongoing royalties. 21Draw handles all production.`;
    jsonFormat = `{
  "contact_email": "email@example.com or null",
  "contact_method": "EMAIL/DM/BOTH",
  "priority_tier": "TIER_1/TIER_2/TIER_3",
  "dm_message": "UGC DM text",
  "email_subject": "UGC email subject",
  "email_body": "UGC email body",
  "teacher_dm_message": "Teaching DM text",
  "teacher_email_subject": "Teaching email subject",
  "teacher_email_body": "Teaching email body",
  "language_note": "non-english speaker or null",
  "personalization_hook": "the specific thing you referenced about their work"
}`;
    examples = `
EXAMPLE (BOTH, UGC + Teacher):
{
  "dm_message": "Saw your gouache landscapes and the way you explain color mixing is so clear. I'm Noras at 21Draw, we're an online art school with 2M students. We pay artists to create content for us and thought you'd be perfect. Can I tell you more?",
  "email_subject": "Paid content collab with 21Draw",
  "email_body": "Hi,\\n\\nI'm Noras from 21Draw. Found your work on Instagram and love your painting tutorials.\\n\\nWe're an online art school (2M+ students, courses by Disney/Marvel pros) and we're looking for artists to create paid promo content. Your teaching style and audience would be a great fit.\\n\\nHappy to share more details if you're interested.\\n\\nNoras\\n21Draw",
  "teacher_dm_message": "Your gouache tutorials are seriously good. I'm at 21Draw, we have 2M+ students taking courses from industry pros. We're looking for artists to teach paid courses on our platform, we handle all the production. Think it could be a good fit for you. Open to chatting?",
  "teacher_email_subject": "Teaching opportunity at 21Draw",
  "teacher_email_body": "Hi,\\n\\nI'm Noras from 21Draw. We're an online art education platform with 2M+ students and instructors from Disney, Marvel, and DreamWorks.\\n\\nWe're looking for talented artists to teach courses. You get paid upfront plus ongoing royalties, and we handle all filming and production. Your painting tutorials show exactly the kind of teaching ability our students need.\\n\\nWould love to tell you more.\\n\\nNoras\\n21Draw"
}`;
  } else if (isTeacher) {
    roleContext = 'This creator is flagged as a potential Course Teacher for 21Draw.';
    tierDefs = `   - TIER_1: Professional artist with clear teaching ability, strong portfolio, English speaker
   - TIER_2: Good artist but teaching ability uncertain (no speaking in videos, unclear language)
   - TIER_3: Interesting artist but may not be ready to teach a full course`;
    messageInstructions = `Write outreach about teaching an online art course for 21Draw's 2M+ students.
Key selling points:
- Significant upfront payment + ongoing royalties from course sales
- 21Draw handles ALL production (filming, editing, platform hosting)
- Join a roster of Disney, Marvel, and DreamWorks alumni
- Courses cover: character design, concept art, digital illustration, comic art, traditional painting, anatomy, figure drawing
- Mention their specific art expertise and how it fits`;
    jsonFormat = `{
  "contact_email": "email@example.com or null",
  "contact_method": "EMAIL/DM/BOTH",
  "priority_tier": "TIER_1/TIER_2/TIER_3",
  "dm_message": "the DM text",
  "email_subject": "subject line",
  "email_body": "the email body",
  "language_note": "non-english speaker or null",
  "personalization_hook": "the specific thing you referenced about their work"
}`;
    examples = `
EXAMPLE (Course Teacher):
{
  "dm_message": "Been following your storyboard work for a bit, your process breakdowns are really helpful. I'm at 21Draw, we're looking for artists to teach paid courses on our platform. We handle all the production side, you just teach. Worth a quick chat?",
  "email_subject": "Teaching opportunity at 21Draw",
  "email_body": "Hi,\\n\\nI'm Noras from 21Draw. We're an online art school with 2M+ students, courses taught by pros from Disney, Marvel, DreamWorks.\\n\\nWe're looking for artists to teach their own courses. You get upfront payment plus ongoing royalties from sales. We handle filming, editing, everything.\\n\\nYour storyboard expertise would be a great addition to our course lineup. Happy to share more details.\\n\\nNoras\\n21Draw"
}`;
  } else {
    roleContext = 'This creator is flagged as a UGC Creator for 21Draw.';
    tierDefs = `   - TIER_1: Strong art educator/creator, high scores, speaks English, creates video content. Perfect UGC fit.
   - TIER_2: Good creator but missing something (doesn't talk in videos, lower engagement, or unclear language)
   - TIER_3: Approved but lower potential for video UGC specifically`;
    messageInstructions = `Write outreach about creating paid promotional content for 21Draw.
Key points:
- This is PAID work, not a free product exchange
- They would create content featuring 21Draw courses/platform
- 21Draw is a premium art education platform (2M+ students, Disney/Marvel alumni instructors)
- Reference something specific about their art or content style`;
    jsonFormat = `{
  "contact_email": "email@example.com or null",
  "contact_method": "EMAIL/DM/BOTH",
  "priority_tier": "TIER_1/TIER_2/TIER_3",
  "dm_message": "the DM text",
  "email_subject": "subject line",
  "email_body": "the email body",
  "language_note": "non-english speaker or null",
  "personalization_hook": "the specific thing you referenced about their work"
}`;
    examples = `
EXAMPLE (UGC Creator):
{
  "dm_message": "Saw your character design breakdowns and they're so clean. I work at 21Draw (online art school, 2M+ students) and we're looking for artists to do paid content for us. Thought you'd be a good fit. Can I send you some details?",
  "email_subject": "Paid content collab with 21Draw",
  "email_body": "Hi,\\n\\nI'm Noras from 21Draw. Found your character design work on Instagram and it's great.\\n\\nWe're an online art school (2M+ students, courses by Disney/Marvel pros) and we pay artists to create promo content for our platform. Your style and audience would be a good match.\\n\\nHappy to share details if you're interested.\\n\\nNoras\\n21Draw"
}`;
  }

  return `You are writing outreach messages for 21Draw, an online art education platform. ${roleContext}

ABOUT 21DRAW:
- 2M+ students worldwide
- 50+ courses taught by industry professionals (Disney, Marvel, DreamWorks alumni)
- Course teachers receive upfront payment + ongoing royalties from course sales
- 21Draw handles all production (filming, editing, hosting)
- For UGC creators: paid content partnerships (not free product exchanges)

CREATOR PROFILE:
Username: ${profile.username}
Followers: ${formatNum(profile.followers || 0)}
Engagement Rate: ${profile.engagement_rate || 0}%
Bio: ${bio}
Profile Score: ${profile.profile_score}/10
Course Teacher Score: ${profile.course_teacher_score || 0}/10
Recommendation: ${profile.recommendation}
Reasoning: ${profile.reasoning || 'N/A'}
Profile Type: ${profileType}
${geminiInfo}
${reelContent}

${audienceContext}
${languageContext}

TASKS:
1. Extract any email address from the bio (return null if none found)
2. Determine contact method: EMAIL (if email found), DM (if no email), BOTH (if email found and they seem open to DMs)
3. Assign priority tier:
${tierDefs}
4. ${messageInstructions}

DM MESSAGE RULES:
- 2-3 short sentences max. Keep it under 400 characters.
- NEVER use em-dashes. Use periods or commas instead.
- BANNED PHRASES (do NOT use any of these, even rephrased): "incredible", "stunning", "really stood out", "caught my eye", "caught my attention", "I'd love to", "fantastic", "exceptional", "impressed", "stood out to me", "drew me in"
- One specific thing you noticed about their work, stated simply. Don't stack compliments.
- Don't cram everything into the first message. Just open the door.
- Write like you're texting someone about their work, not writing marketing copy.
- Vary sentence openings. Not every message should start with "Your [noun]..."
- Vary the closing. Not always "Would you be open to hearing more?" Try: "Can I send you details?", "Worth a chat?", "Open to chatting?", "Interested?"
- Zero emojis.
- Sign as just "Noras" in DMs, not "Noras from 21Draw".
- Mention 21Draw and what it is in one short phrase, like "21Draw (online art school, 2M+ students)" or "I'm at 21Draw, we do online art courses".
- Keep the tone casual. Short sentences. No corporate language.

EMAIL RULES:
- Subject: 5-8 words, direct, no buzzwords
- Body: 3-4 short sentences, get to the point fast
- Don't repeat the DM with fancier words, make it a bit different
- No em-dashes in emails either
- Sign off as just "Noras\\n21Draw"
${examples}

Respond with JSON only, no other text:
${jsonFormat}`;
}

function parseResponse(text) {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

async function classifyProfile(supabase, profile, apiKey) {
  const prompt = buildPrompt(profile);
  const { text, tokens } = await callClaude(prompt, apiKey);
  const result = parseResponse(text);
  const profileType = profile.profile_type || 'UGC_CREATOR';

  // Build outreach row with dedicated columns
  const outreachRow = {
    profile_username: profile.username,
    priority_tier: result.priority_tier || 'TIER_2',
    contact_method: result.contact_method || 'DM',
    contact_email: result.contact_email || null,
    message_sent: result.dm_message || '',
    status: 'QUEUED',
    profile_type: profileType,
    email_subject: result.email_subject || null,
    email_body: result.email_body || null,
    teacher_dm_message: result.teacher_dm_message || null,
    teacher_email_subject: result.teacher_email_subject || null,
    teacher_email_body: result.teacher_email_body || null,
    language_note: result.language_note || null,
    personalization_hook: result.personalization_hook || null,
    // Keep notes for backward compat
    notes: JSON.stringify({
      email_subject: result.email_subject,
      email_body: result.email_body,
      ...(result.teacher_dm_message ? {
        teacher_dm_message: result.teacher_dm_message,
        teacher_email_subject: result.teacher_email_subject,
        teacher_email_body: result.teacher_email_body
      } : {})
    })
  };

  // Insert into outreach table
  const { error: insertError } = await supabase
    .from('outreach')
    .insert(outreachRow);

  if (insertError) throw new Error(`DB error: ${insertError.message}`);

  // Log to ai_logs
  await supabase.from('ai_logs').insert({
    profile_username: profile.username,
    workflow_name: 'Outreach-Classification',
    model_used: MODEL,
    prompt_sent: prompt.substring(0, 2000),
    input_data: { username: profile.username, followers: profile.followers, profile_type: profileType },
    output_raw: text,
    output_parsed: result,
    tokens_used: tokens,
    prompt_version: PROMPT_VERSION
  });

  return result;
}

module.exports = { callClaude, buildPrompt, parseResponse, classifyProfile, MODEL, PROMPT_VERSION };
