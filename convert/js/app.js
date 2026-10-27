import {
  convertImage, pdfToImages, imagesToPdf,
  classify, targetsFor, downloadBlob,
} from './converters.js';

const cfg = window.LOAMLY_CONVERT || {
  name: '文件转换',
  title: '文件转换',
  tagline: '图片、PDF 格式转换，在浏览器里完成，文件不上传。',
  tags: [],
  ADS_ENABLED: false,
};

document.title = cfg.title || cfg.name || '文件转换';
const brand = document.getElementById('brand-name');
const taglineEl = document.getElementById('hero-tagline');
const tagsEl = document.getElementById('hero-tags');
if (brand) brand.textContent = cfg.name;
if (taglineEl) taglineEl.textContent = cfg.tagline;
if (tagsEl && cfg.tags?.length) {
  tagsEl.innerHTML = cfg.tags.map((t) => `<span class="tag">${t}</span>`).join('');
}
if (cfg.ADS_ENABLED) document.body.classList.add('ads-on');

const drop = document.getElementById('drop');
const fileInput = document.getElementById('file-input');
const pickBtn = document.getElementById('pick-btn');
const listEl = document.getElementById('file-list');
const panel = document.getElementById('file-panel');
const clearBtn = document.getElementById('clear-btn');
const dlAll = document.getElementById('dl-all');
const qualityRow = document.getElementById('quality-row');
const qualityInput = document.getElementById('quality');
const qualityVal = document.getElementById('quality-val');

/** @type {Array<{id:string,file:File,kind:string,targets:string[],status:string,pct:number,target?:string,result?:{blob:Blob,filename:string},error?:string,thumbUrl?:string}>} */
const items = [];
let seq = 0;

qualityInput?.addEventListener('input', () => {
  qualityVal.textContent = String(qualityInput.value);
});

pickBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
drop.addEventListener('click', (e) => {
  if (e.target === pickBtn || pickBtn.contains(e.target)) return;
  fileInput.click();
});
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((ev) => {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-dragover'); });
});
['dragleave', 'drop'].forEach((ev) => {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-dragover'); });
});
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

clearBtn.addEventListener('click', () => {
  for (const it of items) {
    if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
  }
  items.length = 0;
  render();
});

dlAll.addEventListener('click', async () => {
  const ready = items.filter((i) => i.result);
  if (ready.length === 1) {
    downloadBlob(ready[0].result.blob, ready[0].result.filename);
    return;
  }
  const zip = new JSZip();
  for (const i of ready) zip.file(i.result.filename, i.result.blob);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, 'converted.zip');
});

function extOf(name) {
  const m = name.match(/\.([^.]+)$/);
  return (m ? m[1] : '?').toUpperCase().slice(0, 4);
}

function formatSize(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function addFiles(fileList) {
  if (!fileList?.length) return;
  for (const file of fileList) {
    const kind = classify(file);
    const targets = targetsFor(kind);
    const item = {
      id: `f${++seq}`,
      file,
      kind,
      targets,
      status: targets.length ? 'ready' : 'unsupported',
      pct: 0,
    };
    if (kind === 'image' && !/\.heic$/i.test(file.name)) {
      try { item.thumbUrl = URL.createObjectURL(file); } catch (_) {}
    }
    items.push(item);
  }
  render();
}

function render() {
  const has = items.length > 0;
  drop.classList.toggle('is-compact', has);
  panel.hidden = !has;
  const doneCount = items.filter((i) => i.result).length;
  dlAll.hidden = doneCount < 1;
  const hasImageLike = items.some((i) => i.kind === 'image' || i.kind === 'pdf');
  qualityRow.hidden = !hasImageLike;

  listEl.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'file-card';
    card.dataset.id = item.id;

    const nameLabel = item.target
      ? `${item.file.name} → ${item.target.toUpperCase()}`
      : item.file.name;

    const thumbInner = item.thumbUrl
      ? `<img src="${item.thumbUrl}" alt="" />`
      : `<span class="ext">${escapeHtml(extOf(item.file.name))}</span>`;

    let statusHtml = '';
    if (item.status === 'unsupported' || item.status === 'error') {
      statusHtml = `<span class="status-error">${escapeHtml(item.error || '这个文件暂时转不了')}</span>`;
    } else if (item.status === 'converting' || item.status === 'loading') {
      statusHtml = `<span class="status-progress">转换中 · ${item.pct}%</span>`;
    } else if (item.status === 'done' && item.result) {
      statusHtml = `<button class="btn btn-download" type="button" data-act="dl">下载</button>`;
    }

    let convertHtml = '';
    if (item.status === 'ready' || (item.status === 'done') || item.status === 'error') {
      if (item.status !== 'done' || !item.result) {
        const chips = item.targets.map((t) => {
          const sel = item.target === t ? ' is-selected' : '';
          return `<button class="chip${sel}" type="button" data-target="${t}">${t.toUpperCase()}</button>`;
        }).join('');
        convertHtml = `<div class="convert-row"><span class="convert-label">转成</span><div class="chips">${chips}</div></div>`;
      }
    }

    let progressHtml = '';
    if (item.status === 'converting' || item.status === 'loading') {
      progressHtml = `<div class="progress-track"><div class="progress-fill" style="width:${item.pct}%"></div></div>`;
    }

    card.innerHTML = `
      <div class="file-row">
        <div class="file-thumb" aria-hidden="true">${thumbInner}</div>
        <div class="file-meta">
          <div class="file-name">${escapeHtml(nameLabel)}</div>
          <div class="file-size">${formatSize(item.file.size)}</div>
        </div>
        <div class="file-status">${statusHtml}</div>
      </div>
      ${convertHtml}
      ${progressHtml}
    `;

    card.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => startConvert(item, btn.dataset.target));
    });
    const dl = card.querySelector('[data-act="dl"]');
    if (dl) {
      dl.addEventListener('click', () => downloadBlob(item.result.blob, item.result.filename));
    }
    listEl.appendChild(card);
  }
}

async function startConvert(item, target) {
  item.target = target;
  item.status = 'loading';
  item.pct = 0;
  item.error = undefined;
  item.result = undefined;
  render();
  const q = Number(qualityInput?.value || 90) / 100;
  const bump = (pct) => {
    item.pct = Math.max(0, Math.min(100, Math.round(pct)));
    item.status = 'converting';
    const card = listEl.querySelector(`[data-id="${item.id}"]`);
    if (!card) return;
    const st = card.querySelector('.status-progress');
    if (st) st.textContent = `转换中 · ${item.pct}%`;
    let fill = card.querySelector('.progress-fill');
    if (!fill) {
      const track = document.createElement('div');
      track.className = 'progress-track';
      track.innerHTML = `<div class="progress-fill" style="width:${item.pct}%"></div>`;
      card.appendChild(track);
      fill = track.querySelector('.progress-fill');
      const cr = card.querySelector('.convert-row');
      if (cr) cr.remove();
      const status = card.querySelector('.file-status');
      if (status) status.innerHTML = `<span class="status-progress">转换中 · ${item.pct}%</span>`;
    } else {
      fill.style.width = `${item.pct}%`;
    }
  };
  try {
    let result;
    if (item.kind === 'image' && target === 'pdf') {
      result = await imagesToPdf([item.file], bump);
    } else if (item.kind === 'image') {
      result = await convertImage(item.file, target, q, bump);
    } else if (item.kind === 'pdf') {
      result = await pdfToImages(item.file, target, q, bump);
    } else {
      throw new Error('这个文件暂时转不了');
    }
    item.result = result;
    item.status = 'done';
    item.pct = 100;
  } catch (err) {
    console.error(err);
    item.status = 'error';
    item.error = '这个文件暂时转不了';
  }
  render();
}

render();
