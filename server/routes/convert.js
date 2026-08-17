const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../config');
const store = require('../db');
const roblox = require('../roblox');
const media = require('../media');
const { requireAuth } = require('../auth');
const { pushJob } = require('../worker');
const webhook = require('../webhook');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(cfg.UPLOAD_DIR, req.user.discord_id);
      require('fs').mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = (path.extname(file.originalname) || '.mp3').slice(0, 8).toLowerCase();
      cb(null, `up_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const okExt = ['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac', '.opus'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (okExt.includes(ext)) return cb(null, true);
    const err = new Error('Format file tidak didukung. Gunakan MP3, WAV, M4A, OGG, AAC, FLAC, atau OPUS.');
    err.status = 400;
    cb(err);
  }
});

function clampParams(body) {
  return {
    speed: Math.min(3, Math.max(1, Number(body.speed) || 1)),
    amplify: Math.min(20, Math.max(-20, Number(body.amplify) || 0)),
    pitch: Math.min(12, Math.max(-12, Number(body.pitch) || 0)),
    eq: ['normal', 'bass', 'vocals', 'treble', 'vintage'].includes(body.eq) ? body.eq : 'normal',
    maxDuration: Math.min(1800, Math.max(10, Number(body.maxDuration) || 420)),
    fadeIn: body.fadeIn === 'true' || body.fadeIn === true,
    fadeOut: body.fadeOut === 'true' || body.fadeOut === true,
    autoSplit: body.autoSplit === 'true' || body.autoSplit === true,
    echo: body.echo === 'true' || body.echo === true,
    reverb: body.reverb === 'true' || body.reverb === true,
    chorus: body.chorus === 'true' || body.chorus === true,
    tremolo: body.tremolo === 'true' || body.tremolo === true,
    vibrato: body.vibrato === 'true' || body.vibrato === true,
    radio: body.radio === 'true' || body.radio === true,
    reverse: body.reverse === 'true' || body.reverse === true
  };
}

function buildJob({ user, sourceType, sourceUrl, fileName, assetName, apiKeyId, params }) {
  const id = 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = {
    id,
    user_discord_id: user.discord_id,
    title: fileName || assetName || 'Untitled',
    source_url: sourceUrl || '',
    source_type: sourceType,
    thumbnail: '',
    asset_name: assetName || '',
    status: 'queued',
    parts: '[]',
    params: JSON.stringify(params),
    output_path: '',
    file_path: '', // diisi worker untuk upload-an URL; untuk file diisi di route
    log: '',
    error: '',
    created_at: Date.now(),
    updated_at: Date.now()
  };
  store.db
    .prepare(`INSERT INTO history (id, user_discord_id, title, source_url, source_type, thumbnail, asset_name, status, parts, params, output_path, file_path, log, error, created_at, updated_at)
              VALUES (@id, @user_discord_id, @title, @source_url, @source_type, @thumbnail, @asset_name, @status, @parts, @params, @output_path, @file_path, @log, @error, @created_at, @updated_at)`)
    .run(row);
  return { id, row };
}

router.post('/convert', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const user = req.user;

    const url = String(req.body.url || '').trim();
    const sourceType = req.file ? 'file' : url ? 'url' : null;
    if (!sourceType) return res.status(400).json({ error: 'Tempel URL atau unggah file audio.' });
    if (sourceType === 'url' && !media.isSupportedUrl(url)) {
      return res.status(400).json({ error: 'URL tidak didukung. Gunakan YouTube, SoundCloud, TikTok, atau sumber lain yang didukung.' });
    }

    const params = clampParams(req.body);
    const apiKeyId = String(req.body.apiKeyId || '');
    if (!apiKeyId) return res.status(400).json({ error: 'Pilih Roblox API Key terlebih dahulu.' });
    roblox.loadKey(apiKeyId, user.discord_id); // validasi kepemilikan

    const assetName = String(req.body.assetName || '').trim().slice(0, 60) ||
      (req.file ? path.basename(req.file.originalname).replace(/\.[^.]+$/, '') : 'CVA Audio');

    const job = buildJob({
      user,
      sourceType,
      sourceUrl: sourceType === 'url' ? url : '',
      fileName: req.file ? path.basename(req.file.originalname).replace(/\.[^.]+$/, '') : '',
      assetName,
      apiKeyId,
      params
    });
    if (req.file) {
      store.db.prepare('UPDATE history SET file_path = ? WHERE id = ?').run(req.file.path, job.id);
    }

    pushJob({
      historyId: job.id,
      userId: user.discord_id,
      sourceType,
      sourceUrl: sourceType === 'url' ? url : '',
      filePath: req.file ? req.file.path : '',
      assetName,
      apiKeyId,
      params,
      meta: { ip: req.ip, ua: req.headers['user-agent'] || '', at: Date.now() }
    });

    webhook.trackActivity(user.discord_id);
    res.json({ ok: true, id: job.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/convert/batch', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    const urls = Array.isArray(req.body.urls)
      ? req.body.urls.map((u) => String(u).trim()).filter(Boolean).filter((u) => media.isSupportedUrl(u))
      : [];
    if (!urls.length) return res.status(400).json({ error: 'Tidak ada URL valid yang ditemukan.' });
    if (urls.length > 20) return res.status(400).json({ error: 'Maksimal 20 URL per batch.' });

    const apiKeyId = String(req.body.apiKeyId || '');
    roblox.loadKey(apiKeyId, user.discord_id);
    const params = clampParams(req.body);
    const baseName = String(req.body.assetName || '').trim().slice(0, 50) || 'CVA Batch';

    const ids = [];
    for (let i = 0; i < urls.length; i++) {
      const job = buildJob({
        user,
        sourceType: 'url',
        sourceUrl: urls[i],
        fileName: '',
        assetName: urls.length > 1 ? `${baseName} #${i + 1}` : baseName,
        apiKeyId,
        params
      });
      ids.push(job.id);
      pushJob({ historyId: job.id, userId: user.discord_id, sourceType: 'url', sourceUrl: urls[i], filePath: '', assetName: job.asset_name || baseName, apiKeyId, params, meta: { ip: req.ip, ua: req.headers['user-agent'] || '', at: Date.now() } });
    }
    webhook.trackActivity(user.discord_id, urls.length);
    res.json({ ok: true, ids });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;