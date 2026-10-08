/* =============================================================================
   app.js | Youth Volunteer Digital Platform | Application orchestration module
   -----------------------------------------------------------------------------
   Loaded as <script type="module"> by both index.html and admin.html. The page
   is identified by <body data-page="home|admin">.

   Contents
     1. Configuration and shared state
     2. Safety helpers: esc(), safeUrl(), toast(), text utilities
     3. Supabase client with crash-proof wrappers
     4. Profile resolution and login policy
     5. Public portal: settings, telemetry, ideas box, story stream, login
     6. Admin console: guard, analytics, volunteers table, CSV, settings, editor
     7. Boot

   SECURITY MODEL
     Everything in this file runs in the visitor's browser and can be modified by
     them. It is therefore a usability layer. Authorization is enforced by
     Row-Level Security and triggers in schema.sql.
   ============================================================================= */


/* 1. CONFIGURATION AND SHARED STATE ---------------------------------------- */

const CONFIG = Object.freeze({
  // Project URL and PUBLISHABLE anon key from Supabase -> Project Settings -> API.
  // The anon key is designed to be public; never put a service_role key here.
  SUPABASE_URL: 'https://kwsyyrogrebxwnqfaxez.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3c3l5cm9ncmVieHducWZheGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0ODU2NTIsImV4cCI6MjEwNzA2MTY1Mn0.O2AP2bBj6aRyAQqG6X3Ii42NehDyXlxN5x8D7VqH61Q',

  // Hard-wired bootstrap administrator (mirrors bootstrap_admin_email() in schema.sql).
  ADMIN_EMAIL: 'soulaimanmwamini0@gmail.com',

  // ES module build of supabase-js, imported lazily so a network failure cannot crash the page.
  SDK_URL: 'https://esm.sh/@supabase/supabase-js@2',

  LOGIN_PAGE: 'index.html#join',
  ADMIN_PAGE: 'admin.html',
  SETTING_KEYS: ['hero_title', 'hero_subtitle', 'mission', 'contact_email', 'footer_text'],
});

const state = {
  client: null,
  profile: null,
  volunteers: [],
  posts: [],
  ideas: [],
};

const $ = (id) => document.getElementById(id);

function isConfigured() {
  return !/YOUR-/i.test(CONFIG.SUPABASE_URL) && !/YOUR-/i.test(CONFIG.SUPABASE_ANON_KEY);
}

function isBootstrapEmail(email) {
  return String(email || '').trim().toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase();
}


/* 2. SAFETY HELPERS --------------------------------------------------------- */

/**
 * esc(v): HTML-escape any value before it is placed into innerHTML or an
 * attribute. Escapes & < > " ' ` / and "=", so it is safe in text and quoted
 * attribute contexts. null and undefined become an empty string.
 */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .replace(/\//g, '&#47;')
    .replace(/=/g, '&#61;');
}

/** Returns the URL only when it is a well-formed http(s) URL, otherwise ''. */
function safeUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch (_err) {
    return '';
  }
}

/** Extracts a YouTube video id from the common URL shapes; '' if not YouTube. */
function youtubeId(value) {
  const href = safeUrl(value);
  if (!href) return '';
  const u = new URL(href);
  const host = u.hostname.replace(/^www\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
    else if (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] || '';
  }
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : '';
}

/** Escaped text with line breaks preserved. */
function multiline(v) {
  return esc(v).replace(/\r?\n/g, '<br>');
}

/** Builds the media block (image and/or video) for a story, fully sanitized. */
function mediaHtml(imageUrl, videoUrl, title) {
  const video = safeUrl(videoUrl);
  const image = safeUrl(imageUrl);
  const yt = youtubeId(video);
  if (yt) {
    return `<iframe class="story-media" src="https://www.youtube-nocookie.com/embed/${esc(yt)}" title="${esc(title)} (video)" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }
  if (video && /\.(mp4|webm|ogg)(\?.*)?$/i.test(video)) {
    return `<video class="story-media" src="${esc(video)}" controls preload="metadata"${image ? ` poster="${esc(image)}"` : ''}></video>`;
  }
  if (image) {
    return `<img class="story-media" src="${esc(image)}" alt="${esc(title)}" loading="lazy" referrerpolicy="no-referrer">`;
  }
  return '';
}

/** Short pop-up message. kind: info | success | error. */
function toast(message, kind = 'info') {
  const stack = $('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' toast--error' : kind === 'success' ? ' toast--success' : ''}`;
  el.textContent = String(message);
  stack.appendChild(el);
  window.setTimeout(() => el.remove(), 4500);
}

/** Writes an alert box into a container using safe text insertion. */
function setMessage(containerId, message, kind) {
  const box = $(containerId);
  if (!box) return;
  box.textContent = '';
  if (!message) return;
  const div = document.createElement('div');
  div.className = `alert alert--${kind || 'info'}`;
  div.textContent = message;
  box.appendChild(div);
}

function setText(id, value) {
  const el = $(id);
  if (el && value !== undefined && value !== null && String(value) !== '') el.textContent = String(value);
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()) && String(v).length <= 254;
}

/** Animated integer counter that respects reduced-motion preferences. */
function animateCount(id, target) {
  const el = $(id);
  if (!el) return;
  const end = Number(target) || 0;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || end === 0) { el.textContent = String(end); return; }
  const start = performance.now();
  const duration = 900;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = String(Math.round(end * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}


/* 3. SUPABASE CLIENT -------------------------------------------------------- */

function showConfigBanner() {
  const b = $('config-banner');
  if (b) b.hidden = false;
}

/**
 * Returns the shared Supabase client, or null when the project is not
 * configured or the SDK cannot be loaded. Callers must handle null; nothing in
 * this file throws on a missing backend.
 */
async function getClient() {
  if (state.client) return state.client;
  if (!isConfigured()) { showConfigBanner(); return null; }
  try {
    const mod = await import(CONFIG.SDK_URL);
    state.client = mod.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    return state.client;
  } catch (err) {
    console.error('Supabase SDK failed to load:', err);
    showConfigBanner();
    toast('Could not reach the backend. Please try again later.', 'error');
    return null;
  }
}

/** Runs an async function and converts any thrown error into {data:null,error}. */
async function safe(fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
}


/* 4. PROFILE RESOLUTION AND LOGIN POLICY ------------------------------------ */

/**
 * Finds the volunteers row for an authenticated user. First asks the server to
 * link or bootstrap the profile (claim_profile), then falls back to a plain read.
 */
async function resolveProfile(client, user) {
  const claimed = await safe(() => client.rpc('claim_profile'));
  if (!claimed.error && claimed.data && claimed.data.id) return claimed.data;

  const read = await safe(() => client.from('volunteers').select('*').eq('auth_uid', user.id).maybeSingle());
  if (!read.error && read.data) return read.data;
  return null;
}

/**
 * Login decision. Returns { ok, destination, reason, profile }.
 *   - The bootstrap e-mail is always treated as an active admin and is sent to
 *     the admin console (the database enforces this too).
 *   - Missing, pending and suspended profiles are rejected.
 */
function evaluateLogin(user, profile) {
  if (isBootstrapEmail(user && user.email)) {
    return {
      ok: true,
      destination: CONFIG.ADMIN_PAGE,
      profile: Object.assign({}, profile || {}, { role: 'admin', status: 'active', email: user.email }),
    };
  }
  if (!profile) {
    return { ok: false, reason: 'Your account has not been approved yet. Please contact an administrator.' };
  }
  if (profile.status === 'suspended') {
    return { ok: false, reason: 'This account is suspended. Please contact an administrator.' };
  }
  if (profile.status !== 'active') {
    return { ok: false, reason: 'Your account is awaiting approval by an administrator.' };
  }
  return {
    ok: true,
    destination: profile.role === 'admin' ? CONFIG.ADMIN_PAGE : null,
    profile,
  };
}

async function signOutAndGo(client, target) {
  await safe(() => client.auth.signOut());
  if (target) window.location.href = target; else window.location.reload();
}


/* 5. PUBLIC PORTAL ---------------------------------------------------------- */

async function loadPublicSettings(client) {
  const res = await safe(() => client.from('site_settings').select('key,value').in('key', CONFIG.SETTING_KEYS));
  if (res.error || !Array.isArray(res.data)) return;
  const map = {};
  res.data.forEach((row) => { map[row.key] = row.value; });
  setText('hero-title', map.hero_title);
  setText('hero-subtitle', map.hero_subtitle);
  setText('mission-text', map.mission);
  setText('contact-email', map.contact_email);
  setText('footer-text', map.footer_text);
}

async function loadPublicStats(client) {
  const res = await safe(() => client.rpc('get_public_stats'));
  if (res.error || res.data === null || res.data === undefined) return;
  let stats = res.data;
  if (typeof stats === 'string') {
    try { stats = JSON.parse(stats); } catch (_e) { return; }
  }
  animateCount('stat-active', stats.active_volunteers);
  animateCount('stat-total', stats.total_volunteers);
  animateCount('stat-posts', stats.published_posts);
  animateCount('stat-ideas', stats.ideas_received);
}

async function loadStoryStream(client) {
  const box = $('story-stream');
  if (!box) return;
  const res = await safe(() => client.from('posts')
    .select('id,title,body,image_url,video_url,created_at')
    .eq('published', true).order('created_at', { ascending: false }).limit(12));
  if (res.error || !Array.isArray(res.data)) {
    box.innerHTML = '<div class="empty-state">Stories are unavailable right now.</div>';
    return;
  }
  if (res.data.length === 0) {
    box.innerHTML = '<div class="empty-state">No stories yet. Check back soon.</div>';
    return;
  }
  box.innerHTML = res.data.map((p) => {
    const excerpt = String(p.body || '').length > 320 ? `${String(p.body).slice(0, 320)}...` : p.body;
    return `<article class="card story">
      ${mediaHtml(p.image_url, p.video_url, p.title)}
      <div class="story-body">
        <div class="card-meta">${esc(formatDate(p.created_at))}</div>
        <h3>${esc(p.title)}</h3>
        <p>${multiline(excerpt)}</p>
      </div>
    </article>`;
  }).join('');
}

function initIdeaForm() {
  const form = $('idea-form');
  if (!form) return;
  const message = $('idea-message');
  const counter = $('idea-count');
  message.addEventListener('input', () => { counter.textContent = String(message.value.length); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setMessage('idea-msg', '');
    if ($('idea-website').value) return; // honeypot tripped: silently drop

    const name = $('idea-name').value.trim() || 'Anonymous';
    const email = $('idea-email').value.trim();
    const text = message.value.trim();

    if (text.length < 5) { setMessage('idea-msg', 'Please write at least 5 characters.', 'error'); return; }
    if (text.length > 2000) { setMessage('idea-msg', 'Please keep your idea under 2000 characters.', 'error'); return; }
    if (email && !isValidEmail(email)) { setMessage('idea-msg', 'That e-mail address does not look right.', 'error'); return; }

    const client = await getClient();
    if (!client) { setMessage('idea-msg', 'The ideas box is offline right now.', 'error'); return; }

    const btn = $('idea-submit');
    btn.disabled = true;
    const res = await safe(() => client.from('ideas').insert({ name: name.slice(0, 120), email, message: text }));
    btn.disabled = false;

    if (res.error) {
      setMessage('idea-msg', 'We could not save your idea. Please try again.', 'error');
      return;
    }
    form.reset();
    counter.textContent = '0';
    setMessage('idea-msg', 'Thank you! Your idea has been received.', 'success');
  });
}

function showMemberPanel(profile) {
  const form = $('login-form');
  const panel = $('member-panel');
  if (form) form.hidden = true;
  if (panel) panel.hidden = false;
  setText('member-name', profile.full_name || profile.email || 'volunteer');
  const link = $('member-admin-link');
  if (link) link.hidden = profile.role !== 'admin';
}

function initLoginForm() {
  const form = $('login-form');
  if (!form) return;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setMessage('login-msg', '');
    const email = $('login-email').value.trim();
    const password = $('login-password').value;

    if (!isValidEmail(email)) { setMessage('login-msg', 'Enter a valid e-mail address.', 'error'); return; }
    if (password.length < 6) { setMessage('login-msg', 'Enter your password.', 'error'); return; }

    const client = await getClient();
    if (!client) { setMessage('login-msg', 'Login is unavailable until the backend is configured.', 'error'); return; }

    const btn = $('login-submit');
    btn.disabled = true;
    const auth = await safe(() => client.auth.signInWithPassword({ email, password }));

    if (auth.error || !auth.data || !auth.data.user) {
      btn.disabled = false;
      // A single generic message avoids revealing which e-mails exist.
      setMessage('login-msg', 'Incorrect e-mail or password, or the account has not been approved.', 'error');
      return;
    }

    const user = auth.data.user;
    const profile = await resolveProfile(client, user);
    const verdict = evaluateLogin(user, profile);

    if (!verdict.ok) {
      await safe(() => client.auth.signOut());
      btn.disabled = false;
      setMessage('login-msg', verdict.reason, 'error');
      return;
    }

    btn.disabled = false;
    form.reset();
    if (verdict.destination) {
      window.location.href = verdict.destination;
      return;
    }
    showMemberPanel(verdict.profile);
    toast('Signed in successfully.', 'success');
  });

  const logout = $('logout-btn');
  if (logout) {
    logout.addEventListener('click', async () => {
      const client = await getClient();
      if (client) await signOutAndGo(client, null);
    });
  }
}

/** If a valid active session already exists, show the member panel directly. */
async function restoreMemberSession(client) {
  const sess = await safe(() => client.auth.getSession());
  const user = sess.data && sess.data.session ? sess.data.session.user : null;
  if (!user) return;
  const profile = await resolveProfile(client, user);
  const verdict = evaluateLogin(user, profile);
  if (verdict.ok) showMemberPanel(verdict.profile);
}

function initNav() {
  const toggle = $('nav-toggle');
  const links = $('nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', (ev) => {
    if (ev.target.closest('a')) {
      links.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

async function bootHome() {
  initNav();
  initIdeaForm();
  initLoginForm();
  const client = await getClient();
  if (!client) {
    const stories = $('story-stream');
    if (stories) stories.innerHTML = '<div class="empty-state">Stories will appear here once the site is connected.</div>';
    return;
  }
  await Promise.all([loadPublicSettings(client), loadPublicStats(client), loadStoryStream(client)]);
  await restoreMemberSession(client);
}


/* 6. ADMIN CONSOLE ---------------------------------------------------------- */

function guardDeny(title, text, showLogin) {
  const spinner = $('guard-spinner');
  if (spinner) spinner.hidden = true;
  setText('guard-title', title);
  setText('guard-text', text);
  const link = $('guard-link');
  if (link) { link.hidden = !showLogin; link.href = CONFIG.LOGIN_PAGE; }
}

/** Client-side authentication guard. Returns the admin profile or null. */
async function adminGuard(client) {
  const sess = await safe(() => client.auth.getSession());
  const user = sess.data && sess.data.session ? sess.data.session.user : null;
  if (!user) {
    guardDeny('Sign in required', 'This console is only for administrators.', true);
    return null;
  }

  const profile = await resolveProfile(client, user);
  const verdict = evaluateLogin(user, profile);

  if (!verdict.ok) {
    await safe(() => client.auth.signOut());
    guardDeny('Access denied', verdict.reason, true);
    return null;
  }

  // Do not trust the client-side verdict alone: the server must also report an
  // active admin, otherwise every protected query would fail anyway.
  const check = await safe(() => client.rpc('is_admin'));
  if (check.error || check.data !== true) {
    guardDeny('Access denied', 'Your account does not have administrator rights.', true);
    return null;
  }
  return verdict.profile;
}

/* ---- 6.1 Analytics ---- */

function countBy(rows, field, values) {
  const out = {};
  values.forEach((v) => { out[v] = 0; });
  rows.forEach((r) => { if (r[field] in out) out[r[field]] += 1; });
  return out;
}

/** Builds a conic-gradient string from [{color, value}] segments. */
function conic(segments) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return 'conic-gradient(var(--gray-200) 0 100%)';
  let acc = 0;
  const stops = segments.filter((s) => s.value > 0).map((s) => {
    const from = (acc / total) * 100;
    acc += s.value;
    const to = (acc / total) * 100;
    return `${s.color} ${from.toFixed(2)}% ${to.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function renderAnalytics() {
  const rows = state.volunteers;
  const byStatus = countBy(rows, 'status', ['active', 'pending', 'suspended']);
  const byRole = countBy(rows, 'role', ['admin', 'volunteer']);

  setText('kpi-total', rows.length);
  $('kpi-total').textContent = String(rows.length);
  $('kpi-active').textContent = String(byStatus.active);
  $('kpi-pending').textContent = String(byStatus.pending);
  $('kpi-suspended').textContent = String(byStatus.suspended);
  $('lg-active').textContent = String(byStatus.active);
  $('lg-pending').textContent = String(byStatus.pending);
  $('lg-suspended').textContent = String(byStatus.suspended);
  $('lg-admin').textContent = String(byRole.admin);
  $('lg-volunteer').textContent = String(byRole.volunteer);

  const ds = $('donut-status');
  ds.style.setProperty('--donut', conic([
    { color: 'var(--success)', value: byStatus.active },
    { color: '#d97706', value: byStatus.pending },
    { color: 'var(--crimson)', value: byStatus.suspended },
  ]));
  ds.setAttribute('data-center', String(rows.length));
  ds.setAttribute('aria-label', `Accounts by status: ${byStatus.active} active, ${byStatus.pending} pending, ${byStatus.suspended} suspended`);

  const dr = $('donut-role');
  dr.style.setProperty('--donut', conic([
    { color: 'var(--navy)', value: byRole.admin },
    { color: 'var(--gray-400)', value: byRole.volunteer },
  ]));
  dr.setAttribute('data-center', String(rows.length));
  dr.setAttribute('aria-label', `Accounts by role: ${byRole.admin} admins, ${byRole.volunteer} volunteers`);
}

/* ---- 6.2 Volunteers table: search, filter, sort ---- */

/**
 * Multi-column matrix search. The query is split into whitespace-separated
 * tokens; a row matches when EVERY token is found in at least one searchable
 * column (name, e-mail, phone, role, status, created date).
 */
function searchHaystack(v) {
  return [v.full_name, v.email, v.phone, v.role, v.status, formatDate(v.created_at)]
    .map((c) => String(c || '').toLowerCase());
}

function getVisibleVolunteers() {
  const query = ($('vol-search').value || '').toLowerCase().trim();
  const tokens = query ? query.split(/\s+/) : [];
  const filter = $('vol-filter').value;
  const sort = $('vol-sort').value;

  const rows = state.volunteers.filter((v) => {
    if (filter !== 'all' && v.status !== filter) return false;
    if (tokens.length === 0) return true;
    const cells = searchHaystack(v);
    return tokens.every((tok) => cells.some((cell) => cell.includes(tok)));
  });

  const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
  rows.sort((a, b) => {
    switch (sort) {
      case 'created_asc': return String(a.created_at).localeCompare(String(b.created_at));
      case 'name_asc':    return cmpText(a.full_name, b.full_name);
      case 'email_asc':   return cmpText(a.email, b.email);
      default:            return String(b.created_at).localeCompare(String(a.created_at));
    }
  });
  return rows;
}

function actionButtons(v) {
  // The bootstrap administrator is locked: no buttons are offered.
  if (isBootstrapEmail(v.email)) return '<span class="text-muted">Protected</span>';
  const id = esc(v.id);
  const btns = [];
  if (v.status !== 'active')    btns.push(`<button class="btn btn--navy btn--sm" type="button" data-action="approve" data-id="${id}">Approve</button>`);
  if (v.status !== 'suspended') btns.push(`<button class="btn btn--ghost btn--sm" type="button" data-action="suspend" data-id="${id}">Suspend</button>`);
  if (v.role !== 'admin')       btns.push(`<button class="btn btn--primary btn--sm" type="button" data-action="make_admin" data-id="${id}">Make admin</button>`);
  else                          btns.push(`<button class="btn btn--ghost btn--sm" type="button" data-action="make_volunteer" data-id="${id}">Remove admin</button>`);
  btns.push(`<button class="btn btn--ghost btn--sm" type="button" data-action="delete" data-id="${id}">Delete</button>`);
  return `<div class="row-actions">${btns.join('')}</div>`;
}

function renderVolunteers() {
  const rows = getVisibleVolunteers();
  const body = $('vol-body');
  $('vol-count').textContent = `${rows.length} of ${state.volunteers.length} volunteers shown`;

  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="7">No volunteers match your search.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((v) => `<tr>
    <td>${esc(v.full_name) || '<span class="text-muted">(no name)</span>'}</td>
    <td>${esc(v.email)}</td>
    <td>${esc(v.phone)}</td>
    <td><span class="badge role-${esc(v.role)}">${esc(v.role)}</span></td>
    <td><span class="badge status-${esc(v.status)}">${esc(v.status)}</span></td>
    <td>${esc(formatDate(v.created_at))}</td>
    <td>${actionButtons(v)}</td>
  </tr>`).join('');
}

async function loadVolunteers(client) {
  const res = await safe(() => client.from('volunteers').select('*').order('created_at', { ascending: false }));
  if (res.error || !Array.isArray(res.data)) {
    toast('Could not load volunteers.', 'error');
    return;
  }
  state.volunteers = res.data;
  renderAnalytics();
  renderVolunteers();
}

async function applyVolunteerAction(client, action, id) {
  const target = state.volunteers.find((v) => v.id === id);
  if (!target) return;
  if (isBootstrapEmail(target.email)) { toast('The bootstrap administrator is protected.', 'error'); return; }

  const label = target.full_name || target.email;
  let patch = null;
  let confirmText = '';

  switch (action) {
    case 'approve':        patch = { status: 'active' }; break;
    case 'suspend':        patch = { status: 'suspended' }; confirmText = `Suspend ${label}? They will lose access.`; break;
    case 'make_admin':     patch = { role: 'admin', status: 'active' }; confirmText = `Give ${label} full administrator rights?`; break;
    case 'make_volunteer': patch = { role: 'volunteer' }; confirmText = `Remove administrator rights from ${label}?`; break;
    case 'delete':         confirmText = `Permanently delete the profile for ${label}? This cannot be undone.`; break;
    default: return;
  }
  if (confirmText && !window.confirm(confirmText)) return;

  const res = action === 'delete'
    ? await safe(() => client.from('volunteers').delete().eq('id', id))
    : await safe(() => client.from('volunteers').update(patch).eq('id', id));

  if (res.error) { toast('That change was not allowed or failed.', 'error'); return; }
  toast('Volunteer updated.', 'success');
  await loadVolunteers(client);
}

function initVolunteerTable(client) {
  ['vol-search', 'vol-filter', 'vol-sort'].forEach((id) => {
    $(id).addEventListener('input', renderVolunteers);
    $(id).addEventListener('change', renderVolunteers);
  });
  $('vol-body').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    applyVolunteerAction(client, btn.getAttribute('data-action'), btn.getAttribute('data-id'));
  });
  $('export-csv').addEventListener('click', exportCsv);

  $('create-vol-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setMessage('cv-msg', '');
    const full_name = $('cv-name').value.trim();
    const email = $('cv-email').value.trim().toLowerCase();
    const phone = $('cv-phone').value.trim();
    const role = $('cv-role').value === 'admin' ? 'admin' : 'volunteer';

    if (full_name.length < 2) { setMessage('cv-msg', 'Enter the volunteer\'s full name.', 'error'); return; }
    if (!isValidEmail(email)) { setMessage('cv-msg', 'Enter a valid e-mail address.', 'error'); return; }
    if (state.volunteers.some((v) => String(v.email).toLowerCase() === email)) {
      setMessage('cv-msg', 'A profile with that e-mail already exists.', 'error');
      return;
    }

    const res = await safe(() => client.from('volunteers').insert({ full_name, email, phone, role, status: 'active' }));
    if (res.error) { setMessage('cv-msg', 'Could not create the profile. Check the details and try again.', 'error'); return; }

    ev.target.reset();
    setMessage('cv-msg', `Profile created for ${email}. Now add the same e-mail under Supabase Authentication > Users so they can sign in.`, 'success');
    await loadVolunteers(client);
  });
}

/* ---- 6.3 CSV export ---- */

/**
 * RFC 4180 quoting plus spreadsheet formula-injection protection: a cell that
 * starts with = + - @ tab or CR is prefixed with an apostrophe.
 */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const rows = getVisibleVolunteers();
  if (rows.length === 0) { toast('Nothing to export.', 'error'); return; }
  const header = ['id', 'full_name', 'email', 'phone', 'role', 'status', 'created_at'];
  const lines = [header.map(csvCell).join(',')];
  rows.forEach((v) => lines.push(header.map((k) => csvCell(v[k])).join(',')));

  // Leading BOM makes Excel open the file as UTF-8.
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `volunteers-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${rows.length} rows.`, 'success');
}

/* ---- 6.4 Site content settings ---- */

async function loadSettingsForm(client) {
  const res = await safe(() => client.from('site_settings').select('key,value'));
  if (res.error || !Array.isArray(res.data)) return;
  const map = {};
  res.data.forEach((r) => { map[r.key] = r.value; });
  document.querySelectorAll('#settings-form [data-key]').forEach((input) => {
    input.value = map[input.getAttribute('data-key')] || '';
  });
}

function initSettingsForm(client) {
  $('settings-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setMessage('settings-msg', '');
    const rows = [];
    document.querySelectorAll('#settings-form [data-key]').forEach((input) => {
      rows.push({ key: input.getAttribute('data-key'), value: input.value.trim(), updated_at: new Date().toISOString() });
    });
    const contact = rows.find((r) => r.key === 'contact_email');
    if (contact && contact.value && !isValidEmail(contact.value)) {
      setMessage('settings-msg', 'The contact e-mail is not valid.', 'error');
      return;
    }
    const res = await safe(() => client.from('site_settings').upsert(rows, { onConflict: 'key' }));
    if (res.error) { setMessage('settings-msg', 'Could not save the settings.', 'error'); return; }
    setMessage('settings-msg', 'Site content saved. The public page will show it on next load.', 'success');
  });
}

/* ---- 6.5 Multimedia story editor ---- */

function renderPostPreview() {
  const title = $('post-title').value.trim();
  const body = $('post-body').value;
  const media = mediaHtml($('post-image').value, $('post-video').value, title || 'Story');
  const box = $('post-preview');
  if (!title && !body && !media) {
    box.innerHTML = '<p class="text-muted mb-0">Start typing to see a preview.</p>';
    return;
  }
  box.innerHTML = `<article class="story">${media}<div class="story-body"><h3>${esc(title || 'Untitled')}</h3><p>${multiline(body)}</p></div></article>`;
}

function resetPostForm() {
  $('post-form').reset();
  $('post-id').value = '';
  $('post-save').textContent = 'Save story';
  setMessage('post-msg', '');
  renderPostPreview();
}

function renderPostList() {
  const box = $('post-list');
  if (state.posts.length === 0) {
    box.innerHTML = '<p class="text-muted">No stories yet.</p>';
    return;
  }
  box.innerHTML = state.posts.map((p) => `<div class="post-item">
    <div>
      <strong>${esc(p.title)}</strong>
      <small>${esc(formatDate(p.created_at))} &middot; ${p.published ? 'Published' : 'Draft'}</small>
    </div>
    <div class="row-actions">
      <button class="btn btn--ghost btn--sm" type="button" data-post-action="edit" data-id="${esc(p.id)}">Edit</button>
      <button class="btn btn--ghost btn--sm" type="button" data-post-action="toggle" data-id="${esc(p.id)}">${p.published ? 'Unpublish' : 'Publish'}</button>
      <button class="btn btn--ghost btn--sm" type="button" data-post-action="delete" data-id="${esc(p.id)}">Delete</button>
    </div>
  </div>`).join('');
}

async function loadPosts(client) {
  const res = await safe(() => client.from('posts').select('*').order('created_at', { ascending: false }));
  if (res.error || !Array.isArray(res.data)) { toast('Could not load stories.', 'error'); return; }
  state.posts = res.data;
  renderPostList();
}

function initPostEditor(client) {
  ['post-title', 'post-body', 'post-image', 'post-video'].forEach((id) => $(id).addEventListener('input', renderPostPreview));
  $('post-reset').addEventListener('click', resetPostForm);

  $('post-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setMessage('post-msg', '');
    const id = $('post-id').value;
    const title = $('post-title').value.trim();
    const body = $('post-body').value.trim();
    const imageRaw = $('post-image').value.trim();
    const videoRaw = $('post-video').value.trim();
    const image_url = imageRaw ? safeUrl(imageRaw) : '';
    const video_url = videoRaw ? safeUrl(videoRaw) : '';

    if (title.length < 3 || title.length > 160) { setMessage('post-msg', 'The title must be 3 to 160 characters.', 'error'); return; }
    if (imageRaw && !image_url) { setMessage('post-msg', 'The image URL must start with http:// or https://.', 'error'); return; }
    if (videoRaw && !video_url) { setMessage('post-msg', 'The video URL must start with http:// or https://.', 'error'); return; }

    const payload = { title, body, image_url, video_url, published: $('post-published').checked };
    if (!id) payload.author_id = state.profile && state.profile.id ? state.profile.id : null;

    const res = id
      ? await safe(() => client.from('posts').update(payload).eq('id', id))
      : await safe(() => client.from('posts').insert(payload));

    if (res.error) { setMessage('post-msg', 'Could not save the story.', 'error'); return; }
    toast('Story saved.', 'success');
    resetPostForm();
    await loadPosts(client);
  });

  $('post-list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-post-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const post = state.posts.find((p) => p.id === id);
    if (!post) return;
    const action = btn.getAttribute('data-post-action');

    if (action === 'edit') {
      $('post-id').value = post.id;
      $('post-title').value = post.title;
      $('post-body').value = post.body;
      $('post-image').value = post.image_url;
      $('post-video').value = post.video_url;
      $('post-published').checked = !!post.published;
      $('post-save').textContent = 'Update story';
      renderPostPreview();
      $('post-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'toggle') {
      const res = await safe(() => client.from('posts').update({ published: !post.published }).eq('id', id));
      if (res.error) toast('Could not change the story.', 'error'); else { toast('Story updated.', 'success'); await loadPosts(client); }
      return;
    }
    if (action === 'delete') {
      if (!window.confirm(`Delete "${post.title}" permanently?`)) return;
      const res = await safe(() => client.from('posts').delete().eq('id', id));
      if (res.error) toast('Could not delete the story.', 'error'); else { toast('Story deleted.', 'success'); await loadPosts(client); }
    }
  });
}

/* ---- 6.6 Ideas inbox ---- */

function renderIdeas() {
  const box = $('idea-list');
  if (state.ideas.length === 0) {
    box.innerHTML = '<p class="text-muted">No ideas yet.</p>';
    return;
  }
  box.innerHTML = state.ideas.map((i) => `<div class="idea-item">
    <div class="flex flex--wrap flex--between flex--center">
      <strong>${esc(i.name)}${i.email ? ` &middot; ${esc(i.email)}` : ''}</strong>
      <span class="text-muted">${esc(formatDate(i.created_at))} &middot; ${esc(i.status)}</span>
    </div>
    <p>${esc(i.message)}</p>
    <div class="row-actions mt-4">
      ${i.status !== 'reviewed' ? `<button class="btn btn--navy btn--sm" type="button" data-idea-action="reviewed" data-id="${esc(i.id)}">Mark reviewed</button>` : ''}
      ${i.status !== 'archived' ? `<button class="btn btn--ghost btn--sm" type="button" data-idea-action="archived" data-id="${esc(i.id)}">Archive</button>` : ''}
      <button class="btn btn--ghost btn--sm" type="button" data-idea-action="delete" data-id="${esc(i.id)}">Delete</button>
    </div>
  </div>`).join('');
}

async function loadIdeas(client) {
  const res = await safe(() => client.from('ideas').select('*').order('created_at', { ascending: false }).limit(200));
  if (res.error || !Array.isArray(res.data)) { toast('Could not load ideas.', 'error'); return; }
  state.ideas = res.data;
  renderIdeas();
}

function initIdeasInbox(client) {
  $('idea-list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-idea-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-idea-action');
    let res;
    if (action === 'delete') {
      if (!window.confirm('Delete this idea permanently?')) return;
      res = await safe(() => client.from('ideas').delete().eq('id', id));
    } else {
      res = await safe(() => client.from('ideas').update({ status: action }).eq('id', id));
    }
    if (res.error) toast('Could not update the idea.', 'error'); else { toast('Idea updated.', 'success'); await loadIdeas(client); }
  });
}

/* ---- 6.7 Admin boot ---- */

async function bootAdmin() {
  const client = await getClient();
  if (!client) {
    guardDeny('Backend not configured', 'Set the Supabase URL and anon key in app.js, then reload.', false);
    return;
  }

  const admin = await adminGuard(client);
  if (!admin) return;
  state.profile = admin;

  $('guard-screen').hidden = true;
  $('admin-app').hidden = false;
  $('admin-user').textContent = `${admin.full_name || admin.email} (admin)`;

  $('logout-btn').addEventListener('click', () => signOutAndGo(client, CONFIG.LOGIN_PAGE));
  initVolunteerTable(client);
  initSettingsForm(client);
  initPostEditor(client);
  initIdeasInbox(client);
  renderPostPreview();

  await Promise.all([loadVolunteers(client), loadSettingsForm(client), loadPosts(client), loadIdeas(client)]);
}


/* 7. BOOT -------------------------------------------------------------------- */

function boot() {
  const page = document.body.getAttribute('data-page');
  const run = page === 'admin' ? bootAdmin : bootHome;
  run().catch((err) => {
    // Last-resort net: a failure here must never leave a blank page.
    console.error('Boot failure:', err);
    toast('Something went wrong while loading the page.', 'error');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
