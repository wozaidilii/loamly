import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const puppeteer = require('/tmp/pt/node_modules/puppeteer-core');

const BASE = process.env.BASE || 'http://127.0.0.1:3090';
const MOCK = 'http://127.0.0.1:3091';
const SHOTS = '/workspace/loamly-convert/shots';
const SAMPLES = '/workspace/loamly-convert/samples';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => {
  results.push([name, !!ok, extra]);
  console.log(ok ? 'PASS' : 'FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
};

async function waitFor(page, fn, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await page.evaluate(fn)) return true; } catch {}
    await sleep(400);
  }
  return false;
}

async function sideBySide(browser, mockFile, implShotName, label) {
  const mpage = await browser.newPage();
  await mpage.setViewport({ width: 1440, height: 900 });
  await mpage.goto(`${MOCK}/${mockFile}`, { waitUntil: 'networkidle2' });
  const mockPath = path.join(SHOTS, `mock-${implShotName}`);
  await mpage.screenshot({ path: mockPath, fullPage: false });
  await mpage.close();

  const ipage = await browser.newPage();
  await ipage.setViewport({ width: 1440, height: 900 });
  await ipage.goto(BASE + '/', { waitUntil: 'networkidle2' });
  const implPath = path.join(SHOTS, `impl-${implShotName}`);
  await ipage.screenshot({ path: implPath, fullPage: false });
  await ipage.close();

  const out = path.join(SHOTS, `compare-${implShotName}`);
  try {
    const { execSync } = require('child_process');
    execSync(`python3 - <<'PY'\nfrom PIL import Image\nm=Image.open('${mockPath}')\ni=Image.open('${implPath}')\nh=max(m.height,i.height)\ncanvas=Image.new('RGB',(m.width+i.width,h),(255,255,255))\ncanvas.paste(m,(0,0))\ncanvas.paste(i,(m.width,0))\ncanvas.save('${out}')\nprint('ok')\nPY`, { stdio: 'pipe', shell: true });
    check(`compare ${label}`, fs.existsSync(out));
  } catch (e) {
    check(`compare ${label} (separate files)`, fs.existsSync(mockPath) && fs.existsSync(implPath), String(e.message||e).slice(0,120));
  }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  const failedUrls = [];
  page.on('response', (r) => {
    if (r.status() === 404) failedUrls.push(r.url());
  });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (/error|Error|fail/i.test(t) && !/favicon/i.test(t)) console.log('CONSOLE', t.slice(0, 200));
  });

  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  check('document title 文件转换', (await page.title()) === '文件转换', await page.title());
  check('brand 文件转换', (await page.$eval('#brand-name', (el) => el.textContent.trim())) === '文件转换');
  check('no h1', !(await page.evaluate(() => !!document.querySelector('h1'))));
  check('ADS_ENABLED false', !(await page.evaluate(() => document.body.classList.contains('ads-on'))));
  check('ad slot hidden', !(await page.evaluate(() => {
    const el = document.getElementById('ad-slot');
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  })));
  check('shell max-width 760', (await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.shell')).maxWidth))) === 760);
  check('no 广告位 text', !(await page.content()).includes('广告位'));
  const footer = await page.$eval('.footer', (el) => el.textContent);
  check('footer company+ICP', footer.includes('栖于垄上（上海）网络科技有限公司') && footer.includes('沪ICP备2026030604号'), footer.trim());

  const tagline = await page.$eval('#hero-tagline', (el) => el.textContent.trim());
  check('hero tagline 图片/PDF only', tagline === '图片、PDF 格式转换，在浏览器里完成，文件不上传。', tagline);
  check('hero no 音频/视频/MP3', !/音频|视频|MP3|mp3|ffmpeg/i.test(tagline));

  const visibleCopy = await page.evaluate(() => document.body.innerText);
  check('visible copy no audio/video/MP3', !/音频|视频|MP3/.test(visibleCopy), visibleCopy.slice(0, 200));

  await page.screenshot({ path: path.join(SHOTS, '01-empty-desktop.png'), fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(SHOTS, '01-empty-mobile.png'), fullPage: true });
  await page.setViewport({ width: 1440, height: 900 });

  async function convertFile(filePath, targetLabel, timeout = 60000) {
    failedUrls.length = 0;
    const input = await page.$('#file-input');
    await input.uploadFile(filePath);
    await sleep(500);
    const clicked = await page.evaluate((label) => {
      const cards = [...document.querySelectorAll('.file-card')];
      const card = cards[cards.length - 1];
      const btn = card && [...card.querySelectorAll('.chip')].find((b) => b.textContent.trim() === label);
      if (!btn) return false;
      btn.click();
      return true;
    }, targetLabel);
    check(`click ${path.basename(filePath)} → ${targetLabel}`, clicked);
    if (!clicked) return false;
    const done = await waitFor(page, () => {
      const cards = [...document.querySelectorAll('.file-card')];
      const card = cards[cards.length - 1];
      return !!(card && [...card.querySelectorAll('.btn-download')].some((b) => b.textContent.trim() === '下载'));
    }, timeout);
    check(`done ${path.basename(filePath)} → ${targetLabel}`, done);
    if (!done) {
      const st = await page.evaluate(() => {
        const card = [...document.querySelectorAll('.file-card')].pop();
        return card?.querySelector('.file-status')?.textContent || '';
      });
      console.log('  status:', st, '404s:', failedUrls.slice(-5));
    }
    return done;
  }

  async function expectUnsupported(filePath) {
    await (await page.$('#file-input')).uploadFile(filePath);
    await sleep(400);
    const st = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.file-card')].pop();
      return {
        err: card?.querySelector('.status-error')?.textContent || '',
        chips: [...(card?.querySelectorAll('.chip') || [])].map((b) => b.textContent.trim()),
      };
    });
    check(`${path.basename(filePath)} unsupported`, st.err.includes('这个文件暂时转不了') && st.chips.length === 0, st);
  }

  const input0 = await page.$('#file-input');
  await input0.uploadFile(path.join(SAMPLES, 'sample.png'));
  await sleep(400);
  check('compact dropzone', await page.evaluate(() => document.getElementById('drop').classList.contains('is-compact')));
  check('toolbar 清空', await page.evaluate(() => !!document.getElementById('clear-btn')));
  await page.screenshot({ path: path.join(SHOTS, '02-file-added-desktop.png'), fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  const clearH = await page.evaluate(() => document.getElementById('clear-btn').getBoundingClientRect().height);
  check('mobile 清空 >=44px', clearH >= 43, clearH);
  await page.screenshot({ path: path.join(SHOTS, '02-file-added-mobile.png'), fullPage: true });
  await page.setViewport({ width: 1440, height: 900 });

  const hasCard = await page.evaluate(() => !!document.querySelector('.file-card'));
  if (!hasCard) {
    await (await page.$('#file-input')).uploadFile(path.join(SAMPLES, 'sample.png'));
    await sleep(400);
  }
  {
    const clicked = await page.evaluate(() => {
      const card = document.querySelector('.file-card');
      if (!card) return false;
      const btn = [...card.querySelectorAll('.chip')].find((b) => b.textContent.trim() === 'JPG');
      btn?.click();
      return !!btn;
    });
    check('click sample.png → JPG', clicked);
    const done = await waitFor(page, () => {
      const card = document.querySelector('.file-card');
      return !!(card && [...card.querySelectorAll('.btn-download')].some((b) => b.textContent.trim() === '下载'));
    }, 60000);
    check('done sample.png → JPG', done);
  }

  await convertFile(path.join(SAMPLES, 'sample.jpg'), 'PDF');
  await convertFile(path.join(SAMPLES, 'sample.pdf'), 'PNG');

  await page.screenshot({ path: path.join(SHOTS, '03-converting-desktop.png'), fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(SHOTS, '03-converting-mobile.png'), fullPage: true });
  await page.setViewport({ width: 1440, height: 900 });

  // audio/video must be unsupported (no ffmpeg in v0.1)
  await page.click('#clear-btn');
  await sleep(200);
  await expectUnsupported(path.join(SAMPLES, 'sample.wav'));
  await expectUnsupported(path.join(SAMPLES, 'sample.mp4'));

  await page.click('#clear-btn');
  await sleep(200);
  const bogus = path.join(SAMPLES, 'bogus.xyz');
  fs.writeFileSync(bogus, 'x');
  await expectUnsupported(bogus);

  await page.goto(BASE + '/about.html', { waitUntil: 'networkidle2' });
  const about = await page.content();
  check('about Filee MIT', about.includes('基于开源项目') && about.includes('Filee') && about.includes('MIT'));
  check('about no ffmpeg', !/ffmpeg/i.test(about));
  check('about heic2any source+license',
    about.includes('heic2any') &&
    about.includes('LGPL-3.0') &&
    about.includes('github.com/alexcorvi/heic2any') &&
    about.includes('notices/heic2any-LICENSE'));
  check('about no 演示/LICENSE-AUDIT', !/演示|LICENSE-AUDIT/.test(about));
  await page.screenshot({ path: path.join(SHOTS, 'about-desktop.png'), fullPage: true });

  await sideBySide(browser, '01-empty.html', 'empty-desktop.png', 'empty');

  const critical404 = failedUrls.filter((u) => /pdf\.worker|app\.js|app\.css|heic2any/.test(u));
  check('no critical 404', critical404.length === 0, critical404);

  await browser.close();
  const failed = results.filter((r) => !r[1]);
  console.log('\n=== SUMMARY ===', results.length - failed.length, '/', results.length);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f[0]).join(' | '));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
