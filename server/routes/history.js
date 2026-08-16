const express = require('express');
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const store = require('../db');
const roblox = require('../roblox');
const { decrypt } = require('../crypto');
const { requireAuth } = require('../auth');
const { pushJob, appendLog } = require('../worker');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    thumbnail: row.thumbnail,
    assetName: row.asset_name,
    status: row.status,
    parts: JSON.parse(row.parts || '[]'),
    params: JSON.parse(row.params || '{}'),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasOutput: !!row.output_path && fs.existsSync(row.output_path),
    hasFile: !!row.file_path && fs.existsSync(row.file_path)
  };
}

router.get('/', requireAuth, (req, res) => {
  const rows = store.db
    .prepare('SELECT * FROM history WHERE user_discord_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(String(req.user.discord_id));
  res.json({ history: rows.map(serialize) });
});

router.get('/:id', requireAuth, (req, res) => {
  const row = store.db.prepare('SELECT * FROM history WHERE id = ? AND user_discord_id = ?')
    .get(String(req.params.id), String(req.user.discord_id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ item: serialize(row) });
});

router.get('/:id/console', requireAuth, (req, res) => {
  const row = store.db.prepare('SELECT log, status, parts, error FROM history WHERE id = ? AND user_discord_id = ?')
    .get(String(req.params.id), String(req.user.discord_id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const lines = (row.log || '').split('\n').filter(Boolean);
  res.json({ status: row.status, log: lines.slice(-120), parts: JSON.parse(row.parts || '[]'), error: row.error });
});

router.get('/:id/download', requireAuth, (req, res) => {
  const row = store.db.prepare('SELECT * FROM history WHERE id = ? AND user_discord_id = ?')
    .get(String(req.params.id), String(req.user.discord_id));
  if (!row || !row.output_path || !fs.existsSync(row.output_path)) {
    return res.status(404).json({ error: 'File tidak tersedia' });
  }
  res.download(row.output_path, `${row.asset_name || 'cva-audio'}.mp3`);
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = store.db.prepare('SELECT * FROM history WHERE id = ? AND user_discord_id = ?')
    .get(String(req.params.id), String(req.user.discord_id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  for (const p of [row.file_path, row.output_path]) {
    if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) {} }
  }
  const dir = path.join(cfg.OUT_DIR, row.id);
  if (fs.existsSync(dir)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  store.db.prepare('DELETE FROM history WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

/* Ambil ID aset:
   - Sudah tersimpan di riwayat (hasil upload via CVA STUDIO) → kembalikan langsung,
     tanpa menyentuh Roblox. (Open Cloud tidak punya endpoint list aset milik user;
     toolbox-service menolak x-api-key → HTTP 404.)
   - Belum ada ID → jalankan ulang job dengan key terakhir dipakai agar ID didapat via upload. */
router.post('/:id/getid', requireAuth, async (req, res) => {
  const row = store.db.prepare('SELECT * FROM history WHERE id = ? AND user_discord_id = ?')
    .get(String(req.params.id), String(req.user.discord_id));
  if (!row) return res.status(404).json({ error: 'Not found' });

  const parts = JSON.parse(row.parts || '[]');
  const withId = parts.filter((p) => p.assetId);
  if (withId.length) {
    const matches = withId.map((p) => ({
      assetId: String(p.assetId),
      name: p.name || row.asset_name || row.title || '',
      createdAt: '',
      moderationState: p.moderationState || ''
    }));
    appendLog(row.id, `Get ID: ${withId.length} ID aset diambil dari riwayat lokal (tanpa akses Roblox).`);
    return res.json({ ok: true, query: row.asset_name || row.title || '', matches, local: true });
  }

  const keyRow = roblox.lastUsedKey(req.user.discord_id);
  if (!keyRow) {
    return res.json({ error: 'Belum ada Asset ID tersimpan. Tambahkan Roblox API Key (tab Roblox API Keys), lalu klik lagi — job akan dijalankan ulang dan ID diambil setelah upload.' });
  }
  roblox.touchKey(keyRow.id);
  store.db.prepare('UPDATE history SET status = @st, error = @err, updated_at = @ts WHERE id = @id')
    .run({ st: 'queued', err: '', ts: Date.now(), id: row.id });
  appendLog(row.id, 'Get ID: belum ada ID tersimpan — job dijalankan ulang untuk mengambil Asset ID via upload.');
  pushJob({
    historyId: row.id,
    userId: req.user.discord_id,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    filePath: row.file_path,
    assetName: row.asset_name,
    apiKeyId: keyRow.id,
    params: JSON.parse(row.params || '{}')
  });
  return res.json({
    ok: true,
    requeued: true,
    status: 'queued',
    query: row.asset_name || row.title || '',
    matches: [],
    message: keyRow.is_demo
      ? 'Belum ada ID tersimpan — job dijalankan ulang (mode demo). ID muncul setelah proses selesai.'
      : 'Belum ada ID tersimpan — job dijalankan ulang dengan Roblox API Key Anda. ID muncul setelah upload.'
  });
});

/* Ambil ID yang belum didapat:
   - status 'error'/'queued'/'processing' → jalankan ulang job dengan key terakhir dipakai
   - status 'uploaded' → refresh moderasi langsung ke Roblox per part */
router.post('/:id/refresh', requireAuth, async (req, res) => {
  const row = store.db.prepare('SELECT * FROM history WHERE id = ? AND user_discord_id = ?')
    .get(String(req.params.id), String(req.user.discord_id));
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (row.status === 'error' || row.status === 'queued' || row.status === 'processing') {
    const keyRow = roblox.lastUsedKey(req.user.discord_id);
    if (!keyRow) return res.json({ error: 'Tidak ada Roblox API Key tersimpan — tambahkan key dulu di tab Roblox API Keys.' });
    roblox.touchKey(keyRow.id);
    const params = JSON.parse(row.params || '{}');
    store.db.prepare('UPDATE history SET status = @st, error = @err, updated_at = @ts WHERE id = @id')
      .run({ st: 'queued', err: '', ts: Date.now(), id: row.id });
    appendLog(row.id, 'Retry manual: job dijalankan ulang untuk mengambil Asset ID.');
    pushJob({
      historyId: row.id,
      userId: req.user.discord_id,
      sourceType: row.source_type,
      sourceUrl: row.source_url,
      filePath: row.file_path,
      assetName: row.asset_name,
      apiKeyId: keyRow.id,
      params
    });
    return res.json({
      ok: true,
      status: 'queued',
      message: keyRow.is_demo
        ? 'Job dijalankan ulang (mode demo). ID aset muncul setelah proses selesai.'
        : 'Job dijalankan ulang dengan Roblox API Key Anda. ID aset muncul setelah upload.'
    });
  }

  if (row.status === 'uploaded') {
    const parts = JSON.parse(row.parts || '[]');
    const keyRow = roblox.lastUsedKey(req.user.discord_id);
    if (!keyRow) return res.json({ ok: true, status: row.status, message: 'Tidak ada key — status disimpan apa adanya.' });
    roblox.touchKey(keyRow.id);
    const apiKey = { ...keyRow, secret: decrypt(keyRow.secret_enc) || '' };
    const states = [];
    try {
      for (const p of parts) {
        if (!p.assetId) continue;
        const asset = await roblox.getAsset(apiKey, p.assetId);
        states.push(asset.moderationState);
        if (asset.moderationState !== p.moderationState) {
          p.moderationState = asset.moderationState;
        }
      }
    } catch (e) {
      return res.json({ error: 'Gagal menghubungi Roblox: ' + (e.message || 'network error') });
    }
    let newStatus = row.status;
    if (states.length && states.every((s) => s === 'Approved')) newStatus = 'approved';
    else if (states.some((s) => s === 'Rejected')) newStatus = 'rejected';
    store.db.prepare('UPDATE history SET parts = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(parts), newStatus, Date.now(), row.id);
    appendLog(row.id, 'Refresh manual: status moderasi diperiksa ulang via Roblox (' + newStatus + ').');
    const ids = parts.map((p) => p.assetId).filter(Boolean);
    return res.json({ ok: true, status: newStatus, parts, message: ids.length ? ids.length + ' ID aset tersedia (klik ID untuk salin).' : 'Belum ada Asset ID.' });
  }

  res.json({ ok: true, status: row.status });
});

module.exports = router;