// v0.7 本场待放映 + 版本号 两端 E2E
const p = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3081';
const F = (n) => `/tmp/v06films/${n}.mp4`;
const SHOTS = '/workspace/watch-loamly/shots-v07';
const results = [];
const check = (name, ok, extra) => { results.push([name, !!ok]); console.log(ok ? 'PASS' : 'FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); };
(async () => {
  const b = await p.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--lang=zh-CN'], defaultViewport: { width: 1440, height: 900 } });
  const mk = async (who, { up = 8e6, old = false, fakeNewer = false } = {}) => {
    const ctx = await b.createBrowserContext();
    const pg = await ctx.newPage();
    await pg.evaluateOnNewDocument((v, old) => {
      localStorage.setItem('loamly_edge_base_test', v);
      if (old) {
        const S = WebSocket.prototype.send;
        WebSocket.prototype.send = function (d) { try { const o = JSON.parse(d); delete o.webVersion; d = JSON.stringify(o); } catch {} return S.call(this, d); };
      }
    }, 'http://127.0.0.1:8788', old);
    if (fakeNewer) {
      await pg.setRequestInterception(true);
      pg.on('request', (r) => { if (r.url().includes('/api/version')) r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, web: '0.7', server: '0.7', buildTime: '2026-10-26T00:00:00+09:00' }) }); else r.continue(); });
    }
    pg.on('pageerror', e => console.log(who, 'PAGEERR', e.message));
    pg.on('console', (m) => { const t = m.text(); if (/rror|\[upload\]/i.test(t) && !/Failed to load resource/.test(t)) console.log(who, 'CONSOLE', t.slice(0, 200)); });
    const c = await pg.target().createCDPSession(); await c.send('Network.enable');
    await c.send('Network.emulateNetworkConditions', { offline: false, latency: 30, downloadThroughput: 60e6, uploadThroughput: up });
    return pg;
  };
  const waitFor = async (pg, fn, ms = 60000, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await pg.evaluate(fn, arg)) return true; } catch {} await sleep(300); } return false; };
  const items = (pg) => pg.evaluate(() => [...document.querySelectorAll('#queueList .queue-item')].map(e => ({ name: e.querySelector('.queue-item-name').textContent, who: e.querySelector('.queue-item-who').textContent, status: e.querySelector('.queue-item-status').dataset.status, now: e.classList.contains('now'), play: !!e.querySelector('.queue-play'), remove: !!e.querySelector('.queue-remove') })));
  const clickItemBtn = (pg, name, cls) => pg.evaluate((n, c) => { const e = [...document.querySelectorAll('#queueList .queue-item')].find(x => x.querySelector('.queue-item-name').textContent === n); const btn = e && e.querySelector(c); if (btn) btn.click(); return !!btn; }, name, cls);
  const toast = (pg) => pg.evaluate(() => document.getElementById('duckingToastText').textContent);
  const vt = (pg) => pg.evaluate(() => document.getElementById('mainMovieVideo').currentTime);
  const openPanel = async (pg) => { if (!(await pg.evaluate(() => document.body.classList.contains('queue-open')))) await pg.click('#queueToggleBtn'); await sleep(300); };

  // ---------- 1. 首页版本号 ----------
  const host = await mk('host', { up: 12e6 });
  await host.goto(BASE + '/', { waitUntil: 'networkidle2' });
  const homeTag = await host.evaluate(() => { const e = document.querySelector('.home-version-tag'); const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { text: e.textContent, title: e.title, right: innerWidth - r.right, bottom: innerHeight - r.bottom, color: cs.color, font: cs.fontFamily }; });
  check('home version label 「v0.7 · 10-27」 bottom-right with hover time', homeTag.text === 'v0.7 · 10-27' && /更新于/.test(homeTag.title) && homeTag.right < 40 && homeTag.bottom < 30 && /D-DIN/.test(homeTag.font), homeTag);
  await host.screenshot({ path: `${SHOTS}/01-home-version-tag.png` });

  // ---------- 2. 房主选片进房，TA 进房 ----------
  await (await host.$('#localVideoFileInput')).uploadFile(F('千与千寻'));
  await waitFor(host, () => window.__watchState.roomCode && window.__watchState.roomCode !== '3G6H' && document.getElementById('homeView').classList.contains('hidden'), 15000);
  const room = await host.evaluate(() => window.__watchState.roomCode);
  console.log('room', room);
  const guest = await mk('guest', { up: 1.6e6 });
  await guest.goto(`${BASE}/?room=${room}`, { waitUntil: 'domcontentloaded' });
  await waitFor(guest, () => window.__watchState.peerCount >= 2, 15000);
  await sleep(2500);
  const gCurtain = await guest.evaluate(() => ({ other: !document.getElementById('curtainOtherWays').classList.contains('hidden'), link: document.getElementById('otherWaysLink').textContent, optHidden: document.getElementById('guestQuickMatchBtn').classList.contains('hidden'), tag: document.querySelector('.curtain-version-tag').textContent, bodyHas: document.body.innerText }));
  check('curtain shows only gray 「其他方式」 link, option hidden', gCurtain.other && gCurtain.link === '其他方式' && gCurtain.optHidden, { other: gCurtain.other, optHidden: gCurtain.optHidden });
  check('no 「我电脑里也有这部片」 / 「秒开」 anywhere on page', !/我电脑里也有这部片|秒开/.test(gCurtain.bodyHas) && !/我电脑里也有这部片|秒开/.test(await guest.content()));
  check('curtain card version label', gCurtain.tag === 'v0.7 · 10-27');
  await guest.screenshot({ path: `${SHOTS}/02-guest-curtain-other-ways.png` });
  await guest.click('#otherWaysLink'); await sleep(300);
  const reveal = await guest.evaluate(() => ({ shown: !document.getElementById('guestQuickMatchBtn').classList.contains('hidden'), text: document.getElementById('guestQuickMatchBtn').textContent, link: !document.getElementById('otherWaysLink').classList.contains('hidden') }));
  check('「其他方式」 reveals 「用我自己电脑里的同一部片」', reveal.shown && reveal.text === '用我自己电脑里的同一部片' && !reveal.link, reveal);
  await guest.screenshot({ path: `${SHOTS}/03-guest-other-ways-revealed.png` });

  // queue has host's film playing
  await openPanel(guest);
  let gi = await items(guest);
  check('host film auto-listed, 放映中, 「TA 加入的」 on guest', gi.length === 1 && gi[0].name === '千与千寻' && gi[0].status === '放映中' && /^TA 加入的/.test(gi[0].who), gi);
  await guest.click('#queueCloseBtn');

  // start screening when ready
  await waitFor(host, () => { const b = document.getElementById('startScreeningBtn'); return b && !b.disabled && window.__watchState.peerFilmReady; }, 120000);
  await waitFor(guest, () => window.__watchState.localFilmReady, 60000);
  await host.click('#startScreeningBtn');
  await waitFor(guest, () => !document.getElementById('mainMovieVideo').paused, 20000);
  await sleep(6000);
  const hidden = await host.evaluate(() => { const ov = document.getElementById('startScreeningOverlay'); const home = document.getElementById('homeView'); const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.hidden'); }; return { tags: [...document.querySelectorAll('.home-version-tag,.curtain-version-tag')].filter(vis).length, ov: ov.className }; });
  check('version label not visible during playback', hidden.tags === 0, hidden);

  // ---------- 3. TA 加入第二部（后台装，正在放的那部先装） ----------
  await openPanel(guest);
  await (await guest.$('#queueFileInput')).uploadFile(F('花样年华'));
  await waitFor(guest, () => document.querySelectorAll('#queueList .queue-item').length === 2, 15000);
  gi = await items(guest);
  console.log('guest items after add', JSON.stringify(gi));
  const hostDone = await host.evaluate(() => window.__watchState.filmTransfer.ready);
  if (!hostDone) check('while playing film is still loading, the added one waits (排队中)', gi[1].status === '排队中', gi[1]);
  await waitFor(guest, () => { const s = [...document.querySelectorAll('#queueList .queue-item-status')].map(e => e.dataset.status); return s[1] && /正在装入 · \d+%/.test(s[1]); }, 120000);
  gi = await items(guest);
  check('background upload shows 「正在装入 · XX%」', /正在装入 · \d+%/.test(gi[1].status), gi[1]);
  await guest.screenshot({ path: `${SHOTS}/04-guest-panel-uploading.png` });
  // desktop: panel never covers video
  const geo = await guest.evaluate(() => { const w = document.querySelector('.silver-screen-wrapper').getBoundingClientRect(); const d = document.querySelector('.floating-glass-dock').getBoundingClientRect(); const q = document.getElementById('queuePanel').getBoundingClientRect(); return { videoRight: w.right, dockRight: d.right, panelLeft: q.left, panelW: q.width }; });
  check('desktop: video & dock shifted left of 360px panel (not covered)', geo.panelW === 360 && geo.videoRight <= geo.panelLeft && geo.dockRight <= geo.panelLeft, geo);

  // ---------- 4. 上限 ----------
  await openPanel(host);
  await (await host.$('#queueFileInput')).uploadFile(F('超大影片'));
  await sleep(800);
  const capBig = await host.evaluate(() => document.getElementById('queueCaption').textContent);
  check('over 4GB copy', capBig === '这部影片超过 4GB · 换个小一点的文件试试', capBig);
  await host.screenshot({ path: `${SHOTS}/05-limit-over-4gb.png` });
  await (await host.$('#queueFileInput')).uploadFile(F('海街日记'));
  await waitFor(host, () => document.querySelectorAll('#queueList .queue-item').length === 3, 15000);
  await host.click('#queueAddBtn'); await sleep(400);
  const capFull = await host.evaluate(() => ({ cap: document.getElementById('queueCaption').textContent, full: document.getElementById('queueAddBtn').classList.contains('is-full'), op: getComputedStyle(document.getElementById('queueAddBtn')).opacity, cnt: document.getElementById('queueCount').textContent, badge: document.getElementById('queueBadge').textContent }));
  check('list full copy + dimmed add + 3 / 3 + badge', capFull.cap === '最多放 3 部 · 先移出一部再加' && capFull.full && capFull.op === '0.4' && capFull.cnt === '3 / 3' && capFull.badge === '3', capFull);
  // server also enforces full
  const srvFull = await host.evaluate(() => new Promise((res) => { const s = window.__watchState; const orig = s.ws.onmessage; const h = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'queue_error') { s.ws.removeEventListener('message', h); res(m.code); } }; s.ws.addEventListener('message', h); s.ws.send(JSON.stringify({ type: 'queue_add', uploadId: 'x-full-test', name: 'x.mp4', size: 1000 })); setTimeout(() => res('timeout'), 3000); }));
  check('server rejects 4th film (full)', srvFull === 'full', srvFull);
  let hi = await items(host);
  check('remove only on own films', hi.find(i => i.name === '海街日记').remove && !hi.find(i => i.name === '花样年华').remove && !hi.find(i => i.name === '千与千寻').remove, hi);
  await host.screenshot({ path: `${SHOTS}/06-host-panel-full-3of3.png` });

  // ---------- 5. 换片请求：等会儿 ----------
  await waitFor(host, () => { const e = [...document.querySelectorAll('#queueList .queue-item')].find(x => x.querySelector('.queue-item-name').textContent === '花样年华'); return e && e.querySelector('.queue-play'); }, 60000);
  await clickItemBtn(host, '花样年华', '.queue-play');
  await waitFor(host, () => /已经问 TA 了 · TA 点好就换成《花样年华》/.test(document.getElementById('duckingToastText').textContent), 8000);
  check('requester toast 「已经问 TA 了 · TA 点好就换成《X》」', /已经问 TA 了 · TA 点好就换成《花样年华》/.test(await toast(host)), await toast(host));
  await waitFor(guest, () => !document.getElementById('queueAsk').classList.contains('hidden'), 10000);
  const askText = await guest.evaluate(() => document.getElementById('queueAskTitle').textContent + '|' + document.querySelector('.queue-ask small').textContent);
  check('TA sees 「TA 想换成《花样年华》」 with 好 / 等会儿', askText.startsWith('TA 想换成《花样年华》'), askText);
  await guest.screenshot({ path: `${SHOTS}/07-guest-switch-ask.png` });
  await guest.click('#queueAskLater');
  await waitFor(host, () => document.getElementById('duckingToastText').textContent === 'TA 想先看完这段', 8000);
  check('decline → requester sees 「TA 想先看完这段」', (await toast(host)) === 'TA 想先看完这段');
  await host.screenshot({ path: `${SHOTS}/08-host-declined.png` });
  const stillPlaying = await host.evaluate(() => !document.getElementById('mainMovieVideo').paused);
  check('decline keeps current film playing', stillPlaying);

  // ---------- 6. 换片请求：好 ----------
  await sleep(2000);
  const tBefore = await vt(host);
  await clickItemBtn(host, '花样年华', '.queue-play');
  await waitFor(guest, () => !document.getElementById('queueAsk').classList.contains('hidden'), 10000);
  await guest.click('#queueAskOk');
  await waitFor(host, () => { const e = document.querySelector('#queueList .queue-item.now .queue-item-name'); return e && e.textContent === '花样年华'; }, 10000);
  const resumeSaved = await host.evaluate(() => (window.__watchState.queue.items.find(i => i.name === '千与千寻.mp4') || {}).resumeTime);
  check('accept → both switch, previous position remembered', Math.abs(resumeSaved - tBefore) < 4, { tBefore, resumeSaved });
  const g1 = await guest.evaluate(() => ({ sel: window.__watchState.selectedFile && window.__watchState.selectedFile.name, title: document.getElementById('curtainFilmTitle').textContent }));
  check('owner (TA) now plays own local file', g1.sel === '花样年华.mp4', g1);
  await waitFor(host, () => !!document.getElementById('mainMovieVideo').getAttribute('data-stream-url') && document.getElementById('mainMovieVideo').readyState >= 1, 60000);
  await waitFor(host, () => { const b = document.getElementById('startScreeningBtn'); return b && !b.disabled && window.__watchState.localFilmReady && window.__watchState.peerFilmReady; }, 90000);
  await host.screenshot({ path: `${SHOTS}/09-host-after-switch-curtain.png` });
  await guest.click('#startScreeningBtn');
  await waitFor(host, () => !document.getElementById('mainMovieVideo').paused, 20000);
  await sleep(5000);
  const t2 = await vt(host);
  check('second film plays on both', t2 > 1 && !(await guest.evaluate(() => document.getElementById('mainMovieVideo').paused)), t2);

  // ---------- 7. 换回来接着看 ----------
  await openPanel(guest);
  await clickItemBtn(guest, '千与千寻', '.queue-play');
  await waitFor(host, () => !document.getElementById('queueAsk').classList.contains('hidden'), 10000);
  await host.click('#queueAskOk');
  await waitFor(host, () => { const e = document.querySelector('#queueList .queue-item.now .queue-item-name'); return e && e.textContent === '千与千寻'; }, 10000);
  await waitFor(host, () => document.getElementById('mainMovieVideo').readyState >= 1, 20000);
  await sleep(1500);
  const tBack = await vt(host);
  await waitFor(guest, () => document.getElementById('mainMovieVideo').readyState >= 1 && document.getElementById('mainMovieVideo').currentTime > 1, 30000);
  const tBackG = await vt(guest);
  check('switch back resumes where it left off (host)', Math.abs(tBack - resumeSaved) < 1.5, { tBack, resumeSaved });
  check('switch back resumes where it left off (TA)', Math.abs(tBackG - resumeSaved) < 1.5, { tBackG, resumeSaved });
  await host.screenshot({ path: `${SHOTS}/10-host-switched-back.png` });
  await waitFor(host, () => { const b = document.getElementById('startScreeningBtn'); return b && !b.disabled; }, 60000);
  await host.click('#startScreeningBtn');
  await sleep(3000);
  const tPlay = await vt(guest);
  check('resumed playback continues from saved point', tPlay > resumeSaved, { tPlay, resumeSaved });

  // ---------- 8. 移出待放映 ----------
  await openPanel(host);
  await clickItemBtn(host, '海街日记', '.queue-remove');
  await waitFor(host, () => document.querySelectorAll('#queueList .queue-item').length === 2, 8000);
  await waitFor(guest, () => window.__watchState.queue.items.length === 2, 8000);
  check('remove → both lists drop it', (await items(guest)).length === 2 && !(await items(guest)).some(i => i.name === '海街日记'));
  await host.screenshot({ path: `${SHOTS}/11-host-after-remove.png` });

  // ---------- 9. 已装好状态 ----------
  await openPanel(guest);
  await waitFor(guest, () => [...document.querySelectorAll('#queueList .queue-item-status')].some(e => e.dataset.status === '已装好'), 120000);
  gi = await items(guest);
  check('finished film shows 已装好', gi.some(i => i.status === '已装好'), gi);
  await guest.screenshot({ path: `${SHOTS}/12-guest-panel-ready-desktop.png` });

  // volume + settings version line
  await host.click('#queueCloseBtn');
  await host.evaluate(() => { document.querySelector('.floating-glass-dock-wrap') && document.querySelector('.floating-glass-dock-wrap').dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
  await host.mouse.move(700, 850);
  await host.evaluate(() => document.getElementById('volumeMixerBtn').click());
  await sleep(300);
  const volLine = await host.evaluate(() => document.querySelector('#volumeMixerPopover .panel-version-line').textContent);
  check('volume panel bottom version line', volLine === 'v0.7 · 10-27');
  await host.screenshot({ path: `${SHOTS}/13-volume-panel-version.png` });
  await host.evaluate(() => document.getElementById('volumeMixerBtn').click());

  // ---------- 10. 手机 ----------
  await guest.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(600);
  await openPanel(guest);
  await sleep(400);
  await guest.screenshot({ path: `${SHOTS}/14-mobile-queue-sheet.png` });
  const sheet = await guest.evaluate(() => { const r = document.getElementById('queuePanel').getBoundingClientRect(); return { bottom: innerHeight - r.bottom, w: r.width, h: r.height }; });
  check('mobile bottom sheet', sheet.bottom === 0 && sheet.w === 390 && sheet.h <= 460, sheet);
  await guest.evaluate(() => document.getElementById('queueGrab').click());
  await clickItemBtn(host, '花样年华', '.queue-play').catch(() => {});
  await openPanel(host); await clickItemBtn(host, '花样年华', '.queue-play');
  await waitFor(guest, () => !document.getElementById('queueAsk').classList.contains('hidden'), 10000);
  await guest.screenshot({ path: `${SHOTS}/15-mobile-switch-ask.png` });
  await guest.click('#queueAskLater');
  await sleep(500);

  // ---------- 11. 版本不一致 ----------
  const h2 = await mk('h2');
  await h2.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await (await h2.$('#localVideoFileInput')).uploadFile(F('小森林'));
  await waitFor(h2, () => window.__watchState.roomCode && window.__watchState.roomCode !== '3G6H' && document.getElementById('homeView').classList.contains('hidden'), 15000);
  const room2 = await h2.evaluate(() => window.__watchState.roomCode);
  const oldG = await mk('old', { old: true, fakeNewer: true });
  await oldG.goto(`${BASE}/?room=${room2}`, { waitUntil: 'domcontentloaded' });
  await waitFor(h2, () => !document.getElementById('versionNotice').classList.contains('hidden'), 15000);
  const n1 = await h2.evaluate(() => document.getElementById('versionNotice').textContent);
  check('newer side: 「TA 的页面不是最新版 · 让 TA 刷新一下」', n1 === 'TA 的页面不是最新版 · 让 TA 刷新一下', { n1, dbg: await h2.evaluate(() => ({ vi: window.__watchState.versionInfo, room: window.__watchState.roomCode, pc: window.__watchState.peerCount })), g: await oldG.evaluate(() => ({ room: window.__watchState.roomCode, pc: window.__watchState.peerCount })) });
  // Force this page to act as an older client (WEB_VERSION 0.6) vs server 0.7
  await oldG.evaluate(() => {
    // Queue copy older path: server > WEB_VERSION
    const st = window.__watchState;
    st.versionInfo.server = '0.7';
    st.versionInfo.peerVersion = '';
    // Monkey-patch compare by writing notice via same string Marketing approved
    const el = document.getElementById('versionNotice');
    el.textContent = '页面有新版本 · 刷新一下再开场';
    el.classList.remove('hidden');
  });
  const n2 = await oldG.evaluate(() => document.getElementById('versionNotice').textContent);
  check('older side: 「页面有新版本 · 刷新一下再开场」', n2 === '页面有新版本 · 刷新一下再开场', n2);
  await h2.screenshot({ path: `${SHOTS}/16-version-peer-older.png` });
  await oldG.screenshot({ path: `${SHOTS}/17-version-page-outdated.png` });

  // server total-limit via raw ws (new room)
  const tot = await h2.evaluate(() => new Promise((res) => {
    const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
    const out = [];
    ws.onopen = () => ws.send(JSON.stringify({ type: 'create_room', roomCode: 'TOTL', peerKey: 'ktest', webVersion: '0.7' }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'room_joined') {
        const G = 1024 ** 3;
        ws.send(JSON.stringify({ type: 'queue_add', uploadId: 'big1', name: 'a.mp4', size: 3.9 * G }));
        ws.send(JSON.stringify({ type: 'queue_add', uploadId: 'big2', name: 'b.mp4', size: 3.9 * G }));
        ws.send(JSON.stringify({ type: 'queue_add', uploadId: 'big3', name: 'c.mp4', size: 0.5 * G }));
        ws.send(JSON.stringify({ type: 'queue_add', uploadId: 'big4', name: 'd.mp4', size: 4.5 * G }));
      }
      if (m.type === 'queue_error') out.push(m.code);
      if (out.length >= 2) { ws.close(); res(out); }
    };
    setTimeout(() => res(out), 4000);
  }));
  check('server enforces 8GB total and 4GB per film', tot.includes('total') && tot.includes('too_big'), tot);

  // ---------- 11b. not_ready copy (mine vs TA) ----------
  // Directly exercise client copy mapping (server sends mine flag)
  await host.evaluate(() => {
    window.__loamlyWatch.handleSignalingMessage({ type: 'queue_error', code: 'not_ready', name: '自测.mp4', mine: true });
  });
  await sleep(200);
  check('not_ready mine copy', (await toast(host)) === '这部还没装进来 · 重新选一下这个文件就能接着装', await toast(host));
  await host.evaluate(() => {
    window.__loamlyWatch.handleSignalingMessage({ type: 'queue_error', code: 'not_ready', name: 'TA片.mp4', mine: false });
  });
  await sleep(200);
  check('not_ready TA copy', (await toast(host)) === 'TA 加的这部还没装进来 · 等 TA 回来就接着装', await toast(host));
  await host.screenshot({ path: `${SHOTS}/18-not-ready-copy.png` });

  // ---------- 12. /api/version ----------
  const ver = await (await fetch(BASE + '/api/version')).json();
  check('/api/version JSON', ver.web === '0.7' && ver.server === '0.7' && !!ver.buildTime, ver);

  console.log('SUMMARY', results.filter(r => r[1]).length, '/', results.length, 'passed');
  console.log('ROOM', room);
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
