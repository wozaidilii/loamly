import {
  convertImage, imagesToPdf, convertPdf, mergePdfs, convertAV,
  classify, treePlanAsync, downloadBlob,
  labelFor, needsQuality, needsRange,
} from './converters.js?v=20261027i';

const cfg = window.LOAMLY_CONVERT || {
  name: '文件转换',
  title: '文件转换',
  tagline: '图片、PDF 格式转换，在浏览器里完成，文件不上传。',
  tags: ['免费使用'],
  version: '0.3c',
};
document.title = cfg.title || cfg.name || '文件转换';
const brand = document.getElementById('brand-name');
if (brand) brand.textContent = cfg.name;
const verEl = document.getElementById('footer-version');
if (verEl) verEl.textContent = `v${cfg.version || '0.3c'}`;
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
const centerNode = $('#center-node');
const centerExt = $('#center-ext');
const centerSub = $('#center-sub');
const targetsEl = $('#targets');
const hint = $('#hint');
const idleHero = $('#idle-hero');
const dropError = $('#drop-error');
const qualityRow = $('#quality-row');
const qualityInput = $('#quality');
const qualityVal = $('#quality-val');
const rangeRow = $('#range-row');
const rangeInput = $('#page-range');
const btnChange = $('#btn-change-file');
const btnChangeMobile = $('#btn-change-file-mobile');
const treeControls = $('#tree-controls');

const isMobile = () => window.matchMedia('(max-width: 640px)').matches;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const MSG_SINGLE = '这个文件暂时转不了';
const MSG_MULTI = '这几个文件没有共同可转的格式';
const MSG_FAIL = '转换失败，再试一次';
const MSG_TOO_LARGE = '文件太大';

const SECOND_ANGLES = [75, 105, 135, 165]; // 0°=right, clockwise; 调整: 黑白/1920/1280/800; 页面: first 3
const SECOND_R_PX = 116;
const SECOND_D_PX = 52;

let files = [];
let plan = null;
let targets = [];
let converting = false;
let activeTarget = null;
let convertGen = 0;
let qualityTimer = null;
let groupHoverTimer = null;
let groupCollapseTimer = null;
let groupExpanded = false;
/** @type {Map<string, {blob?: Blob, filename?: string, url?: string, skipped?: boolean, status?: string, error?: boolean}>} */
const results = new Map();

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
  if (!activeTarget || !needsQuality(activeTarget)) return;
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

function clearResults() {
  for (const r of results.values()) {
    if (r?.url) {
      try { URL.revokeObjectURL(r.url); } catch {}
    }
  }
  results.clear();
}

/** ~180° arc above centre, left → right; endpoints on horizontal midline. */
function layoutArc(n, r = 41, startDeg = -180, endDeg = 0) {
  const cx = 50;
  const cy = 50;
  if (n <= 0) return [];
  if (n === 1) return [{ x: cx, y: cy - r }];
  const step = (endDeg - startDeg) / (n - 1);
  return Array.from({ length: n }, (_, i) => {
    const a = ((startDeg + step * i) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/** Second layer from group parent.
 * Angles 75/105/135/165° (0°=+x right, clockwise). Centres exactly SECOND_R_PX (116) from parent.
 * Returns pixel centres relative to .tree, plus % for lines.
 */
function layoutSecondDown(parentPos, n) {
  const tw = tree.clientWidth || 640;
  const th = tree.clientHeight || 620;
  const px = (parentPos.x / 100) * tw;
  const py = (parentPos.y / 100) * th;
  return SECOND_ANGLES.slice(0, n).map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const cx = px + SECOND_R_PX * Math.cos(rad);
    const cy = py + SECOND_R_PX * Math.sin(rad);
    return {
      x: (cx / tw) * 100,
      y: (cy / th) * 100,
      leftPx: cx,
      topPx: cy,
    };
  });
}

function setQualityVisible(on) {
  qualityRow?.classList.toggle('is-visible', !!on);
  treeControls?.classList.toggle('has-quality', !!on);
}
function setRangeVisible(on) {
  rangeRow?.classList.toggle('is-visible', !!on);
  treeControls?.classList.toggle('has-range', !!on);
}

function openPicker() {
  fileInput.click();
}

function showIdle() {
  converting = false;
  activeTarget = null;
  convertGen++;
  clearTimeout(qualityTimer);
  clearTimeout(groupHoverTimer);
  clearTimeout(groupCollapseTimer);
  groupExpanded = false;
  clearResults();
  drop.classList.remove('hidden', 'is-dragover');
  idleHero?.classList.remove('hidden');
  tree.classList.remove('is-open', 'mobile-list', 'group-open');
  hint.classList.remove('hidden');
  setQualityVisible(false);
  setRangeVisible(false);
  dropError.hidden = true;
  dropError.textContent = '';
  targetsEl.innerHTML = '';
  treeSvg.innerHTML = '';
  files = [];
  plan = null;
  targets = [];
  if (btnChangeMobile) btnChangeMobile.hidden = true;
  document.body.classList.remove('tree-open-mobile');
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
  clearResults();
  files = fileList;
  plan = await treePlanAsync(fileList);
  targets = plan
    ? [...plan.ring, ...(plan.group ? plan.group.children : [])]
    : [];
  drop.classList.add('hidden');
  idleHero?.classList.add('hidden');
  hint.classList.add('hidden');
  dropError.hidden = true;
  tree.classList.add('is-open');
  tree.classList.toggle('mobile-list', isMobile());
  document.body.classList.toggle('tree-open-mobile', isMobile());
  if (btnChangeMobile) btnChangeMobile.hidden = !isMobile();

  if (fileList.length === 1) {
    const ext = fileList[0].name.split('.').pop()?.toUpperCase() || 'FILE';
    centerExt.textContent =
      ext === 'JPEG' ? 'JPG' : ext === 'TIF' ? 'TIFF' : ext;
    centerSub.textContent = formatSize(fileList[0].size);
    centerSub.style.display = 'block';
  } else {
    centerExt.textContent = `${fileList.length} 个文件`;
    centerSub.textContent = '';
    centerSub.style.display = 'none';
  }

  setQualityVisible(false);
  setRangeVisible(false);
  groupExpanded = false;
  converting = false;
  activeTarget = null;
  renderTargets();
}

function formatLabel(key) {
  return labelFor(key);
}

function makeNode(key, pos, opts = {}) {
  const label = opts.label || formatLabel(key);
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'target-node'
    + (opts.group ? ' is-group' : '')
    + (opts.second ? ' is-second' : '');
  node.dataset.format = key;
  if (opts.second) node.dataset.layer = 'second';
  node.style.left = `${pos.x}%`;
  node.style.top = `${pos.y}%`;
  node.style.transitionDelay = reduceMotion() ? '0ms' : `${(opts.i || 0) * 30}ms`;
  const r = opts.second ? 24 : 36;
  node.innerHTML = `
    <svg class="progress-ring" viewBox="0 0 80 80" aria-hidden="true">
      <circle class="track" cx="40" cy="40" r="${r}"></circle>
      <circle class="fill" cx="40" cy="40" r="${r}"
        stroke-dasharray="${2 * Math.PI * r}"
        stroke-dashoffset="${2 * Math.PI * r}"></circle>
    </svg>
    <span class="ext">${label}</span>
    <span class="download-stack" aria-hidden="true">
      <span class="download-label">下载</span>
      <span class="download-fmt">${label}</span>
    </span>
    <span class="retry-label">重试</span>
    <span class="progress-label">转换中 · 0%</span>
  `;
  return node;
}

function addLine(fmt, x1, y1, x2, y2, cls = '') {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('class', `tree-line ${cls}`.trim());
  line.setAttribute('data-format', fmt);
  line.setAttribute('x1', `${x1}%`);
  line.setAttribute('y1', `${y1}%`);
  line.setAttribute('x2', `${x2}%`);
  line.setAttribute('y2', `${y2}%`);
  treeSvg.appendChild(line);
  return line;
}

function applyResultState(node, key) {
  const r = results.get(key);
  node.classList.remove('is-done', 'is-status', 'is-error', 'is-converting');
  if (!r) return;
  if (r.error) {
    node.classList.add('is-error');
    return;
  }
  node.classList.add('is-done');
  if (r.skipped) {
    node.classList.add('is-status');
    const dl = $('.download-label', node);
    if (dl) dl.textContent = r.status || '已经很小，不用再压缩';
    const fmtEl = $('.download-fmt', node);
    if (fmtEl) fmtEl.style.display = 'none';
  } else {
    const dl = $('.download-label', node);
    if (dl) dl.textContent = '下载';
    const fmtEl = $('.download-fmt', node);
    if (fmtEl) {
      fmtEl.style.display = '';
      fmtEl.textContent = formatLabel(key);
    }
  }
  // mobile single-line
  if (isMobile()) {
    const dl = $('.download-label', node);
    if (dl && !r.skipped) dl.textContent = `下载 ${formatLabel(key)}`;
    const fmtEl = $('.download-fmt', node);
    if (fmtEl) fmtEl.style.display = 'none';
  }
}

function bindLeaf(node, key) {
  node.addEventListener('pointerenter', () => setHover(key, true));
  node.addEventListener('pointerleave', () => setHover(key, false));
  node.addEventListener('click', () => {
    const r = results.get(key);
    if (r?.error) {
      startConvert(key);
      return;
    }
    if (r && !r.error && r.blob) {
      downloadBlob(r.blob, r.filename);
      return;
    }
    if (r?.skipped) return;
    if (converting) return;
    startConvert(key);
  });
}

function renderTargets() {
  targetsEl.innerHTML = '';
  treeSvg.innerHTML = '';
  if (!plan) return;
  const mobile = isMobile();

  if (mobile) {
    renderMobile();
    return;
  }

  const ringKeys = [...plan.ring];
  if (plan.group) ringKeys.push(plan.group.key);
  const positions = layoutArc(ringKeys.length);
  const posByKey = {};

  ringKeys.forEach((key, i) => {
    const pos = positions[i];
    posByKey[key] = pos;
    const isGroup = plan.group && key === plan.group.key;
    addLine(key, 50, 50, pos.x, pos.y);
    const node = makeNode(isGroup ? plan.group.key : key, pos, {
      i,
      group: isGroup,
      label: isGroup ? plan.group.label : formatLabel(key),
    });
    if (isGroup) {
      node.addEventListener('pointerenter', () => scheduleExpand());
      node.addEventListener('pointerleave', () => scheduleCollapse());
      node.addEventListener('click', (e) => {
        e.preventDefault();
        expandGroup(true);
      });
    } else {
      bindLeaf(node, key);
      applyResultState(node, key);
    }
    targetsEl.appendChild(node);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => node.classList.add('is-shown'));
    });
  });

  if (plan.group) {
    const parentPos = posByKey[plan.group.key];
    const kids = plan.group.children;
    const secondPos = layoutSecondDown(parentPos, kids.length);
    kids.forEach((key, i) => {
      const pos = secondPos[i];
      addLine(key, parentPos.x, parentPos.y, pos.x, pos.y, 'tree-line-second');
      const node = makeNode(key, pos, { i, second: true });
      node.style.left = `${pos.leftPx}px`;
      node.style.top = `${pos.topPx}px`;
      node.style.width = `${SECOND_D_PX}px`;
      node.style.height = `${SECOND_D_PX}px`;
      // No scale in final state — diameter must stay 52 CSS px (translate only)
      node.style.transform = 'translate(-50%, -50%)';
      node.classList.add('is-second-hidden');
      node.addEventListener('pointerenter', () => {
        clearTimeout(groupCollapseTimer);
        setHover(key, true);
      });
      node.addEventListener('pointerleave', () => {
        setHover(key, false);
        scheduleCollapse();
      });
      node.addEventListener('click', () => {
        const r = results.get(key);
        if (r?.error) { startConvert(key); return; }
        if (r && !r.error && r.blob) { downloadBlob(r.blob, r.filename); return; }
        if (r?.skipped) return;
        if (converting) return;
        startConvert(key);
      });
      applyResultState(node, key);
      targetsEl.appendChild(node);
    });
  }

  if (groupExpanded) expandGroup(true);
}

function renderMobile() {
  tree.classList.add('mobile-list');
  const wrap = document.createElement('div');
  wrap.className = 'mobile-grids';

  const fmtGrid = document.createElement('div');
  fmtGrid.className = 'pill-grid';
  plan.ring.forEach((key, i) => {
    const node = makeNode(key, { x: 0, y: 0 }, { i });
    node.style.left = '';
    node.style.top = '';
    bindLeaf(node, key);
    applyResultState(node, key);
    fmtGrid.appendChild(node);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => node.classList.add('is-shown'));
    });
  });
  wrap.appendChild(fmtGrid);

  if (plan.group && plan.group.children.length) {
    const div = document.createElement('div');
    div.className = 'mobile-divider';
    wrap.appendChild(div);
    const opGrid = document.createElement('div');
    opGrid.className = 'pill-grid';
    plan.group.children.forEach((key, i) => {
      const node = makeNode(key, { x: 0, y: 0 }, { i });
      node.style.left = '';
      node.style.top = '';
      bindLeaf(node, key);
      applyResultState(node, key);
      opGrid.appendChild(node);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => node.classList.add('is-shown'));
      });
    });
    wrap.appendChild(opGrid);
  }

  targetsEl.appendChild(wrap);
}

function scheduleExpand() {
  clearTimeout(groupCollapseTimer);
  clearTimeout(groupHoverTimer);
  groupHoverTimer = setTimeout(() => expandGroup(true), 150);
}

function scheduleCollapse() {
  clearTimeout(groupHoverTimer);
  clearTimeout(groupCollapseTimer);
  // Keep open if a second-layer result exists or converting a child
  const keep =
    converting && plan?.group?.children?.includes(activeTarget)
    || plan?.group?.children?.some((k) => results.has(k));
  if (keep) return;
  groupCollapseTimer = setTimeout(() => expandGroup(false), 300);
}

function expandGroup(on) {
  groupExpanded = !!on;
  tree.classList.toggle('group-open', groupExpanded);
  $$('.target-node.is-second').forEach((n) => {
    n.classList.toggle('is-second-hidden', !groupExpanded);
    if (groupExpanded) {
      n.classList.add('is-shown');
      // Snap: kill any leftover scale from hidden state / transition
      n.style.transform = 'translate(-50%, -50%)';
    }
  });
  $$('.tree-line-second').forEach((l) => {
    l.classList.toggle('is-second-visible', groupExpanded);
  });
}

function setHover(fmt, on) {
  if (converting && fmt !== activeTarget) {
    // still allow hover highlight on idle nodes
  }
  $$('.target-node').forEach((n) => {
    n.classList.toggle('is-hover', on && n.dataset.format === fmt);
  });
  $$('.tree-line').forEach((l) => {
    l.classList.toggle('is-active', on && l.dataset.format === fmt);
  });
}

function setProgress(fmt, pct) {
  const node = $(`.target-node[data-format="${fmt}"]`);
  if (!node) return;
  const fill = $('.fill', node);
  const label = $('.progress-label', node);
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const r = node.classList.contains('is-second') ? 24 : 36;
  const circumference = 2 * Math.PI * r;
  if (fill) fill.style.strokeDashoffset = String(circumference * (1 - p / 100));
  if (label) label.textContent = isMobile() ? `${p}%` : `转换中 · ${p}%`;
  node.dataset.progress = String(p);
  node.style.setProperty('--p', `${p}%`);
}

async function convertOne(file, target, quality, onProgress, opts = {}) {
  const kind = classify(file);
  if (kind === 'image') return convertImage(file, target, quality, onProgress);
  if (kind === 'pdf') return convertPdf(file, target, quality, onProgress, opts);
  if (kind === 'audio' || kind === 'video') return convertAV(file, target, onProgress);
  throw new Error(MSG_FAIL);
}

function storeResult(fmt, result) {
  const prev = results.get(fmt);
  if (prev?.url) {
    try { URL.revokeObjectURL(prev.url); } catch {}
  }
  const entry = { ...result };
  if (result?.blob) entry.url = URL.createObjectURL(result.blob);
  results.set(fmt, entry);
}

async function startConvert(fmt, opts = {}) {
  if (!targets.includes(fmt) && !(plan?.group && plan.group.key === fmt)) return;
  if (plan?.group && fmt === plan.group.key) return;
  if (converting && !opts.fromQuality && !opts.fromRange) return;

  if (fmt === 'extract' && !opts.fromRange && !opts.fromQuality) {
    activeTarget = fmt;
    setRangeVisible(true);
    setQualityVisible(false);
    if (!rangeInput.value.trim()) rangeInput.value = '1';
    rangeInput.focus();
    // wait for Enter / explicit fromRange — still kick off if already has value from prior
  }

  const myGen = ++convertGen;
  converting = true;
  activeTarget = fmt;

  // clear prior result for this fmt only
  if (results.has(fmt)) {
    const prev = results.get(fmt);
    if (prev?.url) { try { URL.revokeObjectURL(prev.url); } catch {} }
    results.delete(fmt);
  }

  setQualityVisible(needsQuality(fmt));
  setRangeVisible(needsRange(fmt));

  if (plan?.group?.children?.includes(fmt)) expandGroup(true);

  $$('.target-node').forEach((n) => {
    const match = n.dataset.format === fmt;
    n.classList.toggle('is-converting', match);
    // Do NOT fade other nodes permanently; only dim during convert for non-done
    if (match) {
      n.classList.remove('is-done', 'is-status', 'is-error', 'is-hover');
    } else {
      n.classList.remove('is-faded');
    }
  });
  // Lines stay: only highlight active, don't fade others away
  $$('.tree-line').forEach((l) => {
    const match = l.dataset.format === fmt;
    l.classList.toggle('is-active', match);
    l.classList.remove('is-faded');
  });
  setProgress(fmt, 0);

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
    } else if (files.every((f) => classify(f) === 'image' || classify(f) === 'audio' || classify(f) === 'video')) {
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
      result = { blob: zblob, filename: 'converted.zip' };
      setProgress(fmt, 100);
    } else {
      throw new Error(MSG_FAIL);
    }
    if (myGen !== convertGen) return;
    storeResult(fmt, result);
    finishConvert(fmt, result);
  } catch (err) {
    if (myGen !== convertGen) return;
    console.error(err);
    converting = false;
    let msg = MSG_FAIL;
    if (err?.code === 'TOO_LARGE' || err?.message === '文件太大') msg = MSG_TOO_LARGE;
    else if (err?.code === 'RANGE_FORMAT' || /页码格式不对/.test(err?.message || '')) msg = err.message;
    else if (err?.code === 'RANGE_MISSING' || /没有第/.test(err?.message || '')) msg = err.message;

    // Stay in tree: mark node as error/retry (except range/size messages shown as drop toast when idle)
    if (err?.code === 'RANGE_FORMAT' || err?.code === 'RANGE_MISSING') {
      showDropMessage(msg);
      const node = $(`.target-node[data-format="${fmt}"]`);
      node?.classList.remove('is-converting');
      $$('.tree-line').forEach((l) => l.classList.remove('is-active'));
      return;
    }

    results.set(fmt, { error: true, message: msg });
    const node = $(`.target-node[data-format="${fmt}"]`);
    if (node) {
      node.classList.remove('is-converting', 'is-done', 'is-status');
      node.classList.add('is-error');
    }
    $$('.tree-line').forEach((l) => l.classList.remove('is-active'));
  }
}

function finishConvert(fmt, result) {
  const node = $(`.target-node[data-format="${fmt}"]`);
  if (!node) return;
  node.classList.remove('is-converting', 'is-error', 'is-faded', 'is-hover');
  // Snap to done colors (no mid-transition pale green)
  node.style.transition = 'none';
  applyResultState(node, fmt);
  requestAnimationFrame(() => { node.style.transition = ''; });
  delete node.dataset.progress;
  const label = $('.progress-label', node);
  if (label) label.textContent = '';
  setProgress(fmt, 100);
  const line = document.querySelector(`.tree-line[data-format="${fmt}"]`);
  if (line) line.classList.add('is-done-active');
  // Keep other lines visible (no fade wipe)
  $$('.tree-line').forEach((l) => {
    l.classList.remove('is-faded');
    if (l.dataset.format !== fmt) l.classList.remove('is-active');
  });
  converting = false;
  // Keep quality visible for lossy so user can tweak & re-convert
  setQualityVisible(needsQuality(fmt));
  setRangeVisible(needsRange(fmt));
}

async function ingestFiles(fileList) {
  const list = [...fileList].filter(Boolean);
  if (!list.length) return;
  const p = await treePlanAsync(list);
  if (!p || (!p.ring.length && !p.group)) {
    if (tree.classList.contains('is-open')) {
      // keep tree; just toast
      showDropMessage(list.length > 1 ? MSG_MULTI : MSG_SINGLE);
      return;
    }
    showDropMessage(list.length > 1 ? MSG_MULTI : MSG_SINGLE);
    return;
  }
  await openTree(list);
}

$('#btn-pick').addEventListener('click', () => openPicker());
fileInput.addEventListener('change', () => {
  ingestFiles(fileInput.files);
  fileInput.value = '';
});
btnChange?.addEventListener('click', openPicker);
btnChangeMobile?.addEventListener('click', openPicker);
centerNode?.addEventListener('click', openPicker);

let dragDepth = 0;
function hasFiles(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || converting) return;
  e.preventDefault();
  dragDepth++;
  drop.classList.add('is-dragover');
  document.body.classList.add('is-file-drag');
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    drop.classList.remove('is-dragover');
    document.body.classList.remove('is-file-drag');
  }
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('is-file-drag');
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('is-dragover');
  document.body.classList.remove('is-file-drag');
  const dropped = [...e.dataTransfer.files];
  if (!dropped.length || converting) return;
  await ingestFiles(dropped);
});

window.addEventListener('resize', () => {
  if (!tree.classList.contains('is-open') || converting) return;
  const was = groupExpanded;
  tree.classList.toggle('mobile-list', isMobile());
  document.body.classList.toggle('tree-open-mobile', isMobile());
  if (btnChangeMobile) btnChangeMobile.hidden = !isMobile();
  renderTargets();
  if (was && !isMobile()) expandGroup(true);
});

window.ConvertTree = {
  showIdle,
  openTree,
  startConvert,
  getTargets: () => targets.slice(),
  getPlan: () => (plan ? JSON.parse(JSON.stringify(plan)) : null),
  getFiles: () => files.slice(),
  isConverting: () => converting,
  getLastResult: () => {
    if (activeTarget && results.has(activeTarget)) return results.get(activeTarget);
    const last = [...results.values()].pop();
    return last || null;
  },
  getResult: (fmt) => results.get(fmt) || null,
  getResults: () => {
    const o = {};
    for (const [k, v] of results) o[k] = { ...v, blob: v.blob, url: v.url };
    return o;
  },
  getActiveTarget: () => activeTarget,
  expandGroup,
  isGroupExpanded: () => groupExpanded,
  clearResults,
  forceFail: (fmt) => {
    results.set(fmt || activeTarget || 'jpg', { error: true });
    const key = fmt || activeTarget || 'jpg';
    const node = $(`.target-node[data-format="${key}"]`);
    if (node) {
      node.classList.remove('is-converting', 'is-done');
      node.classList.add('is-error');
    }
    converting = false;
  },
  openPicker,
};

showIdle();
