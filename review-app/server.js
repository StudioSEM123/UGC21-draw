const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config(); // also check local .env (for Docker)

const app = express();
app.set('trust proxy', 1); // trust first proxy (Traefik)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ══════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════

const APP_PASSWORD = process.env.APP_PASSWORD || 'review2024';

app.use(session({
  secret: process.env.SESSION_SECRET || 'ugc-finder-session-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  const error = req.query.error ? '<p style="color:#e74c3c;margin-bottom:16px">Wrong password</p>' : '';
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — 21Draw UGC</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f1117;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#1a1d27;border:1px solid #2a2d3a;border-radius:12px;padding:40px;width:360px;text-align:center}
  h1{font-size:20px;margin-bottom:8px;color:#fff}
  .sub{color:#888;font-size:13px;margin-bottom:24px}
  input[type=password]{width:100%;padding:12px 16px;background:#0f1117;border:1px solid #2a2d3a;border-radius:8px;color:#fff;font-size:15px;margin-bottom:16px;outline:none}
  input[type=password]:focus{border-color:#6c5ce7}
  button{width:100%;padding:12px;background:#6c5ce7;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600}
  button:hover{background:#5a4bd1}
</style></head><body>
<div class="card">
  <h1>21Draw UGC Finder</h1>
  <p class="sub">Enter password to continue</p>
  ${error}
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Password" autofocus>
    <button type="submit">Log in</button>
  </form>
</div></body></html>`);
});

app.post('/login', (req, res) => {
  if (req.body.password === APP_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect(req.session.returnTo || '/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Protect all routes except /login
app.use((req, res, next) => {
  if (req.path === '/login') return next();
  if (!req.session.authenticated) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Email transporter (Gmail for testing)
let emailTransporter = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// REVIEW API
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/profiles', async (req, res) => {
  const filter = req.query.filter || 'all';
  const sort = req.query.sort || 'score';

  const { data: reviewed } = await supabase
    .from('human_reviews')
    .select('profile_username, decision, human_reasoning');
  const reviewMap = {};
  (reviewed || []).forEach(r => {
    reviewMap[r.profile_username] = { decision: r.decision, human_reasoning: r.human_reasoning };
  });

  const type = req.query.type || 'all';

  let query = supabase.from('profiles').select('*');

  if (filter === 'pass') query = query.eq('recommendation', 'PASS');
  else if (filter === 'reject') query = query.eq('recommendation', 'REJECT');
  else if (filter === 'collaborate') query = query.eq('recommendation', 'COLLABORATE');
  else if (filter === 'review') query = query.eq('recommendation', 'REVIEW');
  else query = query.in('recommendation', ['COLLABORATE', 'REVIEW']);

  if (type !== 'all') {
    query = query.eq('suggested_type', type);
  }

  if (sort === 'score') query = query.order('profile_score', { ascending: false });
  if (sort === 'followers') query = query.order('followers', { ascending: false });
  if (sort === 'engagement') query = query.order('engagement_rate', { ascending: false });
  if (sort === 'teacher_score') query = query.order('course_teacher_score', { ascending: false, nullsFirst: false });

  const { data: profiles, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  let result = (profiles || []).map(p => ({
    ...p,
    already_reviewed: !!reviewMap[p.username],
    review_decision: reviewMap[p.username]?.decision || null,
    review_reasoning: reviewMap[p.username]?.human_reasoning || null
  }));

  if (filter === 'denied') result = result.filter(p => p.review_decision === 'DENIED');
  if (filter === 'approved') result = result.filter(p => p.review_decision === 'APPROVED');
  if (filter === 'denied_teacher') result = result.filter(p => p.review_decision === 'DENIED' && (p.course_teacher_score || 0) >= 6);
  if (filter === 'reject' || filter === 'pass') result = result.filter(p => p.review_decision !== 'APPROVED');

  res.json(result);
});

app.post('/api/review', async (req, res) => {
  const { profile_id, profile_username, decision, human_reasoning, profile_type } = req.body;

  if (!profile_username || !decision) {
    return res.status(400).json({ error: 'Missing profile_username or decision' });
  }

  const reviewRow = {
    profile_id,
    profile_username,
    decision,
    human_reasoning: human_reasoning || '',
    reviewed_by: 'noras',
    prompt_version_claude: 2
  };
  if (profile_type) reviewRow.profile_type = profile_type;

  const { error: reviewError } = await supabase
    .from('human_reviews')
    .insert(reviewRow);

  if (reviewError) return res.status(500).json({ error: reviewError.message });

  const profileUpdate = { status: 'HUMAN_REVIEWED' };
  if (decision === 'APPROVED' && profile_type) {
    profileUpdate.profile_type = profile_type;
  }

  await supabase
    .from('profiles')
    .update(profileUpdate)
    .eq('username', profile_username);

  res.json({ success: true });
});

app.post('/api/review/change', async (req, res) => {
  const { profile_id, profile_username, decision, human_reasoning, profile_type } = req.body;

  if (!profile_username || !decision) {
    return res.status(400).json({ error: 'Missing profile_username or decision' });
  }

  // Update existing review row
  const updateRow = { decision, human_reasoning: human_reasoning || '', reviewed_by: 'noras' };
  if (profile_type) updateRow.profile_type = profile_type;

  const { error: reviewError } = await supabase
    .from('human_reviews')
    .update(updateRow)
    .eq('profile_username', profile_username);

  if (reviewError) return res.status(500).json({ error: reviewError.message });

  // Update profile type if approving
  if (decision === 'APPROVED' && profile_type) {
    await supabase.from('profiles').update({ profile_type }).eq('username', profile_username);
  }

  res.json({ success: true });
});

app.get('/api/stats', async (req, res) => {
  const { data: reviews } = await supabase
    .from('human_reviews')
    .select('decision, profile_username');

  const { data: recCounts } = await supabase
    .from('profiles')
    .select('recommendation, username');

  const reviewedSet = new Set((reviews || []).map(r => r.profile_username));

  const counts = { collaborate: 0, review: 0, pass: 0, reject: 0 };
  const unreviewed = { collaborate: 0, review: 0 };
  (recCounts || []).forEach(r => {
    const key = (r.recommendation || '').toLowerCase();
    if (counts[key] !== undefined) counts[key]++;
    if ((key === 'collaborate' || key === 'review') && !reviewedSet.has(r.username)) {
      unreviewed[key]++;
    }
  });

  const totalToReview = counts.collaborate + counts.review;
  const approved = (reviews || []).filter(r => r.decision === 'APPROVED').length;
  const denied = (reviews || []).filter(r => r.decision === 'DENIED').length;

  res.json({
    total_to_review: totalToReview,
    reviewed: (reviews || []).length,
    approved,
    denied,
    remaining: Math.max(0, totalToReview - (reviews || []).length),
    counts,
    unreviewed
  });
});

// ══════════════════════════════════════════════════════════════════════════
// OUTREACH API
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/outreach', async (req, res) => {
  const filter = req.query.filter || 'all';
  const type = req.query.type || 'all';
  const sort = req.query.sort || 'tier';

  let query = supabase
    .from('outreach')
    .select('*');

  // Sorting — tier is default, others handled client-side after profile join
  if (sort === 'created') {
    query = query.order('created_at', { ascending: false });
  } else {
    query = query.order('priority_tier', { ascending: true }).order('created_at', { ascending: true });
  }

  if (filter !== 'all') {
    if (filter === 'follow_up') {
      query = query.in('status', ['FOLLOW_UP_1', 'FOLLOW_UP_2']);
    } else {
      query = query.eq('status', filter.toUpperCase());
    }
  }

  if (type !== 'all') {
    query = query.eq('profile_type', type);
  }

  const { data: outreach, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Join with profile data
  const usernames = (outreach || []).map(o => o.profile_username);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('username, followers, engagement_rate, bio, profile_score, recommendation, overall_ugc_score, speaks_english, talks_in_videos, course_teacher_score, suggested_type, profile_type, audit_flags, reel_1_post_url, reel_2_post_url, reel_3_post_url, reel_1_caption, reel_2_caption, reel_3_caption')
    .in('username', usernames.length > 0 ? usernames : ['__none__']);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.username] = p; });

  const result = (outreach || []).map(o => ({
    ...o,
    profile: profileMap[o.profile_username] || null
  }));

  res.json(result);
});

app.get('/api/outreach/stats', async (req, res) => {
  const { data } = await supabase.from('outreach').select('status, priority_tier');

  const stats = { total: 0, queued: 0, contacted: 0, follow_up: 0, replied: 0, negotiating: 0, confirmed: 0, declined: 0, no_response: 0 };
  const tiers = { TIER_1: 0, TIER_2: 0, TIER_3: 0 };

  (data || []).forEach(o => {
    stats.total++;
    const key = o.status.toLowerCase().replace(/_\d+$/, '').replace('_', '_');
    if (o.status === 'FOLLOW_UP_1' || o.status === 'FOLLOW_UP_2') stats.follow_up++;
    else if (stats[o.status.toLowerCase()] !== undefined) stats[o.status.toLowerCase()]++;
    if (tiers[o.priority_tier] !== undefined) tiers[o.priority_tier]++;
  });

  res.json({ ...stats, tiers });
});

app.post('/api/outreach/send-email', async (req, res) => {
  const { profile_username, subject, body, to_email } = req.body;

  if (!profile_username || !subject || !body || !to_email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!emailTransporter) {
    return res.status(500).json({ error: 'Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env' });
  }

  try {
    await emailTransporter.sendMail({
      from: process.env.GMAIL_USER,
      to: to_email,
      subject,
      text: body
    });

    await supabase
      .from('outreach')
      .update({
        status: 'CONTACTED',
        contacted_at: new Date().toISOString(),
        email_subject: subject,
        email_body: body
      })
      .eq('profile_username', profile_username);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outreach/mark-contacted', async (req, res) => {
  const { profile_username, message } = req.body;

  if (!profile_username) {
    return res.status(400).json({ error: 'Missing profile_username' });
  }

  const { error } = await supabase
    .from('outreach')
    .update({
      status: 'CONTACTED',
      contacted_at: new Date().toISOString(),
      message_sent: message || ''
    })
    .eq('profile_username', profile_username);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/outreach/update-status', async (req, res) => {
  const { profile_username, status, notes } = req.body;

  if (!profile_username || !status) {
    return res.status(400).json({ error: 'Missing profile_username or status' });
  }

  const update = { status };
  if (status === 'QUEUED') {
    update.contacted_at = null;
    update.follow_up_1_at = null;
    update.follow_up_2_at = null;
    update.replied_at = null;
  }
  if (status === 'CONTACTED') update.contacted_at = new Date().toISOString();
  if (status === 'FOLLOW_UP_1') update.follow_up_1_at = new Date().toISOString();
  if (status === 'FOLLOW_UP_2') update.follow_up_2_at = new Date().toISOString();
  if (status === 'REPLIED') update.replied_at = new Date().toISOString();
  if (notes) update.notes = notes;

  const { error } = await supabase
    .from('outreach')
    .update(update)
    .eq('profile_username', profile_username);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/outreach/save-reply', async (req, res) => {
  const { profile_username, reply_summary, reply_sentiment } = req.body;

  if (!profile_username || !reply_summary) {
    return res.status(400).json({ error: 'Missing profile_username or reply_summary' });
  }

  const update = {
    status: 'REPLIED',
    replied_at: new Date().toISOString(),
    reply_summary
  };
  if (reply_sentiment) update.reply_sentiment = reply_sentiment;

  const { error } = await supabase
    .from('outreach')
    .update(update)
    .eq('profile_username', profile_username);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/outreach/save-message', async (req, res) => {
  const { profile_username, field, value } = req.body;

  if (!profile_username || !field) {
    return res.status(400).json({ error: 'Missing profile_username or field' });
  }

  const allowedFields = ['message_sent', 'email_subject', 'email_body', 'teacher_dm_message', 'teacher_email_subject', 'teacher_email_body'];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Invalid field' });
  }

  const { error } = await supabase
    .from('outreach')
    .update({ [field]: value })
    .eq('profile_username', profile_username);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/outreach/save-notes', async (req, res) => {
  const { profile_username, user_notes } = req.body;

  if (!profile_username) {
    return res.status(400).json({ error: 'Missing profile_username' });
  }

  const { error } = await supabase
    .from('outreach')
    .update({ user_notes: user_notes || '' })
    .eq('profile_username', profile_username);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/outreach/export-csv', async (req, res) => {
  const { data: outreach } = await supabase
    .from('outreach')
    .select('*')
    .order('priority_tier', { ascending: true });

  const usernames = (outreach || []).map(o => o.profile_username);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('username, followers, engagement_rate, bio, profile_score, course_teacher_score')
    .in('username', usernames.length > 0 ? usernames : ['__none__']);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.username] = p; });

  const headers = ['username', 'tier', 'type', 'status', 'contact_method', 'contact_email', 'followers', 'engagement_rate', 'profile_score', 'dm_message', 'email_subject', 'email_body', 'teacher_dm', 'teacher_email_subject', 'teacher_email_body', 'language_note', 'personalization_hook', 'user_notes', 'reply_summary', 'reply_sentiment', 'contacted_at', 'replied_at'];

  const escCsv = (v) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };

  const rows = (outreach || []).map(o => {
    const p = profileMap[o.profile_username] || {};
    return [o.profile_username, o.priority_tier, o.profile_type, o.status, o.contact_method, o.contact_email, p.followers, p.engagement_rate, p.profile_score, o.message_sent, o.email_subject, o.email_body, o.teacher_dm_message, o.teacher_email_subject, o.teacher_email_body, o.language_note, o.personalization_hook, o.user_notes, o.reply_summary, o.reply_sentiment, o.contacted_at, o.replied_at].map(escCsv).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=outreach-export.csv');
  res.send(csv);
});

app.post('/api/outreach/reclassify', async (req, res) => {
  const { profile_username } = req.body;
  if (!profile_username) return res.status(400).json({ error: 'Missing profile_username' });

  try {
    // 1. Delete existing outreach record
    await supabase.from('outreach').delete().eq('profile_username', profile_username);

    // 2. Fetch profile data
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('username, followers, engagement_rate, bio, profile_score, course_teacher_score, recommendation, reasoning, overall_ugc_score, speaks_english, talks_in_videos, voice_potential, teaching_potential, brand_fit, production_quality, video_recommendation, profile_type, suggested_type, reel_1_caption, reel_2_caption, reel_3_caption, reel_1_likes, reel_2_likes, reel_3_likes')
      .eq('username', profile_username)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Use human-assigned type, fall back to AI suggestion
    if (!profile.profile_type && profile.suggested_type) {
      profile.profile_type = profile.suggested_type;
    }

    // 3. Re-classify using shared module
    const { classifyProfile } = require(path.join(__dirname, '..', 'scripts', 'lib', 'classify'));
    await classifyProfile(supabase, profile, process.env.ANTHROPIC_API_KEY);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PAGES
// ══════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => { res.send(renderReviewPage()); });
app.get('/outreach', (req, res) => { res.send(renderOutreachPage()); });

// ══════════════════════════════════════════════════════════════════════════
// REVIEW PAGE (unchanged functionality)
// ══════════════════════════════════════════════════════════════════════════

function renderReviewPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>21Draw UGC Review</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="tab-nav">
    <a href="/" class="tab active">Review</a>
    <a href="/outreach" class="tab">Outreach</a>
  </div>

  <div class="header">
    <h1>21Draw UGC Review</h1>
    <div class="header-right">
      <div class="search-box">
        <input type="text" id="search" placeholder="Search username..." oninput="filterBySearch()">
      </div>
      <div class="stats">
        <span>Remaining: <strong id="stat-remaining">-</strong></span>
        <span class="approved">Approved: <strong id="stat-approved">-</strong></span>
        <span class="denied">Denied: <strong id="stat-denied">-</strong></span>
      </div>
    </div>
  </div>

  <div class="progress-wrap"><div class="progress-bar" id="progress-bar"></div></div>

  <div class="filters">
    <button class="active" data-filter="all">All <span class="count" id="count-all"></span></button>
    <button data-filter="collaborate">Collaborate <span class="count" id="count-collaborate"></span></button>
    <button data-filter="review">Review <span class="count" id="count-review"></span></button>
    <div class="filter-sep"></div>
    <button data-filter="pass">Pass <span class="count" id="count-pass"></span></button>
    <button data-filter="reject">Reject <span class="count" id="count-reject"></span></button>
    <div class="filter-sep"></div>
    <button data-filter="denied">My Denied <span class="count" id="count-denied"></span></button>
    <button data-filter="approved">My Approved <span class="count" id="count-approved"></span></button>
  </div>

  <div class="container" id="profiles"></div>
  <div class="toast" id="toast"></div>

  <div class="kb-legend">
    <div class="kb"><kbd>A</kbd> Approve</div>
    <div class="kb"><kbd>D</kbd> Deny</div>
    <div class="kb"><kbd>U</kbd> Undo</div>
    <div class="kb"><kbd>T</kbd> Type</div>
    <div class="kb"><kbd>J</kbd> Next</div>
    <div class="kb"><kbd>K</kbd> Prev</div>
  </div>

<script>
let currentFilter = 'all';
let currentSort = 'score';
let currentType = 'all';
let allProfiles = [];
let focusedIndex = 0;

async function loadStats() {
  const res = await fetch('/api/stats');
  const s = await res.json();
  document.getElementById('stat-remaining').textContent = s.remaining;
  document.getElementById('stat-approved').textContent = s.approved;
  document.getElementById('stat-denied').textContent = s.denied;
  const pct = s.total_to_review > 0 ? Math.round((s.reviewed / s.total_to_review) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  const c = s.counts || {};
  const u = s.unreviewed || {};
  setText('count-all', (u.collaborate || 0) + (u.review || 0));
  setText('count-collaborate', u.collaborate || 0);
  setText('count-review', u.review || 0);
  setText('count-pass', c.pass);
  setText('count-reject', c.reject);
  setText('count-denied', s.denied);
  setText('count-approved', s.approved);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val != null ? '(' + val + ')' : '';
}

async function loadProfiles() {
  const res = await fetch('/api/profiles?filter=' + currentFilter + '&sort=' + currentSort + '&type=' + currentType);
  allProfiles = await res.json();
  renderProfiles(allProfiles);
  updateFilterCounts(allProfiles);
}

function updateFilterCounts(profiles) {
  // Update counts to show unreviewed only for review-mode filters
  const unreviewed = profiles.filter(p => !p.already_reviewed);
  const byRec = {};
  unreviewed.forEach(p => {
    const key = (p.recommendation || '').toLowerCase();
    byRec[key] = (byRec[key] || 0) + 1;
  });
  if (currentFilter === 'all') {
    setText('count-all', unreviewed.length);
    setText('count-collaborate', byRec['collaborate'] || 0);
    setText('count-review', byRec['review'] || 0);
  } else if (currentFilter === 'collaborate') {
    setText('count-collaborate', byRec['collaborate'] || 0);
  } else if (currentFilter === 'review') {
    setText('count-review', byRec['review'] || 0);
  }
}

function renderProfiles(profiles) {
  const container = document.getElementById('profiles');
  const search = (document.getElementById('search').value || '').toLowerCase();
  let filtered = profiles;
  if (search) filtered = profiles.filter(p => p.username.toLowerCase().includes(search));
  if (!['denied','approved','denied_teacher','pass','reject'].includes(currentFilter)) {
    filtered = filtered.filter(p => !p.already_reviewed);
  }
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">' + (search ? 'No matches for "' + escapeHtml(search) + '"' : 'All caught up!') + '</div>';
    return;
  }
  container.innerHTML = filtered.map(p => renderCard(p)).join('');
  focusedIndex = 0;
  updateFocus();
}

function filterBySearch() { renderProfiles(allProfiles); }

function scoreClass(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function aiSuggestionClass(type) {
  if (type === 'COURSE_TEACHER') return 'teacher';
  if (type === 'BOTH') return 'both';
  return 'ugc';
}

function aiSuggestionLabel(type) {
  if (type === 'COURSE_TEACHER') return 'AI: Teacher';
  if (type === 'BOTH') return 'AI: Both';
  return 'AI: UGC';
}

function formatNumber(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getEmbedUrl(postUrl) {
  if (!postUrl) return '';
  const url = postUrl.endsWith('/') ? postUrl : postUrl + '/';
  return url + 'embed/';
}

function toggleEmbed(id) {
  const wrap = document.getElementById('embed-' + id);
  const btn = document.getElementById('btn-' + id);
  if (!wrap || !btn) return;
  if (wrap.classList.contains('show')) {
    wrap.classList.remove('show'); wrap.innerHTML = ''; btn.classList.remove('open'); btn.textContent = 'Watch';
  } else {
    wrap.classList.add('show');
    wrap.innerHTML = '<iframe src="' + wrap.dataset.url + '" loading="lazy" allowtransparency="true" allowfullscreen></iframe>';
    btn.classList.add('open'); btn.textContent = 'Close';
  }
}

function renderReel(p, num) {
  const postUrl = p['reel_' + num + '_post_url'];
  const likes = p['reel_' + num + '_likes'];
  const comments = p['reel_' + num + '_comments'];
  const duration = p['reel_' + num + '_duration'];
  const caption = p['reel_' + num + '_caption'];
  if (!postUrl) return '';
  const embedId = p.username + '-' + num;
  const embedUrl = getEmbedUrl(postUrl);
  return '<div class="reel">' +
    '<div class="reel-info"><div class="reel-info-left">' +
      '<span class="reel-num">Reel ' + num + '</span>' +
      (duration ? '<span>' + duration + 's</span>' : '') +
      '<span>' + formatNumber(likes) + ' likes</span>' +
      '<span>' + formatNumber(comments) + ' comments</span>' +
    '</div>' +
    '<button class="btn-watch" id="btn-' + embedId + '" onclick="toggleEmbed(\\'' + embedId + '\\')">Watch</button></div>' +
    '<div class="reel-embed" id="embed-' + embedId + '" data-url="' + embedUrl + '"></div>' +
    (caption ? '<div class="reel-caption">' + escapeHtml(caption).substring(0, 150) + '</div>' : '') +
  '</div>';
}

function renderCard(p) {
  const reviewed = p.already_reviewed;
  const igUrl = 'https://www.instagram.com/' + p.username + '/';
  const reelHtml = [renderReel(p, 1), renderReel(p, 2), renderReel(p, 3)].filter(Boolean).join('');
  const hasReels = !!reelHtml;

  let geminiHtml = '';
  if (p.overall_ugc_score) {
    // Audit flags banner
    let auditBanner = '';
    const flags = p.audit_flags || [];
    if (flags.length > 0) {
      const hasHigh = flags.some(function(f) { return f.severity === 'high' || f.severity === 'critical'; });
      const bannerClass = hasHigh ? 'audit-banner-high' : 'audit-banner-warn';
      const flagItems = flags.map(function(f) {
        return '<div class="audit-flag">' +
          '<span class="audit-severity audit-' + f.severity + '">' + f.severity.toUpperCase() + '</span> ' +
          escapeHtml(f.message) +
          (f.auto_corrected ? ' <span class="audit-corrected">auto-corrected</span>' : '') +
        '</div>';
      }).join('');
      auditBanner = '<div class="audit-banner ' + bannerClass + '">' +
        '<div class="audit-banner-title">&#9888; ' + flags.length + ' audit flag' + (flags.length > 1 ? 's' : '') + '</div>' +
        flagItems + '</div>';
    }

    geminiHtml = '<div class="section"><div class="section-label">Video Analysis (Gemini)</div>' +
      auditBanner +
      '<div class="gemini-grid">' +
        '<div class="gemini-stat"><div class="value">' + p.overall_ugc_score + '</div><div class="label">UGC Score</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.talks_in_videos ? 'Yes' : 'No') + '</div><div class="label">Talks</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.speaks_english ? 'Yes' : 'No') + '</div><div class="label">English</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.voice_potential || '-') + '</div><div class="label">Voice</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.teaching_potential || '-') + '</div><div class="label">Teaching</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.brand_fit || '-') + '</div><div class="label">Brand Fit</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.production_quality || '-') + '</div><div class="label">Production</div></div>' +
      '</div>' +
      (p.audio_description ? '<div class="audio-desc">' + escapeHtml(p.audio_description) + '</div>' : '') +
      (p.video_recommendation ? '<div style="margin-top:8px;font-size:12px;color:#6e6e73">' + escapeHtml(p.video_recommendation) + '</div>' : '') +
    '</div>';
  }

  let actionsHtml = '';
  if (reviewed) {
    const isDenied = p.review_decision === 'DENIED';
    const isApproved = p.review_decision === 'APPROVED';
    const defaultType = p.profile_type || p.suggested_type || 'UGC_CREATOR';
    actionsHtml = '<div class="review-status ' + (isDenied ? 'denied-status' : 'approved-status') + '">' +
      '<span>' + (p.review_decision || 'Reviewed') + '</span>' +
      (p.review_reasoning ? '<span class="reason"> — ' + escapeHtml(p.review_reasoning) + '</span>' : '') + '</div>' +
      '<div class="type-selector" data-username="' + p.username + '" style="margin-top:8px">' +
        '<button class="btn-type' + (defaultType === 'UGC_CREATOR' ? ' active' : '') + '" data-type-value="UGC_CREATOR" onclick="selectType(\\'' + p.username + '\\', \\'UGC_CREATOR\\')">UGC Creator</button>' +
        '<button class="btn-type' + (defaultType === 'COURSE_TEACHER' ? ' active' : '') + '" data-type-value="COURSE_TEACHER" onclick="selectType(\\'' + p.username + '\\', \\'COURSE_TEACHER\\')">Course Teacher</button>' +
        '<button class="btn-type' + (defaultType === 'BOTH' ? ' active' : '') + '" data-type-value="BOTH" onclick="selectType(\\'' + p.username + '\\', \\'BOTH\\')">Both</button>' +
      '</div>' +
      '<div class="card-actions" style="margin-top:6px">' +
        '<textarea id="reason-' + p.username + '" placeholder="Reason for changing decision"></textarea>' +
        (isDenied ? '<button class="btn btn-approve" onclick="changeReview(' + p.id + ', \\'' + p.username + '\\', \\'APPROVED\\')">Approve</button>' : '') +
        (isApproved ? '<button class="btn btn-deny" onclick="changeReview(' + p.id + ', \\'' + p.username + '\\', \\'DENIED\\')">Deny</button>' : '') +
      '</div>';
  } else {
    const defaultType = p.suggested_type || 'UGC_CREATOR';
    actionsHtml = '<div class="type-selector" data-username="' + p.username + '">' +
      '<button class="btn-type' + (defaultType === 'UGC_CREATOR' ? ' active' : '') + '" data-type-value="UGC_CREATOR" onclick="selectType(\\'' + p.username + '\\', \\'UGC_CREATOR\\')">UGC Creator</button>' +
      '<button class="btn-type' + (defaultType === 'COURSE_TEACHER' ? ' active' : '') + '" data-type-value="COURSE_TEACHER" onclick="selectType(\\'' + p.username + '\\', \\'COURSE_TEACHER\\')">Course Teacher</button>' +
      '<button class="btn-type' + (defaultType === 'BOTH' ? ' active' : '') + '" data-type-value="BOTH" onclick="selectType(\\'' + p.username + '\\', \\'BOTH\\')">Both</button>' +
    '</div>' +
    '<div class="card-actions">' +
      '<textarea id="reason-' + p.username + '" placeholder="Reason (optional for approve, recommended for deny)"></textarea>' +
      '<button class="btn btn-approve" onclick="submitReview(' + p.id + ', \\'' + p.username + '\\', \\'APPROVED\\')">Approve <span class="shortcut-hint">A</span></button>' +
      '<button class="btn btn-deny" onclick="submitReview(' + p.id + ', \\'' + p.username + '\\', \\'DENIED\\')">Deny <span class="shortcut-hint">D</span></button>' +
    '</div>';
  }

  return '<div class="card" data-username="' + p.username + '" id="card-' + p.username + '">' +
    '<div class="card-header"><div>' +
      '<div class="username"><a href="' + igUrl + '" target="_blank">@' + p.username + '</a></div>' +
      '<div class="meta">' +
        '<span class="meta-pill highlight">' + formatNumber(p.followers) + ' followers</span>' +
        '<span class="meta-pill">' + (p.engagement_rate || 0) + '% eng</span>' +
        '<span class="meta-pill">' + (p.source || '?') + '</span>' +
        '<span class="meta-pill">' + (p.total_reels_found || 0) + ' reels</span>' +
      '</div></div>' +
      '<div class="score-badges">' +
        '<div class="score-badge"><div class="score ' + scoreClass(p.profile_score) + '">' + (p.profile_score || '?') + '</div><div class="label">UGC</div></div>' +
        '<div class="score-badge"><div class="score ' + scoreClass(p.course_teacher_score) + '">' + (p.course_teacher_score || '?') + '</div><div class="label">Teacher</div></div>' +
        '<div class="score-badge"><div class="score ' + scoreClass(p.niche_relevance) + '">' + (p.niche_relevance || '?') + '</div><div class="label">Niche</div></div>' +
        '<span class="badge ' + (p.recommendation || '').toLowerCase() + '">' + (p.recommendation || '?') + '</span>' +
        (p.suggested_type ? '<span class="ai-suggestion ' + aiSuggestionClass(p.suggested_type) + '">' + aiSuggestionLabel(p.suggested_type) + '</span>' : '') +
      '</div></div>' +
    '<div class="card-body' + (hasReels ? '' : ' no-reels') + '">' +
      '<div class="info-col">' +
        '<div class="section"><div class="section-label">Bio</div><div class="bio">' + escapeHtml(p.bio) + '</div></div>' +
        '<div class="section"><div class="section-label">Claude\\'s Reasoning</div><div class="reasoning">' + escapeHtml(p.reasoning) + '</div></div>' +
        geminiHtml +
      '</div>' +
      (hasReels ? '<div class="reels-col"><div class="section"><div class="section-label">Reels</div><div class="reels">' + reelHtml + '</div></div></div>' : '') +
    '</div>' +
    actionsHtml +
  '</div>';
}

function selectType(username, type) {
  const selector = document.querySelector('.type-selector[data-username="' + username + '"]');
  if (!selector) return;
  selector.querySelectorAll('.btn-type').forEach(b => b.classList.remove('active'));
  selector.querySelector('[data-type-value="' + type + '"]').classList.add('active');
}

function getSelectedType(username) {
  const selector = document.querySelector('.type-selector[data-username="' + username + '"]');
  if (!selector) return 'UGC_CREATOR';
  const active = selector.querySelector('.btn-type.active');
  return active ? active.dataset.typeValue : 'UGC_CREATOR';
}

function cycleType(username) {
  const types = ['UGC_CREATOR', 'COURSE_TEACHER', 'BOTH'];
  const current = getSelectedType(username);
  const idx = types.indexOf(current);
  const next = types[(idx + 1) % types.length];
  selectType(username, next);
}

const pendingReviews = {};
let lastReviewUsername = null;

function submitReview(profileId, username, decision) {
  const reasonEl = document.getElementById('reason-' + username);
  const reason = reasonEl ? reasonEl.value : '';
  const profileType = getSelectedType(username);
  const card = document.getElementById('card-' + username);
  const actionsEl = card.querySelector('.card-actions') || card.querySelector('.review-status');
  if (!actionsEl) return;
  const originalHtml = actionsEl.outerHTML;
  const color = decision === 'APPROVED' ? '#34c759' : '#ff3b30';
  const label = decision === 'APPROVED' ? 'Approved' : 'Denied';

  actionsEl.outerHTML =
    '<div class="card-actions" style="justify-content:space-between">' +
      '<span style="color:' + color + ';font-weight:600">' + label + (reason ? ' — ' + escapeHtml(reason) : '') + '</span>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span id="countdown-' + username + '" style="font-size:12px;color:#8e8e93">5s</span>' +
        '<button class="btn" style="background:#8e8e93;padding:6px 16px;font-size:12px" onclick="undoReview(\\'' + username + '\\')">Undo <span class="shortcut-hint">U</span></button>' +
      '</div></div>';
  card.style.opacity = '0.5';
  lastReviewUsername = username;

  let seconds = 5;
  const interval = setInterval(() => {
    seconds--;
    const el = document.getElementById('countdown-' + username);
    if (el) el.textContent = seconds + 's';
    if (seconds <= 0) clearInterval(interval);
  }, 1000);

  const timer = setTimeout(async () => {
    delete pendingReviews[username];
    clearInterval(interval);
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, profile_username: username, decision, human_reasoning: reason, profile_type: profileType })
      });
      if (!res.ok) throw new Error('Failed');
      card.style.display = 'none';
      showToast('@' + username + ' ' + decision.toLowerCase(), 'success');
      loadStats();
    } catch (e) {
      card.style.opacity = '1';
      const wrapper = card.querySelector('.card-actions');
      if (wrapper) wrapper.outerHTML = originalHtml;
      showToast('Error saving review', 'error');
    }
  }, 5000);

  pendingReviews[username] = { timer, interval, originalHtml, card };
}

function undoReview(username) {
  const pending = pendingReviews[username];
  if (!pending) return;
  clearTimeout(pending.timer);
  clearInterval(pending.interval);
  pending.card.style.opacity = '1';
  const wrapper = pending.card.querySelector('.card-actions');
  if (wrapper) wrapper.outerHTML = pending.originalHtml;
  delete pendingReviews[username];
  showToast('Undone — @' + username, 'success');
}

async function changeReview(profileId, username, decision) {
  const reasonEl = document.getElementById('reason-' + username);
  const reason = reasonEl ? reasonEl.value : '';
  const profileType = getSelectedType(username);
  const card = document.getElementById('card-' + username);
  if (!card) return;
  try {
    const res = await fetch('/api/review/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, profile_username: username, decision, human_reasoning: reason, profile_type: profileType })
    });
    if (!res.ok) throw new Error('Failed');
    card.style.display = 'none';
    showToast('@' + username + ' changed to ' + decision.toLowerCase(), 'success');
    loadStats();
  } catch (e) {
    showToast('Error changing review', 'error');
  }
}

function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => { toast.className = 'toast'; }, 2500);
}

function getVisibleCards() {
  return Array.from(document.querySelectorAll('.card')).filter(c => c.style.display !== 'none');
}

function updateFocus() {
  document.querySelectorAll('.card').forEach(c => c.classList.remove('focused'));
  const cards = getVisibleCards();
  if (cards[focusedIndex]) {
    cards[focusedIndex].classList.add('focused');
    cards[focusedIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const cards = getVisibleCards();
  if (!cards.length) return;
  const key = e.key.toLowerCase();
  if (key === 'j') { e.preventDefault(); focusedIndex = Math.min(focusedIndex + 1, cards.length - 1); updateFocus(); }
  if (key === 'k') { e.preventDefault(); focusedIndex = Math.max(focusedIndex - 1, 0); updateFocus(); }
  if (key === 'a') { e.preventDefault(); const card = cards[focusedIndex]; if (card) { const btn = card.querySelector('.btn-approve'); if (btn) btn.click(); } }
  if (key === 'd') { e.preventDefault(); const card = cards[focusedIndex]; if (card) { const btn = card.querySelector('.btn-deny'); if (btn) btn.click(); } }
  if (key === 'u') { e.preventDefault(); if (lastReviewUsername && pendingReviews[lastReviewUsername]) undoReview(lastReviewUsername); }
  if (key === 't') { e.preventDefault(); const card = cards[focusedIndex]; if (card) { cycleType(card.dataset.username); } }
});

document.querySelector('.filters').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.filter !== undefined) {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    document.getElementById('search').value = '';
    loadProfiles();
  }
  if (btn.dataset.sort !== undefined) {
    document.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSort = btn.dataset.sort;
    loadProfiles();
  }
  if (btn.dataset.type !== undefined) {
    document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentType = btn.dataset.type;
    loadProfiles();
  }
});

loadStats();
loadProfiles();
</script>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════
// OUTREACH PAGE
// ══════════════════════════════════════════════════════════════════════════

function renderOutreachPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>21Draw UGC Outreach</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="tab-nav">
    <a href="/" class="tab">Review</a>
    <a href="/outreach" class="tab active">Outreach</a>
  </div>

  <div class="header">
    <h1>21Draw Outreach</h1>
    <div class="header-right">
      <div class="search-box">
        <input type="text" id="search" placeholder="Search username..." oninput="filterBySearch()">
      </div>
      <a href="/api/outreach/export-csv" class="btn btn-status" style="text-decoration:none;margin-left:8px">Export CSV</a>
    </div>
  </div>

  <!-- Dashboard Funnel -->
  <div class="outreach-dashboard">
    <div class="funnel-row">
      <div class="funnel-card">
        <div class="funnel-num" id="dash-total">-</div>
        <div class="funnel-label">Total</div>
      </div>
      <div class="funnel-arrow">&rarr;</div>
      <div class="funnel-card funnel-contacted">
        <div class="funnel-num" id="dash-contacted">-</div>
        <div class="funnel-label">Contacted</div>
      </div>
      <div class="funnel-arrow">&rarr;</div>
      <div class="funnel-card funnel-replied">
        <div class="funnel-num" id="dash-replied">-</div>
        <div class="funnel-label">Replied</div>
      </div>
      <div class="funnel-arrow">&rarr;</div>
      <div class="funnel-card funnel-confirmed">
        <div class="funnel-num" id="dash-confirmed">-</div>
        <div class="funnel-label">Confirmed</div>
      </div>
      <div class="funnel-rate" id="dash-rate"></div>
    </div>
    <div class="tier-summary">
      <span class="tier-chip tier-1">TIER 1: <strong id="dash-t1">-</strong></span>
      <span class="tier-chip tier-2">TIER 2: <strong id="dash-t2">-</strong></span>
      <span class="tier-chip tier-3">TIER 3: <strong id="dash-t3">-</strong></span>
    </div>
  </div>

  <div class="filters">
    <button class="active" data-filter="all">All <span class="count" id="count-all"></span></button>
    <button data-filter="queued">Queued <span class="count" id="ocount-queued"></span></button>
    <button data-filter="contacted">Contacted <span class="count" id="ocount-contacted"></span></button>
    <button data-filter="follow_up">Follow-up <span class="count" id="ocount-follow_up"></span></button>
    <div class="filter-sep"></div>
    <button data-filter="replied">Replied <span class="count" id="ocount-replied"></span></button>
    <button data-filter="negotiating">Negotiating <span class="count" id="ocount-negotiating"></span></button>
    <button data-filter="confirmed">Confirmed <span class="count" id="ocount-confirmed"></span></button>
    <div class="filter-sep"></div>
    <button data-filter="declined">Declined <span class="count" id="ocount-declined"></span></button>
    <button data-filter="no_response">No Response <span class="count" id="ocount-no_response"></span></button>
    <div class="filter-sep"></div>
    <select class="status-dropdown" id="otype-select" onchange="changeOType(this.value)">
      <option value="all">All Types</option>
      <option value="UGC_CREATOR">UGC</option>
      <option value="COURSE_TEACHER">Teacher</option>
      <option value="BOTH">Both</option>
    </select>
    <select class="status-dropdown" id="osort-select" onchange="changeOSort(this.value)">
      <option value="tier">Sort: Tier</option>
      <option value="score">Sort: Score</option>
      <option value="followers">Sort: Followers</option>
      <option value="created">Sort: Created</option>
    </select>
  </div>

  <div class="container" id="outreach-list"></div>
  <div class="toast" id="toast"></div>

  <!-- Email Preview Modal -->
  <div class="modal-overlay" id="email-modal" style="display:none">
    <div class="modal">
      <div class="modal-header">
        <h3>Send Email to <span id="modal-username"></span></h3>
        <button class="modal-close" onclick="closeEmailModal()">&times;</button>
      </div>
      <div class="modal-body">
        <label>To:</label>
        <input type="email" id="modal-to" class="modal-input" readonly>
        <label>Subject:</label>
        <input type="text" id="modal-subject" class="modal-input">
        <label>Body:</label>
        <textarea id="modal-body-text" class="modal-textarea"></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-status" onclick="closeEmailModal()">Cancel</button>
        <button class="btn btn-email" onclick="confirmSendEmail()">Send Email</button>
      </div>
    </div>
  </div>

  <div class="kb-legend">
    <div class="kb"><kbd>E</kbd> Send Email</div>
    <div class="kb"><kbd>C</kbd> Copy + Open DM</div>
    <div class="kb"><kbd>J</kbd> Next</div>
    <div class="kb"><kbd>K</kbd> Prev</div>
  </div>

<script>
let currentFilter = 'all';
let currentOType = 'all';
let currentSort = 'tier';
let allOutreach = [];
let focusedIndex = 0;
let saveTimers = {};
let emailModalUsername = '';

async function loadStats() {
  const res = await fetch('/api/outreach/stats');
  const s = await res.json();
  // Dashboard funnel
  document.getElementById('dash-total').textContent = s.total;
  document.getElementById('dash-contacted').textContent = s.contacted + s.follow_up;
  document.getElementById('dash-replied').textContent = s.replied + s.negotiating;
  document.getElementById('dash-confirmed').textContent = s.confirmed;
  const contacted = s.contacted + s.follow_up + s.replied + s.negotiating + s.confirmed + s.declined + s.no_response;
  const replyRate = contacted > 0 ? Math.round(((s.replied + s.negotiating + s.confirmed) / contacted) * 100) : 0;
  document.getElementById('dash-rate').textContent = contacted > 0 ? 'Reply rate: ' + replyRate + '%' : '';
  document.getElementById('dash-t1').textContent = s.tiers.TIER_1;
  document.getElementById('dash-t2').textContent = s.tiers.TIER_2;
  document.getElementById('dash-t3').textContent = s.tiers.TIER_3;
  // Filter counts
  setText('count-all', s.total);
  setText('ocount-queued', s.queued);
  setText('ocount-contacted', s.contacted);
  setText('ocount-follow_up', s.follow_up);
  setText('ocount-replied', s.replied);
  setText('ocount-negotiating', s.negotiating);
  setText('ocount-confirmed', s.confirmed);
  setText('ocount-declined', s.declined);
  setText('ocount-no_response', s.no_response);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val != null ? '(' + val + ')' : '';
}

async function loadOutreach() {
  const sortParam = currentSort === 'created' ? '&sort=created' : '';
  const res = await fetch('/api/outreach?filter=' + currentFilter + '&type=' + currentOType + sortParam);
  allOutreach = await res.json();
  // Client-side sort for score/followers (needs profile data)
  if (currentSort === 'score') {
    allOutreach.sort((a, b) => ((b.profile?.profile_score || 0) - (a.profile?.profile_score || 0)));
  } else if (currentSort === 'followers') {
    allOutreach.sort((a, b) => ((b.profile?.followers || 0) - (a.profile?.followers || 0)));
  }
  renderOutreach(allOutreach);
}

function renderOutreach(items) {
  const container = document.getElementById('outreach-list');
  const search = (document.getElementById('search').value || '').toLowerCase();
  let filtered = items;
  if (search) filtered = items.filter(o => o.profile_username.toLowerCase().includes(search));
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">' + (search ? 'No matches' : 'No outreach records yet. Run scripts/classify-outreach.js first.') + '</div>';
    return;
  }
  container.innerHTML = filtered.map(renderOutreachCard).join('');
  focusedIndex = 0;
  updateFocus();
}

function filterBySearch() { renderOutreach(allOutreach); }

function changeOType(val) { currentOType = val; loadOutreach(); }
function changeOSort(val) { currentSort = val; loadOutreach(); }

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  if (!text) return '';
  return text.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatNumber(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function typeClass(type) {
  if (type === 'COURSE_TEACHER') return 'type-teacher';
  if (type === 'BOTH') return 'type-both';
  return 'type-ugc';
}

function typeLabel(type) {
  if (type === 'COURSE_TEACHER') return 'Teacher';
  if (type === 'BOTH') return 'UGC + Teacher';
  return 'UGC';
}

function renderOutreachCard(o) {
  const p = o.profile || {};
  const igUrl = 'https://www.instagram.com/' + o.profile_username + '/';
  const tierClass = o.priority_tier === 'TIER_1' ? 'tier-1' : o.priority_tier === 'TIER_3' ? 'tier-3' : 'tier-2';
  const tierBorderClass = o.priority_tier === 'TIER_1' ? 'card-tier-1' : o.priority_tier === 'TIER_3' ? 'card-tier-3' : 'card-tier-2';
  const days = daysSince(o.contacted_at);
  const needsFollowUp = o.status === 'CONTACTED' && days !== null && days >= 7;

  const statusLabels = {
    'QUEUED': 'Queued', 'CONTACTED': 'Contacted', 'FOLLOW_UP_1': 'Follow-up 1',
    'FOLLOW_UP_2': 'Follow-up 2', 'REPLIED': 'Replied', 'NEGOTIATING': 'Negotiating',
    'CONFIRMED': 'Confirmed', 'DECLINED': 'Declined', 'NO_RESPONSE': 'No Response'
  };
  const allStatuses = ['QUEUED', 'CONTACTED', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'REPLIED', 'NEGOTIATING', 'CONFIRMED', 'DECLINED', 'NO_RESPONSE'];

  const statusDropdown = '<select class="status-dropdown" onchange="changeStatus(\\'' + o.profile_username + '\\', this.value)">' +
    allStatuses.map(s => '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + (statusLabels[s] || s) + '</option>').join('') + '</select>';

  // -- LEFT PANEL --
  let leftHtml = '';

  // Bio
  const bio = (p.bio || '').substring(0, 200);
  if (bio) leftHtml += '<div class="o-section"><div class="bio">' + escapeHtml(bio) + (p.bio && p.bio.length > 200 ? '...' : '') + '</div></div>';

  // Reels: combined links + captions
  const reelItems = [];
  if (p.reel_1_post_url || p.reel_1_caption) {
    const link = p.reel_1_post_url ? '<a href="' + escapeAttr(p.reel_1_post_url) + '" target="_blank" class="reel-link">Reel 1</a>' : 'Reel 1';
    const cap = p.reel_1_caption ? ' "' + escapeHtml(p.reel_1_caption.substring(0, 60)) + (p.reel_1_caption.length > 60 ? '...' : '') + '"' : '';
    reelItems.push(link + cap);
  }
  if (p.reel_2_post_url || p.reel_2_caption) {
    const link = p.reel_2_post_url ? '<a href="' + escapeAttr(p.reel_2_post_url) + '" target="_blank" class="reel-link">Reel 2</a>' : 'Reel 2';
    const cap = p.reel_2_caption ? ' "' + escapeHtml(p.reel_2_caption.substring(0, 60)) + (p.reel_2_caption.length > 60 ? '...' : '') + '"' : '';
    reelItems.push(link + cap);
  }
  if (p.reel_3_post_url || p.reel_3_caption) {
    const link = p.reel_3_post_url ? '<a href="' + escapeAttr(p.reel_3_post_url) + '" target="_blank" class="reel-link">Reel 3</a>' : 'Reel 3';
    const cap = p.reel_3_caption ? ' "' + escapeHtml(p.reel_3_caption.substring(0, 60)) + (p.reel_3_caption.length > 60 ? '...' : '') + '"' : '';
    reelItems.push(link + cap);
  }
  if (reelItems.length) leftHtml += '<div class="o-section o-reels">' + reelItems.map(r => '<div class="reel-item">' + r + '</div>').join('') + '</div>';

  // Stats line + language
  let statsLine = formatNumber(p.followers) + ' followers';
  statsLine += ' &middot; Score ' + (p.profile_score || '?') + '/10';
  if (p.course_teacher_score) statsLine += ' &middot; Teacher ' + p.course_teacher_score + '/10';
  if (p.overall_ugc_score) statsLine += ' &middot; UGC ' + p.overall_ugc_score + '/10';
  if (p.speaks_english != null) statsLine += ' &middot; ' + (p.speaks_english ? 'English' : '<span class="lang-flag">Non-English</span>');
  const oFlags = p.audit_flags || [];
  if (oFlags.length > 0) {
    const hasHighFlag = oFlags.some(function(f) { return f.severity === 'high' || f.severity === 'critical'; });
    const flagList = oFlags.map(function(f) { return f.severity.toUpperCase() + ': ' + f.message; }).join('&#10;');
    statsLine += ' &middot; <span class="audit-pill ' + (hasHighFlag ? 'audit-pill-high' : 'audit-pill-warn') + '" title="' + escapeAttr(flagList) + '">&#9888; ' + oFlags.length + ' flag' + (oFlags.length > 1 ? 's' : '') + '</span>';
  }
  leftHtml += '<div class="o-section o-stats">' + statsLine + '</div>';

  // Contact timeline (only if contacted)
  const timelineEvents = [];
  if (o.contacted_at) timelineEvents.push({ label: 'Contacted', date: o.contacted_at });
  if (o.follow_up_1_at) timelineEvents.push({ label: 'Follow-up 1', date: o.follow_up_1_at });
  if (o.follow_up_2_at) timelineEvents.push({ label: 'Follow-up 2', date: o.follow_up_2_at });
  if (o.replied_at) timelineEvents.push({ label: 'Replied', date: o.replied_at });
  if (timelineEvents.length > 0) {
    leftHtml += '<div class="contact-timeline">' +
      timelineEvents.map(e => '<div class="timeline-event"><span class="timeline-label">' + e.label + '</span><span class="timeline-date">' + formatDate(e.date) + '</span></div>').join('') + '</div>';
  }

  // Notes
  leftHtml += '<div class="o-section">' +
    '<input type="text" class="notes-input" placeholder="Add a note..." value="' + escapeAttr(o.user_notes || '') + '" onblur="saveNotes(\\'' + o.profile_username + '\\', this.value)" onkeydown="if(event.key===\\'Enter\\')this.blur()">' +
  '</div>';

  // -- RIGHT PANEL: Messages --
  let rightHtml = '';
  const hasTeacherMsg = o.teacher_dm_message;
  const isEditable = o.status === 'QUEUED' || o.status === 'CONTACTED' || o.status === 'FOLLOW_UP_1' || o.status === 'FOLLOW_UP_2';

  let tabs = ['dm'];
  if (o.email_subject || o.email_body || o.contact_email) tabs.push('email');
  if (hasTeacherMsg) tabs.push('teacher_dm');
  if (o.teacher_email_subject || o.teacher_email_body) tabs.push('teacher_email');

  if (tabs.length > 1) {
    rightHtml += '<div class="msg-tabs" data-username="' + o.profile_username + '">';
    rightHtml += '<button class="msg-tab active" data-tab="dm" onclick="switchTab(\\'' + o.profile_username + '\\',\\'dm\\')">DM</button>';
    if (tabs.includes('email')) rightHtml += '<button class="msg-tab" data-tab="email" onclick="switchTab(\\'' + o.profile_username + '\\',\\'email\\')">Email</button>';
    if (tabs.includes('teacher_dm')) rightHtml += '<button class="msg-tab" data-tab="teacher_dm" onclick="switchTab(\\'' + o.profile_username + '\\',\\'teacher_dm\\')">Teacher DM</button>';
    if (tabs.includes('teacher_email')) rightHtml += '<button class="msg-tab" data-tab="teacher_email" onclick="switchTab(\\'' + o.profile_username + '\\',\\'teacher_email\\')">Teacher Email</button>';
    rightHtml += '</div>';
  }

  // DM panel
  if (isEditable) {
    rightHtml += '<div class="msg-panel active" data-panel="dm" data-username="' + o.profile_username + '">' +
      '<textarea id="msg-' + o.profile_username + '" class="outreach-msg" oninput="autoSaveMsg(\\'' + o.profile_username + '\\',\\'message_sent\\',this.value)">' + escapeHtml(o.message_sent || '') + '</textarea>' +
      '<span class="save-indicator" id="save-' + o.profile_username + '-message_sent"></span>' +
    '</div>';
  } else {
    rightHtml += '<div class="msg-panel active" data-panel="dm" data-username="' + o.profile_username + '">' +
      '<div class="msg-readonly">' + escapeHtml(o.message_sent || '') + '</div>' +
    '</div>';
  }

  // Email panel
  if (tabs.includes('email')) {
    if (isEditable) {
      rightHtml += '<div class="msg-panel" data-panel="email" data-username="' + o.profile_username + '" style="display:none">' +
        '<div class="email-field"><label>Subject:</label><input type="text" class="email-input" value="' + escapeAttr(o.email_subject || '') + '" oninput="autoSaveMsg(\\'' + o.profile_username + '\\',\\'email_subject\\',this.value)"></div>' +
        '<textarea class="outreach-msg email-body-msg" oninput="autoSaveMsg(\\'' + o.profile_username + '\\',\\'email_body\\',this.value)">' + escapeHtml(o.email_body || '') + '</textarea>' +
        '<span class="save-indicator" id="save-' + o.profile_username + '-email_body"></span>' +
      '</div>';
    } else {
      rightHtml += '<div class="msg-panel" data-panel="email" data-username="' + o.profile_username + '" style="display:none">' +
        '<div class="email-field"><label>Subject:</label><span>' + escapeHtml(o.email_subject || '') + '</span></div>' +
        '<div class="msg-readonly">' + escapeHtml(o.email_body || '') + '</div>' +
      '</div>';
    }
  }

  // Teacher DM panel
  if (tabs.includes('teacher_dm')) {
    if (isEditable) {
      rightHtml += '<div class="msg-panel" data-panel="teacher_dm" data-username="' + o.profile_username + '" style="display:none">' +
        '<textarea id="teacher-msg-' + o.profile_username + '" class="outreach-msg" oninput="autoSaveMsg(\\'' + o.profile_username + '\\',\\'teacher_dm_message\\',this.value)">' + escapeHtml(o.teacher_dm_message || '') + '</textarea>' +
        '<span class="save-indicator" id="save-' + o.profile_username + '-teacher_dm_message"></span>' +
      '</div>';
    } else {
      rightHtml += '<div class="msg-panel" data-panel="teacher_dm" data-username="' + o.profile_username + '" style="display:none">' +
        '<div class="msg-readonly">' + escapeHtml(o.teacher_dm_message || '') + '</div>' +
      '</div>';
    }
  }

  // Teacher email panel
  if (tabs.includes('teacher_email')) {
    if (isEditable) {
      rightHtml += '<div class="msg-panel" data-panel="teacher_email" data-username="' + o.profile_username + '" style="display:none">' +
        '<div class="email-field"><label>Subject:</label><input type="text" class="email-input" value="' + escapeAttr(o.teacher_email_subject || '') + '" oninput="autoSaveMsg(\\'' + o.profile_username + '\\',\\'teacher_email_subject\\',this.value)"></div>' +
        '<textarea class="outreach-msg email-body-msg" oninput="autoSaveMsg(\\'' + o.profile_username + '\\',\\'teacher_email_body\\',this.value)">' + escapeHtml(o.teacher_email_body || '') + '</textarea>' +
        '<span class="save-indicator" id="save-' + o.profile_username + '-teacher_email_body"></span>' +
      '</div>';
    } else {
      rightHtml += '<div class="msg-panel" data-panel="teacher_email" data-username="' + o.profile_username + '" style="display:none">' +
        '<div class="email-field"><label>Subject:</label><span>' + escapeHtml(o.teacher_email_subject || '') + '</span></div>' +
        '<div class="msg-readonly">' + escapeHtml(o.teacher_email_body || '') + '</div>' +
      '</div>';
    }
  }

  // Reply form (hidden)
  rightHtml += '<div class="reply-section" id="reply-section-' + o.profile_username + '" style="display:none">' +
    '<textarea class="reply-textarea" id="reply-text-' + o.profile_username + '" placeholder="What did they say?"></textarea>' +
    '<div class="reply-row">' +
      '<select class="reply-sentiment" id="reply-sentiment-' + o.profile_username + '">' +
        '<option value="positive">Positive (interested)</option>' +
        '<option value="neutral">Neutral (questions)</option>' +
        '<option value="negative">Not interested</option>' +
      '</select>' +
      '<button class="btn btn-reply" onclick="submitReply(\\'' + o.profile_username + '\\')">Save</button>' +
      '<button class="btn btn-status" onclick="toggleReplyForm(\\'' + o.profile_username + '\\')">Cancel</button>' +
    '</div>' +
  '</div>';

  // Existing reply
  if (o.reply_summary) {
    rightHtml += '<div class="existing-reply">' +
      (o.reply_sentiment ? '<span class="sentiment-badge sentiment-' + o.reply_sentiment + '">' + o.reply_sentiment + '</span>' : '') +
      '<span class="reply-text">' + escapeHtml(o.reply_summary) + '</span>' +
    '</div>';
  }

  // Status info
  let statusInfoHtml = '';
  if (o.status !== 'QUEUED') {
    statusInfoHtml = '<div class="outreach-status-bar">' +
      (days !== null ? '<span class="days-ago">' + days + 'd since contact</span>' : '') +
      (needsFollowUp ? '<span class="follow-up-badge">Needs follow-up</span>' : '') +
    '</div>';
  }

  // Action buttons
  let actionBtns = '<div class="outreach-action-bar">' +
    '<div class="action-left">' +
      '<button class="btn btn-dm" onclick="copyAndOpenDM(\\'' + o.profile_username + '\\')">Copy + Open DM</button>' +
      (o.contact_email ? '<button class="btn btn-email" onclick="openEmailModal(\\'' + o.profile_username + '\\')">Send Email</button>' : '') +
      '<button class="btn btn-status" onclick="toggleReplyForm(\\'' + o.profile_username + '\\')">Log Reply</button>' +
    '</div>' +
    '<button class="btn btn-reclassify" onclick="reclassify(\\'' + o.profile_username + '\\')">Re-classify</button>' +
  '</div>';

  // -- CARD HEADER: two rows --
  return '<div class="card ' + tierBorderClass + (needsFollowUp ? ' follow-up-highlight' : '') + '" data-username="' + o.profile_username + '" id="card-' + o.profile_username + '">' +
    '<div class="card-header-clean">' +
      '<div class="header-row-1">' +
        '<div class="header-left">' +
          '<a href="' + igUrl + '" target="_blank" class="username-link">@' + o.profile_username + '</a>' +
          '<span class="meta-pill ' + tierClass + '">' + o.priority_tier.replace('_', ' ') + '</span>' +
          (o.profile_type ? '<span class="meta-pill ' + typeClass(o.profile_type) + '">' + typeLabel(o.profile_type) + '</span>' : '') +
        '</div>' +
        '<div class="header-right-clean">' +
          statusDropdown +
        '</div>' +
      '</div>' +
      '<div class="header-row-2">' +
        formatNumber(p.followers) + ' followers &middot; ' +
        (p.engagement_rate || 0) + '% eng &middot; ' +
        (o.contact_method || 'DM') +
        (o.contact_email ? ' &middot; ' + escapeHtml(o.contact_email) : '') +
      '</div>' +
    '</div>' +
    '<div class="card-body-two-panel">' +
      '<div class="panel-left">' + leftHtml + '</div>' +
      '<div class="panel-right">' + rightHtml + '</div>' +
    '</div>' +
    '<div class="outreach-actions">' +
      statusInfoHtml +
      actionBtns +
    '</div>' +
  '</div>';
}

// -- Tab switching --
function switchTab(username, tab) {
  const card = document.getElementById('card-' + username);
  if (!card) return;
  card.querySelectorAll('.msg-tab').forEach(b => b.classList.remove('active'));
  card.querySelector('.msg-tab[data-tab="' + tab + '"]').classList.add('active');
  card.querySelectorAll('.msg-panel[data-username="' + username + '"]').forEach(p => p.style.display = 'none');
  const panel = card.querySelector('.msg-panel[data-panel="' + tab + '"][data-username="' + username + '"]');
  if (panel) panel.style.display = '';
}

// -- Auto-save messages --
function autoSaveMsg(username, field, value) {
  const key = username + '-' + field;
  if (saveTimers[key]) clearTimeout(saveTimers[key]);
  const indicator = document.getElementById('save-' + key);
  if (indicator) indicator.textContent = 'Saving...';
  saveTimers[key] = setTimeout(async () => {
    await fetch('/api/outreach/save-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_username: username, field, value })
    });
    if (indicator) { indicator.textContent = 'Saved'; setTimeout(() => { indicator.textContent = ''; }, 1500); }
  }, 500);
}

// -- Notes --
async function saveNotes(username, value) {
  await fetch('/api/outreach/save-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_username: username, user_notes: value })
  });
}

// -- Copy + Open DM --
async function copyAndOpenDM(username) {
  const msgEl = document.getElementById('msg-' + username);
  const record = allOutreach.find(o => o.profile_username === username);
  const msg = msgEl ? msgEl.value : (record ? record.message_sent : '');

  try {
    await navigator.clipboard.writeText(msg);
    showToast('Message copied! Opening DM...', 'success');
  } catch(e) {
    const ta = document.createElement('textarea');
    ta.value = msg;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Message copied! Opening DM...', 'success');
  }
  window.open('https://ig.me/m/' + username, '_blank');
}

// -- Status change --
async function changeStatus(username, newStatus) {
  const record = allOutreach.find(o => o.profile_username === username);
  const msgEl = document.getElementById('msg-' + username);
  const msg = msgEl ? msgEl.value : (record ? record.message_sent : '');

  if (newStatus === 'CONTACTED' && record && record.status === 'QUEUED') {
    await fetch('/api/outreach/mark-contacted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_username: username, message: msg })
    });
  } else {
    await fetch('/api/outreach/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_username: username, status: newStatus })
    });
  }
  showToast('@' + username + ' \\u2192 ' + newStatus, 'success');
  loadOutreach();
  loadStats();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

// -- Email modal --
function openEmailModal(username) {
  const record = allOutreach.find(o => o.profile_username === username);
  if (!record) return;
  emailModalUsername = username;
  document.getElementById('modal-username').textContent = '@' + username;
  document.getElementById('modal-to').value = record.contact_email || '';
  document.getElementById('modal-subject').value = record.email_subject || '';
  document.getElementById('modal-body-text').value = (record.email_body || '').replace(/\\\\n/g, '\\n');
  document.getElementById('email-modal').style.display = 'flex';
}

function closeEmailModal() {
  document.getElementById('email-modal').style.display = 'none';
  emailModalUsername = '';
}

async function confirmSendEmail() {
  const to = document.getElementById('modal-to').value;
  const subject = document.getElementById('modal-subject').value;
  const body = document.getElementById('modal-body-text').value;
  if (!to || !subject || !body) { showToast('Fill all fields', 'error'); return; }

  try {
    const res = await fetch('/api/outreach/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_username: emailModalUsername, subject, body, to_email: to })
    });
    const data = await res.json();
    if (data.error) { showToast('Email error: ' + data.error, 'error'); return; }
    showToast('Email sent to ' + to, 'success');
    closeEmailModal();
    loadOutreach();
    loadStats();
  } catch(e) {
    showToast('Failed to send email', 'error');
  }
}

// -- Reply form --
function toggleReplyForm(username) {
  const el = document.getElementById('reply-section-' + username);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function submitReply(username) {
  const text = document.getElementById('reply-text-' + username).value;
  const sentiment = document.getElementById('reply-sentiment-' + username).value;
  if (!text) { showToast('Enter reply text', 'error'); return; }
  await fetch('/api/outreach/save-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_username: username, reply_summary: text, reply_sentiment: sentiment })
  });
  showToast('Reply logged for @' + username, 'success');
  loadOutreach();
  loadStats();
}

// -- Reclassify --
async function reclassify(username) {
  if (!confirm('Re-classify @' + username + '? This will delete the existing outreach record and generate new messages.')) return;
  showToast('Re-classifying @' + username + '...', 'success');
  const res = await fetch('/api/outreach/reclassify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_username: username })
  });
  const data = await res.json();
  if (data.error) { showToast('Error: ' + data.error, 'error'); return; }
  showToast('Re-classified @' + username, 'success');
  loadOutreach();
  loadStats();
}

function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => { toast.className = 'toast'; }, 2500);
}

function getVisibleCards() {
  return Array.from(document.querySelectorAll('.card')).filter(c => c.style.display !== 'none');
}

function updateFocus() {
  document.querySelectorAll('.card').forEach(c => c.classList.remove('focused'));
  const cards = getVisibleCards();
  if (cards[focusedIndex]) {
    cards[focusedIndex].classList.add('focused');
    cards[focusedIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const cards = getVisibleCards();
  if (!cards.length) return;
  const key = e.key.toLowerCase();
  if (key === 'j') { e.preventDefault(); focusedIndex = Math.min(focusedIndex + 1, cards.length - 1); updateFocus(); }
  if (key === 'k') { e.preventDefault(); focusedIndex = Math.max(focusedIndex - 1, 0); updateFocus(); }
  if (key === 'e') {
    e.preventDefault();
    const card = cards[focusedIndex];
    if (card) { const btn = card.querySelector('.btn-email'); if (btn) btn.click(); }
  }
  if (key === 'c') {
    e.preventDefault();
    const card = cards[focusedIndex];
    if (card) { const btn = card.querySelector('.btn-dm'); if (btn) btn.click(); }
  }
});

document.querySelector('.filters').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.filter !== undefined) {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    document.getElementById('search').value = '';
    loadOutreach();
  }
  if (btn.dataset.otype !== undefined) {
    document.querySelectorAll('[data-otype]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentOType = btn.dataset.otype;
    loadOutreach();
  }
  if (btn.dataset.osort !== undefined) {
    document.querySelectorAll('[data-osort]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSort = btn.dataset.osort;
    loadOutreach();
  }
});

// Close modal on overlay click
document.getElementById('email-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeEmailModal();
});

loadStats();
loadOutreach();
</script>
</body>
</html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Review UI running at http://localhost:' + PORT);
  console.log('Outreach UI at http://localhost:' + PORT + '/outreach');
});
