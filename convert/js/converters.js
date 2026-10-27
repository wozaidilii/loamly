/* ES module: browser-only converters */
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

function basename(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function loadImageBitmap(file) {
  if (file.type === 'image/heic' || file.type === 'image/heif' ||
      /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name)) {
    if (typeof heic2any !== 'function') throw new Error('HEIC 不可用');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return createImageBitmap(blob);
  }
  return createImageBitmap(file);
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), mime, quality);
  });
}

export async function convertImage(file, target, quality, onProgress) {
  onProgress?.(10);
  const bmp = await loadImageBitmap(file);
  onProgress?.(40);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (target === 'jpg' || target === 'jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  onProgress?.(70);
  const mime = target === 'png' ? 'image/png'
    : target === 'webp' ? 'image/webp'
    : 'image/jpeg';
  const q = (mime === 'image/png') ? undefined : (quality ?? 0.9);
  const blob = await canvasToBlob(canvas, mime, q);
  onProgress?.(100);
  const ext = target === 'jpeg' ? 'jpg' : target;
  return { blob, filename: `${basename(file.name)}.${ext}` };
}

export async function pdfToImages(file, target, quality, onProgress) {
  onProgress?.(5);
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = pdf.numPages;
  const blobs = [];
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
    const mime = target === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, quality ?? 0.92);
    const ext = target === 'png' ? 'png' : 'jpg';
    blobs.push({ blob, filename: `${basename(file.name)}-p${i}.${ext}` });
    onProgress?.(Math.round((i / pages) * 100));
  }
  if (blobs.length === 1) return blobs[0];
  const zip = new JSZip();
  for (const item of blobs) zip.file(item.filename, item.blob);
  const zblob = await zip.generateAsync({ type: 'blob' });
  return { blob: zblob, filename: `${basename(file.name)}.zip` };
}

export async function imagesToPdf(files, onProgress) {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let bytes = new Uint8Array(await file.arrayBuffer());
    let embedded;
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    const isJpg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
    if (isPng) {
      embedded = await doc.embedPng(bytes);
    } else if (isJpg) {
      embedded = await doc.embedJpg(bytes);
    } else {
      const bmp = await loadImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width; canvas.height = bmp.height;
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      const blob = await canvasToBlob(canvas, 'image/png');
      bytes = new Uint8Array(await blob.arrayBuffer());
      embedded = await doc.embedPng(bytes);
    }
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    onProgress?.(Math.round(((i + 1) / files.length) * 90));
  }
  const pdfBytes = await doc.save();
  onProgress?.(100);
  const name = files.length === 1 ? `${basename(files[0].name)}.pdf` : 'images.pdf';
  return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), filename: name };
}


export function classify(file) {
  const n = file.name.toLowerCase();
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/.test(n)) return 'image';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (t.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v)$/.test(n)) return 'video';
  if (t.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|wma)$/.test(n)) return 'audio';
  return 'unknown';
}

export function targetsFor(kind) {
  if (kind === 'image') return ['jpg', 'png', 'webp', 'pdf'];
  if (kind === 'pdf') return ['png', 'jpg'];
  // v0.1: audio/video targets not offered
  return [];
}
