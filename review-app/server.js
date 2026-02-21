const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

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

  let query = supabase.from('profiles').select('*');

  if (filter === 'pass') query = query.eq('recommendation', 'PASS');
  else if (filter === 'reject') query = query.eq('recommendation', 'REJECT');
  else if (filter === 'collaborate') query = query.eq('recommendation', 'COLLABORATE');
  else if (filter === 'review') query = query.eq('recommendation', 'REVIEW');
  else query = query.in('recommendation', ['COLLABORATE', 'REVIEW']);

  if (sort === 'score') query = query.order('profile_score', { ascending: false });
  if (sort === 'followers') query = query.order('followers', { ascending: false });
  if (sort === 'engagement') query = query.order('engagement_rate', { ascending: false });

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

  res.json(result);
});

app.post('/api/review', async (req, res) => {
  const { profile_id, profile_username, decision, human_reasoning } = req.body;

  if (!profile_username || !decision) {
    return res.status(400).json({ error: 'Missing profile_username or decision' });
  }

  const { error: reviewError } = await supabase
    .from('human_reviews')
    .insert({
      profile_id,
      profile_username,
      decision,
      human_reasoning: human_reasoning || '',
      reviewed_by: 'noras',
      prompt_version_claude: 1
    });

  if (reviewError) return res.status(500).json({ error: reviewError.message });

  await supabase
    .from('profiles')
    .update({ status: 'HUMAN_REVIEWED' })
    .eq('username', profile_username);

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

  let query = supabase
    .from('outreach')
    .select('*')
    .order('priority_tier', { ascending: true })
    .order('created_at', { ascending: true });

  if (filter !== 'all') {
    if (filter === 'follow_up') {
      query = query.in('status', ['FOLLOW_UP_1', 'FOLLOW_UP_2']);
    } else {
      query = query.eq('status', filter.toUpperCase());
    }
  }

  const { data: outreach, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Join with profile data
  const usernames = (outreach || []).map(o => o.profile_username);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('username, followers, engagement_rate, bio, profile_score, recommendation, overall_ugc_score, speaks_english, talks_in_videos')
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
        message_sent: `[EMAIL] Subject: ${subject}\n\n${body}`
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
  const { profile_username, reply_summary } = req.body;

  if (!profile_username || !reply_summary) {
    return res.status(400).json({ error: 'Missing profile_username or reply_summary' });
  }

  const { error } = await supabase
    .from('outreach')
    .update({
      status: 'REPLIED',
      replied_at: new Date().toISOString(),
      reply_summary
    })
    .eq('profile_username', profile_username);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
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
    <span class="sort-label">Sort:</span>
    <button class="active" data-sort="score">Score</button>
    <button data-sort="followers">Followers</button>
    <button data-sort="engagement">Engagement</button>
  </div>

  <div class="container" id="profiles"></div>
  <div class="toast" id="toast"></div>

  <div class="kb-legend">
    <div class="kb"><kbd>A</kbd> Approve</div>
    <div class="kb"><kbd>D</kbd> Deny</div>
    <div class="kb"><kbd>U</kbd> Undo</div>
    <div class="kb"><kbd>J</kbd> Next</div>
    <div class="kb"><kbd>K</kbd> Prev</div>
  </div>

<script>
let currentFilter = 'all';
let currentSort = 'score';
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
  const res = await fetch('/api/profiles?filter=' + currentFilter + '&sort=' + currentSort);
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
  if (!['denied','approved','pass','reject'].includes(currentFilter)) {
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
    geminiHtml = '<div class="section"><div class="section-label">Video Analysis (Gemini)</div>' +
      '<div class="gemini-grid">' +
        '<div class="gemini-stat"><div class="value">' + p.overall_ugc_score + '</div><div class="label">UGC Score</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.talks_in_videos ? 'Yes' : 'No') + '</div><div class="label">Talks</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.speaks_english ? 'Yes' : 'No') + '</div><div class="label">English</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.voice_potential || '-') + '</div><div class="label">Voice</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.teaching_potential || '-') + '</div><div class="label">Teaching</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.brand_fit || '-') + '</div><div class="label">Brand Fit</div></div>' +
        '<div class="gemini-stat"><div class="value">' + (p.production_quality || '-') + '</div><div class="label">Production</div></div>' +
      '</div>' +
      (p.video_recommendation ? '<div style="margin-top:8px;font-size:12px;color:#6e6e73">' + escapeHtml(p.video_recommendation) + '</div>' : '') +
    '</div>';
  }

  let actionsHtml = '';
  if (reviewed) {
    const isDenied = p.review_decision === 'DENIED';
    actionsHtml = '<div class="review-status ' + (isDenied ? 'denied-status' : 'approved-status') + '">' +
      '<span>' + (p.review_decision || 'Reviewed') + '</span>' +
      (p.review_reasoning ? '<span class="reason"> — ' + escapeHtml(p.review_reasoning) + '</span>' : '') + '</div>';
  } else {
    actionsHtml = '<div class="card-actions">' +
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
        '<div class="score-badge"><div class="score ' + scoreClass(p.profile_score) + '">' + (p.profile_score || '?') + '</div><div class="label">Score</div></div>' +
        '<div class="score-badge"><div class="score ' + scoreClass(p.niche_relevance) + '">' + (p.niche_relevance || '?') + '</div><div class="label">Niche</div></div>' +
        '<span class="badge ' + (p.recommendation || '').toLowerCase() + '">' + (p.recommendation || '?') + '</span>' +
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

const pendingReviews = {};
let lastReviewUsername = null;

function submitReview(profileId, username, decision) {
  const reasonEl = document.getElementById('reason-' + username);
  const reason = reasonEl ? reasonEl.value : '';
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
        body: JSON.stringify({ profile_id: profileId, profile_username: username, decision, human_reasoning: reason })
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
      <div class="stats">
        <span>Queued: <strong id="stat-queued">-</strong></span>
        <span style="color:#007aff">Contacted: <strong id="stat-contacted">-</strong></span>
        <span class="approved">Replied: <strong id="stat-replied">-</strong></span>
        <span style="color:#34c759;font-weight:600">Confirmed: <strong id="stat-confirmed">-</strong></span>
      </div>
    </div>
  </div>

  <div class="progress-wrap"><div class="progress-bar" id="progress-bar"></div></div>

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
  </div>

  <div class="container" id="outreach-list"></div>
  <div class="toast" id="toast"></div>

  <div class="kb-legend">
    <div class="kb"><kbd>E</kbd> Send Email</div>
    <div class="kb"><kbd>C</kbd> Copy + Open DM</div>
    <div class="kb"><kbd>J</kbd> Next</div>
    <div class="kb"><kbd>K</kbd> Prev</div>
  </div>

<script>
let currentFilter = 'all';
let allOutreach = [];
let focusedIndex = 0;

async function loadStats() {
  const res = await fetch('/api/outreach/stats');
  const s = await res.json();
  document.getElementById('stat-queued').textContent = s.queued;
  document.getElementById('stat-contacted').textContent = s.contacted;
  document.getElementById('stat-replied').textContent = s.replied;
  document.getElementById('stat-confirmed').textContent = s.confirmed;
  const pct = s.total > 0 ? Math.round(((s.contacted + s.replied + s.negotiating + s.confirmed + s.declined + s.no_response) / s.total) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
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
  const res = await fetch('/api/outreach?filter=' + currentFilter);
  allOutreach = await res.json();
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

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

function renderOutreachCard(o) {
  const p = o.profile || {};
  const igUrl = 'https://www.instagram.com/' + o.profile_username + '/';
  const dmUrl = 'https://ig.me/m/' + o.profile_username;
  const tierClass = o.priority_tier === 'TIER_1' ? 'tier-1' : o.priority_tier === 'TIER_3' ? 'tier-3' : 'tier-2';
  const days = daysSince(o.contacted_at);
  const needsFollowUp = o.status === 'CONTACTED' && days !== null && days >= 7;

  // Parse email data from notes
  let emailData = {};
  try { emailData = JSON.parse(o.notes || '{}'); } catch(e) {}

  const tierDescriptions = {
    'TIER_1': 'Strong art educator/creator, high scores, speaks English, creates video content. Perfect UGC fit.',
    'TIER_2': 'Good creator but missing something — doesn\\'t talk in videos, lower engagement, or unclear language.',
    'TIER_3': 'Approved but lower potential for video UGC specifically.'
  };

  const statusLabels = {
    'QUEUED': 'Queued', 'CONTACTED': 'Contacted', 'FOLLOW_UP_1': 'Follow-up 1',
    'FOLLOW_UP_2': 'Follow-up 2', 'REPLIED': 'Replied', 'NEGOTIATING': 'Negotiating',
    'CONFIRMED': 'Confirmed', 'DECLINED': 'Declined', 'NO_RESPONSE': 'No Response'
  };

  const allStatuses = ['QUEUED', 'CONTACTED', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'REPLIED', 'NEGOTIATING', 'CONFIRMED', 'DECLINED', 'NO_RESPONSE'];

  // Status dropdown (always shown)
  const statusDropdown = '<select class="status-dropdown" onchange="changeStatus(\\'' + o.profile_username + '\\', this.value)" data-username="' + o.profile_username + '">' +
    allStatuses.map(s => '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + (statusLabels[s] || s) + '</option>').join('') +
    '</select>';

  // Contact timeline
  let timelineHtml = '';
  const timelineEvents = [];
  if (o.created_at) timelineEvents.push({ label: 'Created', date: o.created_at });
  if (o.contacted_at) timelineEvents.push({ label: 'Contacted', date: o.contacted_at });
  if (o.follow_up_1_at) timelineEvents.push({ label: 'Follow-up 1', date: o.follow_up_1_at });
  if (o.follow_up_2_at) timelineEvents.push({ label: 'Follow-up 2', date: o.follow_up_2_at });
  if (o.replied_at) timelineEvents.push({ label: 'Replied', date: o.replied_at });
  if (timelineEvents.length > 0) {
    timelineHtml = '<div class="contact-timeline">' +
      timelineEvents.map(e => '<div class="timeline-event"><span class="timeline-label">' + e.label + '</span><span class="timeline-date">' + formatDate(e.date) + '</span></div>').join('') +
    '</div>';
  }

  // Action buttons — always show both DM and Email when email exists
  let contactBtns = '';
  if (o.status === 'QUEUED' || o.status === 'CONTACTED' || o.status === 'FOLLOW_UP_1' || o.status === 'FOLLOW_UP_2') {
    contactBtns = '<div class="outreach-btns">' +
      '<button class="btn btn-dm" onclick="copyAndOpenDM(\\'' + o.profile_username + '\\')">Copy + Open DM</button>' +
      (o.contact_email ?
        '<button class="btn btn-email" onclick="sendEmail(\\'' + o.profile_username + '\\', \\'' + escapeHtml(o.contact_email) + '\\')">Send Email</button>' : '') +
      '<button class="btn btn-reply" onclick="logReply(\\'' + o.profile_username + '\\')">Log Reply</button>' +
    '</div>';
  } else {
    contactBtns = '<div class="outreach-btns">' +
      '<button class="btn btn-reply" onclick="logReply(\\'' + o.profile_username + '\\')">Log Reply</button>' +
      '<button class="btn btn-dm" onclick="copyAndOpenDM(\\'' + o.profile_username + '\\')">Copy + Open DM</button>' +
    '</div>';
  }

  // Message section — editable for QUEUED, shown as sent for others
  let messageHtml = '';
  if (o.status === 'QUEUED') {
    messageHtml = '<div class="message-edit">' +
      '<div class="section-label">Message</div>' +
      '<textarea id="msg-' + o.profile_username + '" class="outreach-msg">' + escapeHtml(o.message_sent || '') + '</textarea>' +
    '</div>';
  } else if (o.message_sent) {
    messageHtml = '<div class="section"><div class="section-label">Message Sent</div><div class="reasoning">' + escapeHtml(o.message_sent) + '</div></div>';
  }

  // Status bar with days ago + follow-up badge
  let statusInfoHtml = '';
  if (o.status !== 'QUEUED') {
    statusInfoHtml = '<div class="outreach-status-bar">' +
      (days !== null ? '<span class="days-ago">' + days + ' days since contact</span>' : '') +
      (needsFollowUp ? '<span class="follow-up-badge">Needs follow-up</span>' : '') +
      (o.reply_summary ? '<span class="reply-text">' + escapeHtml(o.reply_summary) + '</span>' : '') +
    '</div>';
  }

  return '<div class="card' + (needsFollowUp ? ' follow-up-highlight' : '') + '" data-username="' + o.profile_username + '" id="card-' + o.profile_username + '">' +
    '<div class="card-header">' +
      '<div>' +
        '<div class="username"><a href="' + igUrl + '" target="_blank">@' + o.profile_username + '</a></div>' +
        '<div class="meta">' +
          '<span class="meta-pill highlight">' + formatNumber(p.followers) + ' followers</span>' +
          '<span class="meta-pill">' + (p.engagement_rate || 0) + '% eng</span>' +
          '<span class="meta-pill ' + tierClass + '" title="' + (tierDescriptions[o.priority_tier] || '') + '">' + o.priority_tier + '</span>' +
          '<span class="meta-pill">' + (o.contact_method || 'DM') + '</span>' +
          (o.contact_email ? '<span class="meta-pill">' + escapeHtml(o.contact_email) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="score-badges">' +
        statusDropdown +
        '<div class="score-badge"><div class="score ' + (p.profile_score >= 7 ? 'high' : p.profile_score >= 4 ? 'medium' : 'low') + '">' + (p.profile_score || '?') + '</div><div class="label">Score</div></div>' +
        (p.overall_ugc_score ? '<div class="score-badge"><div class="score ' + (p.overall_ugc_score >= 7 ? 'high' : p.overall_ugc_score >= 4 ? 'medium' : 'low') + '">' + p.overall_ugc_score + '</div><div class="label">UGC</div></div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="card-body no-reels">' +
      '<div class="info-col">' +
        '<div class="section"><div class="section-label">Bio</div><div class="bio">' + escapeHtml(p.bio) + '</div></div>' +
        messageHtml +
        timelineHtml +
      '</div>' +
    '</div>' +
    '<div class="outreach-actions">' +
      statusInfoHtml +
      contactBtns +
    '</div>' +
  '</div>';
}

async function copyAndOpenDM(username) {
  const msgEl = document.getElementById('msg-' + username);
  const msg = msgEl ? msgEl.value : '';

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

  // Open Instagram DM directly (ig.me/m/ links open the DM thread)
  window.open('https://ig.me/m/' + username, '_blank');
}

async function changeStatus(username, newStatus) {
  const record = allOutreach.find(o => o.profile_username === username);
  const msgEl = document.getElementById('msg-' + username);
  const msg = msgEl ? msgEl.value : (record ? record.message_sent : '');

  if (newStatus === 'CONTACTED' && record && record.status === 'QUEUED') {
    // When moving to CONTACTED, save the message
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
  showToast('@' + username + ' → ' + newStatus, 'success');
  loadOutreach();
  loadStats();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return month + ' ' + day + ', ' + time;
}

async function sendEmail(username, email) {
  const msgEl = document.getElementById('msg-' + username);
  const msg = msgEl ? msgEl.value : '';

  // Get email subject/body from the outreach record notes
  const record = allOutreach.find(o => o.profile_username === username);
  let emailData = {};
  try { emailData = JSON.parse(record?.notes || '{}'); } catch(e) {}

  const subject = emailData.email_subject || 'Quick question about a paid collab';
  const body = emailData.email_body || msg;

  try {
    const res = await fetch('/api/outreach/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_username: username, subject, body, to_email: email })
    });
    const data = await res.json();
    if (data.error) {
      showToast('Email error: ' + data.error, 'error');
      return;
    }
    showToast('Email sent to ' + email, 'success');
    loadOutreach();
    loadStats();
  } catch(e) {
    showToast('Failed to send email', 'error');
  }
}

async function logReply(username) {
  const reply = prompt('What did they say? (brief summary)');
  if (!reply) return;
  await fetch('/api/outreach/save-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_username: username, reply_summary: reply })
  });
  showToast('Reply logged for @' + username, 'success');
  loadOutreach();
  loadStats();
}

// updateStatus kept as alias for backward compat
async function updateStatus(username, status) {
  return changeStatus(username, status);
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
});

loadStats();
loadOutreach();
</script>
</body>
</html>`;
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log('Review UI running at http://localhost:' + PORT);
  console.log('Outreach UI at http://localhost:' + PORT + '/outreach');
});
