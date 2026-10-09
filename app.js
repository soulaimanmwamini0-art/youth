/* =============================================================================
   app.js | RP-GISHARI COLLEGE Youth Volunteer | Application orchestration module
   -----------------------------------------------------------------------------
   Loaded as <script type="module"> by both index.html and admin.html. The page
   is identified by <body data-page="home|admin">.

   Contents
     1. Configuration and shared state
     2. Safety helpers: esc(), safeUrl(), toast(), text utilities
     3. Supabase client with crash-proof wrappers
     4. Profile resolution and login policy
     5. Public portal: settings, telemetry, ideas box, stories, Join Us
        (sign in, request to join, member inbox)
     6. Admin console: guard, analytics, volunteers, join requests, messaging,
        download center, settings, story editor, ideas inbox
     7. Boot

   SECURITY MODEL
     Everything in this file runs in the visitor's browser and can be modified by
     them. It is therefore a usability layer. Authorization is enforced by
     Row-Level Security and triggers in your database (schema.sql and
     sql/additive_schema.sql).
   ============================================================================= */


/* 1. CONFIGURATION AND SHARED STATE ---------------------------------------- */

const CONFIG = Object.freeze({
  // Project URL and PUBLISHABLE anon key from Supabase -> Project Settings -> API.
  // The anon key is designed to be public; never put a service_role key here.
  SUPABASE_URL: 'https://kwsyyrogrebxwnqfaxez.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3c3l5cm9ncmVieHducWZheGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0ODU2NTIsImV4cCI6MjEwNzA2MTY1Mn0.O2AP2bBj6aRyAQqG6X3Ii42NehDyXlxN5x8D7VqH61Q',

  // Hard-wired bootstrap administrator (mirrors bootstrap_admin_email() in schema.sql).
  ADMIN_EMAIL: 'soulaimanmwamini0@gmail.com',

  SITE_NAME: 'RP-GISHARI COLLEGE Youth Volunteer',

  // ES module build of supabase-js, imported lazily so a network failure cannot crash the page.
  SDK_URL: 'https://esm.sh/@supabase/supabase-js@2',

  LOGIN_PAGE: 'index.html#join',
  ADMIN_PAGE: 'admin.html',
  SETTING_KEYS: ['hero_title', 'hero_subtitle', 'mission', 'contact_email', 'footer_text'],
  PAGE_SIZE: 25,
});

const state = {
  client: null,
  profile: null,
  volunteers: [],
  posts: [],
  ideas: [],
  requests: [],
  messages: [],
  counts: {},
  volPage: 1,
  picked: new Set(),
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
    return `<img class="story-media" src="${esc(image)}" alt="${esc(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
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

/** Delays fn until the user stops typing; keeps big tables responsive. */
function debounce(fn, ms = 180) {
  let t = 0;
  return (...args) => { window.clearTimeout(t); t = window.setTimeout(() => fn(...args), ms); };
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

/** Reads every row of a table in 1000-row pages (Supabase caps a single read). */
async function fetchAll(client, table, orderCol = 'created_at', ascending = false) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const res = await safe(() => client.from(table).select('*').order(orderCol, { ascending }).range(from, from + size - 1));
    if (res.error || !Array.isArray(res.data)) return { data: null, error: res.error || new Error('read failed') };
    rows.push(...res.data);
    if (res.data.length < size) break;
  }
  return { data: rows, error: null };
}

/** Exact row count of a table without downloading rows. */
async function countRows(client, table) {
  const res = await safe(() => client.from(table).select('*', { count: 'exact', head: true }));
  return res.error || typeof res.count !== 'number' ? null : res.count;
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
 *   - The bootstrap e-mail (soulaimanmwamini0@gmail.com) is ALWAYS treated as an
 *     active admin and is sent to the admin console right after login.
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

/* ---- 5.1 Join Us: tabs, member panel, inbox ---- */

function initJoinTabs() {
  const tabLogin = $('tab-login');
  const tabReg = $('tab-register');
  if (!tabLogin || !tabReg) return;
  const select = (which) => {
    const isLogin = which === 'login';
    tabLogin.setAttribute('aria-selected', String(isLogin));
    tabReg.setAttribute('aria-selected', String(!isLogin));
    $('login-form').hidden = !isLogin;
    $('register-form').hidden = isLogin;
  };
  tabLogin.addEventListener('click', () => select('login'));
  tabReg.addEventListener('click', () => select('register'));
}

function renderInbox(rows) {
  const wrap = $('inbox');
  const list = $('inbox-list');
  if (!wrap || !list) return;
  wrap.hidden = false;
  const unread = rows.filter((r) => !r.read_at).length;
  const badge = $('inbox-unread');
  if (badge) { badge.hidden = unread === 0; badge.textContent = `${unread} new`; }
  if (rows.length === 0) {
    list.innerHTML = '<p class="text-muted mb-0">No messages yet.</p>';
    return;
  }
  list.innerHTML = rows.map((r) => {
    const m = r.messages || {};
    return `<details class="msg-item${r.read_at ? '' : ' is-unread'}" data-mid="${esc(r.message_id)}">
      <summary><span>${r.read_at ? '' : '<span class="dot-new"></span>'}${esc(m.subject || '(no subject)')}</span><small>${esc(formatDate(m.created_at))}</small></summary>
      <p>${esc(m.body)}</p>
    </details>`;
  }).join('');
}

async function loadInbox(client, profile) {
  if (!profile || !profile.id) return;
  const res = await safe(() => client.from('message_recipients')
    .select('id,read_at,message_id,messages(subject,body,created_at)')
    .eq('volunteer_id', String(profile.id)).order('created_at', { ascending: false }).limit(30));
  if (res.error || !Array.isArray(res.data)) return; // messaging tables not installed yet: stay silent
  renderInbox(res.data);
  const list = $('inbox-list');
  list.addEventListener('toggle', async (ev) => {
    const d = ev.target;
    if (!d.matches || !d.matches('details.msg-item.is-unread') || !d.open) return;
    d.classList.remove('is-unread');
    const dot = d.querySelector('.dot-new');
    if (dot) dot.remove();
    await safe(() => client.rpc('mark_message_read', { p_message_id: d.getAttribute('data-mid') }));
    const left = list.querySelectorAll('details.is-unread').length;
    const badge = $('inbox-unread');
    if (badge) { badge.hidden = left === 0; badge.textContent = `${left} new`; }
  }, true);
}

function showMemberPanel(profile, client) {
  const auth = $('auth-area');
  const panel = $('member-panel');
  if (auth) auth.hidden = true;
  if (panel) panel.hidden = false;
  setText('member-name', profile.full_name || profile.email || 'volunteer');
  const link = $('member-admin-link');
  if (link) link.hidden = profile.role !== 'admin';
  if (client) loadInbox(client, profile);
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
    showMemberPanel(verdict.profile, client);
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

/**
 * "Request to join": records a join request for the administrators to review.
 * It also tries to create the sign-in credentials with the chosen password so the
 * person can log in as soon as they are approved. If your Supabase project has
 * sign-ups switched off, the request is still saved and the admin can create the
 * auth user manually.
 */
function initRegisterForm() {
  const form = $('register-form');
  if (!form) return;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setMessage('register-msg', '');
    if ($('reg-website').value) return; // honeypot

    const full_name = $('reg-name').value.trim();
    const email = $('reg-email').value.trim().toLowerCase();
    const phone = $('reg-phone').value.trim();
    const password = $('reg-password').value;
    const message = $('reg-message').value.trim();

    if (full_name.length < 2) { setMessage('register-msg', 'Enter your full name.', 'error'); return; }
    if (!isValidEmail(email)) { setMessage('register-msg', 'Enter a valid e-mail address.', 'error'); return; }
    if (password.length < 6) { setMessage('register-msg', 'Choose a password of at least 6 characters.', 'error'); return; }

    const client = await getClient();
    if (!client) { setMessage('register-msg', 'Registration is unavailable until the backend is configured.', 'error'); return; }

    const btn = $('register-submit');
    btn.disabled = true;
    const saved = await safe(() => client.from('join_requests').insert({ full_name, email, phone, message }));
    if (saved.error) {
      btn.disabled = false;
      setMessage('register-msg', 'We could not send your request. Please try again later.', 'error');
      return;
    }

    // Best effort: prepare the sign-in credentials. Failure here is not an error for the person.
    const created = await safe(() => client.auth.signUp({ email, password }));
    if (created.data && created.data.session) await safe(() => client.auth.signOut());

    btn.disabled = false;
    form.reset();
    setMessage('register-msg', 'Request sent! An administrator will review it. Once approved you can sign in with your e-mail and password.', 'success');
  });
}

/** If a valid active session already exists, show the member panel directly. */
async function restoreMemberSession(client) {
  const sess = await safe(() => client.auth.getSession());
  const user = sess.data && sess.data.session ? sess.data.session.user : null;
  if (!user) return;
  const profile = await resolveProfile(client, user);
  const verdict = evaluateLogin(user, profile);
  if (verdict.ok) showMemberPanel(verdict.profile, client);
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
  initJoinTabs();
  initIdeaForm();
  initLoginForm();
  initRegisterForm();
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

function renderMonthBars(rows) {
  const box = $('month-bars');
  if (!box) return;
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }), n: 0 });
  }
  rows.forEach((r) => {
    const m = months.find((x) => x.key === String(r.created_at || '').slice(0, 7));
    if (m) m.n += 1;
  });
  const max = Math.max(1, ...months.map((m) => m.n));
  box.innerHTML = months.map((m) => `<div class="mini-bar"><span>${esc(m.label)}</span><span class="track"><span class="fill" style="width:${Math.round((m.n / max) * 100)}%"></span></span><span>${m.n}</span></div>`).join('');
}

function renderKpiExtras() {
  const c = state.counts;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v === null || v === undefined ? '-' : String(v); };
  set('kpi-requests', state.requests.filter((r) => r.status === 'new').length);
  set('kpi-ideas', c.ideas);
  set('kpi-posts', c.posts);
  set('kpi-messages', c.messages);
}

function renderAnalytics() {
  const rows = state.volunteers;
  const byStatus = countBy(rows, 'status', ['active', 'pending', 'suspended']);
  const byRole = countBy(rows, 'role', ['admin', 'volunteer']);

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

  renderMonthBars(rows);
  renderKpiExtras();
}

async function loadCounts(client) {
  const tables = ['ideas', 'posts', 'messages'];
  const results = await Promise.all(tables.map((t) => countRows(client, t)));
  tables.forEach((t, i) => { state.counts[t] = results[i]; });
  renderKpiExtras();
}

/* ---- 6.2 Volunteers table: search, filter, sort, pagination ---- */

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
  const pages = Math.max(1, Math.ceil(rows.length / CONFIG.PAGE_SIZE));
  if (state.volPage > pages) state.volPage = pages;
  const startIdx = (state.volPage - 1) * CONFIG.PAGE_SIZE;
  const slice = rows.slice(startIdx, startIdx + CONFIG.PAGE_SIZE);
  $('vol-count').textContent = `${rows.length} of ${state.volunteers.length} volunteers match`;

  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="7">No volunteers match your search.</td></tr>';
  } else {
    body.innerHTML = slice.map((v) => `<tr>
      <td>${esc(v.full_name) || '<span class="text-muted">(no name)</span>'}</td>
      <td>${esc(v.email)}</td>
      <td>${esc(v.phone)}</td>
      <td><span class="badge role-${esc(v.role)}">${esc(v.role)}</span></td>
      <td><span class="badge status-${esc(v.status)}">${esc(v.status)}</span></td>
      <td>${esc(formatDate(v.created_at))}</td>
      <td>${actionButtons(v)}</td>
    </tr>`).join('');
  }

  const pager = $('vol-pager');
  if (rows.length <= CONFIG.PAGE_SIZE) { pager.innerHTML = ''; return; }
  pager.innerHTML = `<span>Page ${state.volPage} of ${pages}</span>
    <div class="row-actions">
      <button class="btn btn--ghost btn--sm" type="button" data-page="prev"${state.volPage <= 1 ? ' disabled' : ''}>Previous</button>
      <button class="btn btn--ghost btn--sm" type="button" data-page="next"${state.volPage >= pages ? ' disabled' : ''}>Next</button>
    </div>`;
}

async function loadVolunteers(client) {
  const res = await fetchAll(client, 'volunteers');
  if (res.error || !Array.isArray(res.data)) {
    toast('Could not load volunteers.', 'error');
    return;
  }
  state.volunteers = res.data;
  renderAnalytics();
  renderVolunteers();
  renderPicker();
}

async function applyVolunteerAction(client, action, id) {
  const target = state.volunteers.find((v) => String(v.id) === String(id));
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
  const rerender = () => { state.volPage = 1; renderVolunteers(); };
  const slowRerender = debounce(rerender);
  $('vol-search').addEventListener('input', slowRerender);
  ['vol-filter', 'vol-sort'].forEach((id) => $(id).addEventListener('change', rerender));

  $('vol-body').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    applyVolunteerAction(client, btn.getAttribute('data-action'), btn.getAttribute('data-id'));
  });
  $('vol-pager').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-page]');
    if (!btn) return;
    state.volPage += btn.getAttribute('data-page') === 'next' ? 1 : -1;
    renderVolunteers();
    $('volunteers').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('export-csv').addEventListener('click', () => {
    const rows = getVisibleVolunteers();
    if (rows.length === 0) { toast('Nothing to export.', 'error'); return; }
    downloadRows('volunteers-filtered', VOLUNTEER_COLUMNS, rows, 'csv');
    toast(`Exported ${rows.length} rows.`, 'success');
  });

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
    setMessage('cv-msg', `Profile created for ${email}. If they have not registered themselves, add the same e-mail under Supabase Authentication > Users so they can sign in.`, 'success');
    await loadVolunteers(client);
  });
}

/* ---- 6.3 Join requests ---- */

function renderRequests() {
  const box = $('req-list');
  const open = state.requests.filter((r) => r.status === 'new').length;
  const badge = $('req-badge');
  if (badge) { badge.hidden = open === 0; badge.textContent = String(open); }
  if (state.requests.length === 0) {
    box.innerHTML = '<p class="text-muted">No join requests yet.</p>';
    return;
  }
  box.innerHTML = state.requests.slice(0, 100).map((r) => `<div class="idea-item">
    <div class="flex flex--wrap flex--between flex--center">
      <strong>${esc(r.full_name)} &middot; ${esc(r.email)}${r.phone ? ` &middot; ${esc(r.phone)}` : ''}</strong>
      <span><span class="badge status-${esc(r.status)}">${esc(r.status)}</span> <span class="text-muted">${esc(formatDate(r.created_at))}</span></span>
    </div>
    ${r.message ? `<p>${esc(r.message)}</p>` : ''}
    <div class="row-actions mt-4">
      ${r.status !== 'approved' ? `<button class="btn btn--navy btn--sm" type="button" data-req-action="approve" data-id="${esc(r.id)}">Approve</button>` : ''}
      ${r.status !== 'rejected' ? `<button class="btn btn--ghost btn--sm" type="button" data-req-action="reject" data-id="${esc(r.id)}">Reject</button>` : ''}
      <button class="btn btn--ghost btn--sm" type="button" data-req-action="delete" data-id="${esc(r.id)}">Delete</button>
    </div>
  </div>`).join('');
}

async function loadRequests(client) {
  const res = await fetchAll(client, 'join_requests');
  if (res.error || !Array.isArray(res.data)) { renderRequestsUnavailable(); return; }
  state.requests = res.data;
  renderRequests();
  renderKpiExtras();
}

function renderRequestsUnavailable() {
  const box = $('req-list');
  if (box) box.innerHTML = '<p class="text-muted">Join requests are unavailable. Run <code>sql/additive_schema.sql</code> in the Supabase SQL Editor once.</p>';
}

function initRequests(client) {
  $('req-list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-req-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-req-action');
    const req = state.requests.find((r) => String(r.id) === String(id));
    if (!req) return;
    let res;

    if (action === 'approve') {
      const email = String(req.email).toLowerCase();
      const exists = state.volunteers.some((v) => String(v.email).toLowerCase() === email);
      if (!exists) {
        const made = await safe(() => client.from('volunteers').insert({ full_name: req.full_name, email, phone: req.phone || '', role: 'volunteer', status: 'active' }));
        if (made.error) { toast('Could not create the volunteer profile.', 'error'); return; }
      }
      res = await safe(() => client.from('join_requests').update({ status: 'approved' }).eq('id', id));
    } else if (action === 'reject') {
      res = await safe(() => client.from('join_requests').update({ status: 'rejected' }).eq('id', id));
    } else {
      if (!window.confirm('Delete this request permanently?')) return;
      res = await safe(() => client.from('join_requests').delete().eq('id', id));
    }
    if (res.error) { toast('Could not update the request.', 'error'); return; }
    toast('Request updated.', 'success');
    await Promise.all([loadRequests(client), loadVolunteers(client)]);
  });
}

/* ---- 6.4 Messaging ---- */

function pickerCandidates() {
  const q = ($('msg-picker-search') ? $('msg-picker-search').value : '').toLowerCase().trim();
  return state.volunteers
    .filter((v) => v.status === 'active' && v.id !== undefined && v.id !== null)
    .filter((v) => !q || `${v.full_name || ''} ${v.email || ''}`.toLowerCase().includes(q));
}

function renderPicker() {
  const box = $('msg-picker');
  if (!box) return;
  const rows = pickerCandidates();
  box.innerHTML = rows.length === 0
    ? '<p class="text-muted mb-0" style="padding:0.5rem">No active users match.</p>'
    : rows.map((v) => `<label><input type="checkbox" data-pick="${esc(v.id)}"${state.picked.has(String(v.id)) ? ' checked' : ''}> <span>${esc(v.full_name || '(no name)')} <small class="text-muted">${esc(v.email)}</small></span></label>`).join('');
  const c = $('msg-selected-count');
  if (c) c.textContent = `${state.picked.size} selected`;
}

function renderMessageHistory() {
  const box = $('msg-history');
  if (!box) return;
  if (state.messages.length === 0) {
    box.innerHTML = '<p class="text-muted">No messages sent yet.</p>';
    return;
  }
  box.innerHTML = state.messages.map((m) => {
    const n = Array.isArray(m.message_recipients) && m.message_recipients[0] ? m.message_recipients[0].count : 0;
    return `<div class="post-item">
      <div>
        <strong>${esc(m.subject)}</strong>
        <small>${esc(formatDate(m.created_at))} &middot; ${m.audience === 'all' ? 'All users' : 'Selected users'} &middot; ${esc(n)} recipient${n === 1 ? '' : 's'}</small>
      </div>
      <div class="row-actions"><button class="btn btn--ghost btn--sm" type="button" data-msg-action="delete" data-id="${esc(m.id)}">Delete</button></div>
    </div>`;
  }).join('');
}

async function loadMessages(client) {
  const res = await safe(() => client.from('messages')
    .select('id,subject,body,audience,created_at,message_recipients(count)')
    .order('created_at', { ascending: false }).limit(50));
  if (res.error || !Array.isArray(res.data)) {
    const box = $('msg-history');
    if (box) box.innerHTML = '<p class="text-muted">Messaging is unavailable. Run <code>sql/additive_schema.sql</code> in the Supabase SQL Editor once.</p>';
    return;
  }
  state.messages = res.data;
  renderMessageHistory();
}

function initMessaging(client) {
  const audience = () => (document.querySelector('input[name="msg-audience"]:checked') || {}).value || 'all';

  document.querySelectorAll('input[name="msg-audience"]').forEach((r) => r.addEventListener('change', () => {
    $('msg-picker-wrap').hidden = audience() !== 'selected';
    if (audience() === 'selected') renderPicker();
  }));
  $('msg-picker-search').addEventListener('input', debounce(renderPicker));
  $('msg-picker').addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-pick]');
    if (!cb) return;
    const id = cb.getAttribute('data-pick');
    if (cb.checked) state.picked.add(id); else state.picked.delete(id);
    $('msg-selected-count').textContent = `${state.picked.size} selected`;
  });
  $('msg-select-visible').addEventListener('click', () => { pickerCandidates().forEach((v) => state.picked.add(String(v.id))); renderPicker(); });
  $('msg-clear').addEventListener('click', () => { state.picked.clear(); renderPicker(); });

  $('msg-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setMessage('msg-status', '');
    const subject = $('msg-subject').value.trim();
    const body = $('msg-body').value.trim();
    const mode = audience();

    if (!subject) { setMessage('msg-status', 'Add a subject.', 'error'); return; }
    if (!body) { setMessage('msg-status', 'Write your message.', 'error'); return; }

    const active = state.volunteers.filter((v) => v.status === 'active' && v.id !== undefined && v.id !== null);
    const ids = mode === 'all' ? active.map((v) => String(v.id)) : Array.from(state.picked);
    if (ids.length === 0) { setMessage('msg-status', mode === 'all' ? 'There are no active users to message.' : 'Select at least one recipient.', 'error'); return; }
    if (!window.confirm(`Send this message to ${ids.length} user${ids.length === 1 ? '' : 's'}?`)) return;

    const btn = $('msg-send');
    btn.disabled = true;
    const sender = state.profile && state.profile.id ? String(state.profile.id) : null;
    const made = await safe(() => client.from('messages').insert({ subject, body, audience: mode, sender_id: sender }).select('id').single());
    if (made.error || !made.data) {
      btn.disabled = false;
      setMessage('msg-status', 'Could not send. Make sure sql/additive_schema.sql has been run.', 'error');
      return;
    }

    let failed = false;
    for (let i = 0; i < ids.length && !failed; i += 200) {
      const chunk = ids.slice(i, i + 200).map((vid) => ({ message_id: made.data.id, volunteer_id: vid }));
      const r = await safe(() => client.from('message_recipients').insert(chunk));
      if (r.error) failed = true;
    }
    if (failed) {
      await safe(() => client.from('messages').delete().eq('id', made.data.id)); // no half-sent message
      btn.disabled = false;
      setMessage('msg-status', 'Sending failed, so nothing was delivered. Please try again.', 'error');
      return;
    }

    btn.disabled = false;
    ev.target.reset();
    state.picked.clear();
    $('msg-picker-wrap').hidden = true;
    setMessage('msg-status', `Message sent to ${ids.length} user${ids.length === 1 ? '' : 's'}. They will see it under Join Us after signing in.`, 'success');
    await Promise.all([loadMessages(client), loadCounts(client)]);
  });

  $('msg-history').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-msg-action="delete"]');
    if (!btn) return;
    if (!window.confirm('Delete this message for everyone? This cannot be undone.')) return;
    const res = await safe(() => client.from('messages').delete().eq('id', btn.getAttribute('data-id')));
    if (res.error) toast('Could not delete the message.', 'error');
    else { toast('Message deleted.', 'success'); await Promise.all([loadMessages(client), loadCounts(client)]); }
  });
}

/* ---- 6.5 Download center (CSV and Excel) ---- */

const VOLUNTEER_COLUMNS = ['id', 'full_name', 'email', 'phone', 'role', 'status', 'created_at'];

const DATASETS = [
  { key: 'volunteers', label: 'Registered users', note: 'Every volunteer and admin profile.', cols: VOLUNTEER_COLUMNS, order: 'created_at' },
  { key: 'join_requests', label: 'Join requests', note: 'Requests sent from Join Us.', cols: ['id', 'full_name', 'email', 'phone', 'message', 'status', 'created_at'], order: 'created_at' },
  { key: 'ideas', label: 'Ideas received', note: 'Everything from the community ideas box.', cols: ['id', 'name', 'email', 'message', 'status', 'created_at'], order: 'created_at' },
  { key: 'posts', label: 'Stories', note: 'Published stories and drafts.', cols: ['id', 'title', 'body', 'image_url', 'video_url', 'published', 'created_at'], order: 'created_at' },
  { key: 'messages', label: 'Messages sent', note: 'Admin messages to users.', cols: ['id', 'subject', 'body', 'audience', 'created_at'], order: 'created_at' },
  { key: 'message_recipients', label: 'Message delivery log', note: 'Who received which message and when it was read.', cols: ['id', 'message_id', 'volunteer_id', 'read_at', 'created_at'], order: 'created_at' },
  { key: 'site_settings', label: 'Site content settings', note: 'Hero, mission, contact and footer texts.', cols: ['key', 'value', 'updated_at'], order: 'key', asc: true },
];

/**
 * RFC 4180 quoting plus spreadsheet formula-injection protection: a cell that
 * starts with = + - @ tab or CR is prefixed with an apostrophe.
 */
function guardCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s;
}

function csvCell(value) {
  return `"${guardCell(value).replace(/"/g, '""')}"`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Builds and downloads a CSV (UTF-8 with BOM) or an Excel-compatible .xls file. */
function downloadRows(name, cols, rows, format) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'xls') {
    const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
    const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(guardCell(r[c]))}</td>`).join('')}</tr>`).join('');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${esc(name).slice(0, 28)}</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    saveBlob(new Blob([`﻿${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' }), `${name}-${stamp}.xls`);
    return;
  }
  const lines = [cols.map(csvCell).join(',')];
  rows.forEach((r) => lines.push(cols.map((c) => csvCell(r[c])).join(',')));
  saveBlob(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `${name}-${stamp}.csv`);
}

async function exportDataset(client, ds, format, quiet) {
  const res = await fetchAll(client, ds.key, ds.order, !!ds.asc);
  if (res.error || !Array.isArray(res.data)) {
    if (!quiet) setMessage('dl-status', `Could not read "${ds.label}". If it is a new table, run sql/additive_schema.sql first.`, 'error');
    return false;
  }
  if (res.data.length === 0) {
    if (!quiet) setMessage('dl-status', `"${ds.label}" has no rows yet.`, 'info');
    return false;
  }
  downloadRows(ds.key, ds.cols, res.data, format);
  if (!quiet) setMessage('dl-status', `Downloaded ${res.data.length} rows from "${ds.label}".`, 'success');
  return true;
}

async function renderExportGrid(client) {
  const grid = $('export-grid');
  grid.innerHTML = DATASETS.map((d) => `<div class="card export-card">
    <h3>${esc(d.label)}</h3>
    <p>${esc(d.note)}</p>
    <p><span class="count" id="count-${esc(d.key)}">...</span> rows</p>
    <div class="row-actions">
      <button class="btn btn--navy btn--sm" type="button" data-export="${esc(d.key)}" data-format="csv">CSV</button>
      <button class="btn btn--primary btn--sm" type="button" data-export="${esc(d.key)}" data-format="xls">Excel</button>
    </div>
  </div>`).join('');
  const counts = await Promise.all(DATASETS.map((d) => countRows(client, d.key)));
  DATASETS.forEach((d, i) => {
    const el = $(`count-${d.key}`);
    if (el) el.textContent = counts[i] === null ? 'n/a' : String(counts[i]);
  });
}

function initDownloads(client) {
  $('export-grid').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-export]');
    if (!btn) return;
    const ds = DATASETS.find((d) => d.key === btn.getAttribute('data-export'));
    if (!ds) return;
    btn.disabled = true;
    await exportDataset(client, ds, btn.getAttribute('data-format'), false);
    btn.disabled = false;
  });
  $('dl-all-csv').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    let done = 0;
    for (const ds of DATASETS) {
      // eslint-disable-next-line no-await-in-loop
      if (await exportDataset(client, ds, 'csv', true)) done += 1;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => window.setTimeout(r, 350)); // lets the browser accept several downloads
    }
    btn.disabled = false;
    setMessage('dl-status', `Downloaded ${done} file${done === 1 ? '' : 's'}. Your browser may ask permission for multiple downloads.`, done ? 'success' : 'info');
  });
}

/* ---- 6.6 Site content settings ---- */

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

/* ---- 6.7 Multimedia story editor ---- */

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
  const preview = debounce(renderPostPreview, 120);
  ['post-title', 'post-body', 'post-image', 'post-video'].forEach((id) => $(id).addEventListener('input', preview));
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
    await Promise.all([loadPosts(client), loadCounts(client)]);
  });

  $('post-list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-post-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const post = state.posts.find((p) => String(p.id) === String(id));
    if (!post) return;
    const action = btn.getAttribute('data-post-action');

    if (action === 'edit') {
      $('post-id').value = post.id;
      $('post-title').value = post.title || '';
      $('post-body').value = post.body || '';
      $('post-image').value = post.image_url || '';
      $('post-video').value = post.video_url || '';
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
      if (res.error) toast('Could not delete the story.', 'error'); else { toast('Story deleted.', 'success'); await Promise.all([loadPosts(client), loadCounts(client)]); }
    }
  });
}

/* ---- 6.8 Ideas inbox ---- */

function renderIdeas() {
  const box = $('idea-list');
  if (state.ideas.length === 0) {
    box.innerHTML = '<p class="text-muted">No ideas yet.</p>';
    return;
  }
  box.innerHTML = state.ideas.map((i) => `<div class="idea-item">
    <div class="flex flex--wrap flex--between flex--center">
      <strong>${esc(i.name)}${i.email ? ` &middot; ${esc(i.email)}` : ''}</strong>
      <span class="text-muted">${esc(formatDate(i.created_at))} &middot; <span class="badge status-${esc(i.status)}">${esc(i.status)}</span></span>
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
    if (res.error) toast('Could not update the idea.', 'error');
    else { toast('Idea updated.', 'success'); await Promise.all([loadIdeas(client), loadCounts(client)]); }
  });
}

/* ---- 6.9 Admin boot ---- */

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
  initRequests(client);
  initMessaging(client);
  initDownloads(client);
  initSettingsForm(client);
  initPostEditor(client);
  initIdeasInbox(client);
  renderPostPreview();

  // Independent reads run in parallel; a failure in one never blocks the others.
  await Promise.all([
    loadVolunteers(client), loadRequests(client), loadMessages(client), loadSettingsForm(client),
    loadPosts(client), loadIdeas(client), loadCounts(client), renderExportGrid(client),
  ]);
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
