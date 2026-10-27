/* ES module: browser-only converters (v0.3 Phase A) */
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import {
  encodeBmp, decodeBmp, encodeIco, encodeTiff, decodeTiff, supportsAvifEncode,
} from './image-codecs.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../vendor/pdfjs/pdf.worker.min.mjs',
  import.meta.url,
).href;

let avifSupported = null;

export async function probeAvif() {
  if (avifSupported == null) avifSupported = await supportsAvifEncode();
  return avifSupported;
}

function basename(name) {
  const i = (name || '').lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name || 'file';
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('转换失败，再试一次'))),
      mime,
      quality,
    );
  });
}

/* ---- GIF encoder (from v0.2) ---- */
function encodeGif(imageData) {
  const { width, height, data } = imageData;
  // Build 256-color palette by simple uniform sampling of unique-ish colors
  const palette = [];
  const indexMap = new Map();
  const indices = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3];
    const r = a < 128 ? 255 : data[i];
    const g = a < 128 ? 255 : data[i + 1];
    const b = a < 128 ? 255 : data[i + 2];
    // quantize to 4 bits/channel → ≤4096 then reduce
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let idx = indexMap.get(key);
    if (idx === undefined) {
      if (palette.length < 256) {
        idx = palette.length;
        palette.push([r, g, b]);
        indexMap.set(key, idx);
      } else {
        // nearest existing
        let best = 0, bestD = 1e9;
        for (let k = 0; k < palette.length; k++) {
          const dr = palette[k][0] - r, dg = palette[k][1] - g, db = palette[k][2] - b;
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; best = k; }
        }
        idx = best;
        indexMap.set(key, idx);
      }
    }
    indices[p] = idx;
  }
  while (palette.length < 2) palette.push([0, 0, 0]);
  // pad palette to power of 2
  let gctSize = 1;
  while ((1 << gctSize) < palette.length && gctSize < 8) gctSize++;
  const gctCount = 1 << gctSize;
  while (palette.length < gctCount) palette.push([0, 0, 0]);

  const parts = [];
  const u8 = (...arr) => parts.push(Uint8Array.from(arr));
  const u16 = (n) => u8(n & 255, (n >> 8) & 255);
  // Header
  parts.push(new TextEncoder().encode('GIF89a'));
  u16(width); u16(height);
  u8(0x80 | ((gctSize - 1) << 4) | (gctSize - 1), 0, 0); // packed, bg, aspect
  const pal = new Uint8Array(gctCount * 3);
  for (let i = 0; i < gctCount; i++) {
    pal[i * 3] = palette[i][0];
    pal[i * 3 + 1] = palette[i][1];
    pal[i * 3 + 2] = palette[i][2];
  }
  parts.push(pal);
  // Image descriptor
  u8(0x2c);
  u16(0); u16(0); u16(width); u16(height);
  u8(0);
  // LZW min code size
  const minCode = Math.max(2, gctSize);
  u8(minCode);
  const lzw = lzwEncode(indices, minCode);
  // sub-blocks
  for (let i = 0; i < lzw.length; i += 255) {
    const chunk = lzw.subarray(i, Math.min(i + 255, lzw.length));
    u8(chunk.length);
    parts.push(chunk);
  }
  u8(0);
  u8(0x3b); // trailer
  return new Blob(parts, { type: 'image/gif' });
}

function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  const maxCode = () => (1 << codeSize) - 1;
  let dict = new Map();
  const resetDict = () => {
    dict = new Map();
    for (let i = 0; i < clear; i++) dict.set(String.fromCharCode(i), i);
    nextCode = eoi + 1;
    codeSize = minCodeSize + 1;
  };
  resetDict();

  const out = [];
  let acc = 0;
  let accBits = 0;
  const write = (code) => {
    acc |= code << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
      out.push(acc & 255);
      acc >>= 8;
      accBits -= 8;
    }
  };
  write(clear);
  let w = String.fromCharCode(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const c = String.fromCharCode(indices[i]);
    const wc = w + c;
    if (dict.has(wc)) {
      w = wc;
    } else {
      write(dict.get(w));
      if (nextCode <= 4095) {
        dict.set(wc, nextCode++);
        if (nextCode > maxCode() + 1 && codeSize < 12) codeSize++;
      } else {
        write(clear);
        resetDict();
      }
      w = c;
    }
  }
  write(dict.get(w));
  write(eoi);
  if (accBits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}


export const TARGET_LABELS = {
  jpg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  pdf: 'PDF',
  bmp: 'BMP',
  tiff: 'TIFF',
  ico: 'ICO',
  avif: 'AVIF',
  merge: '合并',
  split: '拆页',
  extract: '抽页',
  compress: '压缩',
  gray: '灰度',
  edge1920: '1920',
  edge1280: '1280',
  edge800: '800',
};

export function labelFor(target) {
  const k = String(target || '').toLowerCase();
  return TARGET_LABELS[k] || String(target).toUpperCase();
}

export function needsQuality(target) {
  const t = String(target || '').toLowerCase();
  return t === 'jpg' || t === 'jpeg' || t === 'webp' || t === 'avif' || t === 'compress';
}

export function needsRange(target) {
  return String(target || '').toLowerCase() === 'extract';
}

export function classify(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    type.startsWith('image/') ||
    /\.(jpe?g|png|gif|webp|bmp|tiff?|ico|avif|heic|heif)$/i.test(name)
  ) {
    return 'image';
  }
  return 'unknown';
}

export function sourceFormat(file) {
  const name = (file.name || '').toLowerCase();
  const m = name.match(/\.([a-z0-9]+)$/);
  let ext = m ? m[1] : '';
  if (ext === 'jpeg') ext = 'jpg';
  if (ext === 'tif') ext = 'tiff';
  return ext;
}

function imageFormatTargets(avif) {
  const t = ['jpg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'pdf'];
  if (avif) t.splice(3, 0, 'avif');
  return t;
}

function imageActionTargets() {
  return ['gray', 'edge1920', 'edge1280', 'edge800'];
}

export function commonTargets(files) {
  const kinds = files.map(classify);
  if (kinds.includes('unknown')) return [];
  const allPdf = kinds.every((k) => k === 'pdf');
  const allImage = kinds.every((k) => k === 'image');
  if (allPdf) {
    if (files.length === 1) return ['png', 'jpg', 'split', 'extract', 'compress'];
    return ['merge'];
  }
  if (allImage) {
    const formats = imageFormatTargets(!!avifSupported);
    const src = files.length === 1 ? sourceFormat(files[0]) : null;
    const filtered = src ? formats.filter((f) => f !== src) : formats;
    return [...filtered, ...imageActionTargets()];
  }
  return [];
}

export async function commonTargetsAsync(files) {
  await probeAvif();
  return commonTargets(files);
}

function imageDataToCanvas(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}

function grayscaleCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

function resizeCanvas(canvas, maxEdge) {
  const w0 = canvas.width;
  const h0 = canvas.height;
  if (!maxEdge || Math.max(w0, h0) <= maxEdge) return canvas;
  const s = maxEdge / Math.max(w0, h0);
  const out = document.createElement('canvas');
  out.width = Math.round(w0 * s);
  out.height = Math.round(h0 * s);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

async function loadImageBitmap(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();

  if (type.includes('heic') || type.includes('heif') || /\.heic$|\.heif$/i.test(name)) {
    if (typeof heic2any !== 'function') throw new Error('HEIC 不可用');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return createImageBitmap(blob);
  }

  if (type === 'image/bmp' || type === 'image/x-ms-bmp' || name.endsWith('.bmp')) {
    try {
      return await createImageBitmap(file);
    } catch {
      return imageDataToCanvas(decodeBmp(await file.arrayBuffer()));
    }
  }

  if (type === 'image/tiff' || type === 'image/tif' || /\.tiff?$/i.test(name)) {
    try {
      return await createImageBitmap(file);
    } catch {
      return imageDataToCanvas(decodeTiff(await file.arrayBuffer()));
    }
  }

  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('图片无法解码'));
        img.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toCanvas(source) {
  if (source instanceof HTMLCanvasElement) return source;
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0);
  if (source.close) source.close();
  return canvas;
}

async function encodeFromCanvas(canvas, target, qualityFrac) {
  const t = target === 'jpeg' ? 'jpg' : target;
  if (t === 'gif') {
    const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return { blob: encodeGif(img), ext: 'gif' };
  }
  if (t === 'bmp') {
    const id = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return { blob: encodeBmp(id), ext: 'bmp' };
  }
  if (t === 'tiff' || t === 'tif') {
    const id = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return { blob: encodeTiff(id), ext: 'tiff' };
  }
  if (t === 'ico') {
    const sizes = [16, 32, 48, 256];
    const pngs = [];
    for (const s of sizes) {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      c.getContext('2d').drawImage(canvas, 0, 0, s, s);
      pngs.push(await canvasToBlob(c, 'image/png'));
    }
    return { blob: await encodeIco(pngs), ext: 'ico' };
  }
  if (t === 'png') {
    return { blob: await canvasToBlob(canvas, 'image/png'), ext: 'png' };
  }
  if (t === 'webp') {
    return { blob: await canvasToBlob(canvas, 'image/webp', qualityFrac), ext: 'webp' };
  }
  if (t === 'avif') {
    return { blob: await canvasToBlob(canvas, 'image/avif', qualityFrac), ext: 'avif' };
  }
  const c2 = document.createElement('canvas');
  c2.width = canvas.width;
  c2.height = canvas.height;
  const x = c2.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c2.width, c2.height);
  x.drawImage(canvas, 0, 0);
  return { blob: await canvasToBlob(c2, 'image/jpeg', qualityFrac), ext: 'jpg' };
}

export async function convertImage(file, target, quality, onProgress) {
  const q = quality ?? 0.9;
  onProgress?.(10);
  const source = await loadImageBitmap(file);
  onProgress?.(35);
  let canvas = toCanvas(source);
  const t = String(target).toLowerCase();

  if (t === 'gray') {
    canvas = grayscaleCanvas(canvas);
    onProgress?.(70);
    const { blob } = await encodeFromCanvas(canvas, 'png', q);
    onProgress?.(100);
    return { blob, filename: `${basename(file.name)}-gray.png` };
  }
  if (t === 'edge1920' || t === 'edge1280' || t === 'edge800') {
    const edge = Number(t.slice(4));
    canvas = resizeCanvas(canvas, edge);
    onProgress?.(70);
    const { blob } = await encodeFromCanvas(canvas, 'png', q);
    onProgress?.(100);
    return { blob, filename: `${basename(file.name)}-${edge}.png` };
  }
  if (t === 'pdf') {
    onProgress?.(60);
    return imagesToPdf([file], onProgress);
  }
  onProgress?.(70);
  const { blob, ext } = await encodeFromCanvas(canvas, t, q);
  onProgress?.(100);
  return { blob, filename: `${basename(file.name)}.${ext}` };
}

async function renderPdfPage(pdf, pageNum, scale = 2) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

export async function pdfToImages(file, target, quality, onProgress) {
  const q = quality ?? 0.9;
  const t = target === 'jpeg' ? 'jpg' : target;
  onProgress?.(5);
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const n = pdf.numPages;
  if (n === 1) {
    const canvas = await renderPdfPage(pdf, 1);
    onProgress?.(70);
    const mime = t === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, t === 'png' ? undefined : q);
    onProgress?.(100);
    return { blob, filename: `${basename(file.name)}.${t}` };
  }
  const zip = new JSZip();
  for (let i = 1; i <= n; i++) {
    const canvas = await renderPdfPage(pdf, i);
    const mime = t === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, t === 'png' ? undefined : q);
    zip.file(`${basename(file.name)}-${i}.${t}`, blob);
    onProgress?.(Math.round((i / n) * 100));
  }
  const zblob = await zip.generateAsync({ type: 'blob' });
  return { blob: zblob, filename: `${basename(file.name)}.zip` };
}

export async function imagesToPdf(files, onProgress) {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const source = await loadImageBitmap(files[i]);
    const canvas = toCanvas(source);
    const png = await canvasToBlob(canvas, 'image/png');
    const img = await doc.embedPng(await png.arrayBuffer());
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    onProgress?.(Math.round(((i + 1) / files.length) * 100));
  }
  const bytes = await doc.save();
  const name =
    files.length === 1 ? `${basename(files[0].name)}.pdf` : 'images.pdf';
  return { blob: new Blob([bytes], { type: 'application/pdf' }), filename: name };
}

export async function mergePdfs(files, onProgress) {
  const { PDFDocument } = PDFLib;
  onProgress?.(5);
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const src = await PDFDocument.load(await files[i].arrayBuffer());
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => doc.addPage(p));
    onProgress?.(Math.round(((i + 1) / files.length) * 90) + 5);
  }
  const bytes = await doc.save();
  onProgress?.(100);
  return { blob: new Blob([bytes], { type: 'application/pdf' }), filename: 'merged.pdf' };
}

export async function splitPdf(file, onProgress) {
  const { PDFDocument } = PDFLib;
  onProgress?.(5);
  const bytes = await file.arrayBuffer();
  const src = await PDFDocument.load(bytes);
  const indices = src.getPageIndices();
  const zip = new JSZip();
  for (let i = 0; i < indices.length; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [indices[i]]);
    doc.addPage(page);
    zip.file(`${basename(file.name)}-${i + 1}.pdf`, await doc.save());
    onProgress?.(Math.round(((i + 1) / indices.length) * 90) + 5);
  }
  const zblob = await zip.generateAsync({ type: 'blob' });
  onProgress?.(100);
  return { blob: zblob, filename: `${basename(file.name)}-pages.zip` };
}

export function parsePageRange(text, maxPages) {
  const s = String(text || '').trim();
  if (!s) return [];
  const set = new Set();
  for (const part of s.split(/[,，\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*[-–—~]\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) {
        if (i >= 1 && i <= maxPages) set.add(i);
      }
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= maxPages) set.add(n);
    } else {
      return [];
    }
  }
  return [...set].sort((a, b) => a - b);
}

export async function extractPdfPages(file, rangeText, onProgress) {
  const { PDFDocument } = PDFLib;
  onProgress?.(10);
  const bytes = await file.arrayBuffer();
  const src = await PDFDocument.load(bytes);
  const max = src.getPageCount();
  const pages = parsePageRange(rangeText, max);
  if (!pages.length) throw new Error('页码无效');
  const doc = await PDFDocument.create();
  const copied = await doc.copyPages(src, pages.map((p) => p - 1));
  copied.forEach((p) => doc.addPage(p));
  onProgress?.(90);
  const out = await doc.save();
  onProgress?.(100);
  return {
    blob: new Blob([out], { type: 'application/pdf' }),
    filename: `${basename(file.name)}-extract.pdf`,
  };
}

export async function compressPdf(file, quality, onProgress) {
  const { PDFDocument } = PDFLib;
  const q = quality ?? 0.7;
  onProgress?.(5);
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const n = pdf.numPages;
  const doc = await PDFDocument.create();
  for (let i = 1; i <= n; i++) {
    const canvas = await renderPdfPage(pdf, i, 1.5);
    const jpg = await canvasToBlob(canvas, 'image/jpeg', q);
    const img = await doc.embedJpg(await jpg.arrayBuffer());
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    onProgress?.(Math.round((i / n) * 90) + 5);
  }
  const bytes = await doc.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  onProgress?.(100);
  if (blob.size >= file.size) {
    return { blob: null, skipped: true, status: '已经很小了', filename: null };
  }
  return { blob, filename: `${basename(file.name)}-small.pdf` };
}

export async function convertPdf(file, target, quality, onProgress, opts = {}) {
  const t = String(target).toLowerCase();
  if (t === 'split') return splitPdf(file, onProgress);
  if (t === 'extract') return extractPdfPages(file, opts.rangeText || '', onProgress);
  if (t === 'compress') return compressPdf(file, quality, onProgress);
  if (t === 'png' || t === 'jpg' || t === 'jpeg') {
    return pdfToImages(file, t === 'jpeg' ? 'jpg' : t, quality, onProgress);
  }
  throw new Error('不支持的格式');
}
