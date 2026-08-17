const express = require('express');
const store = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

/* Backup template FX per user (cadangan saat localStorage browser hilang) */
router.get('/templates', requireAuth, (req, res) => {
  try {
    const row = store.db.prepare('SELECT value FROM settings WHERE key = ?').get('templates_' + req.user.discord_id);
    let list = [];
    if (row) { try { list = JSON.parse(row.value); } catch (e) { list = []; } }
    res.json({ ok: true, templates: Array.isArray(list) ? list : [] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/templates', requireAuth, (req, res) => {
  try {
    const list = Array.isArray(req.body.templates) ? req.body.templates.slice(0, 50) : [];
    store.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('templates_' + req.user.discord_id, JSON.stringify(list));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
