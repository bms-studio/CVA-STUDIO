const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { decrypt, maskSecret, encrypt } = require('./crypto');
const store = require('./db');

const ASSETS_API = 'https://apis.roblox.com/assets/v1';
const PERMS_API = 'https://apis.roblox.com/asset-permissions-api/v1/assets/permissions';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randAssetId() {
  const prefix = 9 + String(Math.floor(Math.random() * 8)); // 90-97xxxxxxx terdengar plausible
  const rest = String(Math.floor(Math.random() * 90000000) + 10000000);
  return parseInt(prefix + rest, 10);
}

async function apiFetch(url, options, apiKeySecret) {
  const res = await fetch(url, {
    ...options,
    headers: { 'x-api-key': apiKeySecret, ...(options.headers || {}) }
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
  if (!res.ok) {
    const msg =
      (body && (body.error?.message || body.message || body.error?.code)) ||
      `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new Error('Invalid API Key (401) — Roblox menolak key ini. Cek ulang key Open Cloud di tab Roblox API Keys.');
    }
    throw new Error(`${msg} (${res.status})`);
  }
  return body;
}

function loadKey(keyId, userId) {
  const row = store.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(String(keyId));
  if (!row) throw new Error('API Key tidak ditemukan');
  if (row.user_discord_id !== String(userId)) throw new Error('API Key bukan milik Anda');
  touchKey(row.id);
  return { ...row, secret: row.is_demo ? '' : decrypt(row.secret_enc) || '' };
}

function touchKey(keyId) {
  if (!keyId) return;
  try {
    store.db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(Date.now(), String(keyId));
  } catch (e) { /* kolom last_used belum ada di DB lama */ }
}

function lastUsedKey(userDiscordId) {
  return store.db
    .prepare('SELECT * FROM api_keys WHERE user_discord_id = ? ORDER BY is_demo ASC, last_used DESC, created_at DESC LIMIT 1')
    .get(String(userDiscordId)) || null;
}

/**
 * Upload audio ke Roblox Open Cloud (atau simulasi demo).
 * Returns: { assetId|null, operationId, moderationState }
 */
async function createAudioAsset(apiKey, { displayName, filePath, description }) {
  if (apiKey.is_demo) {
    await sleep(1800 + Math.random() * 1800);
    return {
      operationId: 'demo-op-' + Date.now(),
      assetId: randAssetId(),
      moderationState: 'Reviewing',
      demo: true
    };
  }
  if (!apiKey.secret) throw new Error('API key tidak valid (secret kosong)');
  const buf = fs.readFileSync(filePath);
  const creator = apiKey.creator_type === 'group'
    ? { groupId: parseInt(apiKey.creator_id, 10) || 0 }
    : { userId: parseInt(apiKey.creator_id, 10) || 0 };

  const form = new FormData();
  form.append('request', JSON.stringify({
    assetType: 'Audio',
    displayName: String(displayName).slice(0, 64),
    description: String(description || 'Uploaded via CVA STUDIO').slice(0, 1000),
    creationContext: { creator, expectedPrice: 0 }
  }));
  form.append('fileContent', new Blob([buf], { type: 'audio/mpeg' }), path.basename(filePath) + '.mp3');

  const body = await apiFetch(ASSETS_API + '/assets', { method: 'POST', body: form }, apiKey.secret);

  let assetId = body.response?.assetId || body.assetId || null;
  let moderationState = body.response?.moderationResult?.moderationState || 'Pending';
  const operationId = (body.path || '').replace('operations/', '');

  if (!assetId && operationId) {
    for (let i = 0; i < 30 && !assetId; i++) {
      await sleep(1500);
      const op = await apiFetch(ASSETS_API + '/operations/' + encodeURIComponent(operationId), {}, apiKey.secret);
      if (op.done) {
        assetId = op.response?.assetId || op.assetId || null;
        moderationState = op.response?.moderationResult?.moderationState || moderationState;
      }
    }
  }

  if (!assetId) {
    const errMsg = body.errors?.[0]?.message;
    throw new Error('Upload gagal: ' + (errMsg || 'Roblox tidak mengembalikan assetId'));
  }
  return { operationId, assetId, moderationState, demo: false };
}

/** Cek status moderasi aset. */
async function getAsset(apiKey, assetId) {
  if (apiKey.is_demo) {
    return { assetId, moderationState: 'Approved', displayName: `CVA Test ${assetId}` };
  }
  const body = await apiFetch(`${ASSETS_API}/assets/${encodeURIComponent(assetId)}`, {}, apiKey.secret);
  return {
    assetId,
    moderationState: body.moderationResult?.moderationState || 'Unknown',
    displayName: body.displayName || ''
  };
}

/* Catatan: Open Cloud tidak punya endpoint "list aset milik user", dan
   toolbox-service (apis.roblox.com) menolak x-api-key (404/401) — jadi pencarian
   aset by-nama via Roblox TIDAK dipakai. ID aset diambil dari riwayat lokal
   (lihat routes/history.js → POST /:id/getid). */

/**
 * Whitelist: grant "Use" permission ke Universe untuk list asset.
 * Returns: { success: [], errors: [{assetId, code}] }
 */
async function grantPermissions(apiKey, { universeId, assetIds }) {
  if (apiKey.is_demo) {
    await sleep(900 + Math.random() * 900);
    return { success: assetIds, errors: [] };
  }
  if (!apiKey.secret) throw new Error('API key tidak valid');
  const body = {
    subjectType: 'Universe',
    subjectId: String(universeId),
    action: 'Use',
    requests: assetIds.map((id) => ({ assetId: Number(id), grantToDependencies: false }))
  };
  const resp = await apiFetch(PERMS_API, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, apiKey.secret);
  return { success: resp.successAssetIds || [], errors: resp.errors || [] };
}

function listKeysForUser(userId) {
  const rows = store.db
    .prepare('SELECT * FROM api_keys WHERE user_discord_id = ? ORDER BY created_at DESC')
    .all(String(userId));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    creatorType: r.creator_type,
    creatorId: r.creator_id,
    isDemo: !!r.is_demo,
    masked: r.is_demo ? 'cvademo-••••••••••' : maskSecret(decrypt(r.secret_enc) || ''),
    createdAt: r.created_at
  }));
}

function addKey({ userId, name, secret, creatorType, creatorId }) {
  const id = 'k_' + Math.random().toString(36).slice(2, 10);
  store.db
    .prepare('INSERT INTO api_keys (id, user_discord_id, name, secret_enc, creator_type, creator_id, is_demo, created_at) VALUES (?,?,?,?,?,?,0,?)')
    .run(id, String(userId), String(name || 'Roblox API Key').slice(0, 60), encrypt(secret), creatorType === 'group' ? 'group' : 'user', String(creatorId || ''), Date.now());
  return id;
}

function addDemoKey(userId) {
  const id = 'k_' + Math.random().toString(36).slice(2, 10);
  store.db
    .prepare('INSERT INTO api_keys (id, user_discord_id, name, secret_enc, creator_type, creator_id, is_demo, created_at) VALUES (?,?,?,?,?,?,1,?)')
    .run(id, String(userId), 'CVA Demo Runner', '', 'user', '999999', Date.now());
  return id;
}

function deleteKey(keyId, userId) {
  const row = store.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(String(keyId));
  if (!row) return false;
  if (row.user_discord_id !== String(userId)) throw new Error('API Key bukan milik Anda');
  store.db.prepare('DELETE FROM api_keys WHERE id = ?').run(String(keyId));
  return true;
}

let keyTestFile = null;

/** Buat file uji: audio senyap 2 detik (via ffmpeg), di-cache. */
async function ensureKeyTestFile() {
  if (keyTestFile && fs.existsSync(keyTestFile)) return keyTestFile;
  const dir = path.join(cfg.DATA_DIR, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'keytest.mp3');
  const { runCmd } = require('./media');
  const ffmpegArgs = String(cfg.FFMPEG_CMD).split(/\s+/);
  const { code, stderr } = await runCmd(
    ffmpegArgs,
    ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '2', '-c:a', 'libmp3lame', '-q:a', '9', out],
    20000
  );
  if (code !== 0 || !fs.existsSync(out)) {
    throw new Error('Gagal membuat file uji (ffmpeg): ' + (stderr || '').split('\n').slice(-1)[0].trim());
  }
  keyTestFile = out;
  return out;
}

/**
 * Verifikasi key Roblox asli end-to-end:
 * upload audio senyap -> baca hasil -> archive (best effort).
 * Returns: { assetId, moderationState, archived }
 */
async function testKey(keyId, userId) {
  const apiKey = loadKey(keyId, userId);
  if (apiKey.is_demo) {
    throw new Error('Key demo tidak bisa diuji ke Roblox asli. Tambahkan key asli dari Creator Dashboard (tombol + API Key).');
  }
  const filePath = await ensureKeyTestFile();
  const displayName = 'CVA Key Test ' + new Date().toISOString().slice(0, 10);
  const result = await createAudioAsset(apiKey, {
    displayName,
    filePath,
    description: 'CVA STUDIO key verification asset — dapat di-archive / dihapus manual.'
  });
  let archived = false;
  if (result.assetId) {
    try {
      await apiFetch(`${ASSETS_API}/assets/${encodeURIComponent(result.assetId)}:archive`, { method: 'POST' }, apiKey.secret);
      archived = true;
    } catch (e) {
      archived = false;
    }
  }
  return { assetId: result.assetId, moderationState: result.moderationState, archived, demo: false };
}

module.exports = { createAudioAsset, getAsset, grantPermissions, loadKey, touchKey, lastUsedKey, listKeysForUser, addKey, addDemoKey, deleteKey, testKey };