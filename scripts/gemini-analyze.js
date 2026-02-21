// Standalone Gemini video analysis for approved profiles
// Downloads videos from Supabase Storage, uploads to Gemini, runs analysis
// Updates profiles and logs to ai_logs table

const path = require('path');
const reviewAppModules = path.join(__dirname, '..', 'review-app', 'node_modules');
require(path.join(reviewAppModules, 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require(path.join(reviewAppModules, '@supabase', 'supabase-js'));
const https = require('https');
const http = require('http');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const MODEL = 'gemini-2.0-flash';
const PROMPT_VERSION = 1;

// --- HTTP helpers ---

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`)));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    };
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, handler).on('error', reject);
  });
}

function jsonRequest(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function uploadToGemini(videoBuffer, displayName) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'X-Goog-Upload-Command': 'start, upload, finalize',
        'X-Goog-Upload-Header-Content-Length': videoBuffer.length,
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'Content-Length': videoBuffer.length
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Upload parse error: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Upload timeout')); });
    req.write(videoBuffer);
    req.end();
  });
}

function waitForFileActive(fileName) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const url = new URL(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`);
      https.get({ hostname: url.hostname, path: url.pathname + url.search }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.state === 'ACTIVE') return resolve(parsed);
            if (parsed.state === 'FAILED') return reject(new Error('File processing failed'));
            attempts++;
            if (attempts > 30) return reject(new Error('File processing timeout'));
            setTimeout(check, 2000);
          } catch (e) {
            reject(new Error(`Status check error: ${data.substring(0, 200)}`));
          }
        });
      }).on('error', reject);
    };
    check();
  });
}

function buildPrompt(profile, videoCount) {
  return `You are evaluating Instagram creators for UGC partnerships with 21Draw, an online art education platform.

CREATOR INFO:
- Username: ${profile.username}
- Followers: ${profile.followers}
- Bio: ${(profile.bio || '').replace(/[\n\r]/g, ' ')}

REEL 1 CAPTION: ${profile.reel_1_caption || 'N/A'}
REEL 2 CAPTION: ${profile.reel_2_caption || 'N/A'}
REEL 3 CAPTION: ${profile.reel_3_caption || 'N/A'}

I have provided ${videoCount} video(s) for you to analyze.

WATCH AND LISTEN TO ALL VIDEOS CAREFULLY. Evaluate the creator based on ALL videos:

1. **talks_in_videos** (true/false): Does the creator SPEAK with their voice in ANY of the videos?
   - TRUE = creator talks, explains, or narrates with spoken words in at least one video
   - FALSE = no speech in any video, only music, sound effects, or silence
   - Background music does NOT count as talking
   - Text overlays do NOT count as talking
   - Songs with lyrics do NOT count as the creator talking

2. **audio_description**: What sounds do you HEAR in each video? Be specific. Format:
   - Reel 1: [describe audio]
   - Reel 2: [describe audio] (if provided)
   - Reel 3: [describe audio] (if provided)

3. **speech_quote**: If the creator speaks in ANY video, provide ONE short quote (5-10 words) of what they actually said. If no speech in any video, write "N/A".

4. **speaks_english** (true/false): If they speak, is it in English? (false if no speech)

5. **videos_with_speech**: How many of the videos have the creator speaking? (0, 1, 2, or 3)

6. **voice_potential** (0-10): Based on their content style, how likely could they do voiceover work?
7. **teaching_potential** (0-10): Could they teach art concepts?
8. **content_quality** (0-10): Production quality and visual appeal
9. **brand_fit** (0-10): Fit with art education brand
10. **overall_ugc_score** (0-10): Overall UGC partnership potential

11. **video_summary**: Briefly describe what happens across all videos
12. **ugc_reasoning**: Why would they be a good/bad UGC partner?
13. **recommendation**: STRONG_YES / YES / MAYBE / NO
14. **next_steps**: What to verify before outreach?

IMPORTANT: Be accurate about audio. Do not assume speech exists just because it's a tutorial. Many art videos have only music.

CRITICAL: You MUST respond with ONLY a JSON object. No text before or after. No markdown. No explanation. Do not use newline characters inside string values — use spaces instead. Example format:
{"talks_in_videos": false, "audio_description": "Reel 1: background music. Reel 2: silence.", "speech_quote": "N/A", "speaks_english": false, "videos_with_speech": 0, "voice_potential": 0, "teaching_potential": 0, "content_quality": 0, "brand_fit": 0, "overall_ugc_score": 0, "video_summary": "", "ugc_reasoning": "", "recommendation": "", "next_steps": ""}`;
}

function validateResponse(result) {
  // Check for "no video" hallucination
  const noVideoPatterns = ['no video provided', 'based on the caption', 'without video', 'cannot analyze video'];
  const summary = (result.video_summary || '').toLowerCase();
  const audio = (result.audio_description || '').toLowerCase();

  for (const pattern of noVideoPatterns) {
    if (summary.includes(pattern) || audio.includes(pattern)) {
      return { valid: false, reason: 'Gemini did not analyze actual video content' };
    }
  }

  // Check for speech hallucination
  if (result.talks_in_videos === true) {
    const speechKeywords = ['speak', 'talk', 'voice', 'narrat', 'explain', 'say', 'comment'];
    const hasEvidence = speechKeywords.some(kw => audio.includes(kw));
    if (!hasEvidence) {
      result.talks_in_videos = false;
      result.audio_description = `[CORRECTED: talks_in_videos overridden to false] ${result.audio_description}`;
    }
  }

  return { valid: true };
}

async function analyzeProfile(profile) {
  // Build storage URLs for available reels
  const reels = [];
  for (const num of [1, 2, 3]) {
    const storagePath = profile[`reel_${num}_storage_path`];
    if (storagePath) {
      reels.push({
        num,
        url: `${SUPABASE_URL}/storage/v1/object/public/reel-videos/${storagePath}`
      });
    }
  }

  if (reels.length === 0) {
    return { skipped: true, reason: 'No storage paths' };
  }

  // Download and upload each reel to Gemini
  const fileUris = [];
  for (const reel of reels) {
    try {
      console.log(`    Downloading reel_${reel.num}...`);
      const buffer = await fetchBuffer(reel.url);
      console.log(`    Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB, uploading to Gemini...`);

      const uploadResult = await uploadToGemini(buffer, `${profile.username}_reel_${reel.num}`);
      const fileName = uploadResult.file?.name;
      const fileUri = uploadResult.file?.uri;

      if (!fileUri) {
        console.log(`    Upload failed for reel_${reel.num}: no URI returned`);
        continue;
      }

      // Wait for file to be processed
      if (uploadResult.file?.state !== 'ACTIVE') {
        console.log(`    Waiting for file processing...`);
        await waitForFileActive(fileName);
      }

      fileUris.push(fileUri);
      console.log(`    Reel ${reel.num} ready`);
    } catch (err) {
      console.log(`    Failed reel_${reel.num}: ${err.message}`);
    }
  }

  if (fileUris.length === 0) {
    return { skipped: true, reason: 'All video uploads failed' };
  }

  // Build Gemini request with retry logic
  const prompt = buildPrompt(profile, fileUris.length);
  const fileParts = fileUris.map(uri => ({ fileData: { mimeType: 'video/mp4', fileUri: uri } }));

  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 5000; // 5s, 10s backoff
      console.log(`    Retry ${attempt}/${MAX_RETRIES} after ${delay/1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }

    const textPart = attempt === 0
      ? prompt
      : prompt + '\n\nREMINDER: Output ONLY valid JSON. No text, no markdown, no explanation. Keep all string values on a single line with no newline characters.';

    const parts = [...fileParts, { text: textPart }];

    console.log(`    ${attempt === 0 ? 'Analyzing' : 'Re-analyzing'} ${fileUris.length} video(s) with Gemini...`);
    const response = await jsonRequest(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts }] }
    );

    // Handle rate limit with longer backoff
    if (response.error?.code === 429 || (response.error?.message || '').includes('Resource exhausted')) {
      console.log(`    Rate limited, waiting 30s...`);
      await new Promise(r => setTimeout(r, 30000));
      lastError = new Error('Rate limited');
      continue;
    }

    if (response.error) {
      throw new Error(`Gemini API error: ${response.error.message}`);
    }

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      lastError = new Error('Empty Gemini response');
      continue;
    }

    // Clean and parse JSON response
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    // Remove control characters inside strings (tabs, newlines, etc.)
    cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, ' ');

    // If response doesn't start with {, it's prose — retry
    if (!cleaned.startsWith('{')) {
      console.log(`    Got prose response, will retry...`);
      lastError = new Error('Non-JSON response');
      continue;
    }

    try {
      const result = JSON.parse(cleaned);
      const validation = validateResponse(result);
      return {
        skipped: false,
        result,
        valid: validation.valid,
        validationReason: validation.reason,
        prompt,
        rawResponse: text,
        videosAnalyzed: fileUris.length
      };
    } catch (parseErr) {
      console.log(`    JSON parse failed: ${parseErr.message}`);
      lastError = parseErr;
      continue;
    }
  }

  throw lastError || new Error('All retries exhausted');
}

async function main() {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set in .env');
    process.exit(1);
  }

  // Get approved profiles that need Gemini analysis
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('username, followers, bio, reel_1_caption, reel_2_caption, reel_3_caption, reel_1_storage_path, reel_2_storage_path, reel_3_storage_path, videos_downloaded, overall_ugc_score, status')
    .in('status', ['HUMAN_REVIEWED', 'ANALYZED', 'ANALYSIS_FAILED'])
    .eq('videos_downloaded', true)
    .is('overall_ugc_score', null);

  if (error) {
    console.error('DB error:', error.message);
    process.exit(1);
  }

  // Also filter to only approved profiles
  const { data: reviews } = await supabase
    .from('human_reviews')
    .select('profile_username')
    .eq('decision', 'APPROVED');
  const approvedSet = new Set((reviews || []).map(r => r.profile_username));

  let toAnalyze = (profiles || []).filter(p => approvedSet.has(p.username));

  // Support --limit N flag for testing
  const limitArg = process.argv.indexOf('--limit');
  if (limitArg !== -1 && process.argv[limitArg + 1]) {
    const limit = parseInt(process.argv[limitArg + 1]);
    toAnalyze = toAnalyze.slice(0, limit);
  }

  console.log(`Found ${toAnalyze.length} profiles needing Gemini analysis\n`);

  if (toAnalyze.length === 0) {
    console.log('Nothing to analyze. Done!');
    return;
  }

  let analyzed = 0;
  let skipped = 0;
  let errors = 0;

  for (const profile of toAnalyze) {
    console.log(`[${analyzed + skipped + errors + 1}/${toAnalyze.length}] ${profile.username}`);

    try {
      const result = await analyzeProfile(profile);

      if (result.skipped) {
        console.log(`  SKIPPED: ${result.reason}`);
        skipped++;
        continue;
      }

      const r = result.result;
      const status = result.valid ? 'VIDEO_ANALYZED' : 'ANALYSIS_FAILED';

      // Update profile in Supabase
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          status,
          talks_in_videos: r.talks_in_videos,
          speaks_english: r.speaks_english,
          overall_ugc_score: r.overall_ugc_score,
          content_style: r.video_summary,
          voice_potential: r.voice_potential,
          teaching_potential: r.teaching_potential,
          production_quality: r.content_quality,
          brand_fit: r.brand_fit,
          ugc_reasoning: r.ugc_reasoning,
          video_recommendation: r.recommendation,
          next_steps: r.next_steps,
          audio_description: r.audio_description,
          speech_quote: r.speech_quote,
          videos_with_speech: r.videos_with_speech
        })
        .eq('username', profile.username);

      if (updateError) {
        console.error(`  DB update error: ${updateError.message}`);
        errors++;
        continue;
      }

      // Log to ai_logs
      await supabase.from('ai_logs').insert({
        profile_username: profile.username,
        workflow_name: 'Gemini-Video-Analysis-Script',
        model_used: MODEL,
        prompt_sent: result.prompt.substring(0, 2000),
        input_data: { username: profile.username, videos: result.videosAnalyzed },
        output_raw: result.rawResponse,
        output_parsed: r,
        tokens_used: 0,
        prompt_version: PROMPT_VERSION
      });

      analyzed++;
      console.log(`  ${status} | Score: ${r.overall_ugc_score}/10 | Speaks: ${r.speaks_english} | ${r.recommendation}`);
      if (!result.valid) {
        console.log(`  WARNING: ${result.validationReason}`);
      }

      // Delay between profiles to avoid rate limits
      await new Promise(r => setTimeout(r, 3000));

    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      errors++;

      // Mark as failed
      await supabase.from('profiles')
        .update({ status: 'ANALYSIS_FAILED' })
        .eq('username', profile.username);

      // Log the failure
      await supabase.from('ai_logs').insert({
        profile_username: profile.username,
        workflow_name: 'Gemini-Video-Analysis-Script',
        model_used: 'FAILED',
        input_data: { username: profile.username, error: err.message },
        output_raw: err.message,
        prompt_version: PROMPT_VERSION
      });
    }
  }

  console.log(`\nDone! Analyzed: ${analyzed}, Skipped: ${skipped}, Errors: ${errors}`);

  // Show summary
  const { data: summary } = await supabase
    .from('profiles')
    .select('overall_ugc_score, video_recommendation, speaks_english')
    .not('overall_ugc_score', 'is', null);

  const recs = {};
  let englishSpeakers = 0;
  let avgScore = 0;
  (summary || []).forEach(p => {
    recs[p.video_recommendation] = (recs[p.video_recommendation] || 0) + 1;
    if (p.speaks_english) englishSpeakers++;
    avgScore += p.overall_ugc_score || 0;
  });
  avgScore = summary?.length ? (avgScore / summary.length).toFixed(1) : 0;

  console.log(`\nAll video-analyzed profiles:`);
  console.log(`  Total: ${(summary || []).length}`);
  console.log(`  Avg score: ${avgScore}`);
  console.log(`  English speakers: ${englishSpeakers}`);
  console.log(`  Recommendations: ${JSON.stringify(recs)}`);
}

main().catch(console.error);
