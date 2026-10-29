// v0.7: queue persistence across restart + cleanup-on-startup
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('/tmp/pt/node_modules/ws');

const ROOT = '/workspace/watch-loamly';
const DATA = '/tmp/v07-persist-data';
const PORT = 3087;
const EDGE = 'http://127.0.0.1:8788';
const results = [];
const check = (name, ok, extra) => { results.push([name, !!ok]); console.log(ok ? 'PASS' : 'FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
function startServer(env = {}) {
  const log = fs.openSync('/tmp/srv3087.log', 'a');
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      EDGE_BASE: EDGE,
      ROOM_DATA_DIR: DATA,
      ROOM_EMPTY_TTL_MS: env.ROOM_EMPTY_TTL_MS || '900000',
      QUEUE_MAX_AGE_MS: env.QUEUE_MAX_AGE_MS || String(24 * 3600 * 1000),
      ...env
    },
    stdio: ['ignore', log, log]
  });
  return child;
}
async function waitPort(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      await new Promise((res, rej) => {
        const r = http.get(`http://127.0.0.1:${PORT}/api/version`, (resp) => { resp.resume(); res(); });
        r.on('error', rej);
      });
      return true;
    } catch { await sleep(100); }
  }
  return false;
}
function stopServer(child) {
  return new Promise((res) => {
    if (!child || child.killed) return res();
    child.once('exit', () => res());
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
  });
}
function wsClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const inbox = [];
    ws.on('open', () => resolve({
      ws,
      inbox,
      send: (o) => ws.send(JSON.stringify(o)),
      wait: async (pred, ms = 5000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const hit = inbox.find(pred);
          if (hit) return hit;
          await sleep(50);
        }
        return null;
      },
      drain: () => { inbox.length = 0; }
    }));
    ws.on('message', (d) => { try { inbox.push(JSON.parse(d.toString())); } catch {} });
    ws.on('error', reject);
  });
}

(async () => {
  rmrf(DATA);
  fs.mkdirSync(DATA, { recursive: true });
  // clear old log
  fs.writeFileSync('/tmp/srv3087.log', '');

  // ========== A. restart restore ==========
  let child = startServer();
  check('server A started', await waitPort());
  let c = await wsClient();
  c.send({ type: 'create_room', roomCode: 'PERS', peerKey: 'owner-a', webVersion: '0.7.1', hasLocalFile: false });
  let joined = await c.wait((m) => m.type === 'room_joined');
  check('created room PERS', !!joined && joined.roomCode === 'PERS', joined && joined.roomCode);

  c.send({ type: 'queue_add', uploadId: 'film-a', name: '千与千寻.mp4', size: 1000000, duration: 240, edge: true, chunkSize: 4194304 });
  c.send({ type: 'queue_add', uploadId: 'film-b', name: '花样年华.mp4', size: 2000000, duration: 120, edge: true, chunkSize: 4194304 });
  c.send({ type: 'queue_have', ids: ['film-a', 'film-b'] });
  await sleep(300);
  // progress + resume positions via switch
  c.send({ type: 'queue_progress', id: 'film-a', pct: 100, ready: true, streamReady: true, edgeStreamUrl: `${EDGE}/api/edge-film?room=PERS&uploadId=film-a&total=1000000`, edge: true });
  c.send({ type: 'queue_progress', id: 'film-b', pct: 40, streamReady: false, edge: true });
  await sleep(200);
  // set resume by performing a switch (alone → immediate)
  c.send({ type: 'queue_switch_request', id: 'film-b' });
  await sleep(200);
  // fake playback position then switch back to save resume on film-b
  // server stores resumeTime from currentPlaybackTime; seed via play_state if available
  c.send({ type: 'sync_pause', playing: false, currentTime: 42.5, playbackRate: 1, reason: 'user' });
  await sleep(150);
  c.send({ type: 'queue_switch_request', id: 'film-a' });
  await sleep(300);
  let qs = await c.wait((m) => m.type === 'queue_state' && m.items && m.items.length === 2, 3000);
  // read latest queue_state
  qs = [...c.inbox].reverse().find((m) => m.type === 'queue_state');
  const before = {
    now: qs.nowPlayingId,
    items: qs.items.map((i) => ({ id: i.id, name: i.name, pct: i.pct, ready: i.ready, resumeTime: i.resumeTime, ownerKey: i.ownerKey }))
  };
  console.log('before restart', JSON.stringify(before));

  // leave so emptySince is set (but TTL long) — still should restore
  c.ws.close();
  await sleep(400);

  // confirm state file exists
  const stateFile = path.join(DATA, 'rooms', 'PERS.json');
  check('state file written', fs.existsSync(stateFile), stateFile);
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  check('state has 2 films + emptySince', saved.queue.length === 2 && saved.emptySince > 0, { n: saved.queue.length, emptySince: saved.emptySince });

  await stopServer(child);
  await sleep(300);

  child = startServer();
  check('server B started', await waitPort());
  c = await wsClient();
  c.send({ type: 'join_room', roomCode: 'PERS', peerKey: 'owner-a', webVersion: '0.7.1', queueHave: ['film-a', 'film-b'] });
  joined = await c.wait((m) => m.type === 'room_joined');
  qs = await c.wait((m) => m.type === 'queue_state' && m.items && m.items.length >= 1, 5000);
  qs = [...c.inbox].reverse().find((m) => m.type === 'queue_state');
  const after = qs ? {
    now: qs.nowPlayingId,
    items: qs.items.map((i) => ({ id: i.id, name: i.name, pct: i.pct, ready: i.ready, resumeTime: i.resumeTime, ownerKey: i.ownerKey }))
  } : null;
  console.log('after restart', JSON.stringify(after));
  check('queue restored with 2 films', after && after.items.length === 2, after);
  check('film names restored', after && after.items.some((i) => i.name === '千与千寻.mp4') && after.items.some((i) => i.name === '花样年华.mp4'), after);
  check('progress/ready restored', after && after.items.find((i) => i.id === 'film-a').ready === true && after.items.find((i) => i.id === 'film-b').pct >= 40, after);
  const filmB = after && after.items.find((i) => i.id === 'film-b');
  check('resumeTime restored on switched-away film', filmB && filmB.resumeTime >= 40, filmB);
  check('ownerKey restored', after && after.items.every((i) => i.ownerKey === 'owner-a'), after);
  c.ws.close();
  await stopServer(child);
  await sleep(200);

  // ========== B. cleanup-on-startup ==========
  // Seed two rooms on disk: one vacant>TTL, one fresh; plus aged film; plus orphan temp; UPDT protected
  rmrf(DATA);
  fs.mkdirSync(path.join(DATA, 'rooms'), { recursive: true });
  const now = Date.now();
  const staleRoom = {
    code: 'STAL',
    savedAt: now - 3600000,
    emptySince: now - 20 * 60 * 1000, // 20 min vacant
    lastPresenceAt: now - 20 * 60 * 1000,
    nowPlayingId: 'old1',
    queue: [{ id: 'old1', name: 'stale.mp4', size: 1000, type: 'video/mp4', ownerKey: 'x', addedAt: now - 3600000, pct: 100, ready: true, edgeStreamUrl: 'http://x', resumeTime: 10 }]
  };
  const freshRoom = {
    code: 'FRSH',
    savedAt: now,
    emptySince: null,
    lastPresenceAt: now,
    nowPlayingId: 'new1',
    queue: [
      { id: 'new1', name: 'fresh.mp4', size: 1000, type: 'video/mp4', ownerKey: 'y', addedAt: now - 1000, pct: 50, ready: false, resumeTime: 3 },
      { id: 'aged1', name: 'aged.mp4', size: 1000, type: 'video/mp4', ownerKey: 'y', addedAt: now - 25 * 3600 * 1000, pct: 100, ready: true, edgeStreamUrl: 'http://x', resumeTime: 0 }
    ]
  };
  fs.writeFileSync(path.join(DATA, 'rooms', 'STAL.json'), JSON.stringify(staleRoom));
  fs.writeFileSync(path.join(DATA, 'rooms', 'FRSH.json'), JSON.stringify(freshRoom));

  const filmDir = path.join(require('os').tmpdir(), 'loamly-watch-rooms');
  fs.mkdirSync(filmDir, { recursive: true });
  const orphan = path.join(filmDir, 'room-ORPH-orphan123.mp4');
  const updt = path.join(filmDir, 'room-UPDT-keepme.mp4');
  const staleLocal = path.join(filmDir, 'room-STAL-old1.mp4');
  const agedLocal = path.join(filmDir, 'room-FRSH-aged1.mp4');
  const freshLocal = path.join(filmDir, 'room-FRSH-new1.mp4');
  for (const f of [orphan, updt, staleLocal, agedLocal, freshLocal]) fs.writeFileSync(f, 'x'.repeat(64));

  // short timers for cleanup test
  child = startServer({ ROOM_EMPTY_TTL_MS: '1000', QUEUE_MAX_AGE_MS: String(24 * 3600 * 1000) });
  check('server C started', await waitPort());
  await sleep(800);

  check('stale room state deleted', !fs.existsSync(path.join(DATA, 'rooms', 'STAL.json')));
  check('fresh room state kept', fs.existsSync(path.join(DATA, 'rooms', 'FRSH.json')));
  const frsh = JSON.parse(fs.readFileSync(path.join(DATA, 'rooms', 'FRSH.json'), 'utf8'));
  check('aged film removed from fresh room', frsh.queue.length === 1 && frsh.queue[0].id === 'new1', frsh.queue.map((i) => i.id));
  check('stale local film deleted', !fs.existsSync(staleLocal));
  check('aged local film deleted', !fs.existsSync(agedLocal));
  check('fresh local film kept', fs.existsSync(freshLocal));
  check('orphan local film deleted', !fs.existsSync(orphan));
  check('UPDT tarball NEVER touched', fs.existsSync(updt));

  // runtime: join fresh and confirm queue
  c = await wsClient();
  c.send({ type: 'join_room', roomCode: 'FRSH', peerKey: 'y', webVersion: '0.7.1', queueHave: ['new1'] });
  qs = await c.wait((m) => m.type === 'queue_state', 5000);
  qs = [...c.inbox].reverse().find((m) => m.type === 'queue_state');
  check('restored fresh queue has 1 film with resumeTime', qs && qs.items.length === 1 && qs.items[0].resumeTime === 3, qs && qs.items);

  // version endpoint
  const ver = await new Promise((res) => http.get(`http://127.0.0.1:${PORT}/api/version`, (r) => {
    let b = ''; r.on('data', (d) => b += d); r.on('end', () => res(JSON.parse(b)));
  }));
  check('/api/version is 0.7.1', ver.web === '0.7.1' && ver.server === '0.7.1' && /v0\.7\.1 · 10-29/.test(ver.label), ver);

  c.ws.close();
  await stopServer(child);

  // cleanup leftover test files (keep UPDT if any real)
  try { fs.unlinkSync(updt); } catch {}
  try { fs.unlinkSync(freshLocal); } catch {}

  console.log('SUMMARY', results.filter((r) => r[1]).length, '/', results.length, 'passed');
  if (results.some((r) => !r[1])) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
