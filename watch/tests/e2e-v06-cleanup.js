const p = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3081';
(async () => {
  const b = await p.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
  const mk = async () => { const c = await b.createBrowserContext(); const pg = await c.newPage(); await pg.evaluateOnNewDocument(() => localStorage.setItem('loamly_edge_base_test', 'http://127.0.0.1:8788')); return pg; };
  const waitFor = async (pg, fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await pg.evaluate(fn)) return true; } catch {} await sleep(300); } return false; };
  const h = await mk(); await h.goto(BASE + '/');
  await (await h.$('#localVideoFileInput')).uploadFile('/tmp/v06films/小森林.mp4');
  await waitFor(h, () => !!window.__watchState.roomCode);
  const room = await h.evaluate(() => window.__watchState.roomCode);
  const g = await mk(); await g.goto(`${BASE}/?room=${room}`);
  await waitFor(g, () => window.__watchState.peerCount >= 2);
  await (await g.$('#queueFileInput')).uploadFile('/tmp/v06films/海街日记.mp4');
  await waitFor(g, () => window.__watchState.queue.items.length === 2 && window.__watchState.queue.items.every(i => i.ready), 90000);
  const ids = await g.evaluate(() => window.__watchState.queue.items.map(i => i.id));
  // 只走一个人：不清
  await g.close(); await sleep(9000);
  const v1 = await h.evaluate(() => window.__watchState.queue.items.length);
  console.log('one left, items still', v1);
  await h.close();
  const t0 = Date.now();
  console.log(JSON.stringify({ room, ids, closedAt: t0 }));
  await sleep(36000);
  await b.close();
})();
