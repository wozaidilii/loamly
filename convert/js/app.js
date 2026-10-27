import {
  convertImage, pdfToImages, imagesToPdf,
  convertPdf, mergePdfs,
  classify, commonTargetsAsync, downloadBlob,
  labelFor, needsQuality, needsRange,
} from './converters.js?v=20261027c';

const cfg = window.LOAMLY_CONVERT || {
  name: '文件转换',
  title: '文件转换',
  tagline: '图片、PDF 格式转换，在浏览器里完成，文件不上传。',
  tags: ['免费使用'],
  version: '0.3',
};
document.title = cfg.title || cfg.name || '文件转换';
const brand = document.getElementById('brand-name');
if (brand) brand.textContent = cfg.name;
const verEl = document.getElementById('footer-version');
if (verEl) verEl.textContent = `v${cfg.version || '0.3'}`;
const taglineEl = document.getElementById('hero-tagline');
if (taglineEl && cfg.tagline) taglineEl.textContent = cfg.tagline;
const tagsEl = document.getElementById('hero-tags');
if (tagsEl && cfg.tags?.length) {
  tagsEl.innerHTML = cfg.tags.map((t) => `<span class="tag">${t}</span>`).join('');
}
if (cfg.ADS_ENABLED) document.body.classList.add('ads-on');

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const drop = $('#drop');
const fileInput = $('#file-input');
const tree = $('#tree');
const treeSvg = $('#tree-svg');
const centerExt = $('#center-ext');
const centerSub = $('#center-sub');
const targetsEl = $('#targets');
const hint = $('#hint');
const idleHero = $('#idle-hero');
const actions = $('#tree-actions');
const btnAgain = $('#btn-again');
const dropError = $('#drop-error');
const qualityRow = $('#quality-row');
const qualityInput = $('#quality');
const qualityVal = $('#quality-val');
const rangeRow = $('#range-row');
const rangeInput = $('#page-range');

const isMobile = () => window.matchMedia('(max-width: 640px)').matches;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const MSG_SINGLE = '这个文件暂时转不了';
const MSG_MULTI = '这几个文件没有共同可转的格式';
const MSG_FAIL = '转换失败，再试一次';
const MSG_RANGE = '页码无效';

let files = [];
let targets = []; // lowercase keys
let converting = false;
let lastResult = null;
let activeTarget = null;
let convertGen = 0;
let qualityTimer = null;

function syncQualityFill() {
  const v = Number(qualityInput?.value || 90);
  const min = Number(qualityInput?.min || 50);
  const max = Number(qualityInput?.max || 100);
  const pct = ((v - min) / (max - min)) * 100;
  qualityInput?.style.setProperty('--q', `${pct}%`);
  if (qualityVal) qualityVal.textContent = String(v);
}

qualityInput?.addEventListener('input', () => {
  syncQualityFill();
  if (!activeTarget) return;
  if (!needsQuality(activeTarget)) return;
  clearTimeout(qualityTimer);
  qualityTimer = setTimeout(() => {
    if (activeTarget) startConvert(activeTarget, { fromQuality: true });
  }, 180);
});
syncQualityFill();

rangeInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && activeTarget === 'extract') {
    e.preventDefault();
    startConvert('extract', { fromRange: true });
  }
});

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function layoutPositions(n) {
  const cx = 50;
  const cy = 50;
  const r = 41;
  if (n === 1) return [{ x: cx, y: cy - r }];
  const start = -210;
  const end = 30;
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => {
    const a = ((start + step * i) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function setQualityVisible(on) {
  qualityRow?.classList.toggle('is-visible', !!on);
}

function setRangeVisible(on) {
  rangeRow?.classList.toggle('is-visible', !!on);
}

function showIdle() {
  converting = false;
  lastResult = null;
  activeTarget = null;
  convertGen++;
  clearTimeout(qualityTimer);
  drop.classList.remove('hidden', 'is-dragover');
  idleHero?.classList.remove('hidden');
  tree.classList.remove('is-open', 'mobile-list');
  hint.classList.remove('hidden');
  actions.classList.remove('is-visible');
  setQualityVisible(false);
  setRangeVisible(false);
  dropError.hidden = true;
  dropError.textContent = '';
  targetsEl.innerHTML = '';
  treeSvg.innerHTML = '';
  files = [];
  targets = [];
}

function showDropMessage(msg) {
  dropError.textContent = msg;
  dropError.hidden = false;
  drop.classList.add('is-dragover');
  setTimeout(() => drop.classList.remove('is-dragover'), 240);
  setTimeout(() => {
    if (dropError.textContent === msg) {
      dropError.hidden = true;
      dropError.textContent = '';
    }
  }, 2400);
}

async function openTree(fileList) {
  files = fileList;
  targets = await commonTargetsAsync(fileList);
  drop.classList.add('hidden');
  idleHero?.classList.add('hidden');
  hint.classList.add('hidden');
  dropError.hidden = true;
  tree.classList.add('is-open');
  tree.classList.toggle('mobile-list', isMobile());

  if (fileList.length === 1) {
    const ext = fileList[0].name.split('.').pop()?.toUpperCase() || 'FILE';
    centerExt.textContent = ext === 'JPEG' ? 'JPG' : ext === 'TIF' ? 'TIFF' : ext;
    centerSub.textContent = formatSize(fileList[0].size);
    centerSub.style.display = 'block';
  } else {
    centerExt.textContent = `${fileList.length} 个文件`;
    centerSub.textContent = '';
    centerSub.style.display = 'none';
  }

  setQualityVisible(false);
  setRangeVisible(false);
  renderTargets();
  actions.classList.remove('is-visible');
  converting = false;
  lastResult = null;
  activeTarget = null;
}

function renderTargets() {
  targetsEl.innerHTML = '';
  treeSvg.innerHTML = '';
  const mobile = isMobile();
  const positions = mobile ? targets.map(() => ({ x: 50, y: 50 })) : layoutPositions(targets.length);

  targets.forEach((key, i) => {
    const pos = positions[i];
    const label = labelFor(key);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'tree-line');
    line.setAttribute('data-format', key);
    line.setAttribute('x1', '50%');
    line.setAttribute('y1', '50%');
    line.setAttribute('x2', `${pos.x}%`);
    line.setAttribute('y2', `${pos.y}%`);
    treeSvg.appendChild(line);

    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'target-node';
    node.dataset.format = key;
    node.style.left = `${pos.x}%`;
    node.style.top = `${pos.y}%`;
    node.style.transitionDelay = reduceMotion() ? '0ms' : `${i * 30}ms`;
    const r = 36;
    node.innerHTML = `
      <svg class="progress-ring" viewBox="0 0 80 80" aria-hidden="true">
        <circle class="track" cx="40" cy="40" r="${r}"></circle>
        <circle class="fill" cx="40" cy="40" r="${r}"
          stroke-dasharray="${2 * Math.PI * r}"
          stroke-dashoffset="${2 * Math.PI * r}"></circle>
      </svg>
      <span class="ext">${label}</span>
      <span class="download-label">下载</span>
      <span class="progress-label">转换中 · 0%</span>
    `;
    node.addEventListener('pointerenter', () => setHover(key, true));
    node.addEventListener('pointerleave', () => setHover(key, false));
    node.addEventListener('click', () => {
      if (converting && !node.classList.contains('is-done')) return;
      if (node.classList.contains('is-done') && lastResult && activeTarget === key) {
        if (lastResult.blob) downloadBlob(lastResult.blob, lastResult.filename);
        return;
      }
      startConvert(key);
    });
    targetsEl.appendChild(node);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => node.classList.add('is-shown'));
    });
  });
}

function setHover(fmt, on) {
  if (converting) return;
  $$('.target-node').forEach((n) => {
    n.classList.toggle('is-hover', on && n.dataset.format === fmt);
  });
  $$('.tree-line').forEach((l) => {
    l.classList.toggle('is-active', on && l.dataset.format === fmt);
  });
}

function setProgress(fmt, pct) {
  const circumference = 2 * Math.PI * 36;
  const node = $(`.target-node[data-format="${fmt}"]`);
  if (!node) return;
  const fill = $('.fill', node);
  const label = $('.progress-label', node);
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (fill) fill.style.strokeDashoffset = String(circumference * (1 - p / 100));
  if (label) label.textContent = isMobile() ? `${p}%` : `转换中 · ${p}%`;
  node.dataset.progress = String(p);
  node.style.setProperty('--p', `${p}%`);
}

async function convertOne(file, target, quality, onProgress, opts = {}) {
  const kind = classify(file);
  if (kind === 'image') {
    return convertImage(file, target, quality, onProgress);
  }
  if (kind === 'pdf') {
    return convertPdf(file, target, quality, onProgress, opts);
  }
  throw new Error(MSG_FAIL);
}

async function startConvert(fmt, opts = {}) {
  if (!targets.includes(fmt)) return;
  if (converting && !opts.fromQuality && !opts.fromRange) return;

  // Extract: show range first; convert when range present
  if (fmt === 'extract' && !opts.fromRange && !opts.fromQuality) {
    activeTarget = fmt;
    setRangeVisible(true);
    setQualityVisible(false);
    if (!rangeInput.value.trim()) rangeInput.value = '1';
    rangeInput.focus();
    // proceed immediately with current/default range
  }

  const myGen = ++convertGen;
  converting = true;
  activeTarget = fmt;
  lastResult = null;
  setQualityVisible(needsQuality(fmt));
  setRangeVisible(needsRange(fmt));

  $$('.target-node').forEach((n) => {
    const match = n.dataset.format === fmt;
    n.classList.toggle('is-converting', match);
    n.classList.toggle('is-faded', !match);
    n.classList.remove('is-hover', 'is-done', 'is-status');
    const dl = $('.download-label', n);
    if (dl) dl.textContent = '下载';
  });
  $$('.tree-line').forEach((l) => {
    const match = l.dataset.format === fmt;
    l.classList.toggle('is-active', match);
    l.classList.toggle('is-faded', !match);
  });
  setProgress(fmt, 0);
  actions.classList.remove('is-visible');

  const quality = Number(qualityInput?.value || 90) / 100;
  const rangeText = rangeInput?.value || '';

  try {
    let result;
    if (fmt === 'merge') {
      result = await mergePdfs(files, (pct) => {
        if (myGen !== convertGen) return;
        setProgress(fmt, pct);
      });
    } else if (files.length === 1) {
      result = await convertOne(files[0], fmt, quality, (pct) => {
        if (myGen !== convertGen) return;
        setProgress(fmt, pct);
      }, { rangeText });
    } else if (fmt === 'pdf' && files.every((f) => classify(f) === 'image')) {
      result = await imagesToPdf(files, (pct) => {
        if (myGen !== convertGen) return;
        setProgress(fmt, pct);
      });
    } else if (files.every((f) => classify(f) === 'image')) {
      const zip = new JSZip();
      for (let i = 0; i < files.length; i++) {
        if (myGen !== convertGen) return;
        const base = Math.round((i / files.length) * 100);
        const span = Math.round(100 / files.length);
        const one = await convertOne(files[i], fmt, quality, (pct) => {
          if (myGen !== convertGen) return;
          setProgress(fmt, base + (pct / 100) * span);
        });
        if (one.blob) zip.file(one.filename, one.blob);
      }
      const zblob = await zip.generateAsync({ type: 'blob' });
      result = { blob: zblob, filename: `converted.zip` };
      setProgress(fmt, 100);
    } else {
      throw new Error(MSG_FAIL);
    }
    if (myGen !== convertGen) return;
    lastResult = result;
    finishConvert(fmt, result);
  } catch (err) {
    if (myGen !== convertGen) return;
    console.error(err);
    converting = false;
    activeTarget = null;
    setQualityVisible(false);
    setRangeVisible(false);
    $$('.target-node').forEach((n) => n.classList.remove('is-converting', 'is-faded', 'is-done', 'is-status'));
    $$('.tree-line').forEach((l) => l.classList.remove('is-active', 'is-faded'));
    const msg = (err && err.message === '页码无效') ? MSG_RANGE : MSG_FAIL;
    showIdle();
    showDropMessage(msg);
  }
}

function finishConvert(fmt, result) {
  const node = $(`.target-node[data-format="${fmt}"]`);
  if (!node) return;
  node.classList.remove('is-converting');
  node.classList.add('is-done');
  delete node.dataset.progress;
  const label = $('.progress-label', node);
  if (label) label.textContent = '';
  const dl = $('.download-label', node);
  if (result && result.skipped) {
    node.classList.add('is-status');
    if (dl) dl.textContent = result.status || '已经很小了';
  } else if (dl) {
    dl.textContent = '下载';
  }
  setProgress(fmt, 100);
  actions.classList.add('is-visible');
  converting = false;
  setQualityVisible(needsQuality(fmt));
  setRangeVisible(needsRange(fmt));
}

async function ingestFiles(fileList) {
  const list = [...fileList].filter(Boolean);
  if (!list.length) return;
  const formats = await commonTargetsAsync(list);
  if (!formats.length) {
    if (tree.classList.contains('is-open')) showIdle();
    showDropMessage(list.length > 1 ? MSG_MULTI : MSG_SINGLE);
    return;
  }
  await openTree(list);
}

$('#btn-pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  ingestFiles(fileInput.files);
  fileInput.value = '';
});
btnAgain.addEventListener('click', showIdle);

let dragDepth = 0;
function hasFiles(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || converting) return;
  e.preventDefault();
  dragDepth++;
  if (!tree.classList.contains('is-open')) drop.classList.add('is-dragover');
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) drop.classList.remove('is-dragover');
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (tree.classList.contains('is-open') && !converting) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const node = el && el.closest('.target-node');
    const fmt = node && node.dataset.format;
    $$('.target-node').forEach((n) => n.classList.toggle('is-hover', !!fmt && n.dataset.format === fmt));
    $$('.tree-line').forEach((l) => l.classList.toggle('is-active', !!fmt && l.dataset.format === fmt));
  }
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('is-dragover');
  const dropped = [...e.dataTransfer.files];
  if (!dropped.length || converting) return;

  if (tree.classList.contains('is-open')) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const node = el && el.closest('.target-node');
    await ingestFiles(dropped);
    const formats = await commonTargetsAsync(dropped);
    if (node && node.dataset.format && formats.includes(node.dataset.format)) {
      requestAnimationFrame(() => startConvert(node.dataset.format));
    }
    return;
  }
  await ingestFiles(dropped);
});

window.addEventListener('resize', () => {
  if (!tree.classList.contains('is-open') || converting) return;
  const fmtHover = $('.target-node.is-hover')?.dataset.format;
  tree.classList.toggle('mobile-list', isMobile());
  renderTargets();
  if (fmtHover) setHover(fmtHover, true);
});

window.ConvertTree = {
  showIdle,
  openTree,
  startConvert,
  getTargets: () => targets.slice(),
  getFiles: () => files.slice(),
  isConverting: () => converting,
  getLastResult: () => lastResult,
  getActiveTarget: () => activeTarget,
};

showIdle();
