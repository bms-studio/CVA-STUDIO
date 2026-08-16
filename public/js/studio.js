/* CVA STUDIO — studio: waveform, live FX preview (WebAudio), convert console + batch */
'use strict';

/* ---------- Studio state ---------- */
const MAX_ASSET_SEC = 1800; // 30 menit — batas audio Roblox; max per aset menyesuaikan durasi lagu
const St = {
  peaks: [],
  loaded: false,
  playing: false,
  file: null,
  fileName: '',
  thumbUrl: '',
  dur: 0
};
let audioCtx = null;
let mediaSrc = null;
let fxNodes = [];
let gainNode = null;
let analyserNode = null;
let analyserRaf = null;
let granActive = false;
let granSources = [];
let granEndTimer = null;
let granBus = null;
let granSchedSpeed = 1;
let granF = 1;
let granRestartTimer = null;
let studioJobId = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function currentFxParams() {
  const v = (el, def) => (el ? parseFloat(el.value) : def);
  const tog = (k) => !!$(`#fxExtraRow .chip[data-fx="${k}"].active`);
  return {
    speed: v($('#fxSpeed'), 1),
    amplify: v($('#fxAmplify'), 0),
    pitch: v($('#fxPitch'), 0),
    eq: $('#fxEqRow .chip.active')?.dataset.eq || 'normal',
    maxDuration: $('#fxCrop')?.checked ? v($('#fxMaxDur'), 420) : Math.max(10, Math.min(MAX_ASSET_SEC, Math.round(St.dur || 420))),
    fadeIn: $('#fxFadeIn')?.checked || false,
    fadeOut: $('#fxFadeOut')?.checked || false,
    autoSplit: $('#fxAutoSplit')?.checked || true,
    echo: tog('echo'),
    reverb: tog('reverb'),
    chorus: tog('chorus'),
    tremolo: tog('tremolo'),
    vibrato: tog('vibrato'),
    radio: tog('radio'),
    reverse: tog('reverse')
  };
}

/* ---------- FX Presets / Templates ---------- */
const BUILTIN_PRESETS = [
  { id: 'original', name: 'Original', params: {} },
  { id: 'bassboost', name: 'Bass Boost', params: { eq: 'bass', amplify: 6, echo: true } },
  { id: 'nightcore', name: 'Nightcore', params: { speed: 1.5, pitch: 3, amplify: 2, echo: true } },
  { id: 'slowdeep', name: 'Slow & Deep', params: { pitch: -3, eq: 'bass', reverb: true } },
  { id: 'lofi', name: 'Lo-Fi', params: { amplify: -3, eq: 'vintage', reverb: true, fadeIn: true, fadeOut: true } },
  { id: 'radio', name: 'Radio Voice', params: { eq: 'vocals', amplify: 2, radio: true } },
  { id: 'energetic', name: 'High Energy', params: { speed: 2, amplify: 4, eq: 'treble', tremolo: true } },
  { id: 'echospace', name: 'Echo Space', params: { echo: true, reverb: true, fadeOut: true } }
];

function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem('cva_fx_presets') || '[]'); } catch (e) { return []; }
}
function saveUserPresets(list) {
  try { localStorage.setItem('cva_fx_presets', JSON.stringify(list)); } catch (e) {}
}

function applyPreset(preset) {
  const p = Object.assign({
    speed: 1, amplify: 0, pitch: 0, eq: 'normal',
    fadeIn: false, fadeOut: false, autoSplit: true,
    echo: false, reverb: false, chorus: false, tremolo: false,
    vibrato: false, radio: false, reverse: false
  }, preset.params || {});
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  set('#fxSpeed', p.speed);
  $('#outSpeed').textContent = Number(p.speed).toFixed(2) + 'x';
  $('#speedPresets').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.speed === String(p.speed)));
  set('#fxAmplify', p.amplify);
  $('#outAmplify').textContent = (Number(p.amplify) > 0 ? '+' : '') + p.amplify + ' dB';
  set('#fxPitch', p.pitch);
  $('#outPitch').textContent = (Number(p.pitch) > 0 ? '+' : '') + p.pitch + ' st';
  $('#fxEqRow').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.eq === p.eq));
  $('#fxFadeIn').checked = !!p.fadeIn;
  $('#fxFadeOut').checked = !!p.fadeOut;
  if ($('#fxAutoSplit')) $('#fxAutoSplit').checked = p.autoSplit !== false;
  $('#fxExtraRow').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', !!p[x.dataset.fx]));
  rebuildFxGraph();
  updateFxChips();
}

let activePresetId = '';

function saveCurrentAsPreset() {
  const p = currentFxParams();
  const name = (window.prompt(t('studio.presetName'), p.eq !== 'normal' ? p.eq + ' Preset' : 'My Preset') || '').trim();
  if (!name) return;
  const list = loadUserPresets();
  list.push({
    id: 'u_' + Date.now(),
    name,
    params: {
      speed: p.speed, amplify: p.amplify, pitch: p.pitch, eq: p.eq,
      fadeIn: p.fadeIn, fadeOut: p.fadeOut, autoSplit: p.autoSplit,
      echo: p.echo, reverb: p.reverb, chorus: p.chorus, tremolo: p.tremolo,
      vibrato: p.vibrato, radio: p.radio, reverse: p.reverse
    }
  });
  saveUserPresets(list);
  activePresetId = list[list.length - 1].id;
  const label = $('#fxPresetLabel');
  if (label) label.textContent = name;
  const del = $('#fxPresetDelBtn');
  if (del) del.style.display = 'inline-flex';
  refreshPresetOptions();
  toast(t('studio.presetSaved'), 'success');
}

function deleteSelectedPreset() {
  if (!String(activePresetId).startsWith('u_')) return;
  saveUserPresets(loadUserPresets().filter((x) => x.id !== activePresetId));
  activePresetId = '';
  const label = $('#fxPresetLabel');
  if (label) label.textContent = t('studio.presetPlaceholder');
  const del = $('#fxPresetDelBtn');
  if (del) del.style.display = 'none';
  refreshPresetOptions();
  toast(t('studio.presetDeleted'), 'success');
}

function presetItemsHtml() {
  const user = loadUserPresets();
  const builtin = BUILTIN_PRESETS.map((p) =>
    `<button type="button" class="fx-preset-item-apply" data-preset="${esc(p.id)}" role="option">${esc(p.name)}</button>`).join('');
  const userHtml = user.length
    ? `<div class="fx-preset-group-label">${esc(t('studio.presetUser'))}</div>` +
      user.map((p) =>
        `<button type="button" class="fx-preset-item-apply" data-preset="${esc(p.id)}" role="option">${esc(p.name)}</button>`).join('')
    : '';
  return `<div class="fx-preset-group-label">${esc(t('studio.presetBuiltin'))}</div>${builtin}${userHtml}`;
}

function refreshPresetOptions() {
  const menu = $('#fxPresetMenu');
  if (menu) menu.innerHTML = presetItemsHtml();
}

/* ---------- FX graph ---------- */
function rebuildFxGraph() {
  const audioEl = $('#previewAudio');
  if (!audioEl || !audioCtx) return;
  fxNodes.forEach((n) => { try { n.disconnect(); } catch (e) {} });
  fxNodes = [];
  if (analyserNode) { try { analyserNode.disconnect(); } catch (e) {} analyserNode = null; }
  if (audioEl.dataset.routed !== '1') {
    try {
      mediaSrc = audioCtx.createMediaElementSource(audioEl);
      audioEl.dataset.routed = '1';
    } catch (e) {
      console.error('rebuildFxGraph createMediaElementSource:', e);
      return; // element sudah dirutekan sistem lain — biarkan default routing
    }
  }
  let node = mediaSrc;
  const p = currentFxParams();

  gainNode = audioCtx.createGain();
  gainNode.gain.value = Math.pow(10, p.amplify / 20);
  node.connect(gainNode);
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.8;
  gainNode.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);
  fxNodes.push(gainNode);
  if (granActive && granBus) {
    try { granBus.disconnect(); } catch (e) {}
    granBus.connect(fxNodes[0] || gainNode);
  }
  startAnalyserLoop();
}

/* ---------- Live waveform (AnalyserNode) — fallback andai decodeAudioData tak ada ---------- */
function startAnalyserLoop() {
  if (analyserRaf) cancelAnimationFrame(analyserRaf);
  analyserRaf = null;
  if (!analyserNode) return;
  const data = new Uint8Array(analyserNode.fftSize);
  const A = analyserNode;
  const bucket = 220;
  const loop = () => {
    analyserRaf = requestAnimationFrame(loop);
    const audioEl = $('#previewAudio');
    if (!audioEl || !St.playing) return;
    try { A.getByteTimeDomainData(data); } catch (e) { return; }
    const peaks = new Array(bucket).fill(0);
    const block = Math.max(1, Math.floor(data.length / bucket));
    for (let i = 0; i < bucket; i++) {
      let max = 0;
      const end = Math.min(data.length, (i + 1) * block);
      for (let j = i * block; j < end; j++) {
        const v = Math.abs((data[j] - 128) / 128);
        if (v > max) max = v;
      }
      peaks[i] = Math.min(1, max * 1.35);
    }
    St.peaks = peaks;
    drawWaveform();
  };
  analyserRaf = requestAnimationFrame(loop);
}

function stopAnalyserLoop() {
  if (analyserRaf) { cancelAnimationFrame(analyserRaf); analyserRaf = null; }
}

/* ---------- Granular preview (tempo-preserving pitch) ---------- */
function granInputNode() {
  return fxNodes[0] || gainNode || null;
}

function stopGranular() {
  if (granRestartTimer) { clearTimeout(granRestartTimer); granRestartTimer = null; }
  if (granEndTimer) { clearTimeout(granEndTimer); granEndTimer = null; }
  granSources.forEach((s) => { try { s.stop(); } catch (e) {} });
  granSources = [];
  if (granBus) { try { granBus.disconnect(); } catch (e) {} }
  granActive = false;
}

function startGranular(buffer, params) {
  stopGranular();
  const ctx = getAudioCtx();
  if (!ctx || !buffer) return;
  const speed = Math.min(3, Math.max(1, Number(params.speed) || 1));
  const f = Math.pow(2, (Number(params.pitch) || 0) / 12);
  if (!granBus) { granBus = ctx.createGain(); }
  try { granBus.connect(granInputNode()); } catch (e) { return; }
  granSchedSpeed = speed;
  granF = f;
  const hop = Math.max(0.04, 0.05 / speed);  // spasi antar grain (keluaran)
  const grainOut = hop * 2.5;                 // durasi grain > hop → tumpang tindih seamless
  const env = hop * 1.1;                      // crossfade naik/turun
  const now = ctx.currentTime + 0.05;
  const srcLen = buffer.duration;
  const total = srcLen / speed;
  const n = Math.max(1, Math.floor(total / hop));
  for (let k = 0; k <= n; k++) {
    const win = grainOut * f;                                  // jendela sumber (detik audio)
    const off = Math.min(Math.max(0, k * hop * speed - win / 2), Math.max(0, srcLen - win - 0.001));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = f;
    const g = ctx.createGain();
    const t0 = now + k * hop;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(1, t0 + env);
    g.gain.setValueAtTime(1, t0 + grainOut - env);
    g.gain.linearRampToValueAtTime(0.0001, t0 + grainOut);
    src.connect(g);
    g.connect(granBus);
    src.start(t0, off, grainOut);
    granSources.push(src);
  }
  granActive = true;
  const endAt = now - ctx.currentTime + total + grainOut + 0.3;
  granEndTimer = setTimeout(() => {
    if (granActive) { granActive = false; St.playing = false; updatePlayIcon(); }
  }, endAt * 1000);
  St.playing = true;
  updatePlayIcon();
}

function retuneGranular(f) {
  granF = f;
  granSources.forEach((s) => { try { s.playbackRate.value = f; } catch (e) {} });
}

function scheduleGranRestart(buffer, speed, pitch) {
  if (granRestartTimer) clearTimeout(granRestartTimer);
  granRestartTimer = setTimeout(() => {
    if (granActive) startGranular(buffer, { speed, pitch });
  }, 120);
}

function refreshLivePlayback() {
  const audioEl = $('#previewAudio');
  if (!audioEl) return;
  const p = currentFxParams();
  const speed = Math.min(3, Math.max(1, Number(p.speed) || 1));
  const f = Math.pow(2, (Number(p.pitch) || 0) / 12);
  if (!St.playing) {
    if (granActive) stopGranular();
    audioEl.playbackRate = speed;
    return;
  }
  const wantGran = St._buf && Math.abs(f - 1) > 0.005;
  if (!wantGran) {
    if (granActive) stopGranular();
    audioEl.playbackRate = speed;
    if (audioEl.paused) audioEl.play().catch(() => {});
    return;
  }
  audioEl.pause();
  if (!granActive) {
    startGranular(St._buf, { speed, pitch: p.pitch });
  } else if (Math.abs(speed - granSchedSpeed) > 0.005) {
    scheduleGranRestart(St._buf, speed, p.pitch);
  } else if (Math.abs(f - granF) > 0.001) {
    retuneGranular(f);
  }
}

function updateFxChips() {
  const el = $('#fxLiveChips');
  if (!el) return;
  const p = currentFxParams();
  const bits = [p.speed.toFixed(2) + 'x'];
  if (p.eq && p.eq !== 'normal') bits.push(p.eq);
  if (p.pitch !== 0) bits.push((p.pitch > 0 ? '+' : '') + p.pitch + ' st');
  if (p.amplify !== 0) bits.push((p.amplify > 0 ? '+' : '') + p.amplify + ' dB');
  const extra = ['echo', 'reverb', 'chorus', 'tremolo', 'vibrato', 'radio', 'reverse'].filter((k) => p[k]);
  if (extra.length) bits.push(extra.join('+'));
  if (p.fadeIn || p.fadeOut) bits.push('fade');
  el.textContent = bits.join(' · ');
  const audioEl = $('#previewAudio');
  if (audioEl && !granActive) audioEl.playbackRate = p.speed;
  if (gainNode) gainNode.gain.setTargetAtTime(Math.pow(10, p.amplify / 20), audioCtx.currentTime, 0.05);
  refreshLivePlayback();
}

/* ---------- Waveform ---------- */
function drawWaveform() {
  const canvas = $('#waveformCanvas');
  if (!canvas || !St.peaks.length) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#999999');
  const bars = Math.floor(W / 4);
  const step = Math.max(1, Math.floor(St.peaks.length / bars));
  const mid = H / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < bars; i++) {
    const idx = Math.min(St.peaks.length - 1, i * step);
    const h = Math.max(2, St.peaks[idx] * (H - 14));
    ctx.fillRect(i * 4 + 1, mid - h / 2, 2.4, h);
  }
  const audioEl = $('#previewAudio');
  if (St.playing && audioEl && audioEl.currentTime > 0 && audioEl.duration) {
    ctx.fillStyle = grad;
    ctx.fillRect(Math.max(0, (audioEl.currentTime / audioEl.duration) * W - 1), 0, 2, H);
  }
  const limit = cropLimit();
  if (limit > 0) {
    const total = St.dur || (audioEl ? audioEl.duration : 0) || 0;
    if (total > 0 && limit < total) {
      const bx = (limit / total) * W;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(bx, 0, W - bx, H);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(bx - 1, 0, 2, H);
    }
  }
}

function loadWaveformFromBuffer(buffer) {
  const data = buffer.getChannelData(0);
  const bucket = 220;
  St.peaks = new Array(bucket).fill(0);
  const block = Math.floor(data.length / bucket);
  for (let i = 0; i < bucket; i++) {
    let max = 0;
    for (let j = i * block; j < (i + 1) * block; j += 60) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    St.peaks[i] = Math.min(1, max * 1.4);
  }
  drawWaveform();
}

async function loadStudioAudio(src) {
  stopPreview();
  stopAnalyserLoop();
  stopGranular();
  St.loaded = false;
  St._buf = null;
  const btn = $('#btnPreviewPlay');
  if (btn) { btn.disabled = true; $('#previewDuration').textContent = '00:00 / 00:00'; }
  const audioEl = $('#previewAudio');
  if (!audioEl) return;
  try { audioEl.removeAttribute('src'); audioEl.load(); } catch (e) {}
  audioEl.src = src;
  audioEl.load();
  rebuildFxGraph();
  let decoded = null;
  try {
    const buf = await fetch(src).then((r) => r.arrayBuffer());
    try {
      decoded = await getAudioCtx().decodeAudioData(buf.slice(0)); // copy, biar buf tak terdetach
    } catch (e) { console.warn('decode statis file dilewati:', e); }
  } catch (e) { /* blob tak bisa dibaca — element tetap bisa memutar */ }
  if (decoded) {
    St._buf = decoded;
    loadWaveformFromBuffer(decoded);
    $('#previewDuration').textContent = '00:00 / ' + fmtDur(decoded.duration);
    applyTrackDuration(decoded.duration);
  }
  St.loaded = true;
  if (btn) btn.disabled = false;
  try { getAudioCtx().resume().catch(() => {}); } catch (e) {}
  const hint = $('#waveformHint');
  if (hint) hint.textContent = decoded ? '' : t('studio.previewLive');
}

/* ---------- Player ---------- */
function togglePlay() {
  const audioEl = $('#previewAudio');
  if (!audioEl || !St.loaded) { toast(t('studio.noAudio'), 'warning'); return; }
  rebuildFxGraph(); // idempoten — aman walau element di-re-render (mediaSrc stale)
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  const p = currentFxParams();
  const pitchF = Math.pow(2, (Number(p.pitch) || 0) / 12);
  if (St.playing || !audioEl.paused) {
    stopGranular();
    audioEl.pause();
    St.playing = false;
    updatePlayIcon();
    return;
  }
  if (St._buf && Math.abs(pitchF - 1) > 0.005) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    startGranular(St._buf, p);
    return;
  }
  audioEl.playbackRate = Math.min(3, Math.max(1, p.speed));
  const playNow = () => audioEl.play().then(() => {
    St.playing = true;
    updatePlayIcon();
  }).catch((err) => {
    const n = (err && err.name) || (audioEl.error ? 'MEDIA_ERR_' + audioEl.error.code : 'err');
    console.error('play failed:', err, audioEl.error);
    toast(t('studio.playErr') + ' [' + n + ']', 'error');
    if (audioEl.error && audioEl.error.code === 4) {
      const hint = $('#waveformHint');
      if (hint) hint.textContent = '⚠ ' + t('studio.waveErr') + ' [MEDIA_ERR_SRC_NOT_SUPPORTED]';
    }
  });
  const doPlay = () => {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    playNow();
  };
  if (audioEl.readyState >= 2) doPlay();
  else audioEl.addEventListener('canplay', doPlay, { once: true });
}

function stopPreview() {
  const audioEl = $('#previewAudio');
  if (audioEl) { try { audioEl.pause(); } catch (e) {} }
  St.playing = false;
  updatePlayIcon();
}

function updatePlayIcon() {
  const el = $('#playIconSvg');
  if (!el) return;
  el.innerHTML = St.playing
    ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
    : '<polygon points="7 4 20 12 7 20 7 4"/>';
}

function seekWaveform(e) {
  const audioEl = $('#previewAudio');
  if (!audioEl || !audioEl.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  audioEl.currentTime = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * audioEl.duration;
}

/* ---------- Source: URL + file ---------- */
async function loadUrlInfo(url) {
  St.file = null;
  if (!$('#selectedFileCard')) return;
  $('#selectedFileCard').style.display = 'none';
  const card = $('#youtubePreviewCard');
  const status = $('#urlProbeStatus');
  if (!/^https?:\/\//.test(url)) { if (card) card.style.display = 'none'; return; }
  try {
    if (status) status.textContent = t('studio.loading') + '…';
    const info = await api('/api/media/info?url=' + encodeURIComponent(url), { method: 'GET' });
    State.studio.title = info.title;
    St.thumbUrl = info.thumbnail || '';
    applyTrackDuration(info.duration || 0);
    const img = $('#ytPreviewImage');
    if (img) img.src = info.thumbnail || 'assets/logo.jpg';
    const tEl = $('#ytPreviewTitle');
    if (tEl) tEl.textContent = info.title;
    const cEl = $('#ytPreviewChannel');
    if (cEl) cEl.textContent = (info.channel || '') + (info.duration ? ' · ' + fmtDur(info.duration) : '');
    if (card) card.style.display = 'flex';
    if (status) status.textContent = '';
    loadPreviewFromUrl(url);
  } catch (e) {
    if (card) card.style.display = 'none';
    if (status) status.textContent = 'Error: ' + e.message;
  }
}

function setPreviewLoading(on) {
  const btn = $('#btnPreviewPlay');
  const status = $('#urlProbeStatus');
  const hint = $('#waveformHint');
  const msg = t('studio.loadingPreview');
  if (on) {
    if (btn) btn.disabled = true;
    if (status) status.textContent = msg;
    if (hint) hint.textContent = msg;
  } else {
    if (status && String(status.textContent).startsWith(t('studio.loadingPreview'))) status.textContent = '';
    if (hint && String(hint.textContent).startsWith(t('studio.loadingPreview'))) hint.textContent = '';
  }
}

async function loadPreviewFromUrl(url) {
  const hintEl = $('#waveformHint');
  setPreviewLoading(true);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const res = await fetch('/api/media/preview?url=' + encodeURIComponent(url), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      let msg = 'Preview HTTP ' + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const buf = await res.arrayBuffer();
    const magic = buf.byteLength >= 4 ? Array.from(new Uint8Array(buf.slice(0, 4))).join(' ') : 'n/a';
    const len = buf.byteLength;
    let decoded = null;
    try {
      decoded = await getAudioCtx().decodeAudioData(buf.slice(0)); // copy, biar buf asli tak terdetach
    } catch (eDec) {
      console.warn('decode statis preview dilewati:', eDec && eDec.name, eDec && eDec.message);
    }
    stopPreview();
    stopAnalyserLoop();
    stopGranular();
    St._buf = null;
    const audioEl = $('#previewAudio');
    if (audioEl) {
      try { audioEl.removeAttribute('src'); audioEl.load(); } catch (e2) {}
      audioEl.src = '/api/media/preview?url=' + encodeURIComponent(url) + '&t=' + Date.now();
      audioEl.load();
    }
    St._dbg = { len, magic };
    rebuildFxGraph();
    if (decoded) {
      St._buf = decoded;
      loadWaveformFromBuffer(decoded);
      $('#previewDuration').textContent = '00:00 / ' + fmtDur(decoded.duration);
      applyTrackDuration(decoded.duration);
    }
    St.loaded = true;
    const btn = $('#btnPreviewPlay');
    if (btn) btn.disabled = false;
    setPreviewLoading(false);
    try { getAudioCtx().resume().catch(() => {}); } catch (e3) {}
    if (hintEl) hintEl.textContent = decoded ? '' : t('studio.previewLive');
  } catch (e) {
    setPreviewLoading(false);
    if (hintEl) {
      const silent = /detached arraybuffer/i.test(String(e.message || e));
      hintEl.textContent = silent ? t('studio.previewLive') : ('Error: ' + String(e.message || e).slice(0, 130));
    }
    try { console.error('preview:', e); } catch (e2) {}
  }
}

function handleFileSelect(file) {
  if (!file) return;
  const maxMb = (State.config && State.config.maxUploadMb) || 20;
  if (file.size > maxMb * 1024 * 1024) {
    toast(t('studio.fileBig') + ' ' + maxMb + 'MB', 'error');
    return;
  }
  St.file = file;
  St.fileName = file.name;
  State.studio.title = file.name.replace(/\.[^.]+$/, '');
  const nameEl = $('#selectedFileName');
  if (nameEl) nameEl.textContent = file.name;
  const sizeEl = $('#selectedFileSize');
  if (sizeEl) sizeEl.textContent = ' (' + (file.size / 1024 / 1024).toFixed(2) + ' MB)';
  $('#selectedFileCard').style.display = 'flex';
  const urlEl = $('#audioUrlInput');
  if (urlEl) urlEl.value = '';
  const yt = $('#youtubePreviewCard');
  if (yt) yt.style.display = 'none';
  loadStudioAudio(URL.createObjectURL(file));
  updateConvertBtnState();
}

function clearSelectedFile() {
  St.file = null;
  St.fileName = '';
  St.dur = 0;
  applyTrackDuration(0);
  const card = $('#selectedFileCard');
  if (card) card.style.display = 'none';
  updateConvertBtnState();
}

/* ================= TAB ================= */
async function renderStudio(isLangRefresh) {
  const body = $('#dashboardBody');
  if (!body) return;

  body.innerHTML = `
  <div class="dashboard-grid-2 studio-grid">
    <div>
      <div class="layout-card">
        <button type="button" class="sec-head first" data-sec="src"><span>${icon('music', 14)} ${esc(t('studio.source'))}</span><svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="sec-body" data-sec="src">
        <h3 class="card-title">${esc(t('studio.title'))} <span class="sub">${esc(t('studio.sub'))}</span></h3>

        <label class="field-label">${esc(t('studio.url'))}</label>
        <input type="url" id="audioUrlInput" class="input-control" placeholder="https://youtube.com/watch?v=...">
        <div class="small-note" id="urlProbeStatus" style="margin-top:6px;"></div>
        <div class="url-preview-card" id="youtubePreviewCard" style="display:none;">
          <img src="" id="ytPreviewImage" alt="">
          <div class="grow" style="min-width:0;">
            <div class="up-title" id="ytPreviewTitle">-</div>
            <div class="up-channel" id="ytPreviewChannel">-</div>
          </div>
          <button class="file-remove-btn" id="btnRemoveYtPreview" title="Clear">${icon('x', 14)}</button>
        </div>

        <div style="text-align:center;color:var(--t3);font-size:.74rem;font-weight:700;margin:12px 0;">— OR —</div>

        <label class="field-label">${esc(t('studio.file'))}</label>
        <div class="dropzone" id="audioDropzone">
          <input type="file" id="audioFileInput" accept="audio/*" style="display:none;">
          <div class="dropzone-icon">${icon('music', 44)}</div>
          <div class="dropzone-text">${esc(t('studio.drop'))}</div>
          <div class="dropzone-hint">MP3 · WAV · M4A · OGG · AAC · FLAC · OPUS — max ${State.config && State.config.maxUploadMb ? State.config.maxUploadMb : 20}MB</div>
        </div>
        <div class="selected-file-card" id="selectedFileCard" style="display:none;">
          <div class="file-info">${icon('music', 16)} <span id="selectedFileName">audio.mp3</span><span style="color:var(--t3);" id="selectedFileSize"></span></div>
          <button class="file-remove-btn" id="fileRemoveBtn">${icon('x', 14)}</button>
        </div>

        <label class="field-label mt-14">${esc(t('studio.assetName'))}</label>
        <input type="text" id="assetNameInput" class="input-control" placeholder="My Awesome Sound">

        <label class="field-label mt-14">${esc(t('keys.select'))}</label>
        <select id="uploaderApiKeySelect" class="input-control">${keyOptionsHtml()}</select>
        <div class="small-note mt-4" style="display:flex;justify-content:space-between;">
          <span>${esc(t('studio.keyNote'))}</span>
          <a href="#" onclick="switchTab('keys');return false;" style="font-weight:700;">${esc(t('ov.addKey'))} →</a>
        </div>
        </div>

        <hr class="hr-desk" style="border:none;border-top:1px solid var(--border);margin:18px 0;">

        <button type="button" class="sec-head" data-sec="fx"><span>${icon('split', 14)} ${esc(t('studio.fx'))}</span><svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="sec-body closed" data-sec="fx">

        <div class="preset-row">
          <label class="field-label mb-0" style="white-space:nowrap;">${icon('beaker', 14)} ${esc(t('studio.preset'))}</label>
          <div class="fx-preset-dd" id="fxPresetDD">
            <button type="button" class="fx-preset-trigger" id="fxPresetTrigger" aria-haspopup="listbox" aria-expanded="false">
              <span class="fx-preset-label" id="fxPresetLabel">${esc(t('studio.presetPlaceholder'))}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div class="fx-preset-menu" id="fxPresetMenu" role="listbox" style="display:none;"></div>
          </div>
          <button class="chip" id="fxPresetSaveBtn" title="${esc(t('studio.presetSave'))}">${icon('star', 14)} ${esc(t('studio.presetSaveBtn'))}</button>
          <button class="chip danger icon-btn" id="fxPresetDelBtn" title="${esc(t('studio.presetDelete'))}" style="display:none;">${icon('trash', 14)}</button>
        </div>

        <div class="flex-between">
          <label class="field-label mb-0">${esc(t('studio.fx'))}</label>
          <button class="chip" id="fxResetBtn">${icon('refresh', 14)} reset</button>
        </div>

        <div class="slider-row"><label>${esc(t('studio.speed'))} <span class="t-desc">(${esc(t('studio.speedPreserve'))})</span></label><output id="outSpeed">1.00x</output></div>
        <input type="range" id="fxSpeed" min="1" max="3" step="0.05" value="1">
        <div class="chip-row" id="speedPresets">
          ${[['1', '1.0x'], ['1.5', '1.5x'], ['2', '2.0x'], ['2.5', '2.5x'], ['3', '3.0x']].map(([v, l]) =>
            `<button class="chip${v === '1' ? ' active' : ''}" data-speed="${v}">${l}</button>`).join('')}
        </div>

        <div class="slider-row"><label>${esc(t('studio.amplify'))}</label><output id="outAmplify">0 dB</output></div>
        <input type="range" id="fxAmplify" min="-20" max="20" step="1" value="0">

        <div class="slider-row"><label>${esc(t('studio.pitch'))}</label><output id="outPitch">0 st</output></div>
        <input type="range" id="fxPitch" min="-12" max="12" step="1" value="0">

        <label class="field-label mt-14">${esc(t('studio.eq'))}</label>
        <div class="chip-row" id="fxEqRow">
          ${[['normal', 'Normal'], ['bass', 'Bass'], ['vocals', 'Vocals'], ['treble', 'Treble'], ['vintage', 'Vintage']].map(([v, l]) =>
            `<button class="chip${v === 'normal' ? ' active' : ''}" data-eq="${v}">${l}</button>`).join('')}
        </div>
        <div class="small-note">${esc(t('studio.eqNote'))}</div>

        <div class="toggle-row">
          <div class="t-label"><span>${icon('split', 13)} ${esc(t('studio.crop'))}</span><span class="t-desc">${esc(t('studio.cropDesc'))}</span></div>
          <label class="switch"><input type="checkbox" id="fxCrop"><span class="sl"></span></label>
        </div>
        <div class="slider-row"><label>${esc(t('studio.maxDur'))}</label><output id="outMaxDur">${esc(t('studio.fullSong'))}</output></div>
        <input type="range" id="fxMaxDur" min="10" max="1800" step="10" value="420" disabled>

        <div class="toggle-row">
          <div class="t-label"><span>${icon('upRight', 13)} Fade In</span><span class="t-desc">${esc(t('studio.fadeInDesc'))}</span></div>
          <label class="switch"><input type="checkbox" id="fxFadeIn"><span class="sl"></span></label>
        </div>
        <div class="toggle-row">
          <div class="t-label"><span>${icon('downLeft', 13)} Fade Out</span><span class="t-desc">${esc(t('studio.fadeOutDesc'))}</span></div>
          <label class="switch"><input type="checkbox" id="fxFadeOut"><span class="sl"></span></label>
        </div>
        <div class="toggle-row">
          <div class="t-label"><span>${icon('split', 13)} Auto-Split</span><span class="t-desc">${esc(t('studio.splitDesc'))}</span></div>
          <label class="switch"><input type="checkbox" id="fxAutoSplit" checked><span class="sl"></span></label>
        </div>

        <label class="field-label mt-14">${esc(t('studio.fxExtra'))}</label>
        <div class="chip-row" id="fxExtraRow">
          ${['echo', 'reverb', 'chorus', 'tremolo', 'vibrato', 'radio', 'reverse'].map((k) =>
            `<button class="chip tog" data-fx="${k}">${esc(t('studio.' + k))}</button>`).join('')}
        </div>
        <div class="small-note">${esc(t('studio.fxExtraNote'))}</div>
        </div>

        <button class="btn-primary btn-full mt-20" id="convertUploadBtn" style="padding:15px;" disabled>
          ${icon('music', 15)} ${esc(t('studio.convert'))}
        </button>
        <div class="small-note mt-8" style="text-align:center;" id="quotaNote"></div>
      </div>
    </div>

    <div>
      <button type="button" class="sec-head" data-sec="right"><span>${icon('play', 14)} ${esc(t('studio.preview'))} & ${esc(t('studio.convert'))}</span><svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="sec-body closed" data-sec="right">
      <div class="layout-card player-wrap">
        <h3 class="card-title mb-0">${esc(t('studio.preview'))} <span class="fx-live-note" id="fxLiveChips">1.00x</span></h3>
        <div id="waveformContainer" style="position:relative;height:110px;margin:12px 0;cursor:pointer;background:rgba(255,255,255,0.03);border-radius:12px;overflow:hidden;">
          <canvas id="waveformCanvas" style="width:100%;height:100%;"></canvas>
          <div id="waveformHint" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:.8rem;">${esc(t('studio.waveWait'))}</div>
        </div>
        <div class="player-bar">
          <button class="btn-play" id="btnPreviewPlay" disabled>
            <svg id="playIconSvg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>
          </button>
          <span class="player-time" id="previewDuration">00:00 / 00:00</span>
          <div class="player-info grow" style="text-align:right;" id="previewSourceInfo">${esc(t('studio.noAudio'))}</div>
        </div>
        <audio id="previewAudio" style="display:none;" preload="auto"></audio>
      </div>

      <div class="layout-card" id="consoleLayoutCard" style="display:none;">
        <div class="flex-between">
          <h3 class="card-title mb-0">${icon('terminal', 18)} ${esc(t('studio.console'))}</h3>
          <span id="consoleStatusPill"></span>
        </div>
        <div class="process-console" id="processConsole" style="margin-top:10px;"><span class="info">Console ready.</span></div>
        <div class="progress-track mt-8"><div class="progress-fill" id="consoleProgressFill"></div></div>
        <div id="convertResultCard" class="mt-14"></div>
      </div>

      <div class="layout-card">
        <h3 class="card-title">${icon('bolt', 18)} ${esc(t('studio.batchTitle'))}</h3>
        <p class="small-note">${esc(t('studio.batchDesc'))}</p>
        <textarea id="batchUrls" class="input-control batch-input" placeholder="https://youtube.com/watch?v=...&#10;https://soundcloud.com/...&#10;https://tiktok.com/..."></textarea>
        <select id="batchApiKeySelect" class="input-control mt-14">${keyOptionsHtml()}</select>
        <button class="btn-outline btn-full mt-14" id="batchConvertBtn">${icon('rocket', 15)} ${esc(t('studio.batchRun'))}</button>
      </div>
      </div>
    </div>
  </div>`;

  /* ----- bind ----- */
  const urlInput = $('#audioUrlInput');
  let probeTimer = null;
  urlInput.addEventListener('input', () => {
    clearTimeout(probeTimer);
    const v = urlInput.value.trim();
    probeTimer = setTimeout(() => {
      if (v) loadUrlInfo(v);
      else { const yt = $('#youtubePreviewCard'); if (yt) yt.style.display = 'none'; }
      updateConvertBtnState();
    }, 700);
  });
  $('#btnRemoveYtPreview').addEventListener('click', () => {
    urlInput.value = '';
    const yt = $('#youtubePreviewCard');
    if (yt) yt.style.display = 'none';
    updateConvertBtnState();
  });

  const dz = $('#audioDropzone');
  dz.addEventListener('click', () => $('#audioFileInput').click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('dragover'); handleFileSelect(e.dataTransfer.files[0]); });
  $('#audioFileInput').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
  $('#fileRemoveBtn').addEventListener('click', clearSelectedFile);

  const slider = (id, outId, fmt) => {
    const inp = $(id);
    inp.addEventListener('input', () => {
      $(outId).textContent = fmt(inp.value);
      rebuildFxGraph();
      updateFxChips();
    });
  };
  slider('#fxSpeed', '#outSpeed', (v) => Number(v).toFixed(2) + 'x');
  slider('#fxAmplify', '#outAmplify', (v) => (Number(v) > 0 ? '+' : '') + v + ' dB');
  slider('#fxPitch', '#outPitch', (v) => (Number(v) > 0 ? '+' : '') + v + ' st');
  $('#fxMaxDur').addEventListener('input', () => { syncMaxDur(); rebuildFxGraph(); updateFxChips(); });
  $('#fxCrop').addEventListener('change', () => { syncMaxDur(); rebuildFxGraph(); updateFxChips(); });

  $('#speedPresets').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    $('#speedPresets').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    $('#fxSpeed').value = c.dataset.speed;
    $('#outSpeed').textContent = Number(c.dataset.speed).toFixed(2) + 'x';
    rebuildFxGraph();
    updateFxChips();
  }));
  $('#fxEqRow').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    $('#fxEqRow').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    rebuildFxGraph();
    updateFxChips();
  }));
  $('#fxExtraRow').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    c.classList.toggle('active');
    rebuildFxGraph();
    updateFxChips();
  }));
  $('#fxResetBtn').addEventListener('click', () => {
    $('#fxSpeed').value = 1; $('#outSpeed').textContent = '1.00x';
    $('#speedPresets').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.speed === '1'));
    $('#fxAmplify').value = 0; $('#outAmplify').textContent = '0 dB';
    $('#fxPitch').value = 0; $('#outPitch').textContent = '0 st';
    $('#fxMaxDur').value = 420; syncMaxDur();
    $('#fxFadeIn').checked = false; $('#fxFadeOut').checked = false;
    $('#fxEqRow').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.eq === 'normal'));
    $('#fxExtraRow').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
    rebuildFxGraph();
    updateFxChips();
  });
  const presetTrigger = $('#fxPresetTrigger');
  const presetMenu = $('#fxPresetMenu');
  const presetDD = $('#fxPresetDD');
  presetTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = presetMenu.style.display === 'block';
    presetMenu.style.display = open ? 'none' : 'block';
    presetTrigger.setAttribute('aria-expanded', String(!open));
  });
  presetMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.fx-preset-item-apply');
    if (!btn) return;
    const id = btn.dataset.preset;
    const preset = String(id).startsWith('u_')
      ? loadUserPresets().find((x) => x.id === id)
      : BUILTIN_PRESETS.find((x) => x.id === id);
    if (!preset) return;
    applyPreset(preset);
    activePresetId = id;
    $('#fxPresetLabel').textContent = preset.name;
    const del = $('#fxPresetDelBtn');
    if (del) del.style.display = String(id).startsWith('u_') ? 'inline-flex' : 'none';
    presetMenu.style.display = 'none';
    presetTrigger.setAttribute('aria-expanded', 'false');
    toast(t('studio.presetApply'), 'success');
  });
  document.addEventListener('click', (e) => {
    if (presetDD && !presetDD.contains(e.target)) {
      presetMenu.style.display = 'none';
      presetTrigger.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      presetMenu.style.display = 'none';
      presetTrigger.setAttribute('aria-expanded', 'false');
    }
  });
  $('#fxPresetSaveBtn').addEventListener('click', saveCurrentAsPreset);
  $('#fxPresetDelBtn').addEventListener('click', deleteSelectedPreset);
  refreshPresetOptions();
  $('#fxFadeIn').addEventListener('change', () => { rebuildFxGraph(); updateFxChips(); });
  $('#fxFadeOut').addEventListener('change', () => { rebuildFxGraph(); updateFxChips(); });

  document.querySelectorAll('.sec-head').forEach((h) => h.addEventListener('click', () => {
    const open = h.classList.toggle('open');
    const body = h.nextElementSibling;
    if (body) body.classList.toggle('closed', !open);
  }));

  $('#btnPreviewPlay').addEventListener('click', togglePlay);
  $('#previewAudio').addEventListener('error', () => {
    const a = $('#previewAudio');
    const code = a && a.error ? a.error.code : 'n/a';
    const dbg = St._dbg ? ' [len=' + St._dbg.len + ' magic=' + St._dbg.magic + ']' : '';
    console.error('previewAudio MEDIA_ERR_' + code, (a && (a.currentSrc || a.src)) || '', dbg);
    const hint = $('#waveformHint');
    if (hint && a && a.error) hint.textContent = '⚠ play failed [MEDIA_ERR_' + code + ']' + dbg;
  });
  $('#previewAudio').addEventListener('timeupdate', () => {
    const a = $('#previewAudio');
    const limit = cropLimit();
    if (limit > 0 && a.currentTime >= limit) {
      a.pause();
      stopGranular();
      St.playing = false;
      updatePlayIcon();
      toast(t('studio.cropStop'), 'info');
    }
    $('#previewDuration').textContent = fmtDur(a.currentTime) + ' / ' + fmtDur(a.duration || 0);
    drawWaveform();
  });
  $('#previewAudio').addEventListener('ended', () => { stopGranular(); St.playing = false; updatePlayIcon(); });
  $('#waveformContainer').addEventListener('click', seekWaveform);

  $('#uploaderApiKeySelect').addEventListener('change', updateConvertBtnState);
  $('#convertUploadBtn').addEventListener('click', startConvert);
  $('#batchConvertBtn')?.addEventListener('click', runBatchConvert);

  const quotaEl = $('#quotaNote');
  if (quotaEl) {
    quotaEl.innerHTML = `<span style="color:var(--ok);">${icon('chart', 15)} ${esc(t('studio.unlimited'))}</span>`;
  }
  updateConvertBtnState();
}

/* ---------- Max length per asset: auto-follow track, full or crop ---------- */
function applyTrackDuration(sec) {
  St.dur = Math.max(0, Number(sec) || 0);
  const slider = $('#fxMaxDur');
  if (!slider) return;
  const d = St.dur;
  if (d > 0) slider.max = Math.min(MAX_ASSET_SEC, d);
  const crop = $('#fxCrop');
  if (crop && !crop.checked) slider.value = String(Math.max(10, Math.min(MAX_ASSET_SEC, d || 420)));
  syncMaxDur();
}

function cropLimit() {
  const crop = $('#fxCrop');
  const slider = $('#fxMaxDur');
  if (!crop || !crop.checked || !slider) return 0;
  const val = parseFloat(slider.value) || 0;
  const d = St.dur;
  return d > 0 ? Math.min(val, d) : val;
}

function syncMaxDur() {
  const slider = $('#fxMaxDur');
  const crop = $('#fxCrop');
  const out = $('#outMaxDur');
  if (!slider) return;
  const d = St.dur;
  if (d > 0) slider.max = Math.min(MAX_ASSET_SEC, d);
  const on = !!(crop && crop.checked);
  slider.disabled = !on;
  if (out) {
    out.textContent = on ? fmtDur(cropLimit()) : (d > 0 ? t('studio.fullSong') + ' · ' + fmtDur(d) : t('studio.fullSong'));
  }
  drawWaveform();
}

function updateConvertBtnState() {
  const btn = $('#convertUploadBtn');
  if (!btn) return;
  const urlOk = /^https?:\/\//.test($('#audioUrlInput').value.trim());
  const hasKey = !!$('#uploaderApiKeySelect').value;
  btn.disabled = !((St.file || urlOk) && hasKey);
}

/* ================= CONVERT ================= */
async function startConvert() {
  const url = $('#audioUrlInput').value.trim();
  const sourceType = St.file ? 'file' : url ? 'url' : null;
  if (!sourceType) return toast(t('studio.noSource'), 'error');
  if (!prefFreeCheck()) return;

  const params = currentFxParams();
  const apiKeyId = $('#uploaderApiKeySelect').value;
  if (!apiKeyId) return toast(t('keys.select') + '!', 'warning');
  const assetName = $('#assetNameInput').value.trim() || State.studio.title || 'CVA Audio';

  busy(true);
  try {
    const fd = new FormData();
    if (St.file) fd.append('file', St.file);
    else fd.append('url', url);
    fd.append('assetName', assetName);
    fd.append('apiKeyId', apiKeyId);
    fd.append('speed', String(params.speed));
    fd.append('amplify', String(params.amplify));
    fd.append('pitch', String(params.pitch));
    fd.append('eq', String(params.eq));
    fd.append('echo', String(params.echo));
    fd.append('reverb', String(params.reverb));
    fd.append('chorus', String(params.chorus));
    fd.append('tremolo', String(params.tremolo));
    fd.append('vibrato', String(params.vibrato));
    fd.append('radio', String(params.radio));
    fd.append('reverse', String(params.reverse));
    fd.append('maxDuration', String(params.maxDuration));
    fd.append('fadeIn', String(params.fadeIn));
    fd.append('fadeOut', String(params.fadeOut));
    fd.append('autoSplit', String(params.autoSplit));
    const d = await api('/api/convert', { method: 'POST', body: fd });
    toast(t('studio.jobStarted'), 'success');
    showConsoleFor(d.id);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    busy(false);
  }
}

function prefFreeCheck() {
  return true;
}

function showConsoleFor(jobId) {
  studioJobId = jobId;
  $('#consoleLayoutCard').style.display = 'block';
  $('#processConsole').innerHTML = `<span class="info">${icon('load', 14)} ${esc(t('studio.jobStarting'))}</span>`;
  $('#consoleProgressFill').style.width = '5%';
  $('#convertResultCard').innerHTML = '';
  const pill = $('#consoleStatusPill');
  if (pill) pill.innerHTML = statusPill('queued');
  const btn = $('#convertUploadBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = `${icon('load', 14)} ${esc(t('studio.busy'))}`; }
  clearInterval(State.consoleTimer);
  State.consoleTimer = null;
  const render = async () => {
    let data;
    try {
      data = await api('/api/history/' + jobId + '/console');
    } catch (e) {
      clearInterval(State.consoleTimer);
      State.consoleTimer = null;
      const btn2 = $('#convertUploadBtn');
      if (btn2) { btn2.disabled = false; btn2.innerHTML = `${icon('music', 15)} ${esc(t('studio.convert'))}`; }
      return;
    }
    renderConsole(data);
    if (['approved', 'rejected', 'error'].includes(data.status)) {
      clearInterval(State.consoleTimer);
      State.consoleTimer = null;
      const btn3 = $('#convertUploadBtn');
      if (btn3) { btn3.disabled = false; btn3.innerHTML = `${icon('music', 15)} ${esc(t('studio.convert'))}`; }
      renderConsoleResult(data);
      refreshUser().then(() => renderSidebarUser());
      if (State.tab === 'history') renderHistory(true);
    }
  };
  render();
  State.consoleTimer = setInterval(render, 1400);
}

function renderConsole(data) {
  const consoleEl = $('#processConsole');
  if (!consoleEl) return;
  consoleEl.innerHTML = (data.log || []).map((line) => {
    let cls = 'info';
    if (/gagal|error|✗|⚠|500/i.test(line)) cls = 'err';
    else if (/selesai|berhasil|✓|approved|done|Asset ID/i.test(line)) cls = 'ok';
    else if (/menunggu|moderasi|demo|poller|antre/i.test(line)) cls = 'warn';
    return `<span class="${cls}">${esc(line)}</span>`;
  }).join('\n') || '<span class="info">(kosong)</span>';
  consoleEl.scrollTop = 99999;
  const pill = $('#consoleStatusPill');
  if (pill) pill.innerHTML = statusPill(data.status);
  const fill = $('#consoleProgressFill');
  const map = { queued: 8, processing: 45, uploaded: 85, approved: 100, rejected: 100, error: 100 };
  if (fill) fill.style.width = (map[data.status] || 10) + '%';
}

function renderConsoleResult(data) {
  const wrap = $('#convertResultCard');
  if (!wrap) return;
  if (data.status === 'error') {
    let msg = data.error || t('gate.msg');
    if (/unauthorized to create an Audio asset/i.test(msg)) {
      msg += ' — ' + t('studio.errCreatorHint');
    }
    wrap.innerHTML = `<div class="result-card err">${icon('x', 15)} ${esc(msg)}</div>`;
    return;
  }
  const parts = data.parts || [];
  if (!parts.length) return;
  const allApproved = parts.every((p) => p.moderationState === 'Approved');
  const statusIcon = data.status === 'rejected' ? 'x' : data.status === 'approved' ? 'check' : 'load';
  wrap.innerHTML = `
    <div class="result-card">
      <div style="font-weight:800;margin-bottom:6px;">${icon(statusIcon, 15)} ${esc(t('studio.done'))}</div>
      ${parts.map((p) => `
        <div class="hist-part">
          <span style="font-weight:700;">Part ${p.index}:</span>
          <span class="asset-id" onclick="copyText('${p.assetId}')" title="Klik untuk salin">rbxassetid://${p.assetId}</span>
          ${modPill(p.moderationState)}
        </div>`).join('')}
      <div class="small-note mt-8">${esc(t('history.checkTab'))} → ${esc(t('tab.history'))}</div>
    </div>`;
}

/* ================= BATCH ================= */
async function runBatchConvert() {
  const urls = $('#batchUrls').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const apiKeyId = $('#batchApiKeySelect').value;
  if (!urls.length) return toast(t('studio.batchEmpty'), 'warning');
  if (!apiKeyId) return toast(t('keys.select') + '!', 'warning');
  const params = currentFxParams();
  busy(true);
  try {
    const d = await api('/api/convert/batch', {
      method: 'POST',
      body: JSON.stringify({
        urls,
        apiKeyId,
        assetName: $('#assetNameInput').value.trim() || 'CVA Batch',
        speed: params.speed, amplify: params.amplify, pitch: params.pitch,
        eq: params.eq,
        echo: params.echo, reverb: params.reverb, chorus: params.chorus,
        tremolo: params.tremolo, vibrato: params.vibrato,
        radio: params.radio, reverse: params.reverse,
        maxDuration: params.maxDuration, fadeIn: String(params.fadeIn), fadeOut: String(params.fadeOut), autoSplit: String(params.autoSplit)
      })
    });
    toast(t('studio.batchStarted', { count: d.ids.length }), 'success');
    switchTab('history');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    busy(false);
  }
}