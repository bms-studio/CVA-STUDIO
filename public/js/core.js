/* CVA STUDIO — core: state, helpers, session, shell */
'use strict';

const State = {
  user: null,
  config: null,
  plans: null,
  plansList: null,
  keys: [],
  history: [],
  lang: localStorage.getItem('cva_lang') || 'en',
  tab: 'overview',
  renderedTab: null,
  studio: { sourceType: null, url: '', file: null, fileName: '', title: '', channel: '', thumbnail: '', duration: 0 },
  consoleTimer: null,
  activeJob: null,
  historyTimer: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    if (res.status >= 500) reportIssue('error', err.message, { meta: { path } });
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- Monitoring: lapor bug/spam ke server (webhook Discord admin) ---------- */
const DEVICE_INFO = (() => {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Lainnya';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Lainnya';
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  return { browser, os, screen: window.screen ? window.screen.width + 'x' + window.screen.height : '?', lang: navigator.language, tz };
})();

let monitorBusy = false;
const monitorQueue = [];
function reportIssue(type, message, extra = {}) {
  monitorQueue.push({ type, message, extra });
  if (monitorBusy) return;
  monitorBusy = true;
  (async function drain() {
    while (monitorQueue.length) {
      const item = monitorQueue.shift();
      try {
        await api('/api/report', {
          method: 'POST',
          body: JSON.stringify({
            type: item.type,
            message: String(item.message || '').slice(0, 900),
            url: location.pathname + location.search,
            device: DEVICE_INFO,
            ...item.extra
          })
        });
      } catch (e) { /* jangan loop */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    monitorBusy = false;
  })();
}
window.addEventListener('error', (e) => reportIssue('error', (e && e.message) || 'Uncaught error'));
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  reportIssue('error', (r && (r.message || r.stack)) ? r.message : String(r).slice(0, 300));
});

/* ---------- SVG icon set (extra gambar, tanpa emoji) ---------- */
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  history: '<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 11l3 3 3-3"/>',
  key: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  load: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  beaker: '<path d="M9 3h6"/><path d="M10 3v6L4.79 19.09A2 2 0 0 0 6.55 22h10.9a2 2 0 0 0 1.76-2.91L14 9V3"/><path d="M7 17h10"/>',
  upRight: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  downLeft: '<line x1="17" y1="7" x2="7" y2="17"/><polyline points="7 7 7 17 17 17"/>',
  split: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  rotate: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
};

function icon(name, s = 16, cls = '') {
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ic ${cls}" style="vertical-align:-2px;">${ICON_PATHS[name] || ''}</svg>`;
}

function fmtRp(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied', 'success');
}

const TOAST_ICONS = { success: 'check', error: 'x', warning: 'alert', info: 'chart' };
let toastTimer = 0;
function toast(msg, type = 'info') {
  const cont = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-ic">${icon(TOAST_ICONS[type] || 'chart', 15)}</span><span class="toast-msg">${esc(msg)}</span>`;
  cont.appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3400);
  setTimeout(() => el.remove(), 3800);
}

function busy(on) { $('#globalBusy').style.display = on ? 'flex' : 'none'; }
function openModal(id) { $('#' + id).style.display = 'flex'; }
function closeModal(id) { $('#' + id).style.display = 'none'; }

/* ---------- i18n ---------- */
function t(key, vars) {
  const dict = I18N[State.lang] || I18N.en;
  let txt = dict[key] != null ? dict[key] : I18N.en[key] != null ? I18N.en[key] : key;
  if (vars) {
    txt = String(txt).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  }
  return txt;
}

function applyI18n(scope = document) {
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    const txt = t(el.getAttribute('data-i18n'));
    if (txt != null) el.textContent = txt;
  });
  scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const txt = t(el.getAttribute('data-i18n-html'));
    if (txt != null) el.innerHTML = txt;
  });
}

function switchLang(lang) {
  if (!I18N[lang]) return;
  State.lang = lang;
  localStorage.setItem('cva_lang', lang);
  const enOn = lang === 'en';
  const set = (sel, active) => { const el = $(sel); if (el) el.classList.toggle('active', active); };
  ['#btnLangEn', '#dbLangEn'].forEach((s) => set(s, enOn));
  ['#btnLangId', '#dbLangId'].forEach((s) => set(s, !enOn));
  applyI18n();
  if (isDash()) renderTab(State.tab, true);
}

/* ---------- Session (auto-guest, always succeeds) ---------- */
function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem('cva_device_id'); } catch (e) {}
  if (!id) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    try { localStorage.setItem('cva_device_id', id); } catch (e) {}
  }
  return id;
}

async function refreshUser() {
  try {
    const data = await api('/api/auth/me');
    State.user = data.user;
    return true;
  } catch (e) {
    State.user = null;
    return false;
  }
}

async function ensureSession() {
  if (await refreshUser()) return true;
  try {
    await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ deviceId: getDeviceId() }) });
    return await refreshUser();
  } catch (e) {
    return false;
  }
}

function isDash() { const el = $('#dashboardView'); return el ? el.style.display !== 'none' : false; }

function enterDashboard() {
  const land = $('#landingView');
  const dash = $('#dashboardView');

  if (land) land.style.display = 'none';
  if (dash) dash.style.display = 'flex';

  if (!State.tab || !['overview', 'studio', 'history', 'permissions', 'keys', 'donation'].includes(State.tab)) {
State.tab = 'overview';
  State.renderedTab = null;
  }
  switchTab(State.tab);
  renderSidebarUser();
}

function goHome() {
  const land = $('#landingView');
  const dash = $('#dashboardView');

  if (land) land.style.display = 'block';
  if (dash) dash.style.display = 'none';
  State.tab = 'overview';
  $$('.sidebar-nav-item').forEach((it) => it.classList.toggle('active', it.dataset.tab === 'overview'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  triggerReveal();
}

/* ---------- Sidebar user + server status ---------- */
function renderSidebarUser() {
  if (!State.user) return;
  $('#dbUsername').textContent = State.user.username || 'CVA STUDIO';
  $('#dbUserAvatar').src = 'assets/logo.jpg';
  const pb = $('#dbUserPlan');
  pb.textContent = 'Unlimited';
  renderServerStatus();
}

async function renderServerStatus() {
  const card = $('#sidePlanCard');
  if (!card) return;
  if (!State.config || !('tools' in State.config)) {
    try { await loadConfig(); } catch (e) {}
  }
  const tools = (State.config && State.config.tools) || {};
  let uptime = '';
  try { uptime = await getUptime(); } catch (e) {}
  card.innerHTML = `
    <div class="sp-label">${esc(t('status.title'))}</div>
    <div class="sp-value" style="display:flex;align-items:center;gap:7px;color:var(--t1)">
      <span class="status-dot ok"></span> Online${uptime ? ' · ' + esc(uptime) + ' up' : ''}
    </div>
    <div class="sp-exp" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
      <span class="tool-chip ${tools.ffmpeg ? 'ok' : 'bad'}">ffmpeg ${tools.ffmpeg ? '✓' : '✗'}</span>
      <span class="tool-chip ${tools.ytdlp ? 'ok' : 'bad'}">yt-dlp ${tools.ytdlp ? '✓' : '✗'}</span>
    </div>
    <button class="sp-link" onclick="switchTab('studio')">${esc(t('ov.convertBtn'))} →</button>`;
}

/* ---------- Data loaders ---------- */
async function loadConfig() {
  try { State.config = await api('/api/config'); } catch (e) { State.config = {}; }
  return State.config;
}

/* Uptime server dengan cache 30 detik — hindari fetch /api/health tiap render. */
async function getUptime() {
  const now = Date.now();
  if (State._uptime && now - State._uptime.ts < 30000) return State._uptime.val;
  let val = '';
  try {
    const h = await api('/api/health');
    if (h && h.uptime != null) val = Math.floor(h.uptime / 60) + 'm';
  } catch (e) {}
  State._uptime = { val, ts: now };
  return val;
}



async function loadKeys(silent = true) {
  try {
    const data = await api('/api/keys');
    State.keys = data.keys || [];
    return State.keys;
  } catch (e) {
    if (!silent) toast(e.message, 'error');
    return [];
  }
}

async function loadHistory(silent = true) {
  try {
    const data = await api('/api/history');
    State.history = data.history || [];
    return State.history;
  } catch (e) {
    if (!silent) toast(e.message, 'error');
    return [];
  }
}

/* ---------- Tab system ---------- */
const TAB_TITLES = {
  overview: { en: 'Overview Dashboard', id: 'Dashboard Overview' },
  studio: { en: 'Audio Studio & Uploader', id: 'Audio Studio & Uploader' },
  history: { en: 'Conversion & Upload History', id: 'Riwayat Konversi & Unggahan' },
  permissions: { en: 'Bulk Experience Permissions', id: 'Izin Pengalaman Massal' },
  keys: { en: 'Roblox Open Cloud API Keys', id: 'Kunci API Roblox Open Cloud' },
  donation: { en: 'Donate', id: 'Donasi' }
};

function switchTab(tab) {
  if (tab === 'upgrade') tab = 'overview';
  if (!tab || !['overview', 'studio', 'history', 'permissions', 'keys', 'donation'].includes(tab)) {
    tab = 'overview';
  }

  if (State.tab === tab) {
    $$('.sidebar-nav-item').forEach((it) => it.classList.toggle('active', it.dataset.tab === tab));
    if (!State.renderedTab) {
      State.renderedTab = tab;
      renderTab(tab);
    }
    return;
  }
  State.tab = tab;
  State.renderedTab = tab;
  if (State.consoleTimer) { clearInterval(State.consoleTimer); State.consoleTimer = null; }
  $$('.sidebar-nav-item').forEach((it) => it.classList.toggle('active', it.dataset.tab === tab));
  const title = TAB_TITLES[tab] || TAB_TITLES.overview;
  $('#currentTabTitle').textContent = title[State.lang] || title.en;
  renderTab(tab);
}

function renderTab(tab, isLangRefresh = false) {
  if (!State.user) return;
  const renderers = {
    overview: renderOverview,
    studio: renderStudio,
    history: renderHistory,
    permissions: renderPermissions,
    keys: renderKeys,
    donation: renderDonation
  };
  const fn = renderers[tab];
  if (fn) fn(isLangRefresh);
}

/* ---------- Shared bits ---------- */
function statusPill(status) {
  return `<span class="status-pill ${esc(status)}">${esc(status)}</span>`;
}

function keyOptionsHtml(selected) {
  const opts = State.keys.map((k) =>
    `<option value="${esc(k.id)}" ${selected === k.id ? 'selected' : ''}>${esc(k.name)} (${k.creatorType === 'group' ? 'Group' : 'User'}: ${esc(k.creatorId || '-')})</option>`)
    .join('');
  return `<option value="">-- ${esc(t('keys.select'))} --</option>` + opts;
}

/* ---------- Landing ---------- */
const dummyReviews = [
  { name: 'HayfaDev', stars: 5, text: 'Sangat membantu development game Roblox saya!' },
  { name: 'CalleBuilds', stars: 5, text: 'Konversi YouTube ke Roblox tinggal paste link, auto jadi. Worth it!' },
  { name: 'Moskiw', stars: 5, text: 'Sangat membantu dan mudah digunakan!' },
  { name: 'UCENXXX', stars: 5, text: 'Moderation tracking beneran real-time. Keren banget!' },
  { name: 'JetXNB', stars: 4, text: 'Audio studio-nya lengkap: EQ, pitch, fade. Premium wajib.' },
  { name: 'AmengStudio', stars: 4, text: 'Bulk whitelist hemat waktu buat studio gede.' }
];

function renderMarquee() {
  const list = $('#marqueeList');
  if (!list) return;
  const cards = dummyReviews.map((r) => `
    <div class="review-card">
      <div class="review-top">
        <div class="review-avatar">${esc(r.name[0] || '?')}</div>
        <div>
          <div class="review-name">${esc(r.name)}</div>
          <div class="review-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>
        </div>
      </div>
      <div class="review-comment">${esc(r.text)}</div>
    </div>`).join('');
  list.innerHTML = cards + cards;
}

let revealObs = null;
function revealObserver() {
  if (!revealObs) {
    revealObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('active'); revealObs.unobserve(e.target); } });
    }, { threshold: 0.1 });
  }
  $$('.reveal:not(.active)').forEach((el) => revealObs.observe(el));
}

function triggerReveal() {
  revealObserver();
}

async function startApp() {
  busy(true);
  const ok = await ensureSession();
  busy(false);
  if (ok) enterDashboard();
  else toast('Tidak dapat terhubung ke server. Coba muat ulang.', 'error');
}

function bindStatic() {
  $('#btnLangEn')?.addEventListener('click', () => switchLang('en'));
  $('#btnLangId')?.addEventListener('click', () => switchLang('id'));
  $('#dbLangEn')?.addEventListener('click', () => switchLang('en'));
  $('#dbLangId')?.addEventListener('click', () => switchLang('id'));

  ['#heroGetStartedBtn', '#navGetStartedBtn', '#mobileGetStartedBtn'].forEach((sel) => {
    $(sel)?.addEventListener('click', startApp);
  });

  ['#homeLink', '#sidebarHomeLink', '#footerHomeLink'].forEach((sel) => {
    $(sel)?.addEventListener('click', (e) => { e.preventDefault(); goHome(); });
  });

  $('#mobileMenuBtn')?.addEventListener('click', () => $('#mobileMenu')?.classList.toggle('open'));
  $$('#mobileMenu a').forEach((a) => a.addEventListener('click', () => $('#mobileMenu')?.classList.remove('open')));

  $$('.faq-question').forEach((btn) => btn.addEventListener('click', () => btn.parentElement.classList.toggle('open')));

  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
  $$('.modal-backdrop').forEach((bd) => bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(bd.id); }));

  $('#dbMobileToggle')?.addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#sidebarOverlay').classList.add('show'); });
  $('#sidebarOverlay')?.addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#sidebarOverlay').classList.remove('show'); });
  $$('.sidebar-nav-item').forEach((it) => it.addEventListener('click', () => {
    switchTab(it.dataset.tab);
    $('#sidebar').classList.remove('open');
    $('#sidebarOverlay').classList.remove('show');
  }));
  $('#userProfileMenuBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (State.tab === 'studio') return;
    switchTab('studio');
  });

  $('#saveKeyBtn')?.addEventListener('click', saveKeyFromModal);
  $('#keyCreatorType')?.addEventListener('change', (e) => {
    $('#keyCreatorId').placeholder = e.target.value === 'group' ? 'Group ID (e.g. 7654321)' : 'User ID (e.g. 1234567)';
  });
  $('[data-copy-target]')?.addEventListener('click', (e) => {
    const target = e.currentTarget.dataset.copyTarget;
    copyText($('#' + target).textContent);
  });
}

/* ---------- Keys modal ---------- */
async function saveKeyFromModal() {
  const name = $('#keyNameInput').value.trim();
  const secret = $('#keySecretInput').value.trim();
  const creatorType = $('#keyCreatorType').value;
  const creatorId = $('#keyCreatorId').value.trim();
  if (!secret) return toast(t('keys.errSecret'), 'error');
  busy(true);
  try {
    await api('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name, secret, creatorType, creatorId })
    });
    closeModal('addKeyModal');
    $('#keyNameInput').value = ''; $('#keySecretInput').value = ''; $('#keyCreatorId').value = '';
    await loadKeys();
    toast(t('keys.saved'), 'success');
    if (State.tab === 'keys') renderKeys();
    if (State.tab === 'studio') renderStudio();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    busy(false);
  }
}