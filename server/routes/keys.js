const express = require('express');
const cfg = require('../config');
const roblox = require('../roblox');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ keys: roblox.listKeysForUser(req.user.discord_id) });
});

router.post('/', requireAuth, (req, res) => {
  const secret = String(req.body.secret || '').trim();
  if (secret.length < 12) return res.status(400).json({ error: 'API Key secret minimal 12 karakter. Salin dari Creator Dashboard Roblox.' });
  const id = roblox.addKey({
    userId: req.user.discord_id,
    name: String(req.body.name || 'Roblox API Key').trim(),
    secret,
    creatorType: String(req.body.creatorType || 'user'),
    creatorId: String(req.body.creatorId || '').trim()
  });
  res.json({ ok: true, id });
});

router.post('/demo', requireAuth, (req, res) => {
  const id = roblox.addDemoKey(req.user.discord_id);
  res.json({ ok: true, id });
});

router.delete('/:id', requireAuth, (req, res) => {
  try {
    roblox.deleteKey(req.params.id, req.user.discord_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const keyTestCooldowns = new Map(); // userId -> ts
const KEY_TEST_COOLDOWN_MS = 60000;

/** Uji key Roblox asli: upload audio senyap lalu archive. Maks 1x/menit per user. */
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const userId = req.user.discord_id;
    const last = keyTestCooldowns.get(userId) || 0;
    const wait = KEY_TEST_COOLDOWN_MS - (Date.now() - last);
    if (wait > 0) {
      return res.status(429).json({ error: `Uji key lagi dalam ${Math.ceil(wait / 1000)} detik.` });
    }
    keyTestCooldowns.set(userId, Date.now());
    try {
      const result = await roblox.testKey(req.params.id, userId);
      res.json({ ok: true, ...result });
    } catch (e) {
      keyTestCooldowns.delete(userId);
      throw e;
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;