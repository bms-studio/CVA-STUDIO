const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const infoCache = new Map(); // url -> {data, ts}

function runCmd(cmdParts, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmdParts[0], [...cmdParts.slice(1), ...args], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs || 120000);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, killed });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, killed: false, error: err.message });
    });
  });
}

function ytDlp(args, timeoutMs) {
  const extra = cfg.YTDLP_EXTRA_ARGS ? String(cfg.YTDLP_EXTRA_ARGS).trim().split(/\s+/) : [];
  return runCmd(cfg.YTDLP_CMD, [...extra, ...args], timeoutMs);
}

/** Jarak minimal antar panggilan yt-dlp â€” hindari membanjiri YouTube (anti 403/429). */
let lastYtDlpAt = 0;
function throttledYtDlp(args, timeoutMs) {
  const gap = Math.max(0, 1200 - (Date.now() - lastYtDlpAt));
  lastYtDlpAt = Date.now() + gap;
  return new Promise((resolve) => {
    setTimeout(() => ytDlp(args, timeoutMs).then(resolve), gap);
  });
}

/** Variasi percobaan unduh: client Android/TV (anti-403) -> cookies browser -> cookies.txt -> retries. */
const YT_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=default,android,web_safari'];
function downloadVariants() {
  const v = [() => [...YT_CLIENT_ARGS]];
  if (cfg.YTDLP_COOKIES_BROWSER) v.push(() => ['--cookies-from-browser', cfg.YTDLP_COOKIES_BROWSER, ...YT_CLIENT_ARGS]);
  if (cfg.YTDLP_COOKIES_FILE) v.push(() => ['--cookies', cfg.YTDLP_COOKIES_FILE, ...YT_CLIENT_ARGS]);
  v.push(() => ['--retries', '3', '--fragment-retries', '3']);
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ytErrorHint(stderr) {
  if (/403|Forbidden/.test(stderr) || /Requested format is not available/.test(stderr)) {
    return ' (YouTube memblokir sementara â€” anti-bot. Tunggu beberapa menit lalu coba lagi / ganti lagu. Jika sering: di .env set YTDLP_COOKIES_BROWSER=chrome|firefox|edge dengan browser yang sudah login YouTube, atau export cookies.txt lalu set YTDLP_COOKIES_FILE=path\\ke\\cookies.txt)';
  }
  return '';
}

function isSupportedUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch (e) {
    return false;
  }
  return cfg.ALLOWED_MEDIA_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

async function fetchMediaInfo(url) {
  const cached = infoCache.get(url);
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) return cached.data;

  const variants = downloadVariants();
  let lastErr = '';
  for (let i = 0; i < variants.length; i++) {
    const extra = variants[i]();
    const { code, stdout, stderr } = await throttledYtDlp(
      ['--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', ...extra, url.trim()],
      cfg.MAX_CONVERT_URL_TIME
    );
    if (code === 0 && stdout.trim()) {
      let info;
      try {
        info = JSON.parse(stdout);
      } catch (e) {
        lastErr = 'Gagal parse info media dari yt-dlp';
        continue;
      }
      const data = {
        title: String(info.title || info.fulltitle || 'Untitled').slice(0, 200),
        channel: String(info.uploader || info.channel || info.artist || '').slice(0, 120),
        duration: Math.round(Number(info.duration) || 0),
        thumbnail: pickThumbnail(info),
        webpageUrl: info.webpage_url || url,
        extractor: info.extractor_key || ''
      };
      infoCache.set(url, { data, ts: Date.now() });
      return data;
    }
    lastErr = stderr.split('\n').filter(Boolean).slice(-2).join(' | ') || 'yt-dlp error';
    if (i < variants.length - 1) await sleep(1200);
  }
  throw new Error('Tidak dapat mengambil info media: ' + lastErr + ytErrorHint(lastErr));
}

function pickThumbnail(info) {
  if (info.thumbnail) return info.thumbnail;
  const thumbs = info.thumbnails || [];
  if (!thumbs.length) return '';
  const preferred = (t) => Math.max(t.width || 0, t.height || 0);
  const best = thumbs.reduce((a, b) => (preferred(b) > preferred(a) ? b : a), thumbs[0]);
  return best.url || '';
}

async function fetchDirectAudioUrl(url) {
  const variants = downloadVariants();
  let lastErr = '';
  for (let i = 0; i < variants.length; i++) {
    const extra = variants[i]();
    const { code, stdout, stderr } = await throttledYtDlp(
      ['-g', '-f', 'bestaudio/best', '--no-playlist', '--no-warnings', ...extra, url.trim()],
      cfg.MAX_CONVERT_URL_TIME
    );
    if (code === 0 && stdout.trim()) return stdout.trim();
    lastErr = stderr;
    if (i < variants.length - 1) await sleep(1500);
  }
  throw new Error('Gagal mendapatkan stream audio: ' + (lastErr.split('\n')[0] || 'yt-dlp error') + ytErrorHint(lastErr));
}

async function downloadAudio(url, outBase) {
  const outDir = path.dirname(outBase);
  fs.mkdirSync(outDir, { recursive: true });
  const variants = downloadVariants();
  let lastErr = '';
  for (let i = 0; i < variants.length; i++) {
    const extra = variants[i]();
    const { code, stderr } = await throttledYtDlp(
      ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-f', 'bestaudio/best',
       '--no-playlist', '--no-warnings', ...extra, '-o', outBase + '.%(ext)s', url.trim()],
      cfg.MAX_CONVERT_URL_TIME + 300000
    );
    if (code === 0) {
      const mp3 = outBase + '.mp3';
      if (fs.existsSync(mp3)) return mp3;
      const files = fs.readdirSync(outDir).filter((f) => f.startsWith(path.basename(outBase)));
      if (files.length) return path.join(outDir, files[0]);
      lastErr = stderr;
    } else {
      lastErr = stderr;
      if (i < variants.length - 1) await sleep(2000);
    }
  }
  const tail = lastErr.split('\n').filter(Boolean).slice(-2).join(' | ') || 'yt-dlp error';
  throw new Error('Gagal mengunduh audio: ' + tail + ytErrorHint(lastErr));
}

let previewSeq = 0;

/**
 * Buat file MP3 preview (maks 3 menit) dari URL media.
 * Bukan stream langsung â€” decodeAudioData browser tidak mendukung WebM/opus,
 * jadi audio di-encode ulang ke MP3 via ffmpeg. Returns: path file MP3.
 */
async function previewMp3(url) {
  const dir = path.join(cfg.DATA_DIR, 'tmp', 'preview');
  fs.mkdirSync(dir, { recursive: true });
  const ffmpegArgs = String(cfg.FFMPEG_CMD).split(/\s+/);
  const baseOpts = [
    '-y', '-v', 'error',
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    '-headers', 'Referer: https://www.youtube.com/\r\n',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-rw_timeout', '15000000'
  ];
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = path.join(dir, 'prev_' + Date.now() + '_' + (previewSeq++) + '.mp3');
    try {
      const direct = await fetchDirectAudioUrl(url);
      const { code, stderr } = await runCmd(
        ffmpegArgs,
        [...baseOpts, '-i', direct, '-t', '1800', '-c:a', 'libmp3lame', '-q:a', '7', out],
        120000
      );
      if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 1024) {
        return out;
      }
      lastErr = stderr || 'ffmpeg gagal';
      try { fs.unlinkSync(out); } catch (e) {}
    } catch (e) {
      lastErr = e.message || String(e);
    }
    if (attempt < 2) await sleep(1200);
  }
  throw new Error('Gagal membuat audio preview: ' + lastErr.split('\n').filter(Boolean).slice(-1)[0].trim() || 'ffmpeg error');
}

async function streamDirect(url, req, res) {
  let upstream;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Encoding': 'identity'
  };
  if (req.headers.range) headers.Range = req.headers.range;
  try {
    upstream = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    res.status(502).send('Upstream tidak tersedia: ' + e.message);
    return;
  }
  if (!upstream.ok || !upstream.body) {
    res.status(upstream.status || 502).send('Stream tidak tersedia (' + (upstream.status || 'unknown') + ')');
    return;
  }
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  const cr = upstream.headers.get('content-range');
  if (cr) res.setHeader('Content-Range', cr);
  const cl = upstream.headers.get('content-length');
  if (cl) res.setHeader('Content-Length', cl);
  const reader = upstream.body.getReader();
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        if (res.writableEnded) { reader.cancel().catch(() => {}); break; }
        res.write(value);
      }
    } catch (e) {
      res.end();
    }
  };
  pump();
}

module.exports = { isSupportedUrl, fetchMediaInfo, fetchDirectAudioUrl, downloadAudio, streamDirect, previewMp3, runCmd };