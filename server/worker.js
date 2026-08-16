const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const store = require('./db');
const roblox = require('./roblox');
const media = require('./media');
const audio = require('./audio');

const queue = [];
let running = false;
let pollTimer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appendLog(historyId, line) {
  const row = store.db.prepare('SELECT log FROM history WHERE id = ?').get(historyId);
  if (!row) return;
  const stamp = '[' + new Date().toLocaleTimeString('id-ID') + '] ' + line;
  store.db.prepare('UPDATE history SET log = ?, updated_at = ? WHERE id = ?').run(
    (row.log + '\n' + stamp).slice(-20000),
    Date.now(),
    historyId
  );
}

function setStatus(historyId, status, extra = {}) {
  const fields = Object.keys(extra).map((k) => `${k} = @${k}`).join(', ');
  const params = { ...extra, status, updated_at: Date.now(), id: historyId };
  if (fields) {
    store.db.prepare(`UPDATE history SET ${fields}, status = @status, updated_at = @updated_at WHERE id = @id`).run(params);
  } else {
    store.db.prepare('UPDATE history SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), historyId);
  }
}

function updatePart(historyId, index, patch) {
  const row = store.db.prepare('SELECT parts FROM history WHERE id = ?').get(historyId);
  if (!row) return;
  const parts = JSON.parse(row.parts || '[]');
  const part = parts.find((p) => p.index === index);
  if (!part) return;
  Object.assign(part, patch);
  store.db.prepare('UPDATE history SET parts = ? WHERE id = ?').run(JSON.stringify(parts), historyId);
}

function pushJob(job) {
  queue.push(job);
  pump();
}

async function processJob(job) {
  const { historyId, userId } = job;
  try {
    setStatus(historyId, 'processing');
    appendLog(historyId, `Memulai konversi: ${job.assetName || 'Untitled'}`);

    const key = (() => {
      try {
        return roblox.loadKey(job.apiKeyId, userId);
      } catch (e) {
        throw new Error(e.message === 'API Key tidak ditemukan' ? 'Pilih Roblox API Key terlebih dahulu' : e.message);
      }
    })();
    appendLog(historyId, `Mode target: ${key.is_demo ? 'DEMO (simulasi Roblox)' : 'Roblox Open Cloud'}`);

    let title = job.assetName || '';
    let channel = '';
    let thumbnail = '';
    let sourcePath = job.filePath || '';

    if (job.sourceType === 'url') {
      appendLog(historyId, 'Mengambil info media dari URL...');
      const info = await media.fetchMediaInfo(job.sourceUrl);
      title = info.title;
      channel = info.channel;
      thumbnail = info.thumbnail;
      appendLog(historyId, `Media ditemukan: ${title}`);
      if (info.duration === 0) {
        appendLog(historyId, 'Durasi media tidak terdeteksi, lanjut download...');
      }
      store.db.prepare('UPDATE history SET title = ?, thumbnail = ?, source_url = ? WHERE id = ?')
        .run(title.slice(0, 200), thumbnail, job.sourceUrl, historyId);

      appendLog(historyId, 'Mengunduh audio (yt-dlp)...');
      const outDir = path.join(cfg.UPLOAD_DIR, 'dl', historyId);
      sourcePath = await media.downloadAudio(job.sourceUrl, path.join(outDir, 'src'));
      appendLog(historyId, 'Download selesai.');
    } else {
      if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('File sumber tidak ditemukan');
      appendLog(historyId, `File sumber: ${title}`);
    }

    const duration = await audio.ffprobeDuration(sourcePath);
    const params = audio.clampParams(job.params || {});
    if (!duration || duration <= 0) throw new Error('Audio tidak valid / durasi 0');

    const partsPlan = audio.splitPlan(duration, params);
    const assetName = (job.assetName || title || 'CVA Audio').slice(0, 60);
    store.db.prepare('UPDATE history SET asset_name = ? WHERE id = ?').run(assetName, historyId);

    const parts = [];
    for (const part of partsPlan) {
      const outDir = path.join(cfg.OUT_DIR, historyId);
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `part_${part.index}.mp3`);

      appendLog(historyId, `Memproses bagian ${part.index}/${partsPlan.length} (${formatDur(part.end - part.start)}) via FFmpeg...`);
      await audio.processAudio(sourcePath, outFile, params, { start: part.start, end: part.end });
      appendLog(historyId, `Bagian ${part.index} selesai diproses.`);

      const partsTotal = partsPlan.length;
      const displayName = partsTotal > 1 ? `${assetName} (Part ${part.index})` : assetName;
      appendLog(historyId, `Upload ${displayName} ke Roblox${key.is_demo ? ' (demo)' : ''}...`);
      const result = await roblox.createAudioAsset(key, {
        displayName,
        filePath: outFile,
        description: `Converted by CVA STUDIO | ${new Date().toISOString()}`
      });

      parts.push({
        index: part.index,
        assetId: result.assetId,
        moderationState: result.moderationState || 'Pending',
        durationSec: Math.round((part.end - part.start) * 10) / 10
      });
      updatePart(historyId, part.index, { assetId: result.assetId, moderationState: result.moderationState || 'Pending' });
      appendLog(historyId, `Asset ID ${result.assetId} berhasil dibuat (${result.moderationState}).`);
    }

    setStatus(historyId, 'uploaded', {
      file_path: sourcePath,
      output_path: path.join(cfg.OUT_DIR, historyId, 'part_1.mp3'),
      parts: JSON.stringify(parts),
      error: ''
    });

    const allDemoOrDone = key.is_demo || parts.every((p) => p.moderationState === 'Approved' || p.moderationState === 'Rejected');
    if (allDemoOrDone) {
      scheduleDemoApproval(historyId, key.is_demo);
    } else {
      appendLog(historyId, 'Menunggu hasil moderasi Roblox (poller otomatis berjalan)...');
    }

    appendLog(historyId, key.is_demo
      ? 'Demo: aset dibuat. Moderasi simulasi dimulai...'
      : 'Konversi selesai. Status moderasi akan diperbarui otomatis.');
  } catch (e) {
    setStatus(historyId, 'error', { error: String(e.message || 'Unknown error').slice(0, 500) });
    appendLog(historyId, 'GAGAL: ' + String(e.message || 'Unknown error'));
  }
}

function scheduleDemoApproval(historyId, isDemo) {
  if (!isDemo) return;
  const row = store.db.prepare('SELECT parts FROM history WHERE id = ?').get(historyId);
  if (!row) return;
  const parts = JSON.parse(row.parts || '[]');
  const delay = cfg.DEMO_APPROVE_MIN_MS + Math.random() * (cfg.DEMO_APPROVE_MAX_MS - cfg.DEMO_APPROVE_MIN_MS);
  setTimeout(() => {
    for (const p of parts) {
      updatePart(historyId, p.index, { moderationState: 'Approved' });
    }
    const r2 = store.db.prepare('SELECT parts FROM history WHERE id = ?').get(historyId);
    if (!r2) return; // job sudah dihapus user sebelum approval — jangan crash server
    const all = JSON.parse(r2.parts).every((p) => p.moderationState === 'Approved');
    setStatus(historyId, all ? 'approved' : 'uploaded');
    appendLog(historyId, '✓ Moderasi DEMO menyetujui semua bagian. Status: Approved.');
  }, delay);
}

function formatDur(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  processJob(job)
    .catch(() => {})
    .finally(() => {
      running = false;
      pump();
    });
}

/** Poller moderasi aset real dari Roblox. */
async function pollModeration() {
  const rows = store.db.prepare("SELECT * FROM history WHERE status = 'uploaded'").all();
  for (const row of rows) {
    const parts = JSON.parse(row.parts || '[]');
    if (!parts.length) continue;
    try {
      const keyRow = store.db
        .prepare('SELECT k.* FROM api_keys k JOIN history h ON h.user_discord_id = k.user_discord_id WHERE h.id = ? AND k.is_demo = 0 LIMIT 1')
        .get(row.id);
      if (!keyRow) { setStatus(row.id, 'approved'); continue; }
      roblox.touchKey(keyRow.id);
      const apiKey = { ...keyRow, secret: require('./crypto').decrypt(keyRow.secret_enc) || '' };
      const states = [];
      for (const p of parts) {
        if (!p.assetId) continue;
        const asset = await roblox.getAsset(apiKey, p.assetId);
        states.push(asset.moderationState);
        if (asset.moderationState !== p.moderationState) {
          updatePart(row.id, p.index, { moderationState: asset.moderationState });
        }
      }
      if (states.length && states.every((s) => s === 'Approved')) {
        setStatus(row.id, 'approved');
      } else if (states.some((s) => s === 'Rejected')) {
        setStatus(row.id, 'rejected');
      }
    } catch (e) {
      // key tidak valid / rate-limit: coba lagi nanti
    }
  }
}

function startWorker() {
  pump();
  if (!pollTimer) {
    pollTimer = setInterval(pollModeration, 30000);
    setTimeout(pollModeration, 5000);
  }
}

module.exports = { startWorker, pushJob, appendLog };