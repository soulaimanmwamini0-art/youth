/* =====================================================================
 * Youth Volunteer Digital Platform :: app.js
 * Unified application orchestration engine (ES module, no frameworks).
 *
 * Loaded by BOTH pages:
 *     <script type="module" src="app.js"></script>
 * The active page is detected from <body data-page="home|admin">.
 *
 * Sections
 *   1. Configuration (EDIT THESE TWO VALUES)
 *   2. Generic utilities (XSS escaping, DOM helpers, toasts, CSV)
 *   3. Supabase client bootstrap (error-resilient)
 *   4. Authentication pipeline (sign up / in / out / reset / profile)
 *   5. Public page controller (stats, news grid, ideas form, auth UI)
 *   6. Admin page controller (guard, analytics, table, posts, settings)
 *   7. Entry point
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * 1. CONFIGURATION
 * Use ONLY the project URL and the *publishable* (anon) key. Never put a
 * service_role / secret key in front-end code. Row-Level Security in
 * schema.sql is what actually protects your data.
 * ------------------------------------------------------------------- */
const CONFIG = Object.freeze({
  SUPABASE_URL: 'https://kwsyyrogrebxwnqfaxez.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3c3l5cm9ncmVieHducWZheGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0ODU2NTIsImV4cCI6MjEwNzA2MTY1Mn0.O2AP2bBj6aRyAQqG6X3Ii42NehDyXlxN5x8D7VqH61Q',
  SUPABASE_ESM: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  MAX_POSTS_ON_HOME: 24,
  SEARCH_DEBOUNCE_MS: 180,
});

/** True once the two values above have been replaced with real ones. */
const isConfigured = () =>
  /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(CONFIG.SUPABASE_URL) &&
  !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  !CONFIG.SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR-');

/* ---------------------------------------------------------------------
 * 2. GENERIC UTILITIES
 * ------------------------------------------------------------------- */

/** Shorthand query helpers. */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * Strict HTML escaping. EVERY database-originated string that is placed
 * into an HTML template passes through this function. It escapes the five
 * significant characters plus backtick and forward slash, and coerces
 * null/undefined to an empty string.
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .replace(/\//g, '&#47;');
}

/** Allow only http(s) URLs for images/links; anything else becomes ''. */
function safeUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch (_err) {
    return '';
  }
}

/** Whitelist a status string so it can safely be used in a CSS class. */
function statusClass(status) {
  return ['active', 'pending', 'suspended'].includes(status) ? `status-${status}` : 'status-pending';
}

/** Human readable date; falls back to '' on invalid input. */
function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' });
}

/** Debounce wrapper for search inputs. */
function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Basic e-mail shape check (the server re-validates). */
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

/** Toast notifications rendered into #toast-region (created on demand). */
function toast(message, type = 'info', timeoutMs = 4500) {
  let region = $('#toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message; // textContent => inherently XSS-safe
  region.appendChild(el);
  setTimeout(() => el.remove(), timeoutMs);
}

/** Inline form-level message area (<div data-msg>). */
function setMessage(container, text, kind = 'error') {
  if (!container) return;
  container.className = `alert alert--${kind}`;
  container.textContent = text;
  container.hidden = !text;
}

/** Disable a button and show the spinner while an async task runs. */
async function withBusy(button, task) {
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    return await task();
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

/** Turn a Supabase/PostgREST error into a friendly sentence. */
function friendlyError(error) {
  if (!error) return 'Something went wrong. Please try again.';
  const msg = String(error.message || error);
  if (/privilege escalation|protected/i.test(msg)) return 'That change is not permitted for your account.';
  if (/row-level security|permission denied|42501/i.test(msg + (error.code || ''))) return 'You do not have permission to do that.';
  if (/duplicate key|already registered|already been registered/i.test(msg)) return 'That e-mail address is already registered.';
  if (/invalid login credentials/i.test(msg)) return 'Incorrect e-mail or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your e-mail address first (check your inbox).';
  if (/failed to fetch|networkerror|network request failed/i.test(msg)) return 'Network problem. Check your connection and try again.';
  return msg;
}

/**
 * CSV helpers. Values beginning with = + - @ (or tab/CR) are prefixed with
 * an apostrophe to neutralise spreadsheet formula injection.
 */
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(columns, rows) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8') {
  // Leading BOM makes Excel detect UTF-8 correctly.
  const blob = new Blob(['﻿', text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------------------
 * 3. SUPABASE CLIENT BOOTSTRAP
 * The SDK is imported dynamically so that a CDN outage or missing config
 * degrades gracefully (the static page still renders) instead of
 * crashing the whole module graph.
 * ------------------------------------------------------------------- */
let supabase = null;
let supabaseInitError = null;

async function initSupabase() {
  if (supabase || supabaseInitError) return supabase;
  if (!isConfigured()) {
    supabaseInitError = new Error('Supabase is not configured. Edit CONFIG at the top of app.js.');
    return null;
  }
  try {
    const mod = await import(CONFIG.SUPABASE_ESM);
    supabase = mod.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (err) {
    supabaseInitError = err;
    console.error('[platform] Failed to initialise Supabase:', err);
  }
  return supabase;
}

/** Show a persistent notice when the backend is unavailable. */
function showBackendNotice() {
  const slot = $('#backend-notice');
  if (!slot || !supabaseInitError) return;
  slot.hidden = false;
  slot.className = 'alert alert--info container';
  slot.textContent = `Demo mode: ${supabaseInitError.message}`;
}

/* ---------------------------------------------------------------------
 * 4. AUTHENTICATION PIPELINE
 * ------------------------------------------------------------------- */
const AuthState = { session: null, profile: null };

/** Fetch the signed-in user's own volunteer row (RLS limits it to them). */
async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('volunteers')
    .select('id, full_name, email, phone, city, age, interests, status, role, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Refresh AuthState from the current Supabase session. */
async function refreshAuthState() {
  AuthState.session = null;
  AuthState.profile = null;
  if (!supabase) return AuthState;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return AuthState;
  AuthState.session = data.session;
  try {
    AuthState.profile = await loadProfile(data.session.user.id);
  } catch (err) {
    console.warn('[platform] Could not load profile:', err);
  }
  return AuthState;
}

async function registerVolunteer({ fullName, email, password, phone, city, age, interests }) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
      // Read by the handle_new_user() trigger. Role/status are never taken from here.
      data: { full_name: fullName.trim(), phone: phone || '', city: city || '', age: age || '', interests: interests || '' },
    },
  });
  if (error) throw error;
  return data;
}

async function signInVolunteer(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
  return data;
}

async function signOutVolunteer() {
  if (supabase) await supabase.auth.signOut();
  AuthState.session = null;
  AuthState.profile = null;
}

async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

/** Password policy shared by the registration form. */
function validatePassword(pw) {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Use upper-case, lower-case and a number.';
  return '';
}

/* ---------------------------------------------------------------------
 * 5. PUBLIC PAGE CONTROLLER (index.html)
 * ------------------------------------------------------------------- */
const Home = {
  posts: [],
  activeFilter: 'all',

  async init() {
    this.bindNav();
    this.bindTabs();
    this.bindForms();
    this.renderStatsSkeleton();
    if (!supabase) {
      showBackendNotice();
      this.renderStats(null);
      this.renderPosts([]);
      return;
    }
    await Promise.allSettled([this.loadSettings(), this.loadStats(), this.loadPosts(), this.syncSession()]);
    supabase.auth.onAuthStateChange(() => this.syncSession());
  },

  /* ---- navigation ---- */
  bindNav() {
    const toggle = $('#nav-toggle');
    const nav = $('#main-nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', () => {
      const open = nav.dataset.open === 'true';
      nav.dataset.open = String(!open);
      toggle.setAttribute('aria-expanded', String(!open));
    });
    $$('a', nav).forEach((a) => a.addEventListener('click', () => {
      nav.dataset.open = 'false';
      toggle.setAttribute('aria-expanded', 'false');
    }));
  },

  /* ---- site settings (title, tagline, announcement) ---- */
  async loadSettings() {
    const { data, error } = await supabase.from('site_settings').select('key, value');
    if (error) return console.warn('[platform] settings:', error.message);
    const s = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    if (s.hero_heading) $('#hero-heading').textContent = s.hero_heading;
    if (s.site_tagline) $('#hero-tagline').textContent = s.site_tagline;
    if (s.site_title) {
      document.title = s.site_title;
      $$('[data-site-title]').forEach((el) => { el.textContent = s.site_title; });
    }
    const banner = $('#announcement');
    if (banner) {
      banner.textContent = s.announcement || '';
      banner.hidden = !s.announcement;
    }
    if (s.registration_open === 'false') {
      this.registrationClosed = true;
      const note = $('#register-closed');
      if (note) note.hidden = false;
      $$('#register-form input, #register-form select, #register-form textarea, #register-form button').forEach((el) => { el.disabled = true; });
    }
  },

  /* ---- telemetry ---- */
  renderStatsSkeleton() {
    $$('[data-stat]').forEach((el) => { el.classList.add('skeleton'); el.textContent = '000'; });
  },

  async loadStats() {
    const { data, error } = await supabase.rpc('get_public_stats');
    if (error) {
      console.warn('[platform] stats:', error.message);
      return this.renderStats(null);
    }
    this.renderStats(data);
  },

  renderStats(stats) {
    const map = {
      total_volunteers: 'total_volunteers',
      active_volunteers: 'active_volunteers',
      signups_last_30_days: 'signups_last_30_days',
      total_ideas: 'total_ideas',
    };
    $$('[data-stat]').forEach((el) => {
      const key = map[el.dataset.stat];
      el.classList.remove('skeleton');
      const target = stats && Number.isFinite(Number(stats[key])) ? Number(stats[key]) : null;
      if (target === null) { el.textContent = '—'; return; }
      this.countUp(el, target);
    });
  },

  /** Animated counter (skipped when the user prefers reduced motion). */
  countUp(el, target) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || target < 2) {
      el.textContent = target.toLocaleString();
      return;
    }
    const duration = 900;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  /* ---- news grid ---- */
  async loadPosts() {
    const { data, error } = await supabase
      .from('posts')
      .select('id, title, summary, body, image_url, media_type, created_at')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(CONFIG.MAX_POSTS_ON_HOME);
    if (error) {
      console.warn('[platform] posts:', error.message);
      return this.renderPosts([]);
    }
    this.posts = data || [];
    this.renderPosts(this.posts);
  },

  renderPosts(posts) {
    const grid = $('#news-grid');
    if (!grid) return;
    const filtered = this.activeFilter === 'all' ? posts : posts.filter((p) => p.media_type === this.activeFilter);
    if (!filtered.length) {
      grid.innerHTML = '<div class="empty-state">No stories to show yet. Check back soon!</div>';
      return;
    }
    grid.innerHTML = filtered.map((p) => {
      const img = safeUrl(p.image_url);
      const media = img
        ? `<img class="card__media" src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : '<div class="card__media" aria-hidden="true"></div>';
      const teaser = p.summary || String(p.body || '').slice(0, 160);
      return `
        <article class="card">
          ${media}
          <div class="card__body">
            <div class="card__meta">
              <span class="badge badge--crimson">${escapeHtml(p.media_type)}</span>
              <time datetime="${escapeHtml(p.created_at)}">${escapeHtml(formatDate(p.created_at))}</time>
            </div>
            <h3 class="card__title">${escapeHtml(p.title)}</h3>
            <p class="card__text">${escapeHtml(teaser)}${teaser.length >= 160 && !p.summary ? '…' : ''}</p>
            <button type="button" class="btn btn--outline btn--sm" data-read="${escapeHtml(p.id)}">Read more</button>
          </div>
        </article>`;
    }).join('');
    $$('[data-read]', grid).forEach((btn) => btn.addEventListener('click', () => this.openPost(btn.dataset.read)));
  },

  openPost(id) {
    const post = this.posts.find((p) => p.id === id);
    const dialog = $('#post-dialog');
    if (!post || !dialog) return;
    $('#post-dialog-title').textContent = post.title;
    $('#post-dialog-meta').textContent = `${post.media_type} · ${formatDate(post.created_at)}`;
    $('#post-dialog-body').textContent = post.body; // textContent keeps it XSS-safe
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  },

  /* ---- auth tabs ---- */
  bindTabs() {
    const tabs = $$('[role="tab"]');
    tabs.forEach((tab) => tab.addEventListener('click', () => this.selectTab(tab.dataset.pane)));
    $$('[data-goto]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); this.selectTab(el.dataset.goto); }));
    $$('[role="tablist"]').forEach((list) => list.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const items = $$('[role="tab"]', list);
      const idx = items.findIndex((t) => t.getAttribute('aria-selected') === 'true');
      const next = items[(idx + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
      next.focus();
      this.selectTab(next.dataset.pane);
    }));
  },

  selectTab(pane) {
    $$('[role="tab"]').forEach((t) => {
      const on = t.dataset.pane === pane;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $$('[role="tabpanel"]').forEach((p) => { p.hidden = p.dataset.pane !== pane; });
  },

  /* ---- forms ---- */
  bindForms() {
    $('#login-form')?.addEventListener('submit', (e) => this.onLogin(e));
    $('#register-form')?.addEventListener('submit', (e) => this.onRegister(e));
    $('#reset-form')?.addEventListener('submit', (e) => this.onReset(e));
    $('#idea-form')?.addEventListener('submit', (e) => this.onIdea(e));
    $('#logout-btn')?.addEventListener('click', async () => { await signOutVolunteer(); await this.syncSession(); toast('Signed out.', 'success'); });
    $$('#news-filters .chip').forEach((chip) => chip.addEventListener('click', () => {
      this.activeFilter = chip.dataset.filter;
      $$('#news-filters .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      this.renderPosts(this.posts);
    }));
    $('#post-dialog-close')?.addEventListener('click', () => $('#post-dialog').close());
  },

  fieldError(form, name, text) {
    const input = form.elements[name];
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    if (input) input.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (slot) slot.textContent = text || '';
  },

  async onLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const msg = $('[data-msg]', form);
    setMessage(msg, '');
    if (!supabase) return setMessage(msg, 'The service is not configured yet.');
    const email = form.elements.email.value;
    const password = form.elements.password.value;
    if (!isEmail(email) || !password) return setMessage(msg, 'Enter your e-mail and password.');
    await withBusy(form.querySelector('button[type="submit"]'), async () => {
      try {
        await signInVolunteer(email, password);
        form.reset();
        await this.syncSession();
        toast('Welcome back!', 'success');
      } catch (err) {
        setMessage(msg, friendlyError(err));
      }
    });
  },

  async onRegister(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const msg = $('[data-msg]', form);
    setMessage(msg, '');
    if (!supabase) return setMessage(msg, 'The service is not configured yet.');
    if (form.elements.website.value) return; // honeypot caught a bot
    const f = form.elements;
    let valid = true;
    const rules = [
      ['fullName', f.fullName.value.trim().length >= 2, 'Please enter your full name.'],
      ['email', isEmail(f.email.value), 'Enter a valid e-mail address.'],
      ['password', !validatePassword(f.password.value), validatePassword(f.password.value)],
      ['confirm', f.password.value === f.confirm.value, 'Passwords do not match.'],
      ['age', !f.age.value || (Number(f.age.value) >= 13 && Number(f.age.value) <= 35), 'Age must be between 13 and 35.'],
      ['consent', f.consent.checked, 'You must accept the volunteer code of conduct.'],
    ];
    rules.forEach(([name, ok, text]) => { this.fieldError(form, name, ok ? '' : text); if (!ok) valid = false; });
    if (!valid) return;
    await withBusy(form.querySelector('button[type="submit"]'), async () => {
      try {
        const result = await registerVolunteer({
          fullName: f.fullName.value, email: f.email.value, password: f.password.value,
          phone: f.phone.value.trim(), city: f.city.value.trim(), age: f.age.value, interests: f.interests.value.trim(),
        });
        form.reset();
        const needsConfirm = !result.session;
        setMessage(msg, needsConfirm
          ? 'Registration received! Confirm your e-mail, then wait for an admin to approve your account.'
          : 'Registration received! An admin will approve your account shortly.', 'ok');
        await this.syncSession();
      } catch (err) {
        setMessage(msg, friendlyError(err));
      }
    });
  },

  async onReset(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const msg = $('[data-msg]', form);
    if (!supabase) return setMessage(msg, 'The service is not configured yet.');
    if (!isEmail(form.elements.email.value)) return setMessage(msg, 'Enter a valid e-mail address.');
    await withBusy(form.querySelector('button[type="submit"]'), async () => {
      try {
        await sendPasswordReset(form.elements.email.value);
        setMessage(msg, 'If that address is registered, a reset link is on its way.', 'ok');
      } catch (err) {
        setMessage(msg, friendlyError(err));
      }
    });
  },

  async onIdea(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const msg = $('[data-msg]', form);
    setMessage(msg, '');
    if (form.elements.website.value) return; // honeypot
    if (!supabase) return setMessage(msg, 'The service is not configured yet.');
    const f = form.elements;
    const checks = [
      ['authorName', f.authorName.value.trim().length >= 2, 'Please tell us your name.'],
      ['authorEmail', !f.authorEmail.value || isEmail(f.authorEmail.value), 'That e-mail looks invalid.'],
      ['title', f.title.value.trim().length >= 3, 'Give your idea a short title.'],
      ['body', f.body.value.trim().length >= 10, 'Describe your idea in at least 10 characters.'],
    ];
    let valid = true;
    checks.forEach(([name, ok, text]) => { this.fieldError(form, name, ok ? '' : text); if (!ok) valid = false; });
    if (!valid) return;
    await withBusy(form.querySelector('button[type="submit"]'), async () => {
      const { error } = await supabase.from('ideas').insert({
        author_name: f.authorName.value.trim(),
        author_email: f.authorEmail.value.trim() || null,
        title: f.title.value.trim(),
        body: f.body.value.trim(),
        category: f.category.value,
      });
      if (error) return setMessage(msg, friendlyError(error));
      form.reset();
      setMessage(msg, 'Thank you! Your idea has been submitted for review.', 'ok');
      toast('Idea submitted.', 'success');
      this.loadStats();
    });
  },

  /* ---- reflect session state in the UI ---- */
  async syncSession() {
    await refreshAuthState();
    const guest = $('#auth-guest');
    const member = $('#auth-member');
    if (!guest || !member) return;
    const { session, profile } = AuthState;
    guest.hidden = Boolean(session);
    member.hidden = !session;
    if (!session) return;
    $('#member-name').textContent = profile?.full_name || session.user.email;
    const badge = $('#member-status');
    badge.className = `badge ${statusClass(profile?.status)}`;
    badge.textContent = profile?.status || 'pending';
    $('#member-note').textContent = profile?.status === 'active'
      ? 'Your account is active. Thank you for volunteering!'
      : profile?.status === 'suspended'
        ? 'Your account is suspended. Contact the team for help.'
        : 'Your account is awaiting admin approval.';
    const adminLink = $('#admin-link');
    if (adminLink) adminLink.hidden = !(profile?.role === 'admin' && profile?.status === 'active');
  },
};

/* ---------------------------------------------------------------------
 * 6. ADMIN PAGE CONTROLLER (admin.html)
 * ------------------------------------------------------------------- */
const Admin = {
  volunteers: [],
  query: '',
  sortKey: 'created_at',
  sortDir: 'desc',
  statusFilter: 'all',

  /** Table column definitions drive rendering, sorting and CSV export. */
  columns: [
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'city', label: 'City' },
    { key: 'age', label: 'Age' },
    { key: 'status', label: 'Status' },
    { key: 'role', label: 'Role' },
    { key: 'created_at', label: 'Joined' },
  ],

  async init() {
    $('#nav-toggle')?.addEventListener('click', () => {
      const nav = $('#main-nav');
      nav.dataset.open = String(nav.dataset.open !== 'true');
    });
    if (!supabase) {
      this.showGuard('Not configured', supabaseInitError?.message || 'Backend unavailable.', false);
      return;
    }
    // ---- CLIENT-SIDE ACCESS GUARD (UX only; RLS enforces real security) ----
    await refreshAuthState();
    const { session, profile } = AuthState;
    if (!session) return this.showGuard('Sign in required', 'Please sign in with an administrator account.', true);
    if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
      return this.showGuard('Access denied', 'This area is restricted to active administrators.', true);
    }
    this.showDashboard(profile);
    this.bindUi();
    await Promise.allSettled([this.loadVolunteers(), this.loadIdeasCount(), this.loadSettingsForm(), this.loadPostsList()]);
    supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') window.location.reload(); });
  },

  showGuard(title, text, showLink) {
    $('#guard').hidden = false;
    $('#dashboard').hidden = true;
    $('#guard-title').textContent = title;
    $('#guard-text').textContent = text;
    $('#guard-link').hidden = !showLink;
  },

  showDashboard(profile) {
    $('#guard').hidden = true;
    $('#dashboard').hidden = false;
    $('#admin-name').textContent = profile.full_name;
    this.adminId = profile.id;
  },

  bindUi() {
    $('#volunteer-search').addEventListener('input', debounce((e) => {
      this.query = e.target.value.trim().toLowerCase();
      this.renderTable();
    }, CONFIG.SEARCH_DEBOUNCE_MS));
    $('#status-filter').addEventListener('change', (e) => { this.statusFilter = e.target.value; this.renderTable(); });
    $$('#volunteer-table th[data-sort]').forEach((th) => th.addEventListener('click', () => this.setSort(th.dataset.sort)));
    $('#volunteer-body').addEventListener('click', (e) => this.onRowAction(e));
    $('#export-csv').addEventListener('click', () => this.exportCsv());
    $('#refresh-btn').addEventListener('click', () => this.loadVolunteers(true));
    $('#signout-btn').addEventListener('click', async () => { await signOutVolunteer(); window.location.href = 'index.html'; });
    $('#post-form').addEventListener('submit', (e) => this.onPublish(e));
    $('#settings-form').addEventListener('submit', (e) => this.onSaveSettings(e));
    $('#posts-body').addEventListener('click', (e) => this.onPostAction(e));
  },

  /* ---- volunteers: load ---- */
  async loadVolunteers(announce = false) {
    const { data, error } = await supabase
      .from('volunteers')
      .select('id, full_name, email, phone, city, age, interests, status, role, created_at')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) {
      toast(friendlyError(error), 'error');
      $('#volunteer-body').innerHTML = '<tr><td colspan="8" class="muted">Could not load volunteers.</td></tr>';
      return;
    }
    this.volunteers = data || [];
    this.renderTable();
    this.renderAnalytics();
    if (announce) toast('Volunteer list refreshed.', 'success');
  },

  async loadIdeasCount() {
    const { count, error } = await supabase.from('ideas').select('id', { count: 'exact', head: true });
    $('#kpi-ideas').textContent = error ? '—' : String(count ?? 0);
  },

  /* ---- volunteers: search + multi-column sort ---- */
  getVisibleRows() {
    const q = this.query;
    const rows = this.volunteers.filter((v) => {
      if (this.statusFilter !== 'all' && v.status !== this.statusFilter) return false;
      if (!q) return true;
      // Multi-column search: every whitespace-separated term must match some column.
      const haystack = [v.full_name, v.email, v.city, v.phone, v.interests, v.status, v.role, v.age]
        .map((x) => String(x ?? '').toLowerCase()).join(' ');
      return q.split(/\s+/).every((term) => haystack.includes(term));
    });
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const key = this.sortKey;
    return rows.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;   // nulls always last
      if (bv === null || bv === undefined) return -1;
      if (key === 'age') return (Number(av) - Number(bv)) * dir;
      if (key === 'created_at') return (new Date(av) - new Date(bv)) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
    });
  },

  setSort(key) {
    if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortKey = key; this.sortDir = 'asc'; }
    this.renderTable();
  },

  renderTable() {
    const rows = this.getVisibleRows();
    $$('#volunteer-table th[data-sort]').forEach((th) => {
      th.setAttribute('aria-sort', th.dataset.sort === this.sortKey
        ? (this.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    const body = $('#volunteer-body');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="muted text-center">No volunteers match your filters.</td></tr>';
    } else {
      body.innerHTML = rows.map((v) => this.rowHtml(v)).join('');
    }
    $('#table-count').textContent = `Showing ${rows.length} of ${this.volunteers.length} volunteers`;
  },

  rowHtml(v) {
    const isSelf = v.id === this.adminId;
    const id = escapeHtml(v.id);
    const buttons = [];
    if (v.status !== 'active') buttons.push(`<button class="btn btn--primary btn--sm" data-act="approve" data-id="${id}">Approve</button>`);
    if (v.status !== 'suspended' && !isSelf) buttons.push(`<button class="btn btn--danger btn--sm" data-act="suspend" data-id="${id}">Suspend</button>`);
    if (v.role !== 'admin') buttons.push(`<button class="btn btn--outline btn--sm" data-act="make-admin" data-id="${id}">Make admin</button>`);
    return `
      <tr id="row-${id}">
        <td><strong>${escapeHtml(v.full_name)}</strong>${isSelf ? ' <span class="badge badge--navy">you</span>' : ''}</td>
        <td>${escapeHtml(v.email)}</td>
        <td>${escapeHtml(v.city || '—')}</td>
        <td>${escapeHtml(v.age ?? '—')}</td>
        <td><span class="badge ${statusClass(v.status)}">${escapeHtml(v.status)}</span></td>
        <td>${escapeHtml(v.role)}</td>
        <td>${escapeHtml(formatDate(v.created_at))}</td>
        <td><div class="actions">${isSelf ? '<span class="muted">—</span>' : buttons.join('')}</div></td>
      </tr>`;
  },

  /* ---- volunteers: status actions ---- */
  async onRowAction(event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const volunteer = this.volunteers.find((v) => v.id === btn.dataset.id);
    if (!volunteer) return;
    const act = btn.dataset.act;
    const changes = {
      approve: { status: 'active' },
      suspend: { status: 'suspended' },
      'make-admin': { role: 'admin', status: 'active' },
    }[act];
    if (!changes) return;
    const verb = { approve: 'approve', suspend: 'suspend', 'make-admin': 'grant ADMIN rights to' }[act];
    if (!window.confirm(`Are you sure you want to ${verb} ${volunteer.full_name}?`)) return;
    await withBusy(btn, async () => {
      const { data, error } = await supabase.from('volunteers').update(changes).eq('id', volunteer.id).select().single();
      if (error) return toast(friendlyError(error), 'error');
      Object.assign(volunteer, data);
      this.renderTable();
      this.renderAnalytics();
      $(`#row-${CSS.escape(volunteer.id)}`)?.classList.add('row-flash');
      toast(`${volunteer.full_name} updated.`, 'success');
    });
  },

  /* ---- CSV export of the CURRENT filtered + sorted view ---- */
  exportCsv() {
    const rows = this.getVisibleRows();
    if (!rows.length) return toast('Nothing to export.', 'error');
    const columns = [
      ...this.columns,
      { key: 'phone', label: 'Phone' },
      { key: 'interests', label: 'Interests' },
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`volunteers-${stamp}.csv`, buildCsv(columns, rows));
    toast(`Exported ${rows.length} rows.`, 'success');
  },

  /* ---- analytics: conic-gradient donut + KPI tiles ---- */
  renderAnalytics() {
    const total = this.volunteers.length;
    const count = (s) => this.volunteers.filter((v) => v.status === s).length;
    const active = count('active'), pending = count('pending'), suspended = count('suspended');
    const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
    const donut = $('#status-donut');
    donut.style.setProperty('--p-active', pct(active));
    donut.style.setProperty('--p-pending', pct(pending));
    donut.style.setProperty('--p-suspended', pct(suspended));
    donut.dataset.center = String(total);
    donut.setAttribute('aria-label', `${active} active, ${pending} pending, ${suspended} suspended volunteers`);
    $('#kpi-total').textContent = String(total);
    $('#kpi-pending').textContent = String(pending);
    $('#kpi-admins').textContent = String(this.volunteers.filter((v) => v.role === 'admin').length);
    $('#legend-active').textContent = `Active · ${active} (${pct(active)}%)`;
    $('#legend-pending').textContent = `Pending · ${pending} (${pct(pending)}%)`;
    $('#legend-suspended').textContent = `Suspended · ${suspended} (${pct(suspended)}%)`;
    // Approval-rate meter (active / total).
    $('#approval-meter').style.setProperty('--val', pct(active));
    $('#approval-label').textContent = `${pct(active)}% of sign-ups approved`;
  },

  /* ---- posts: create, list, publish toggle, delete ---- */
  async onPublish(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = form.elements;
    const msg = $('[data-msg]', form);
    setMessage(msg, '');
    const image = f.imageUrl.value.trim();
    if (image && !safeUrl(image)) return setMessage(msg, 'Image URL must start with http:// or https://');
    if (f.title.value.trim().length < 3 || f.body.value.trim().length < 10) {
      return setMessage(msg, 'Add a title (3+ chars) and body (10+ chars).');
    }
    await withBusy(form.querySelector('button[type="submit"]'), async () => {
      const { error } = await supabase.from('posts').insert({
        title: f.title.value.trim(),
        summary: f.summary.value.trim() || null,
        body: f.body.value.trim(),
        image_url: image || null,
        media_type: f.mediaType.value,
        is_published: f.isPublished.checked,
        author_id: this.adminId,
      });
      if (error) return setMessage(msg, friendlyError(error));
      form.reset();
      f.isPublished.checked = true;
      setMessage(msg, 'Post saved.', 'ok');
      toast('Post saved.', 'success');
      this.loadPostsList();
    });
  },

  async loadPostsList() {
    const { data, error } = await supabase
      .from('posts')
      .select('id, title, media_type, is_published, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    const body = $('#posts-body');
    if (error) { body.innerHTML = '<tr><td colspan="4" class="muted">Could not load posts.</td></tr>'; return; }
    this.posts = data || [];
    body.innerHTML = this.posts.length ? this.posts.map((p) => `
      <tr>
        <td>${escapeHtml(p.title)}</td>
        <td>${escapeHtml(p.media_type)}</td>
        <td><span class="badge ${p.is_published ? 'status-active' : 'status-pending'}">${p.is_published ? 'published' : 'draft'}</span></td>
        <td><div class="actions">
          <button class="btn btn--outline btn--sm" data-post-act="toggle" data-id="${escapeHtml(p.id)}">${p.is_published ? 'Unpublish' : 'Publish'}</button>
          <button class="btn btn--danger btn--sm" data-post-act="delete" data-id="${escapeHtml(p.id)}">Delete</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="4" class="muted text-center">No posts yet.</td></tr>';
    $('#kpi-posts').textContent = String(this.posts.filter((p) => p.is_published).length);
  },

  async onPostAction(event) {
    const btn = event.target.closest('button[data-post-act]');
    if (!btn) return;
    const post = (this.posts || []).find((p) => p.id === btn.dataset.id);
    if (!post) return;
    await withBusy(btn, async () => {
      if (btn.dataset.postAct === 'toggle') {
        const { error } = await supabase.from('posts').update({ is_published: !post.is_published }).eq('id', post.id);
        if (error) return toast(friendlyError(error), 'error');
      } else {
        if (!window.confirm(`Delete "${post.title}" permanently?`)) return;
        const { error } = await supabase.from('posts').delete().eq('id', post.id);
        if (error) return toast(friendlyError(error), 'error');
      }
      toast('Post updated.', 'success');
      this.loadPostsList();
    });
  },

  /* ---- site settings form ---- */
  SETTING_KEYS: ['site_title', 'site_tagline', 'hero_heading', 'contact_email', 'announcement'],

  async loadSettingsForm() {
    const { data, error } = await supabase.from('site_settings').select('key, value');
    if (error) return toast(friendlyError(error), 'error');
    const s = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const f = $('#settings-form').elements;
    this.SETTING_KEYS.forEach((k) => { if (f[k]) f[k].value = s[k] || ''; });
    f.registration_open.checked = s.registration_open !== 'false';
  },

  async onSaveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = form.elements;
    const msg = $('[data-msg]', form);
    setMessage(msg, '');
    if (f.contact_email.value && !isEmail(f.contact_email.value)) return setMessage(msg, 'Contact e-mail is invalid.');
    const rows = this.SETTING_KEYS.map((key) => ({ key, value: f[key].value.trim() }));
    rows.push({ key: 'registration_open', value: f.registration_open.checked ? 'true' : 'false' });
    await withBusy(form.querySelector('button[type="submit"]'), async () => {
      const { error } = await supabase.from('site_settings').upsert(rows, { onConflict: 'key' });
      if (error) return setMessage(msg, friendlyError(error));
      setMessage(msg, 'Settings saved. The public site updates immediately.', 'ok');
      toast('Settings saved.', 'success');
    });
  },
};

/* ---------------------------------------------------------------------
 * 7. ENTRY POINT
 * ------------------------------------------------------------------- */
async function main() {
  await initSupabase();
  const page = document.body.dataset.page;
  try {
    if (page === 'home') await Home.init();
    else if (page === 'admin') await Admin.init();
  } catch (err) {
    console.error('[platform] Unhandled startup error:', err);
    toast('Something went wrong while loading the page.', 'error');
  }
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('[platform] Unhandled promise rejection:', e.reason);
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
