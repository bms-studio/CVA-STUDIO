const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const cfg = require('./config');
const { router: authRouter } = require('./auth');
const { startWorker } = require('./worker');
const media = require('./media');

const app = express();
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- AUTH ----
app.use('/api/auth', authRouter);

// ---- MEDIA (probe / stream) ----
const mediaRouter = express.Router();
mediaRouter.get('/info', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!media.isSupportedUrl(url)) return res.status(400).json({ error: 'URL tidak didukung.' });
  try {
    const info = await media.fetchMediaInfo(url);
    res.json({ ok: true, ...info });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});
mediaRouter.get('/direct', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!media.isSupportedUrl(url)) return res.status(400).json({ error: 'URL tidak didukung.' });
  try {
    const direct = await media.fetchDirectAudioUrl(url);
    res.json({ ok: true, url: direct });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});
mediaRouter.get('/stream', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Invalid url' });
  try {
    media.streamDirect(url, req, res);
  } catch (e) {
    res.status(502).json({ error: 'stream gagal' });
  }
});
mediaRouter.get('/preview', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!media.isSupportedUrl(url)) return res.status(400).json({ error: 'URL tidak didukung.' });
  try {
    const file = await media.previewMp3(url);
    const size = require('fs').statSync(file).size;
    console.log('[preview] ok', size, 'bytes <-', url.slice(0, 80));
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      try { require('fs').unlinkSync(file); } catch (e) {}
    });
    res.sendFile(file);
  } catch (e) {
    console.log('[preview] FAIL', e.message);
    res.status(422).json({ error: e.message });
  }
});
app.use('/api/media', mediaRouter);

// ---- APP ROUTES ----
app.use('/api/keys', require('./routes/keys'));
app.use('/api', require('./routes/convert'));
app.use('/api', require('./routes/report'));
app.use('/api/history', require('./routes/history'));
app.use('/api/permissions', require('./routes/permissions'));

const toolsCache = { ts: 0, data: null };
async function detectTools() {
  const now = Date.now();
  if (toolsCache.data && now - toolsCache.ts < 60000) return toolsCache.data;
  const ffmpegArgs = String(cfg.FFMPEG_CMD).split(/\s+/);
  const [ff, yd] = await Promise.all([
    media.runCmd(ffmpegArgs, ['-version'], 8000),
    media.runCmd(cfg.YTDLP_CMD, ['--version'], 8000)
  ]);
  toolsCache.ts = now;
  toolsCache.data = { ffmpeg: ff.code === 0, ytdlp: yd.code === 0 };
  return toolsCache.data;
}

app.get('/api/config', async (req, res) => {
  res.json({
    maxUploadMb: cfg.MAX_UPLOAD_MB,
    tools: await detectTools()
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use((err, req, res, next) => {
  if (err && err.code && String(err.code).startsWith('LIMIT_')) {
    return res.status(413).json({ error: 'File terlalu besar. Maksimal ' + cfg.MAX_UPLOAD_MB + ' MB.' });
  }
  const status = err && err.status ? err.status : 500;
  if (status >= 500) {
    const webhook = require('./webhook');
    webhook.reportServerError(req, err);
  }
  const msg = err && err.message ? err.message : 'Internal error';
  if (res.headersSent) return next(err);
  res.status(status).json({ error: msg });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

startWorker();
app.listen(cfg.PORT, () => {
  fs.mkdirSync(cfg.UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(cfg.OUT_DIR, { recursive: true });
  console.log('=================================================');
  console.log('  CVA STUDIO - Roblox Audio Converter & Studio');
  console.log('  URL      :', cfg.APP_URL);
  console.log('  Mode     : Open Access (no login)');
  console.log('  ffmpeg   :', cfg.FFMPEG_CMD, '| yt-dlp:', cfg.YTDLP_CMD.join(' '));
  console.log('=================================================');
});