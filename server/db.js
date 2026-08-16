const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');

for (const dir of [cfg.DATA_DIR, cfg.UPLOAD_DIR, cfg.OUT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(path.join(cfg.DATA_DIR, 'cva.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  discord_id   TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  avatar       TEXT NOT NULL DEFAULT '',
  plan         TEXT NOT NULL DEFAULT 'free',
  plan_expires INTEGER,
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  user_discord_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  secret_enc    TEXT NOT NULL DEFAULT '',
  creator_type  TEXT NOT NULL DEFAULT 'user',
  creator_id    TEXT NOT NULL DEFAULT '',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_used     INTEGER
);

CREATE TABLE IF NOT EXISTS history (
  id             TEXT PRIMARY KEY,
  user_discord_id TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  source_url     TEXT NOT NULL DEFAULT '',
  source_type    TEXT NOT NULL DEFAULT 'url',
  thumbnail      TEXT NOT NULL DEFAULT '',
  asset_name     TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'queued',
  parts          TEXT NOT NULL DEFAULT '[]',
  params         TEXT NOT NULL DEFAULT '{}',
  output_path    TEXT NOT NULL DEFAULT '',
  file_path      TEXT NOT NULL DEFAULT '',
  log            TEXT NOT NULL DEFAULT '',
  error          TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_discord_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

const now = () => Date.now();

try {
  const keyCols = db.prepare('PRAGMA table_info(api_keys)').all().map((c) => c.name);
  if (!keyCols.includes('last_used')) db.exec('ALTER TABLE api_keys ADD COLUMN last_used INTEGER');
} catch (e) { /* tabel mungkin belum ada saat migrasi pertama */ }

function getUser(discordId) {
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(String(discordId)) || null;
}

function upsertUser({ discord_id, username, avatar }) {
  db.prepare(
    `INSERT INTO users (discord_id, username, avatar, created_at, last_seen)
     VALUES (@discord_id, @username, @avatar, @created_at, @last_seen)
     ON CONFLICT(discord_id) DO UPDATE SET
       username = excluded.username,
       avatar   = CASE WHEN excluded.avatar != '' THEN excluded.avatar ELSE users.avatar END,
       last_seen = excluded.last_seen`
  ).run({ discord_id, username, avatar, created_at: now(), last_seen: now() });
  return getUser(discord_id);
}

module.exports = { db, now, getUser, upsertUser };
