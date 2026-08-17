const express = require('express');
const webhook = require('../webhook');
const { requireAuth } = require('../auth');

const router = express.Router();
const lastReport = new Map(); // rate limit per user: 1 laporan / 2 detik

router.post('/report', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const now = Date.now();
    if (now - (lastReport.get(user.discord_id) || 0) < 2000) return res.json({ ok: true });
    lastReport.set(user.discord_id, now);

    const b = req.body || {};
    const type = ['error', 'spam', 'event'].includes(b.type) ? b.type : 'error';
    const colors = { error: 0xff5555, spam: 0xffaa00, event: 0x55aaff };
    const titles = { error: '⚠️ Bug terdeteksi', spam: '🚨 Aktivitas mencurigakan', event: 'ℹ️ Event' };

    const fields = [
      { name: '👤 User', value: '`' + user.discord_id + '`', inline: true },
      { name: '🧭 Halaman', value: String(b.url || '?').slice(0, 120) || '?', inline: true },
      { name: '💻 Perangkat', value: [b.device && b.device.browser, b.device && b.device.os, b.device && b.device.screen, b.device && b.device.lang].filter(Boolean).join(' · ') || '?', inline: true },
      { name: '📄 Pesan', value: String(b.message || '(tanpa pesan)').slice(0, 900), inline: false }
    ];
    if (b.stack) fields.push({ name: '🪵 Stack', value: String(b.stack).slice(0, 900), inline: false });
    const loc = await webhook.resolveLocation(req.ip);
    fields.push({ name: '📍 Lokasi (IP)', value: loc.flag + ' ' + loc.loc + ' · `' + req.ip + '`', inline: true });

    await webhook.send({
      username: 'CVA STUDIO Monitor',
      embeds: [{ title: titles[type], color: colors[type], fields, timestamp: new Date().toISOString() }]
    });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

module.exports = router;
