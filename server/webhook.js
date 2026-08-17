/* CVA STUDIO — Discord webhook monitor (bug / spam / lokasi IP) */
const cfg = require('./config');

const geoCache = new Map();
const activity = new Map(); // userId -> { count, windowStart, lastAlert }

async function send(payload) {
  const url = cfg.DISCORD_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (e) {
    console.error('[webhook] send gagal:', e.message);
    return false;
  }
}

async function resolveLocation(ip) {
  const ipClean = String(ip || '');
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];
  if (local.includes(ipClean)) return { flag: '🏠', loc: 'Localhost (dev)' };
  if (geoCache.has(ipClean)) return geoCache.get(ipClean);
  const fallback = { flag: '❓', loc: 'Tidak diketahui' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`https://ipapi.co/${ipClean}/json/`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('ipapi ' + r.status);
    const j = await r.json();
    const out = {
      flag: j.country ? '🌍' : '❓',
      loc: [j.city, j.region, j.country_name].filter(Boolean).join(', ') || 'Tidak diketahui'
    };
    geoCache.set(ipClean, out);
    return out;
  } catch (e) {
    geoCache.set(ipClean, fallback);
    return fallback;
  }
}

/* Deteksi spam: > WEBHOOK_SPAM_THRESHOLD job / 10 menit -> alert (cooldown 5 menit) */
function trackActivity(userId, count = 1) {
  if (!cfg.DISCORD_WEBHOOK_URL) return;
  const now = Date.now();
  const rec = activity.get(userId) || { count: 0, windowStart: now, lastAlert: 0 };
  if (now - rec.windowStart > 10 * 60 * 1000) {
    rec.count = 0;
    rec.windowStart = now;
  }
  rec.count += count;
  activity.set(userId, rec);
  const threshold = parseInt(cfg.WEBHOOK_SPAM_THRESHOLD || '15', 10);
  if (rec.count >= threshold && now - rec.lastAlert > 5 * 60 * 1000) {
    rec.lastAlert = now;
    const fields = [
      { name: '👤 User', value: '`' + userId + '`', inline: true },
      { name: '⚡ Job', value: String(rec.count) + ' dalam 10 menit', inline: true }
    ];
    send({
      username: 'CVA STUDIO Monitor',
      embeds: [{
        title: '🚨 Aktivitas mencurigakan (spam)',
        color: 0xffaa00,
        fields,
        timestamp: new Date().toISOString()
      }]
    });
  }
}

/* Laporan error client (dari /api/report) */
async function reportClientError({ user, ip, message, stack, url, device }) {
  const fields = [
    { name: '👤 User', value: '`' + (user || '?') + '`', inline: true },
    { name: '🧭 Halaman', value: String(url || '?').slice(0, 120) || '?', inline: true },
    { name: '💻 Perangkat', value: [device && device.browser, device && device.os, device && device.screen, device && device.lang].filter(Boolean).join(' · ') || '?', inline: true },
    { name: '📄 Pesan', value: String(message || '(tanpa pesan)').slice(0, 900), inline: false }
  ];
  if (stack) fields.push({ name: '🪵 Stack', value: String(stack).slice(0, 900), inline: false });
  const loc = await resolveLocation(ip);
  fields.push({ name: '📍 Lokasi (IP)', value: loc.flag + ' ' + loc.loc + ' · `' + ip + '`', inline: true });
  return send({
    username: 'CVA STUDIO Monitor',
    embeds: [{
      title: '⚠️ Bug terdeteksi',
      color: 0xff5555,
      fields,
      timestamp: new Date().toISOString()
    }]
  });
}

/* Error 500 server */
async function reportServerError(req, err) {
  const fields = [
    { name: '👤 User', value: '`' + ((req.user && req.user.discord_id) || 'anonim') + '`', inline: true },
    { name: '🔗 Path', value: String(req.method + ' ' + req.originalUrl).slice(0, 150), inline: true },
    { name: '📄 Pesan', value: String((err && err.message) || 'Unknown').slice(0, 900), inline: false },
    { name: '🪵 Stack', value: String((err && err.stack) || '').slice(0, 900), inline: false }
  ];
  const loc = await resolveLocation(req.ip);
  fields.push({ name: '📍 Lokasi (IP)', value: loc.flag + ' ' + loc.loc + ' · `' + req.ip + '`', inline: true });
  return send({
    username: 'CVA STUDIO Monitor',
    embeds: [{
      title: '💥 Error server (500)',
      color: 0xff0000,
      fields,
      timestamp: new Date().toISOString()
    }]
  });
}

/* Parsing device dari User-Agent */
function parseUa(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /Firefox\//.test(s) ? 'Firefox' : /curl|node|python/i.test(s) ? 'API/CLI' : 'Lainnya';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'Lainnya';
  return { browser, os };
}

/* Event konversi lengkap & detail: mulai / selesai / gagal */
async function reportConvert({ type, job, key, duration, parts, ms, error }) {
  const ua = parseUa(job.meta && job.meta.ua);
  const fx = job.params || {};
  const effects = ['echo', 'reverb', 'chorus', 'tremolo', 'vibrato', 'radio', 'reverse', 'fadeIn', 'fadeOut']
    .filter((k) => fx[k])
    .map((k) => k.replace(/^fade/, 'fade '));
  const fxSummary = [
    fx.speed && Number(fx.speed) !== 1 ? 'speed ×' + fx.speed : '',
    fx.pitch ? 'pitch ' + (fx.pitch > 0 ? '+' : '') + fx.pitch : '',
    fx.amplify ? (fx.amplify > 0 ? '+' : '') + fx.amplify + 'dB' : '',
    fx.eq && fx.eq !== 'normal' ? 'eq:' + fx.eq : ''
  ].filter(Boolean).join(' ');

  const colors = { start: 0x55aaff, done: 0x22aa55, fail: 0xff5555 };
  const titles = {
    start: '▶️ Konversi dimulai',
    done: '✅ Konversi selesai',
    fail: '❌ Konversi gagal'
  };
  const fields = [
    { name: '👤 User', value: '`' + (job.userId || '?') + '`', inline: true },
    { name: '🎵 Lagu', value: String(job.assetName || 'Untitled').slice(0, 120), inline: true },
    { name: '📥 Sumber', value: job.sourceType === 'url' ? String(job.sourceUrl).slice(0, 90) : '📁 Upload file', inline: true }
  ];
  if (duration > 0) {
    const mm = Math.floor(duration / 60), ss = String(Math.floor(duration % 60)).padStart(2, '0');
    fields.push({ name: '⏱️ Durasi', value: `${mm}:${ss}`, inline: true });
  }
  if (fxSummary || effects.length) {
    fields.push({ name: '🎛️ FX', value: (fxSummary || 'none') + (effects.length ? '\n' + effects.map((e) => '`' + e + '`').join(' ') : ''), inline: true });
  }
  if (fx.maxDuration && duration > 0 && fx.maxDuration < duration) {
    const cm = Math.floor(fx.maxDuration / 60), cs = String(Math.floor(fx.maxDuration % 60)).padStart(2, '0');
    fields.push({ name: '✂️ Crop', value: `0:00 – ${cm}:${cs}`, inline: true });
  }
  if (parts && parts.length) {
    fields.push({
      name: '🧩 Aset',
      value: parts.map((p) => `#${p.index} \`${p.assetId}\` (${p.moderationState || 'Pending'})`).join('\n').slice(0, 900),
      inline: false
    });
  }
  if (type === 'fail' && error) fields.push({ name: '📄 Error', value: String(error).slice(0, 900), inline: false });
  if (ms > 0) fields.push({ name: '⏳ Waktu proses', value: (ms / 1000).toFixed(1) + ' detik', inline: true });
  fields.push({ name: '🏷️ Mode', value: (key && key.is_demo) ? 'DEMO (simulasi)' : 'Roblox Open Cloud', inline: true });
  if (job.meta) {
    const loc = await resolveLocation(job.meta.ip);
    fields.push({ name: '📍 Lokasi (IP)', value: `${loc.flag} ${loc.loc} · \`${job.meta.ip}\``, inline: true });
    fields.push({ name: '💻 Device', value: ua.browser + ' · ' + ua.os, inline: true });
  }

  return send({
    username: 'CVA STUDIO Monitor',
    embeds: [{ title: titles[type], color: colors[type], fields, timestamp: new Date().toISOString() }]
  });
}

module.exports = { send, resolveLocation, trackActivity, reportClientError, reportServerError, reportConvert };
