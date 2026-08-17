const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const cfg = require('./config');
const store = require('./db');

const router = express.Router();

function signToken(discordId) {
  return jwt.sign({ sub: String(discordId) }, cfg.JWT_SECRET, { expiresIn: '365d' });
}

function setSession(res, discordId) {
  res.cookie(cfg.COOKIE_NAME, signToken(discordId), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 3600 * 1000,
    secure: cfg.APP_URL.startsWith('https://')
  });
}

function getIdFromReq(req) {
  const token = req.cookies ? req.cookies[cfg.COOKIE_NAME] : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, cfg.JWT_SECRET);
    return String(payload.sub);
  } catch (e) {
    return null;
  }
}

function getOrCreateGuest(req, res) {
  let id = getIdFromReq(req);
  if (id) {
    const u = store.getUser(id);
    if (u) return u;
  }
  // Cookie hilang/kedaluwarsa → pulihkan identitas lama via device_id dari localStorage
  const deviceId = String((req.body && req.body.deviceId) || (req.query && req.query.deviceId) || '').slice(0, 64);
  if (deviceId) {
    const byDevice = store.db.prepare('SELECT * FROM users WHERE device_id = ? LIMIT 1').get(deviceId);
    if (byDevice) {
      store.db.prepare('UPDATE users SET device_id = ? WHERE discord_id = ?').run(deviceId, byDevice.discord_id);
      setSession(res, byDevice.discord_id);
      return byDevice;
    }
  }
  const key = crypto.randomBytes(8).toString('hex');
  id = 'guest_' + key;
  store.upsertUser({ discord_id: id, username: 'CVA STUDIO', avatar: '', deviceId });
  setSession(res, id);
  return store.getUser(id);
}

function requireAuth(req, res, next) {
  const user = getOrCreateGuest(req, res);
  store.db.prepare('UPDATE users SET last_seen = ? WHERE discord_id = ?').run(Date.now(), user.discord_id);
  req.user = user;
  next();
}

function publicUser(user) {
  return {
    discordId: user.discord_id,
    username: user.username === 'Guest' ? 'CVA STUDIO' : user.username,
    avatar: '',
    plan: 'free',
    planExpires: null,
    isAdmin: false,
    conversionsToday: 0,
    conversionsLimit: -1
  };
}

router.post('/guest', (req, res) => {
  const user = getOrCreateGuest(req, res);
  res.json({ ok: true, user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = { router, requireAuth, publicUser };
