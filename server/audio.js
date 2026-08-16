const { spawn } = require('child_process');
const fs = require('fs');
const cfg = require('./config');

function runFfmpeg(cmdParts, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmdParts[0], [...cmdParts.slice(1), ...args], { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs || 900000);
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr, error: err.message });
    });
  });
}

function ffprobeDuration(filePath) {
  return new Promise((resolve) => {
    const child = spawn(cfg.FFPROBE_CMD, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', () => {
      const val = parseFloat(out.trim());
      resolve(Number.isFinite(val) && val > 0 ? val : null);
    });
    child.on('error', () => resolve(null));
  });
}

function clampParams(params) {
  return {
    speed: Math.min(3, Math.max(1, Number(params.speed) || 1)),
    amplify: Math.min(20, Math.max(-20, Number(params.amplify) || 0)),
    pitch: Math.min(12, Math.max(-12, Number(params.pitch) || 0)),
    eq: ['normal', 'bass', 'vocals', 'treble', 'vintage'].includes(params.eq) ? params.eq : 'normal',
    maxDuration: Math.min(1800, Math.max(10, Number(params.maxDuration) || 420)),
    fadeIn: !!params.fadeIn,
    fadeOut: !!params.fadeOut,
    autoSplit: !!params.autoSplit,
    echo: !!params.echo,
    reverb: !!params.reverb,
    chorus: !!params.chorus,
    tremolo: !!params.tremolo,
    vibrato: !!params.vibrato,
    radio: !!params.radio,
    reverse: !!params.reverse
  };
}

function splitPlan(duration, params) {
  const max = params.maxDuration;
  if (!params.autoSplit) {
    return [{ index: 1, start: 0, end: Math.min(duration, max) }];
  }
  const count = Math.max(1, Math.ceil(duration / max));
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push({ index: i + 1, start: i * max, end: Math.min((i + 1) * max, duration) });
  }
  return parts;
}

function atempoChain(target) {
  let A = Math.max(0.5, Math.min(100, target));
  const parts = [];
  while (A > 2.0) { parts.push('atempo=2.0'); A /= 2; }
  if (A >= 0.5) parts.push('atempo=' + A.toFixed(6));
  return parts.join(',');
}

function buildFilters(params, inputDur, part) {
  const filters = [];
  const pitchFactor = Math.pow(2, params.pitch / 12);

  if (params.pitch !== 0) {
    filters.push(`asetrate=44100*${pitchFactor.toFixed(6)},aresample=44100`);
  }
  // Kompensasi tempo: pitch via asetrate mengubah durasi ×pitchFactor,
  // atempo target = speed / pitchFactor → durasi netto = inputDur / speed (pitch TIDAK mengubah speed).
  const atempo = atempoChain(Math.max(0.5, params.speed / pitchFactor));
  if (atempo) filters.push(atempo);
  if (params.amplify !== 0) filters.push(`volume=${params.amplify.toFixed(1)}dB`);

  switch (params.eq) {
    case 'bass': filters.push('bass=g=9:f=150'); break;
    case 'vocals': filters.push('equalizer=f=2600:t=q:w=1.6:g=7'); break;
    case 'treble': filters.push('treble=g=9:f=5000'); break;
    case 'vintage': filters.push('lowpass=f=3200,highpass=f=80'); break;
  }

  if (params.reverse) filters.push('areverse');
  if (params.radio) filters.push('highpass=f=300,lowpass=f=3400');
  if (params.echo) filters.push('aecho=0.8:0.88:60:0.4');
  if (params.reverb) filters.push('aecho=0.8:0.9:1000|1800:0.3|0.25');
  if (params.chorus) filters.push('chorus=0.7:0.9:55:0.4:0.25:2');
  if (params.tremolo) filters.push('tremolo=f=5:d=0.35');
  if (params.vibrato) filters.push('vibrato=f=5:d=0.5');

  const segDur = Math.max(1, (part.end - part.start));
  if (params.fadeIn) filters.push('afade=t=in:st=0:d=3');
  if (params.fadeOut) filters.push(`afade=t=out:st=${Math.max(0, segDur - 3).toFixed(3)}:d=3`);

  return filters.join(',');
}

/**
 * Proses audio dengan ffmpeg.
 * input: path file asal; output: path hasil
 * segment: { start, end } | null
 */
async function processAudio(input, output, rawParams, segment) {
  const params = clampParams(rawParams);
  const inputDur = segment ? segment.end - segment.start : (rawParams._inputDur || null);
  const dur = inputDur || (await ffprobeDuration(input)) || 0;

  const filters = buildFilters(params, dur, segment || { start: 0, end: dur || 1 });
  const args = ['-y', '-i', input];
  if (segment && (segment.start > 0 || segment.end)) {
    args.push('-ss', String(segment.start), '-to', String(segment.end));
  }
  args.push(
    '-af', filters || 'anull',
    '-ac', '1', '-ar', '44100', '-b:a', '160k',
    '-metadata', 'title=CVA STUDIO Export',
    output
  );

  const { code, stderr } = await runFfmpeg(cfg.FFMPEG_CMD.split(/\s+/), args, 900000);
  if (code !== 0) {
    const tail = stderr.split('\n').filter(Boolean).slice(-4).join(' | ');
    // ffmpeg Sering exit 1 karena "output file does not contain any stream" saat segment kosong
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
      throw new Error('Proses audio gagal: ' + (tail || 'ffmpeg error'));
    }
  }
  if (!fs.existsSync(output)) throw new Error('Output audio tidak ditemukan');
  return output;
}

/** Durasi hasil akhir (percepatan tidak mengubah pitch-net duration) */
function expectedOutputDuration(inputDur, params) {
  return inputDur / Math.max(0.1, Number(params.speed) || 1);
}

module.exports = { processAudio, ffprobeDuration, clampParams, splitPlan, expectedOutputDuration };