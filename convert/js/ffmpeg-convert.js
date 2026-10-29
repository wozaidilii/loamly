/** Lazy-load LGPL ffmpeg.wasm (single-thread core). */
import { FFmpeg } from '../vendor/ffmpeg/index.js';
import { fetchFile, toBlobURL } from '../vendor/ffmpeg-util/index.js';

export const MAX_AV_BYTES = 200 * 1024 * 1024;
const CORE_BASE = new URL('../vendor/ffmpeg-core/', import.meta.url).href;

let ffmpeg = null;
let loading = null;

function basename(name) {
  const i = (name || '').lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name || 'file';
}

export async function ensureFFmpeg(onProgress) {
  if (ffmpeg?.loaded) return ffmpeg;
  if (loading) return loading;
  loading = (async () => {
    const ff = new FFmpeg();
    ff.on('progress', ({ progress }) => {
      const p = Math.max(0, Math.min(1, progress || 0));
      onProgress?.(Math.round(10 + p * 85));
    });
    const coreURL = await toBlobURL(`${CORE_BASE}ffmpeg-core.js?v=20261029b`, 'text/javascript');
    const wasmURL = await toBlobURL(`${CORE_BASE}ffmpeg-core.wasm?v=20261029b`, 'application/wasm');
    await ff.load({ coreURL, wasmURL });
    ffmpeg = ff;
    return ff;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/** Build ffmpeg args for a target. MP4 video uses mpeg4 (LGPL), not x264. */
export function argsFor(target, inName, outName) {
  const t = String(target).toLowerCase();
  if (t === 'mp3') {
    return ['-i', inName, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', outName];
  }
  if (t === 'm4a') {
    return ['-i', inName, '-vn', '-c:a', 'aac', '-b:a', '192k', outName];
  }
  if (t === 'wav') {
    return ['-i', inName, '-vn', '-c:a', 'pcm_s16le', outName];
  }
  if (t === 'ogg' || t === 'opus') {
    return ['-i', inName, '-vn', '-c:a', 'libopus', '-b:a', '128k', outName];
  }
  if (t === 'flac') {
    return ['-i', inName, '-vn', '-c:a', 'flac', outName];
  }
  if (t === 'webm') {
    return ['-i', inName, '-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus', '-b:a', '128k', outName];
  }
  if (t === 'gif') {
    return ['-i', inName, '-vf', 'fps=10,scale=480:-1:flags=lanczos', '-loop', '0', outName];
  }
  if (t === 'mp4') {
    // LGPL: mpeg4 video + native aac (no x264)
    return ['-i', inName, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-b:a', '128k', outName];
  }
  throw new Error('不支持的格式');
}

export function outMeta(target) {
  const t = String(target).toLowerCase();
  const map = {
    mp3: { ext: 'mp3', mime: 'audio/mpeg' },
    m4a: { ext: 'm4a', mime: 'audio/mp4' },
    wav: { ext: 'wav', mime: 'audio/wav' },
    ogg: { ext: 'ogg', mime: 'audio/ogg' },
    opus: { ext: 'ogg', mime: 'audio/ogg' },
    flac: { ext: 'flac', mime: 'audio/flac' },
    webm: { ext: 'webm', mime: 'video/webm' },
    gif: { ext: 'gif', mime: 'image/gif' },
    mp4: { ext: 'mp4', mime: 'video/mp4' },
  };
  return map[t] || { ext: t, mime: 'application/octet-stream' };
}

export async function convertAV(file, target, onProgress) {
  if (file.size > MAX_AV_BYTES) {
    const err = new Error('文件太大');
    err.code = 'TOO_LARGE';
    throw err;
  }
  onProgress?.(5);
  const ff = await ensureFFmpeg(onProgress);
  onProgress?.(10);
  const inName = `in_${Date.now()}_${basename(file.name).replace(/[^\w.-]+/g, '_')}${file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''}`;
  const { ext, mime } = outMeta(target);
  const outName = `out_${Date.now()}.${ext}`;
  await ff.writeFile(inName, await fetchFile(file));
  const args = argsFor(target, inName, outName);
  const code = await ff.exec(args);
  if (code !== 0) {
    try { await ff.deleteFile(inName); } catch {}
    throw new Error('转换失败，再试一次');
  }
  const data = await ff.readFile(outName);
  try { await ff.deleteFile(inName); } catch {}
  try { await ff.deleteFile(outName); } catch {}
  onProgress?.(100);
  const blob = new Blob([data.buffer], { type: mime });
  return { blob, filename: `${basename(file.name)}.${ext}` };
}
