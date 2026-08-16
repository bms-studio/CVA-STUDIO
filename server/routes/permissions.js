const express = require('express');
const cfg = require('../config');
const store = require('../db');
const roblox = require('../roblox');
const { requireAuth } = require('../auth');

const router = express.Router();

router.post('/grant', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    const rawIds = String(req.body.assetIds || '')
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number);
    if (!rawIds.length) return res.status(400).json({ error: 'Tidak ada Asset ID valid.' });
    if (rawIds.length > 300) return res.status(400).json({ error: 'Maksimal 300 Asset ID per request.' });

    const universeId = String(req.body.universeId || '').trim();
    if (!/^\d+$/.test(universeId)) return res.status(400).json({ error: 'Universe ID harus angka (bukan Place ID).' });

    const key = roblox.loadKey(String(req.body.apiKeyId || ''), user.discord_id);
    if (key.is_demo) {
      const result = await roblox.grantPermissions(key, { universeId, assetIds: rawIds });
      return res.json({
        ok: true,
        universeId,
        successCount: result.success.length,
        success: result.success,
        failed: result.errors,
        demo: true
      });
    }
    if (!key.secret) throw new Error('API Key tidak valid');

    const result = await roblox.grantPermissions(key, { universeId, assetIds: rawIds });

    res.json({
      ok: true,
      universeId,
      successCount: result.success.length,
      success: result.success,
      failed: result.errors,
      demo: key.is_demo
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/grant/demo', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    const rawIds = String(req.body.assetIds || '')
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number);
    const universeId = String(req.body.universeId || '').trim();
    if (!rawIds.length || !/^\d+$/.test(universeId)) return res.status(400).json({ error: 'Asset IDs dan Universe ID wajib diisi.' });

    const key = roblox.loadKey(String(req.body.apiKeyId || ''), user.discord_id);
    if (!key.is_demo) return res.status(400).json({ error: 'Endpoint ini khusus key demo.' });

    const result = await roblox.grantPermissions(key, { universeId, assetIds: rawIds });
    res.json({ ok: true, universeId, successCount: result.success.length, success: result.success, failed: result.errors, demo: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;