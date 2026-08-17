require('dotenv').config();
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const OUT_DIR = path.join(DATA_DIR, 'output');

module.exports = {
  PORT,
  APP_URL,
  DATA_DIR,
  UPLOAD_DIR,
  OUT_DIR,
  JWT_SECRET: process.env.JWT_SECRET || 'cva-studio-dev-secret-change-me',
  COOKIE_NAME: 'cva_ssid',
  YTDLP_CMD: (process.env.YTDLP_CMD || 'python -m yt_dlp').split(/\s+/),
  YTDLP_COOKIES_BROWSER: process.env.YTDLP_COOKIES_BROWSER || '',
  YTDLP_COOKIES_FILE: process.env.YTDLP_COOKIES_FILE || '',
  YTDLP_EXTRA_ARGS: process.env.YTDLP_EXTRA_ARGS || '',
  FFMPEG_CMD: process.env.FFMPEG_CMD || 'ffmpeg',
  FFPROBE_CMD: process.env.FFPROBE_CMD || 'ffprobe',
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || '',
  WEBHOOK_SPAM_THRESHOLD: process.env.WEBHOOK_SPAM_THRESHOLD || '15',
  MAX_UPLOAD_MB: 20,
  MAX_CONVERT_URL_TIME: 900000,
  DEMO_APPROVE_MIN_MS: 60000,
  DEMO_APPROVE_MAX_MS: 300000,
  PLANS: {
    free: { price: 0, days: 0, conversionsPerDay: Infinity, bulkWhitelist: true, label: 'Unlimited' }
  },
  QRIS_IMAGE: process.env.QRIS_IMAGE || '/assets/qris.svg',
  QRIS_NAME: process.env.QRIS_NAME || 'CVA STUDIO',
  ALLOWED_MEDIA_HOSTS: [
    'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
    'soundcloud.com', 'on.soundcloud.com', 'm.soundcloud.com',
    'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
    'music.apple.com', 'open.spotify.com', 'spotify.com', 'twitch.tv',
    'vimeo.com', 'bandcamp.com', 'mixcloud.com', 'audiomack.com', 'suno.com'
  ]
};
