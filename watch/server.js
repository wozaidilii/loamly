#!/usr/bin/env node
/**
 * Loamly 双人同屏室 · 异地连麦同步播放器 (watch.loamly.cn)
 * 零外部依赖原生 Node.js HTTP 静态托管 + 房间片源流式中继 (支持上传中实时 HTTP Range 206 流式读取) + RFC6455 WebSocket 房间信令服务
 * 默认监听 127.0.0.1:3080，由 Nginx 反向代理 /、/api/room-film 与 /ws
 */

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '3080', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_FILM_DIR = path.join(os.tmpdir(), 'loamly-watch-rooms');
const ROOM_DATA_DIR = process.env.ROOM_DATA_DIR || path.join(__dirname, 'data');
const ROOM_STATE_DIR = path.join(ROOM_DATA_DIR, 'rooms');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

try { fs.mkdirSync(ROOM_FILM_DIR, { recursive: true }); } catch (e) { console.error('[Loamly Watch] mkdir ROOM_FILM_DIR failed', e.message); }
try { fs.mkdirSync(ROOM_STATE_DIR, { recursive: true }); } catch (e) { console.error('[Loamly Watch] mkdir ROOM_STATE_DIR failed', e.message); }

// ===== 版本号（每次更新 +0.1）=====
const APP_VERSION = '0.7';
const APP_RELEASE = '10-27';
const APP_BUILD_TIME = '2026-10-27T04:26:43.000Z';

// ===== 本场待放映 =====
const EDGE_BASE = process.env.EDGE_BASE || 'https://edge-watch.loamly.net';
const QUEUE_MAX_ITEMS = 3;
const QUEUE_MAX_FILM_BYTES = 4 * 1024 * 1024 * 1024;
const QUEUE_MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
const QUEUE_MAX_AGE_MS = parseInt(process.env.QUEUE_MAX_AGE_MS || String(24 * 60 * 60 * 1000), 10);
const ROOM_EMPTY_TTL_MS = parseInt(process.env.ROOM_EMPTY_TTL_MS || String(15 * 60 * 1000), 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8'
};

// 房间状态表: roomCode -> { code, createdAt, fileMeta, filmUpload, playback, peers: Map<clientId, Client> }
process.on("uncaughtException", (err) => console.error("[Loamly Watch UncaughtException]", err));
process.on("unhandledRejection", (err) => console.error("[Loamly Watch UnhandledRejection]", err));

const rooms = new Map();
const SERVER_STARTED_AT = new Date().toISOString();

function generateRoomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function normalizeRoomCode(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
}

function cleanupRoomFilmFile(room) {
  if (!room || !room.filmUpload) return;
  const old = room.filmUpload;
  room.filmUpload = null;
  if (old.fd !== undefined && old.fd !== null) {
    try { fs.closeSync(old.fd); } catch {}
    old.fd = null;
  }
  if (old.transcodeProc) {
    try { old.transcodeProc.kill("SIGKILL"); } catch {}
    old.transcodeProc = null;
  }
  if (old.filePath) {
    fs.unlink(old.filePath, () => {});
  }
  if (old.transcodedPath) {
    fs.unlink(old.transcodedPath, () => {});
  }
}

function recoverRoomFilmFromDisk(code, fileMeta = null) {
  try {
    const prefix = `room-${code}-`;
    const preferId = fileMeta && fileMeta.uploadId ? String(fileMeta.uploadId).replace(/[^a-zA-Z0-9_-]/g, '') : '';
    let files = fs.readdirSync(ROOM_FILM_DIR)
      .filter((f) => f.startsWith(prefix))
      .map((f) => {
        const fp = path.join(ROOM_FILM_DIR, f);
        const st = fs.statSync(fp);
        return { name: f, filePath: fp, size: st.size, mtimeMs: st.mtimeMs };
      })
      .filter((f) => f.size > 0)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (preferId) {
      const exact = files.filter((f) => f.name.startsWith(`${prefix}${preferId}.`) || f.name === `${prefix}${preferId}`);
      if (exact.length) files = exact;
    }
    if (files.length === 0) return null;
    const latest = files[0];
    const m = latest.name.match(/^room-[A-Z0-9]+-(.+)\.[a-z0-9]+$/i);
    const uploadId = m ? m[1] : `recovered-${Date.now()}`;
    const ext = path.extname(latest.name).toLowerCase() || ".mp4";
    return {
      uploadId,
      name: (fileMeta && fileMeta.name) || latest.name,
      size: latest.size,
      mimeType: (fileMeta && fileMeta.type) || MIME_TYPES[ext] || "video/mp4",
      filePath: latest.filePath,
      streamUrl: `/api/room-film?room=${code}&v=${uploadId}`,
      receivedBytes: latest.size,
      speedBps: 0,
      startedAt: Date.now(),
      lastBroadcastAt: Date.now(),
      ready: true
    };
  } catch {
    return null;
  }
}

function createEmptyRoom(code, fileMeta = null) {
  const recovered = recoverRoomFilmFromDisk(code, fileMeta);
  let cleanMeta = fileMeta || null;
  if (recovered) {
    cleanMeta = {
      name: (fileMeta && fileMeta.name) || recovered.name,
      size: recovered.size,
      type: recovered.mimeType,
      isDemo: false,
      uploadId: recovered.uploadId,
      streamUrl: recovered.streamUrl
    };
  } else if (cleanMeta && !cleanMeta.isDemo && cleanMeta.streamUrl) {
    cleanMeta = null;
  }
  return {
    code,
    createdAt: Date.now(),
    fileMeta: cleanMeta,
    filmUpload: recovered,
    playback: {
      playing: false,
      currentTime: 0,
      playbackRate: 1,
      updatedAt: Date.now()
    },
    peers: new Map(),
    queue: [],
    nowPlayingId: null,
    pendingSwitch: null,
    emptySince: null,
    lastPresenceAt: Date.now()
  };
}

// ---------- 本场待放映：服务端状态 ----------
function roomStatePath(code) {
  return path.join(ROOM_STATE_DIR, `${normalizeRoomCode(code) || 'XXXX'}.json`);
}

function serializeRoomPersist(room) {
  return {
    code: room.code,
    savedAt: Date.now(),
    emptySince: room.emptySince || null,
    lastPresenceAt: room.lastPresenceAt || room.createdAt || Date.now(),
    nowPlayingId: room.nowPlayingId || null,
    queue: (Array.isArray(room.queue) ? room.queue : []).map((it) => ({
      id: it.id,
      name: it.name,
      size: it.size,
      type: it.type || 'video/mp4',
      duration: it.duration || 0,
      ownerKey: it.ownerKey || '',
      addedAt: it.addedAt || Date.now(),
      pct: it.pct || 0,
      contiguousBytes: it.contiguousBytes || 0,
      startBytes: it.startBytes || 0,
      streamReady: Boolean(it.streamReady),
      ready: Boolean(it.ready),
      edge: typeof it.edge === 'boolean' ? it.edge : null,
      chunkSize: it.chunkSize || 0,
      edgeStreamUrl: it.edgeStreamUrl || null,
      resumeTime: Number(it.resumeTime) || 0
    }))
  };
}

function persistRoomState(room) {
  if (!room || !room.code) return;
  // UPDT 只是热更新通道，不写队列快照
  if (normalizeRoomCode(room.code) === 'UPDT') return;
  try {
    const data = JSON.stringify(serializeRoomPersist(room));
    const target = roomStatePath(room.code);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  } catch (e) {
    console.error('[Loamly Watch] persist room failed', room.code, e && e.message);
  }
}

function deletePersistedRoom(code) {
  try { fs.unlinkSync(roomStatePath(code)); } catch {}
}

function loadPersistedRooms() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(ROOM_STATE_DIR).filter((f) => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOM_STATE_DIR, f), 'utf8'));
      if (j && j.code) out.push(j);
    } catch (e) {
      console.error('[Loamly Watch] load room state failed', f, e && e.message);
    }
  }
  return out;
}

function deleteLocalFilmFiles(roomCode, uploadId) {
  if (!roomCode || !uploadId) return;
  if (normalizeRoomCode(roomCode) === 'UPDT') return;
  try {
    const prefix = `room-${normalizeRoomCode(roomCode)}-${uploadId}`;
    for (const f of fs.readdirSync(ROOM_FILM_DIR)) {
      if (f.startsWith(prefix)) {
        try { fs.unlinkSync(path.join(ROOM_FILM_DIR, f)); } catch {}
      }
    }
  } catch {}
}

function hydrateQueueItem(it) {
  return {
    id: cleanId(it.id),
    name: String(it.name || 'movie.mp4').slice(0, 200),
    size: Number(it.size) || 0,
    type: String(it.type || 'video/mp4').slice(0, 60),
    duration: Number(it.duration) || 0,
    ownerKey: String(it.ownerKey || '').slice(0, 64),
    addedAt: Number(it.addedAt) || Date.now(),
    pct: Number(it.pct) || 0,
    contiguousBytes: Number(it.contiguousBytes) || 0,
    startBytes: Number(it.startBytes) || 0,
    streamReady: Boolean(it.streamReady),
    ready: Boolean(it.ready),
    edge: typeof it.edge === 'boolean' ? it.edge : null,
    chunkSize: Number(it.chunkSize) || 0,
    edgeStreamUrl: typeof it.edgeStreamUrl === 'string' ? it.edgeStreamUrl.slice(0, 600) : null,
    resumeTime: Number(it.resumeTime) || 0
  };
}

function restoreAndCleanupPersistedRooms() {
  const now = Date.now();
  const keepKeys = new Set(); // "CODE:uploadId"
  const persisted = loadPersistedRooms();
  for (const saved of persisted) {
    const code = normalizeRoomCode(saved.code);
    if (!code || code === 'UPDT') { deletePersistedRoom(saved.code); continue; }
    let queue = Array.isArray(saved.queue) ? saved.queue.map(hydrateQueueItem).filter((it) => it.id && it.size > 0) : [];
    const emptySince = saved.emptySince ? Number(saved.emptySince) : null;
    const lastPresenceAt = Number(saved.lastPresenceAt) || Number(saved.savedAt) || now;

    // 超过 24 小时的影片：删 R2 + ECS 临时文件
    const kept = [];
    for (const it of queue) {
      if (now - (it.addedAt || 0) > QUEUE_MAX_AGE_MS) {
        console.log(`[Loamly Watch] startup: drop aged film ${code}/${it.id}`);
        deleteEdgeFilm(code, it.id);
        deleteLocalFilmFiles(code, it.id);
      } else {
        kept.push(it);
      }
    }
    queue = kept;

    // 房间空置超过 15 分钟：整房清除
    if (emptySince && (now - emptySince) > ROOM_EMPTY_TTL_MS) {
      console.log(`[Loamly Watch] startup: purge vacant room ${code}`);
      for (const it of queue) {
        deleteEdgeFilm(code, it.id);
        deleteLocalFilmFiles(code, it.id);
      }
      deletePersistedRoom(code);
      continue;
    }

    const room = createEmptyRoom(code, null);
    // createEmptyRoom 可能从磁盘捞到别的片子；以快照为准
    room.filmUpload = null;
    room.fileMeta = null;
    room.queue = queue;
    room.emptySince = emptySince;
    room.lastPresenceAt = lastPresenceAt;
    room.nowPlayingId = (saved.nowPlayingId && queue.some((it) => it.id === saved.nowPlayingId))
      ? saved.nowPlayingId
      : (queue[0] ? queue[0].id : null);

    if (room.nowPlayingId) {
      const item = getQueueItem(room, room.nowPlayingId);
      if (item) {
        const recovered = recoverRoomFilmFromDisk(code, { name: item.name, size: item.size, type: item.type, uploadId: item.id });
        if (recovered && recovered.uploadId === item.id) {
          room.filmUpload = recovered;
          room.fileMeta = { name: item.name, size: item.size, type: item.type || 'video/mp4', isDemo: false, uploadId: item.id, streamUrl: recovered.streamUrl };
        }
        if (!room.filmUpload && item.edgeStreamUrl) {
          room.fileMeta = { name: item.name, size: item.size, type: item.type || 'video/mp4', isDemo: false, uploadId: item.id, streamUrl: item.edgeStreamUrl };
          room.filmUpload = {
            uploadId: item.id,
            name: item.name,
            size: item.size,
            mimeType: item.type || 'video/mp4',
            filePath: null,
            streamUrl: item.edgeStreamUrl,
            edgeStreamUrl: item.edgeStreamUrl,
            receivedBytes: item.ready ? item.size : Math.round(((item.pct || 0) / 100) * item.size),
            contiguousBytes: item.ready ? item.size : (item.contiguousBytes || 0),
            pct: item.ready ? 100 : (item.pct || 0),
            speedBps: 0,
            startedAt: Date.now(),
            preloadReady: Boolean(item.streamReady || item.ready),
            streamReady: Boolean(item.streamReady || item.ready),
            ready: Boolean(item.ready),
            duration: item.duration || 0,
            startBytes: item.startBytes || 0
          };
        }
        room.playback.currentTime = item.resumeTime || 0;
      }
    }

    rooms.set(code, room);
    persistRoomState(room);
    for (const it of room.queue) keepKeys.add(`${code}:${it.id}`);
  }

  // UPDT 热更新包：启动后从磁盘恢复，保证 curl | tar 安装命令在重启后仍可用
  if (!rooms.has('UPDT')) {
    const recovered = recoverRoomFilmFromDisk('UPDT', { name: 'watch-code-update.tar.gz', type: 'application/gzip' });
    if (recovered) {
      const room = createEmptyRoom('UPDT', null);
      room.filmUpload = recovered;
      room.fileMeta = {
        name: 'watch-code-update.tar.gz',
        size: recovered.size,
        type: 'application/gzip',
        isDemo: false,
        uploadId: recovered.uploadId,
        streamUrl: recovered.streamUrl
      };
      rooms.set('UPDT', room);
      console.log(`[Loamly Watch] startup: restored UPDT tarball ${recovered.uploadId} (${recovered.size} bytes)`);
    }
  }

  // 孤儿 ECS 临时文件：不在任何快照里的都删，但永远不动 UPDT
  try {
    for (const f of fs.readdirSync(ROOM_FILM_DIR)) {
      const m = /^room-([A-Z0-9]+)-([a-zA-Z0-9_-]+)/i.exec(f);
      if (!m) continue;
      const code = m[1].toUpperCase();
      const uploadId = m[2];
      if (code === 'UPDT') continue;
      if (keepKeys.has(`${code}:${uploadId}`)) continue;
      try {
        fs.unlinkSync(path.join(ROOM_FILM_DIR, f));
        console.log(`[Loamly Watch] startup: remove orphan temp ${f}`);
      } catch {}
    }
  } catch {}
}

function cleanId(v) {
  return typeof v === 'string' ? v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : '';
}

function getQueueItem(room, id) {
  if (!room || !Array.isArray(room.queue) || !id) return null;
  return room.queue.find((it) => it.id === id) || null;
}

function ownerOnlineWithFile(room, item) {
  if (!room || !item) return false;
  for (const peer of room.peers.values()) {
    if (peer.peerKey && peer.peerKey === item.ownerKey && peer.queueHave && peer.queueHave.has(item.id)) return true;
  }
  return false;
}

// 一次只装一部：正在放的那部没装完就先装它；装完了再按列表顺序装下一部
function computeUploadTurn(room) {
  if (!room || !Array.isArray(room.queue)) return null;
  const np = getQueueItem(room, room.nowPlayingId);
  if (np && !np.ready) return np.id;
  for (const it of room.queue) {
    if (it.id === room.nowPlayingId) continue;
    if (!it.ready && ownerOnlineWithFile(room, it)) return it.id;
  }
  return null;
}

function canSwitchTo(room, item) {
  if (!item || item.id === room.nowPlayingId) return false;
  return Boolean(((item.ready || item.streamReady) && item.edgeStreamUrl) || ownerOnlineWithFile(room, item));
}

function serializeQueue(room) {
  const items = (room && Array.isArray(room.queue)) ? room.queue : [];
  const total = items.reduce((a, it) => a + (Number(it.size) || 0), 0);
  return {
    type: 'queue_state',
    nowPlayingId: room ? room.nowPlayingId : null,
    uploadTurn: computeUploadTurn(room),
    totalBytes: total,
    limits: { maxItems: QUEUE_MAX_ITEMS, maxFilmBytes: QUEUE_MAX_FILM_BYTES, maxTotalBytes: QUEUE_MAX_TOTAL_BYTES },
    pendingSwitch: room && room.pendingSwitch ? { id: room.pendingSwitch.id, fromId: room.pendingSwitch.fromId } : null,
    items: items.map((it) => ({
      id: it.id,
      name: it.name,
      size: it.size,
      type: it.type,
      duration: it.duration || 0,
      ownerKey: it.ownerKey,
      addedAt: it.addedAt,
      pct: it.ready ? 100 : (it.pct || 0),
      contiguousBytes: it.contiguousBytes || 0,
      startBytes: it.startBytes || 0,
      streamReady: Boolean(it.streamReady || it.ready),
      ready: Boolean(it.ready),
      edge: typeof it.edge === 'boolean' ? it.edge : null,
      chunkSize: it.chunkSize || 0,
      resumeTime: it.resumeTime || 0,
      ownerHere: ownerOnlineWithFile(room, it),
      canSwitch: canSwitchTo(room, it)
    }))
  };
}

function broadcastQueueState(room) {
  if (!room) return;
  if (room.queueTimer) { clearTimeout(room.queueTimer); room.queueTimer = null; }
  room.queueLastSentAt = Date.now();
  const payload = serializeQueue(room);
  for (const peer of room.peers.values()) sendWsJson(peer, payload);
  persistRoomState(room);
}

// 进度类更新：最多每 400ms 广播一次
function touchQueue(room) {
  if (!room) return;
  const since = Date.now() - (room.queueLastSentAt || 0);
  if (since >= 400) { broadcastQueueState(room); return; }
  if (!room.queueTimer) {
    room.queueTimer = setTimeout(() => { room.queueTimer = null; broadcastQueueState(room); }, 400 - since);
    if (room.queueTimer.unref) room.queueTimer.unref();
  }
}

function broadcastVersions(room) {
  if (!room) return;
  const versions = {};
  for (const [id, peer] of room.peers.entries()) versions[id] = peer.webVersion || '0.5';
  for (const peer of room.peers.values()) {
    sendWsJson(peer, { type: 'peer_versions', versions, web: APP_VERSION, server: APP_VERSION });
  }
}

// 更新队列里某部影片的装入进度（只增不减）
function applyQueueProgress(item, p) {
  if (!item || !p) return false;
  const before = `${item.pct}|${item.streamReady}|${item.ready}`;
  const pct = Number(p.pct) || 0;
  if (pct > (item.pct || 0)) item.pct = Math.min(100, pct);
  const contig = Number(p.contiguousBytes) || 0;
  if (contig > (item.contiguousBytes || 0)) item.contiguousBytes = contig;
  if (Number(p.startBytes) > 0) item.startBytes = Number(p.startBytes);
  if (Number(p.duration) > 0) item.duration = Number(p.duration);
  if (p.edgeStreamUrl && typeof p.edgeStreamUrl === 'string') item.edgeStreamUrl = p.edgeStreamUrl.slice(0, 600);
  if (typeof p.edge === 'boolean') item.edge = p.edge;
  if (Number(p.chunkSize) > 0) item.chunkSize = Number(p.chunkSize);
  if (p.streamReady) item.streamReady = true;
  if (p.ready) { item.ready = true; item.streamReady = true; item.pct = 100; }
  return before !== `${item.pct}|${item.streamReady}|${item.ready}`;
}

// 前台（正在放映的那部）上传进度：同步到队列；没有就补进队列
function upsertQueueFromForeground(room, ownerKey, info) {
  if (!room || !info || !info.uploadId) return;
  let item = getQueueItem(room, info.uploadId);
  if (!item) {
    if (room.queue.length >= QUEUE_MAX_ITEMS) return;
    item = {
      id: info.uploadId,
      name: String(info.name || 'movie.mp4').slice(0, 200),
      size: Number(info.size) || 0,
      type: info.type || 'video/mp4',
      duration: Number(info.duration) || 0,
      ownerKey: ownerKey || '',
      addedAt: Date.now(),
      pct: 0,
      contiguousBytes: 0,
      startBytes: 0,
      streamReady: false,
      ready: false,
      edge: typeof info.edge === 'boolean' ? info.edge : null,
      chunkSize: Number(info.chunkSize) || 0,
      edgeStreamUrl: null,
      resumeTime: 0
    };
    room.queue.push(item);
    for (const peer of room.peers.values()) {
      if (ownerKey && peer.peerKey === ownerKey) {
        if (!peer.queueHave) peer.queueHave = new Set();
        peer.queueHave.add(item.id);
      }
    }
  }
  const changedPlaying = room.nowPlayingId !== item.id;
  room.nowPlayingId = item.id;
  const changed = applyQueueProgress(item, info);
  if (changedPlaying) broadcastQueueState(room);
  else if (changed) touchQueue(room);
}

function currentPlaybackTime(room) {
  const pb = room.playback || {};
  let t = Number(pb.currentTime) || 0;
  if (pb.playing && pb.updatedAt) t += ((Date.now() - pb.updatedAt) / 1000) * (Number(pb.playbackRate) || 1);
  return Math.max(0, t);
}

// 删掉 R2 上某部影片的全部分片（Worker 只接受来自本服务器的删除请求）
function deleteEdgeFilm(roomCode, uploadId) {
  if (!roomCode || !uploadId || EDGE_BASE === 'off') return;
  try {
    const u = new URL(`${EDGE_BASE}/api/edge-film?room=${encodeURIComponent(roomCode)}&uploadId=${encodeURIComponent(uploadId)}`);
    const mod = u.protocol === 'https:' ? require('https') : http;
    const req = mod.request(u, { method: 'DELETE', timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          console.error(`[Loamly Watch] R2 delete failed ${roomCode}/${uploadId} status=${res.statusCode} ${body.slice(0, 200)} (falling back to R2 24h lifecycle)`);
        }
      });
    });
    req.on('timeout', () => {
      try { req.destroy(); } catch {}
      console.error(`[Loamly Watch] R2 delete timeout ${roomCode}/${uploadId} (falling back to R2 24h lifecycle)`);
    });
    req.on('error', (e) => {
      console.error(`[Loamly Watch] R2 delete error ${roomCode}/${uploadId}: ${e && e.message} (falling back to R2 24h lifecycle)`);
    });
    req.end();
  } catch (e) {
    console.error(`[Loamly Watch] R2 delete exception ${roomCode}/${uploadId}: ${e && e.message} (falling back to R2 24h lifecycle)`);
  }
}

function purgeRoomQueue(room) {
  if (!room || !Array.isArray(room.queue)) return;
  for (const it of room.queue) {
    deleteEdgeFilm(room.code, it.id);
    deleteLocalFilmFiles(room.code, it.id);
  }
  room.queue = [];
  room.nowPlayingId = null;
  room.pendingSwitch = null;
  deletePersistedRoom(room.code);
}

function performQueueSwitch(room, item) {
  const prev = getQueueItem(room, room.nowPlayingId);
  if (prev && prev.id !== item.id) prev.resumeTime = currentPlaybackTime(room);
  room.pendingSwitch = null;
  room.activeSeek = null;
  room.nowPlayingId = item.id;
  room.playback = {
    playing: false,
    currentTime: item.resumeTime || 0,
    playbackRate: (room.playback && room.playback.playbackRate) || 1,
    updatedAt: Date.now()
  };
  const ownerHere = ownerOnlineWithFile(room, item);
  let mode = 'owner';
  let streamUrl = null;
  if (!ownerHere) {
    mode = 'stream';
    streamUrl = item.edgeStreamUrl || null;
    cleanupRoomFilmFile(room);
    room.filmUpload = {
      uploadId: item.id,
      name: item.name,
      size: item.size,
      mimeType: item.type || 'video/mp4',
      filePath: null,
      streamUrl,
      edgeStreamUrl: streamUrl,
      receivedBytes: item.ready ? item.size : Math.round((item.pct / 100) * item.size),
      contiguousBytes: item.ready ? item.size : (item.contiguousBytes || 0),
      pct: item.ready ? 100 : item.pct,
      speedBps: 0,
      startedAt: Date.now(),
      preloadReady: Boolean(item.streamReady || item.ready),
      streamReady: Boolean(item.streamReady || item.ready),
      ready: Boolean(item.ready),
      duration: item.duration || 0,
      startBytes: item.startBytes || 0
    };
    room.fileMeta = { name: item.name, size: item.size, type: item.type || 'video/mp4', isDemo: false, uploadId: item.id, streamUrl };
  }
  for (const peer of room.peers.values()) {
    peer.filmReady = false;
    if (mode === 'stream') { peer.hasLocalFile = false; peer.role = peer.role || 'guest'; }
  }
  const payload = {
    type: 'queue_switched',
    id: item.id,
    mode,
    ownerKey: item.ownerKey,
    resumeTime: item.resumeTime || 0,
    item: { id: item.id, name: item.name, size: item.size, type: item.type, duration: item.duration || 0, edge: item.edge, chunkSize: item.chunkSize || 0, ready: Boolean(item.ready), streamReady: Boolean(item.streamReady) },
    streamUrl,
    fileMeta: room.fileMeta,
    filmTransfer: mode === 'stream' ? serializeFilmTransfer(room) : null
  };
  for (const peer of room.peers.values()) sendWsJson(peer, payload);
  broadcastQueueState(room);
}

function getRoomPeerReadiness(room) {
  const readiness = {};
  if (!room) return readiness;
  for (const [id, peer] of room.peers.entries()) {
    readiness[id] = {
      role: peer.role,
      filmReady: Boolean(peer.filmReady)
    };
  }
  return readiness;
}

function serializeFilmTransfer(room) {
  if (!room || !room.filmUpload) return null;
  const u = room.filmUpload;
  const totalBytes = Number(u.size) || 0;
  const receivedBytes = Number(u.receivedBytes) || 0;
  const contiguousBytes = u.ready ? totalBytes : (Number(u.contiguousBytes) || receivedBytes);
  const calcPct = totalBytes > 0 ? Math.min(99, Math.floor((receivedBytes / totalBytes) * 100)) : 0;
  const pct = u.ready ? 100 : (typeof u.pct === "number" ? u.pct : calcPct);
  const canStream = Boolean(u.ready || u.streamReady || u.preloadReady);
  return {
    uploadId: u.uploadId,
    name: u.name,
    size: totalBytes,
    mimeType: u.mimeType,
    receivedBytes,
    contiguousBytes,
    pct,
    speedBps: u.speedBps || 0,
    ready: Boolean(u.ready),
    preloadReady: canStream,
    streamReady: Boolean(u.ready || u.streamReady),
    streamUrl: canStream ? (u.edgeStreamUrl || u.streamUrl) : null,
    edgeStreamUrl: u.edgeStreamUrl || null,
    ranges: u.ready ? [[0, totalBytes]] : (Array.isArray(u.ranges) ? u.ranges : computeChunkRanges(u)),
    duration: Number(u.duration) || 0,
    startBytes: Number(u.startBytes) || 0
  };
}

// 已写入字节区间（合并后的 [start, endExclusive] 列表）——让 TA 那边的进度条画出真实的已装入段
function computeChunkRanges(u) {
  if (!u || !u.chunks || u.chunks.size === 0) return [];
  const offs = Array.from(u.chunks.keys()).sort((a, b) => a - b);
  const out = [];
  for (const off of offs) {
    const end = off + (u.chunks.get(off) || 0);
    const last = out[out.length - 1];
    if (last && off <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      out.push([off, end]);
    }
  }
  return out.length > 64 ? out.slice(0, 64) : out;
}

function sanitizeRanges(raw, total) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const r of raw.slice(0, 64)) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const a = Math.max(0, Number(r[0]) || 0);
    const b = Math.min(total || Number(r[1]) || 0, Number(r[1]) || 0);
    if (b > a) out.push([a, b]);
  }
  return out;
}

// 「提前开始」门槛：开头连续装入约 2 分钟影片（按码率换算），拿不到时长时退回 max(5%, 32MB)
function computeStartBytes(totalSize, durationSec) {
  const total = Number(totalSize) || 0;
  if (total <= 0) return 1048576;
  const dur = Number(durationSec) || 0;
  let need;
  if (dur > 0) {
    need = Math.ceil((Math.min(120, dur) / dur) * total);
  } else {
    need = Math.max(Math.ceil(total * 0.05), 32 * 1024 * 1024);
  }
  return Math.min(total, Math.max(1048576, need));
}

// 编码 RFC6455 WebSocket 服务端帧
function encodeWsFrame(opcode, payloadBuffer) {
  const len = payloadBuffer.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuffer]);
}

function sendWsJson(client, data) {
  if (!client || client.closed || !client.socket || client.socket.destroyed) return;
  try {
    const json = JSON.stringify(data);
    const frame = encodeWsFrame(0x01, Buffer.from(json, 'utf8'));
    client.socket.write(frame);
  } catch {}
}

function broadcastToRoom(roomCode, data, excludeClientId = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const [id, peer] of room.peers.entries()) {
    if (id !== excludeClientId) {
      sendWsJson(peer, data);
    }
  }
}

function removeClientFromRoom(client) {
  if (!client.roomCode) return;
  const code = client.roomCode;
  client.roomCode = null;
  const room = rooms.get(code);
  if (!room) return;

  room.peers.delete(client.id);
  room.lastPresenceAt = Date.now();
  if (room.peers.size === 0) {
    room.emptySince = Date.now();
    room.activeSeek = null;
    room.pendingSwitch = null;
    if (room.filmUpload && !room.filmUpload.ready) {
      cleanupRoomFilmFile(room);
      room.fileMeta = null;
      room.nowPlayingId = null;
    }
    persistRoomState(room);
    return;
  }
  if (room.pendingSwitch && room.pendingSwitch.fromId === client.id) room.pendingSwitch = null;
  if (room.activeSeek) {
    const aligned = room.activeSeek;
    room.activeSeek = null;
    room.playback.currentTime = aligned.targetTime;
    room.playback.playing = aligned.shouldPlayAfterAlign;
    room.playback.updatedAt = Date.now();
    for (const peer of room.peers.values()) {
      sendWsJson(peer, {
        type: "seek_all_aligned",
        seekId: aligned.seekId,
        currentTime: aligned.targetTime,
        playing: aligned.shouldPlayAfterAlign,
        playbackRate: room.playback.playbackRate,
        serverTime: Date.now()
      });
    }
  }

  let hasHost = false;
  for (const peer of room.peers.values()) {
    if (peer.role === 'host') hasHost = true;
  }
  if (!hasHost) {
    const firstPeer = room.peers.values().next().value;
    if (firstPeer) firstPeer.role = 'host';
  }

  for (const peer of room.peers.values()) {
    sendWsJson(peer, {
      type: 'peer_left',
      peerId: client.id,
      role: peer.role,
      peerCount: room.peers.size,
      peerReadiness: getRoomPeerReadiness(room)
    });
  }
  broadcastQueueState(room);
  broadcastVersions(room);
}

function adoptClientIdentity(client, msg) {
  const k = cleanId(msg && msg.peerKey);
  if (k) client.peerKey = k;
  if (!client.peerKey) client.peerKey = `c-${client.id}`;
  const v = msg && typeof msg.webVersion === 'string' ? msg.webVersion.replace(/[^0-9.]/g, '').slice(0, 10) : '';
  client.webVersion = v || '0.5';
  if (!client.queueHave) client.queueHave = new Set();
  if (msg && Array.isArray(msg.queueHave)) {
    for (const id of msg.queueHave.slice(0, 10)) { const c = cleanId(id); if (c) client.queueHave.add(c); }
  }
}

function checkSameFileMatch(room) {
  if (!room || room.peers.size < 2) return false;
  const peersArr = Array.from(room.peers.values());
  if (!peersArr[0].hasLocalFile || !peersArr[1].hasLocalFile) return false;
  const f1 = peersArr[0].fileMeta;
  const f2 = peersArr[1].fileMeta;
  if (
    f1 &&
    f2 &&
    !f1.isDemo &&
    !f2.isDemo &&
    f1.name &&
    f1.name === f2.name &&
    Number(f1.size) === Number(f2.size) &&
    Number(f1.size) > 0
  ) {
    return true;
  }
  return false;
}

function handleWsMessage(client, rawText) {
  let msg;
  try {
    msg = JSON.parse(rawText);
  } catch {
    return;
  }
  if (!msg || typeof msg.type !== 'string') return;

  try {
  switch (msg.type) {
    case 'create_room': {
      removeClientFromRoom(client);
      const preferred = normalizeRoomCode(msg.roomCode);
      let code = (preferred.length >= 4 && !rooms.has(preferred)) ? preferred : '';
      if (!code && preferred.length >= 4) {
        const existing = rooms.get(preferred);
        if (existing && existing.peers.size === 0) {
          cleanupRoomFilmFile(existing);
          purgeRoomQueue(existing);
          rooms.delete(preferred);
          code = preferred;
        }
      }
      if (!code) code = generateRoomCode();

      const hasLocal = Boolean(msg.hasLocalFile && msg.fileMeta && !msg.fileMeta.isDemo);
      const initialMeta = (hasLocal || (msg.fileMeta && msg.fileMeta.isDemo)) ? msg.fileMeta : null;
      const room = createEmptyRoom(code, initialMeta);
      adoptClientIdentity(client, msg);
      client.role = 'host';
      client.roomCode = code;
      client.hasLocalFile = hasLocal;
      client.fileMeta = room.fileMeta;
      client.filmReady = Boolean(hasLocal || (room.fileMeta && room.fileMeta.isDemo));
      room.peers.set(client.id, client);
      room.emptySince = null;
      room.lastPresenceAt = Date.now();
      rooms.set(code, room);

      sendWsJson(client, {
        type: 'room_joined',
        roomCode: code,
        clientId: client.id,
        role: 'host',
        peerCount: 1,
        fileMeta: room.fileMeta,
        filmTransfer: serializeFilmTransfer(room),
        peerReadiness: getRoomPeerReadiness(room),
        playback: room.playback
      });
      broadcastQueueState(room);
      broadcastVersions(room);
      break;
    }

    case 'join_room': {
      const code = normalizeRoomCode(msg.roomCode);
      if (code.length < 4) {
        sendWsJson(client, { type: 'error', message: '请输入 4~6 位有效房间号' });
        return;
      }

      removeClientFromRoom(client);
      adoptClientIdentity(client, msg);
      let room = rooms.get(code);

      const hasLocal = Boolean(msg.hasLocalFile && msg.fileMeta && !msg.fileMeta.isDemo);
      const validIncomingMeta = (hasLocal || (msg.fileMeta && msg.fileMeta.isDemo)) ? msg.fileMeta : null;

      if (!room) {
        room = createEmptyRoom(code, validIncomingMeta);
        client.role = 'host';
        client.roomCode = code;
        client.hasLocalFile = hasLocal;
        client.fileMeta = room.fileMeta;
        client.filmReady = Boolean(hasLocal || (room.fileMeta && room.fileMeta.isDemo) || (room.filmUpload && room.filmUpload.ready));
        room.peers.set(client.id, client);
        room.emptySince = null;
        room.lastPresenceAt = Date.now();
        rooms.set(code, room);

        sendWsJson(client, {
          type: 'room_joined',
          roomCode: code,
          clientId: client.id,
          role: 'host',
          peerCount: 1,
          fileMeta: room.fileMeta,
          filmTransfer: serializeFilmTransfer(room),
          peerReadiness: getRoomPeerReadiness(room),
          playback: room.playback
        });
        broadcastQueueState(room);
        broadcastVersions(room);
        return;
      }

      room.emptySince = null;
      room.lastPresenceAt = Date.now();

      if (room.peers.size >= 2 && !room.peers.has(client.id)) {
        sendWsJson(client, {
          type: 'room_full',
          roomCode: code,
          message: '该私密放映室已满员（仅限 2 人同屏）'
        });
        return;
      }

      client.roomCode = code;
      client.hasLocalFile = hasLocal;
      if (hasLocal) {
        client.role = 'host';
        for (const peer of room.peers.values()) {
          if (!peer.hasLocalFile) peer.role = 'guest';
        }
        client.fileMeta = validIncomingMeta;
        room.fileMeta = validIncomingMeta;
        client.filmReady = true;
      } else {
        client.role = room.peers.size === 0 ? 'host' : 'guest';
        client.fileMeta = validIncomingMeta;
        if (validIncomingMeta && !room.fileMeta) {
          room.fileMeta = validIncomingMeta;
        }
        client.filmReady = Boolean(validIncomingMeta && validIncomingMeta.isDemo);
      }
      room.peers.set(client.id, client);

      // 若房间内既无已上传片源，也没有任何一端持有本地文件，则清理残留的无效 fileMeta
      let anyHasLocal = false;
      for (const peer of room.peers.values()) {
        if (peer.hasLocalFile) anyHasLocal = true;
      }
      if (room.fileMeta && !room.fileMeta.isDemo && !room.filmUpload && !anyHasLocal) {
        room.fileMeta = null;
      }

      const sameFileMatched = checkSameFileMatch(room);

      sendWsJson(client, {
        type: 'room_joined',
        roomCode: code,
        clientId: client.id,
        role: client.role,
        peerCount: room.peers.size,
        fileMeta: room.fileMeta,
        filmTransfer: serializeFilmTransfer(room),
        peerReadiness: getRoomPeerReadiness(room),
        sameFileMatched,
        playback: room.playback
      });

      broadcastToRoom(code, {
        type: 'peer_joined',
        peerId: client.id,
        peerCount: room.peers.size,
        peerFileMeta: client.fileMeta || null,
        fileMeta: room.fileMeta,
        filmTransfer: serializeFilmTransfer(room),
        peerReadiness: getRoomPeerReadiness(room),
        sameFileMatched
      }, client.id);

      if (sameFileMatched) {
        broadcastToRoom(code, {
          type: 'same_file_matched',
          fileMeta: room.fileMeta
        });
      }
      broadcastQueueState(room);
      broadcastVersions(room);
      break;
    }

    case 'file_meta': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      client.hasLocalFile = Boolean(msg.hasLocalFile !== false && msg.fileMeta && !msg.fileMeta.isDemo);
      client.fileMeta = msg.fileMeta || null;
      client.filmReady = Boolean(msg.filmReady);

      const sameFileMatched = checkSameFileMatch(room);

      if (msg.isNewSelection) {
        client.role = 'host';
        for (const [pid, peer] of room.peers.entries()) {
          if (pid !== client.id) peer.role = 'guest';
        }
      }

      const resumeUploadId = typeof msg.resumeUploadId === 'string' ? msg.resumeUploadId.replace(/[^a-zA-Z0-9_-]/g, '') : '';
      const isResume = Boolean(resumeUploadId && room.filmUpload && room.filmUpload.uploadId === resumeUploadId);

      if (isResume) {
        // 重新选了同一部片：保留已装入的部分，接着装，不打断 TA 那边的画面
        const keepStreamUrl = room.fileMeta && room.fileMeta.streamUrl;
        room.fileMeta = { ...(msg.fileMeta || {}), uploadId: resumeUploadId, streamUrl: keepStreamUrl || null };
      } else if (client.role === 'host' || !room.fileMeta || msg.isNewSelection) {
        if (!sameFileMatched) {
          cleanupRoomFilmFile(room);
        }
        room.fileMeta = msg.fileMeta || null;
        room.playback.playing = false;
        {
          const qi = getQueueItem(room, cleanId(msg.queueItemId));
          room.playback.currentTime = qi ? (qi.resumeTime || 0) : 0;
        }
        room.playback.updatedAt = Date.now();
        for (const [pid, peer] of room.peers.entries()) {
          if (pid !== client.id) {
            peer.filmReady = sameFileMatched;
          }
        }
      }

      broadcastToRoom(client.roomCode, {
        type: 'file_meta',
        fromId: client.id,
        role: client.role,
        fileMeta: room.fileMeta,
        isNewSelection: Boolean(msg.isNewSelection),
        resume: isResume,
        resumeUploadId: isResume ? resumeUploadId : null,
        filmTransfer: serializeFilmTransfer(room),
        sameFileMatched,
        peerReadiness: getRoomPeerReadiness(room)
      }, client.id);

      if (sameFileMatched) {
        for (const peer of room.peers.values()) {
          peer.filmReady = true;
        }
        broadcastToRoom(client.roomCode, {
          type: 'same_file_matched',
          fileMeta: room.fileMeta,
          peerReadiness: getRoomPeerReadiness(room)
        });
      }
      break;
    }

    case 'peer_film_ready':
    case 'film_ready_state': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      client.filmReady = Boolean(msg.ready);
      broadcastToRoom(client.roomCode, {
        type: 'peer_film_ready',
        fromId: client.id,
        role: client.role,
        ready: client.filmReady,
        peerReadiness: getRoomPeerReadiness(room)
      });
      break;
    }

    case 'quality_mode_change': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      const quality = msg.quality === 'original' ? 'original' : '720p';
      room.uploadQuality = quality;
      if (room.filmUpload) {
        room.filmUpload.quality = quality;
      }
      broadcastToRoom(client.roomCode, {
        type: 'quality_mode_change',
        fromId: client.id,
        quality
      }, client.id);
      break;
    }

    case 'instant_zero_wait_start': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      for (const peer of room.peers.values()) {
        peer.filmReady = true;
      }
      let liveStreamUrl = null;
      if (room.filmUpload) {
        room.filmUpload.streamReady = true;
        liveStreamUrl = room.filmUpload.streamUrl;
        if (room.fileMeta) room.fileMeta.streamUrl = liveStreamUrl;
      } else if (room.fileMeta && room.fileMeta.streamUrl) {
        liveStreamUrl = room.fileMeta.streamUrl;
      }
      room.playback.currentTime = typeof msg.currentTime === 'number' ? msg.currentTime : 0;
      room.playback.playing = true;
      room.playback.updatedAt = Date.now();
      broadcastToRoom(client.roomCode, {
        type: 'transfer_status',
        action: 'start_zero_wait_sync',
        fromId: client.id,
        currentTime: room.playback.currentTime,
        playing: true,
        fileMeta: msg.fileMeta || room.fileMeta,
        streamUrl: liveStreamUrl || (`/api/room-film?room=${client.roomCode}`),
        peerReadiness: getRoomPeerReadiness(room)
      }, client.id);
      break;
    }

    case 'webrtc_offer':
    case 'webrtc_answer':
    case 'webrtc_ice':
    case 'transfer_status':
    case 'peer_speaking':
    case 'peer_buffering':
    case 'sync_seek_ready':
    case 'chat_reaction': {
      if (!client.roomCode) return;
      const room = rooms.get(client.roomCode);
      if (msg.type === 'transfer_status' && msg.action === 'start_zero_wait_sync' && room) {
        for (const peer of room.peers.values()) {
          peer.filmReady = true;
        }
        if (room.filmUpload) {
          room.filmUpload.streamReady = true;
          if (room.fileMeta) room.fileMeta.streamUrl = room.filmUpload.streamUrl;
        }
      }
      broadcastToRoom(client.roomCode, {
        ...msg,
        fromId: client.id
      }, client.id);
      break;
    }

    case 'request_priority_chunk': {
      // TA 那边卡在某个位置：请上传的一方优先装这一段
      const room = rooms.get(client.roomCode);
      if (!room || !room.filmUpload || room.filmUpload.ready) return;
      const off = Number(msg.offset);
      if (!(off >= 0)) return;
      broadcastToRoom(client.roomCode, {
        type: 'priority_chunk_needed',
        uploadId: room.filmUpload.uploadId,
        offset: off,
        fromId: client.id,
        reason: msg.reason || 'stall'
      }, client.id);
      break;
    }

    case 'sync_seek': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      const prevTime = room.playback.currentTime || 0;
      const targetTime = typeof msg.currentTime === 'number' ? msg.currentTime : 0;
      const seekId = msg.seekId || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const shouldPlayAfterAlign = msg.shouldPlayAfterAlign !== false;

      room.playback.currentTime = targetTime;
      room.playback.playing = false;
      room.playback.updatedAt = Date.now();

      room.activeSeek = {
        seekId,
        targetTime,
        shouldPlayAfterAlign,
        readyPeers: new Set()
      };
      if (msg.localReady) {
        room.activeSeek.readyPeers.add(client.id);
      }

      if (typeof msg.approxByteOffset === 'number' && msg.approxByteOffset >= 0 && room.filmUpload && !room.filmUpload.ready) {
        broadcastToRoom(client.roomCode, {
          type: 'priority_chunk_needed',
          uploadId: room.filmUpload.uploadId,
          offset: msg.approxByteOffset
        });
      }

      broadcastToRoom(client.roomCode, {
        type: 'sync_seek',
        fromId: client.id,
        seekId,
        waitForAlign: true,
        shouldPlayAfterAlign,
        prevTime: typeof msg.prevTime === 'number' ? msg.prevTime : prevTime,
        currentTime: targetTime,
        playing: false,
        playbackRate: room.playback.playbackRate,
        sentAt: msg.sentAt || Date.now(),
        serverTime: Date.now()
      }, client.id);
      break;
    }

    case 'seek_ready': {
      const room = rooms.get(client.roomCode);
      if (!room || !room.activeSeek) return;
      if (msg.seekId && msg.seekId !== room.activeSeek.seekId) return;

      room.activeSeek.readyPeers.add(client.id);
      let allAligned = true;
      for (const pid of room.peers.keys()) {
        if (!room.activeSeek.readyPeers.has(pid)) {
          allAligned = false;
          break;
        }
      }

      if (allAligned) {
        const aligned = room.activeSeek;
        room.activeSeek = null;
        room.playback.currentTime = aligned.targetTime;
        room.playback.playing = aligned.shouldPlayAfterAlign;
        room.playback.updatedAt = Date.now();

        for (const peer of room.peers.values()) {
          sendWsJson(peer, {
            type: 'seek_all_aligned',
            seekId: aligned.seekId,
            currentTime: aligned.targetTime,
            playing: aligned.shouldPlayAfterAlign,
            playbackRate: room.playback.playbackRate,
            serverTime: Date.now()
          });
        }
      } else {
        broadcastToRoom(client.roomCode, {
          type: 'peer_seek_ready',
          fromId: client.id,
          seekId: room.activeSeek.seekId,
          currentTime: room.activeSeek.targetTime
        }, client.id);
      }
      break;
    }

    case 'edge_transfer_progress': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      const totalSize = Number(msg.totalBytes) || 0;
      const totalBytes = totalSize;
      const prevRecv = (room.filmUpload && room.filmUpload.uploadId === msg.uploadId) ? (room.filmUpload.receivedBytes || 0) : 0;
      const prevContig = (room.filmUpload && room.filmUpload.uploadId === msg.uploadId) ? (room.filmUpload.contiguousBytes || 0) : 0;
      const prevPct = (room.filmUpload && room.filmUpload.uploadId === msg.uploadId) ? (room.filmUpload.pct || 0) : 0;
      const receivedBytes = Math.max(prevRecv, Number(msg.receivedBytes) || 0);
      const contiguousBytes = Math.max(prevContig, Number(msg.contiguousBytes) || receivedBytes);
      const pct = Math.max(prevPct, Number(msg.pct) || 0);
      const edgeStreamUrl = msg.edgeStreamUrl || null;
      if (!room.filmUpload || room.filmUpload.uploadId !== msg.uploadId) {
        room.filmUpload = {
          uploadId: msg.uploadId || `${Date.now()}`,
          name: msg.name || 'movie.mp4',
          size: totalSize,
          mimeType: msg.mimeType || 'video/mp4',
          filePath: null,
          streamUrl: edgeStreamUrl,
          edgeStreamUrl,
          receivedBytes,
          contiguousBytes,
          pct,
          speedBps: msg.speedBps || 0,
          startedAt: Date.now(),
          preloadReady: Boolean(msg.preloadReady),
          streamReady: Boolean(msg.streamReady),
          ready: Boolean(msg.ready)
        };
      } else {
        room.filmUpload.receivedBytes = receivedBytes;
        room.filmUpload.contiguousBytes = contiguousBytes;
        room.filmUpload.pct = pct;
        room.filmUpload.speedBps = msg.speedBps || 0;
        if (edgeStreamUrl) {
          room.filmUpload.edgeStreamUrl = edgeStreamUrl;
          room.filmUpload.streamUrl = edgeStreamUrl;
        }
        if (msg.preloadReady) room.filmUpload.preloadReady = true;
        if (msg.streamReady) room.filmUpload.streamReady = true;
        if (msg.ready) {
          room.filmUpload.ready = true;
          room.filmUpload.streamReady = true;
          room.filmUpload.preloadReady = true;
        }
      }
      {
        const fu = room.filmUpload;
        const rr = sanitizeRanges(msg.ranges, totalSize);
        if (rr) fu.ranges = rr;
        if (Number(msg.duration) > 0) fu.duration = Number(msg.duration);
        if (Number(msg.startBytes) > 0) fu.startBytes = Number(msg.startBytes);
      }
      upsertQueueFromForeground(room, client.peerKey, {
        uploadId: room.filmUpload.uploadId,
        name: msg.name || room.filmUpload.name,
        size: totalSize,
        type: msg.mimeType || 'video/mp4',
        duration: msg.duration,
        pct: room.filmUpload.ready ? 100 : pct,
        contiguousBytes,
        startBytes: msg.startBytes,
        streamReady: room.filmUpload.streamReady,
        ready: room.filmUpload.ready,
        edgeStreamUrl: room.filmUpload.edgeStreamUrl,
        edge: typeof msg.edge === 'boolean' ? msg.edge : true,
        chunkSize: msg.chunkSize
      });
      const canStream = Boolean(room.filmUpload.preloadReady || room.filmUpload.streamReady || room.filmUpload.ready);
      if (!room.fileMeta) {
        room.fileMeta = {
          name: msg.name || 'movie.mp4',
          size: totalSize,
          type: msg.mimeType || 'video/mp4',
          isDemo: false,
          uploadId: room.filmUpload.uploadId,
          streamUrl: canStream ? edgeStreamUrl : null
        };
      } else if (canStream && edgeStreamUrl) {
        room.fileMeta.streamUrl = edgeStreamUrl;
      }

      if (msg.ready) {
        broadcastToRoom(client.roomCode, {
          type: 'film_transfer_ready',
          uploadId: room.filmUpload.uploadId,
          streamUrl: edgeStreamUrl,
          fileMeta: room.fileMeta,
          filmTransfer: serializeFilmTransfer(room),
          peerReadiness: getRoomPeerReadiness(room)
        }, client.id);
      } else {
        broadcastToRoom(client.roomCode, {
          type: 'film_transfer_progress',
          uploadId: room.filmUpload.uploadId,
          name: room.fileMeta.name,
          receivedBytes,
          contiguousBytes,
          totalBytes,
          pct,
          speedBps: msg.speedBps || 0,
          preloadReady: Boolean(room.filmUpload.preloadReady),
          streamReady: Boolean(room.filmUpload.streamReady),
          streamUrl: canStream ? edgeStreamUrl : null,
          ready: false,
          ranges: room.filmUpload.ranges || null,
          duration: room.filmUpload.duration || 0,
          startBytes: room.filmUpload.startBytes || 0,
          peerReadiness: getRoomPeerReadiness(room)
        }, client.id);
      }
      break;
    }

    case 'sync_play':
    case 'sync_pause':
    case 'sync_rate':
    case 'sync_heartbeat': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      if (msg.type === 'sync_heartbeat' && room.activeSeek) return;
      if ((msg.type === 'sync_play' || msg.type === 'sync_pause') && msg.reason !== 'seeking') {
        room.activeSeek = null;
      }
      const prevTime = room.playback.currentTime || 0;
      if (typeof msg.currentTime === 'number') {
        room.playback.currentTime = msg.currentTime;
      }
      if (typeof msg.playing === 'boolean') {
        room.playback.playing = msg.playing;
      } else if (msg.type === 'sync_play') {
        room.playback.playing = true;
      } else if (msg.type === 'sync_pause') {
        room.playback.playing = false;
      }
      if (typeof msg.playbackRate === 'number') {
        room.playback.playbackRate = msg.playbackRate;
      }
      room.playback.updatedAt = Date.now();

      broadcastToRoom(client.roomCode, {
        type: msg.type,
        fromId: client.id,
        prevTime: typeof msg.prevTime === 'number' ? msg.prevTime : prevTime,
        currentTime: room.playback.currentTime,
        playing: room.playback.playing,
        playbackRate: room.playback.playbackRate,
        reason: msg.reason || 'user',
        buffering: typeof msg.buffering === 'boolean' ? msg.buffering : undefined,
        etaSec: typeof msg.etaSec === 'number' ? msg.etaSec : undefined,
        sentAt: msg.sentAt || Date.now(),
        serverTime: Date.now()
      }, client.id);
      break;
    }

    case 'ping': {
      sendWsJson(client, { type: 'pong', serverTime: Date.now() });
      break;
    }

    // ===== 本场待放映 =====
    case 'queue_have': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      client.queueHave = new Set((Array.isArray(msg.ids) ? msg.ids : []).slice(0, 10).map(cleanId).filter(Boolean));
      broadcastQueueState(room);
      break;
    }

    case 'queue_add': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      const id = cleanId(msg.uploadId);
      const size = Number(msg.size) || 0;
      const name = String(msg.name || 'movie.mp4').slice(0, 200);
      if (!id || size <= 0) return;
      const fail = (code) => sendWsJson(client, { type: 'queue_error', code, name });
      if (getQueueItem(room, id)) { broadcastQueueState(room); return; }
      const dup = room.queue.find((it) => it.ownerKey === client.peerKey && it.name === name && Number(it.size) === size);
      if (dup) {
        if (!client.queueHave) client.queueHave = new Set();
        client.queueHave.add(dup.id);
        sendWsJson(client, { type: 'queue_added', id: dup.id, existing: true, requestId: id });
        broadcastQueueState(room);
        return;
      }
      if (size > QUEUE_MAX_FILM_BYTES) return fail('too_big');
      if (room.queue.length >= QUEUE_MAX_ITEMS) return fail('full');
      const used = room.queue.reduce((a, it) => a + (Number(it.size) || 0), 0);
      if (used + size > QUEUE_MAX_TOTAL_BYTES) return fail('total');
      const item = {
        id,
        name,
        size,
        type: String(msg.mimeType || msg.type || 'video/mp4').slice(0, 60),
        duration: Number(msg.duration) || 0,
        ownerKey: client.peerKey,
        addedAt: Date.now(),
        pct: 0,
        contiguousBytes: 0,
        startBytes: 0,
        streamReady: false,
        ready: false,
        edge: typeof msg.edge === 'boolean' ? msg.edge : null,
        chunkSize: Number(msg.chunkSize) || 0,
        edgeStreamUrl: null,
        resumeTime: 0
      };
      room.queue.push(item);
      if (!client.queueHave) client.queueHave = new Set();
      client.queueHave.add(id);
      sendWsJson(client, { type: 'queue_added', id, existing: false });
      // 房间里还没有影片：直接放这部
      const nothingLoaded = !room.nowPlayingId && !(room.fileMeta && room.fileMeta.name) && !room.filmUpload;
      if (nothingLoaded) performQueueSwitch(room, item);
      else broadcastQueueState(room);
      break;
    }

    case 'queue_remove': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      const id = cleanId(msg.id);
      const item = getQueueItem(room, id);
      if (!item) return;
      if (item.ownerKey !== client.peerKey) return sendWsJson(client, { type: 'queue_error', code: 'not_owner', name: item.name });
      if (item.id === room.nowPlayingId) return sendWsJson(client, { type: 'queue_error', code: 'playing', name: item.name });
      room.queue = room.queue.filter((it) => it.id !== id);
      if (room.pendingSwitch && room.pendingSwitch.id === id) room.pendingSwitch = null;
      for (const peer of room.peers.values()) { if (peer.queueHave) peer.queueHave.delete(id); }
      deleteEdgeFilm(room.code, id);
      deleteLocalFilmFiles(room.code, id);
      broadcastQueueState(room);
      break;
    }

    case 'queue_progress': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      const item = getQueueItem(room, cleanId(msg.id));
      if (!item || item.ownerKey !== client.peerKey) return;
      if (applyQueueProgress(item, msg)) touchQueue(room);
      break;
    }

    case 'queue_switch_request': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      const item = getQueueItem(room, cleanId(msg.id));
      if (!item) return;
      if (item.id === room.nowPlayingId) { broadcastQueueState(room); return; }
      if (!canSwitchTo(room, item)) return sendWsJson(client, { type: 'queue_error', code: 'not_ready', name: item.name, mine: item.ownerKey === client.peerKey });
      const others = Array.from(room.peers.values()).filter((p) => p.id !== client.id);
      const hasCurrent = Boolean(room.nowPlayingId || (room.fileMeta && room.fileMeta.name));
      if (others.length === 0 || !hasCurrent) {
        performQueueSwitch(room, item);
        return;
      }
      room.pendingSwitch = { id: item.id, fromId: client.id, at: Date.now() };
      for (const p of others) sendWsJson(p, { type: 'queue_switch_ask', id: item.id, name: item.name, fromId: client.id });
      sendWsJson(client, { type: 'queue_switch_pending', id: item.id, name: item.name });
      break;
    }

    case 'queue_switch_reply': {
      const room = rooms.get(client.roomCode);
      if (!room || !room.pendingSwitch) return;
      const ps = room.pendingSwitch;
      if (cleanId(msg.id) !== ps.id || ps.fromId === client.id) return;
      const item = getQueueItem(room, ps.id);
      room.pendingSwitch = null;
      if (!item) return;
      if (msg.accept) {
        performQueueSwitch(room, item);
      } else {
        const requester = room.peers.get(ps.fromId);
        if (requester) sendWsJson(requester, { type: 'queue_switch_declined', id: item.id, name: item.name });
        broadcastQueueState(room);
      }
      break;
    }
  }
  } catch (err) {
    console.error("[Loamly Watch WS Error]", err);
  }
}

// 静态文件服务（支持 HTTP Range 206 分段请求）
function serveStaticFile(req, res, filePath, overrideMimeType = null) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = overrideMimeType || MIME_TYPES[ext] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      if (isNaN(start) || isNaN(end) || start > end || end >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

// 处理房主选片流式上传与伴侣端 HTTP Range 流式播放（支持上传中已知有效大小的平滑流式读取）
function getWrittenSpanAt(u, startOffset, statSize) {
  if (u.ready) {
    return { available: startOffset < statSize, endExclusive: statSize };
  }
  const contig = typeof u.contiguousBytes === 'number' ? u.contiguousBytes : 0;
  if (startOffset < contig) {
    return { available: true, endExclusive: Math.min(statSize, contig) };
  }
  if (!u.chunks || u.chunks.size === 0) {
    return { available: false, endExclusive: 0 };
  }
  // Check if startOffset falls inside any already-written chunk (e.g. the tail moov chunk)
  const sortedOffsets = Array.from(u.chunks.keys()).sort((a, b) => a - b);
  let matchedEnd = -1;
  for (const off of sortedOffsets) {
    const len = u.chunks.get(off) || 0;
    if (startOffset >= off && startOffset < off + len) {
      matchedEnd = off + len;
    } else if (matchedEnd !== -1 && off === matchedEnd) {
      matchedEnd += len;
    } else if (matchedEnd !== -1 && off > matchedEnd) {
      break;
    }
  }
  if (matchedEnd > startOffset) {
    return { available: true, endExclusive: Math.min(statSize, matchedEnd) };
  }
  return { available: false, endExclusive: 0 };
}

function notifyUploadWaiters(u) {
  if (!u || !Array.isArray(u.rangeWaiters) || u.rangeWaiters.length === 0) return;
  const list = u.rangeWaiters.splice(0, u.rangeWaiters.length);
  for (const fn of list) {
    try { fn(); } catch {}
  }
}

function handleRoomFilmApi(req, res, parsedUrl) {
  const code = normalizeRoomCode(parsedUrl.searchParams.get('room') || req.headers['x-room-code'] || '');
  if (!code || code.length < 4) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Invalid room code' }));
    return;
  }

  let room = rooms.get(code);

  // GET /api/room-film?room=&parts=1&uploadId=  → 已写入的块（断点续传用）
  if (req.method === 'GET' && parsedUrl.searchParams.get('parts') === '1') {
    const wantId = (parsedUrl.searchParams.get('uploadId') || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const u = room && room.filmUpload;
    const out = { ok: true, uploadId: wantId, offsets: [], sizes: [], ready: false };
    if (u && u.uploadId === wantId) {
      out.ready = Boolean(u.ready);
      if (u.chunks) {
        for (const [off, len] of Array.from(u.chunks.entries()).sort((a, b) => a[0] - b[0])) {
          out.offsets.push(off);
          out.sizes.push(len);
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out));
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!room || !room.filmUpload || !room.filmUpload.filePath) {
      // 启动后尚未进房、或热更新包 UPDT：尝试从磁盘恢复最新临时文件
      const recovered = recoverRoomFilmFromDisk(code, room && room.fileMeta);
      if (recovered && recovered.filePath) {
        if (!room) {
          room = createEmptyRoom(code, null);
          rooms.set(code, room);
        }
        room.filmUpload = recovered;
        if (!room.fileMeta) {
          room.fileMeta = {
            name: recovered.name,
            size: recovered.size,
            type: recovered.mimeType,
            isDemo: false,
            uploadId: recovered.uploadId,
            streamUrl: recovered.streamUrl
          };
        }
      }
    }
    if (!room || !room.filmUpload || !room.filmUpload.filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Room film not found');
      return;
    }

    const u = room.filmUpload;
    const waitStartedAt = Date.now();
    const RANGE_WAIT_MS = 60000;
    const serveRangeOrWait = (waitedCount = 0) => {
      if (res.writableEnded || res.destroyed) return;
      fs.stat(u.filePath, (err, stat) => {
        if (err || !stat.isFile() || stat.size <= 0) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Room film file not ready');
          return;
        }

        const declaredTotalSize = (!u.ready && u.size && u.size > stat.size) ? u.size : stat.size;
        const contentType = u.mimeType || 'video/mp4';
        const range = req.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          if (isNaN(start) || start < 0 || start >= declaredTotalSize) {
            res.writeHead(416, { 'Content-Range': `bytes */${declaredTotalSize}` });
            res.end();
            return;
          }

          const span = getWrittenSpanAt(u, start, stat.size);
          if (!span.available) {
            if (!u.ready && room.filmUpload === u && Date.now() - waitStartedAt < RANGE_WAIT_MS) {
              if (waitedCount === 0 || waitedCount % 10 === 0) {
                broadcastToRoom(code, {
                  type: 'priority_chunk_needed',
                  uploadId: u.uploadId,
                  offset: start
                });
              }
              if (!Array.isArray(u.rangeWaiters)) u.rangeWaiters = [];
              let done = false;
              const timer = setTimeout(() => {
                if (done) return;
                done = true;
                serveRangeOrWait(waitedCount + 1);
              }, 1000);
              u.rangeWaiters.push(() => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                serveRangeOrWait(waitedCount + 1);
              });
              return;
            }
            // 这一段还没装到：503 + Retry-After，让播放器稍后再取，而不是判定影片损坏
            res.writeHead(503, { 'Retry-After': '2', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Range not uploaded yet');
            return;
          }

          const effectiveLimit = span.endExclusive;
          const maxChunkEnd = u.ready ? (effectiveLimit - 1) : Math.min(effectiveLimit - 1, start + 2 * 1024 * 1024 - 1);
          const requestedEnd = parts[1] ? parseInt(parts[1], 10) : maxChunkEnd;
          const end = Math.min(effectiveLimit - 1, requestedEnd);

          if (isNaN(end) || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${declaredTotalSize}` });
            res.end();
            return;
          }

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${declaredTotalSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType,
            'Cache-Control': u.ready ? 'private, max-age=7200' : 'no-cache'
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          fs.createReadStream(u.filePath, { start, end, highWaterMark: 512 * 1024 }).pipe(res);
        } else {
          const span = getWrittenSpanAt(u, 0, stat.size);
          const safeLen = span.available ? span.endExclusive : stat.size;
          res.writeHead(200, {
            'Content-Length': safeLen,
            'Accept-Ranges': 'bytes',
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          fs.createReadStream(u.filePath, { start: 0, end: Math.max(0, safeLen - 1), highWaterMark: 256 * 1024 }).pipe(res);
        }
      });
    };

    serveRangeOrWait(0);
    return;
  }

  if ((req.method === 'POST' || req.method === 'PUT') && parsedUrl.searchParams.has('offset')) {
    const rawName = parsedUrl.searchParams.get('name') || 'movie.mp4';
    let fileName = 'movie.mp4';
    try { fileName = decodeURIComponent(rawName); } catch { fileName = rawName; }
    const totalSize = parseInt(parsedUrl.searchParams.get('total') || parsedUrl.searchParams.get('size') || '0', 10) || 0;
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10) || 0;
    const isTailChunk = parsedUrl.searchParams.get('tail') === '1';
    const hasHeadMoov = parsedUrl.searchParams.get('headMoov') === '1';
    const mimeType = parsedUrl.searchParams.get('type') || 'video/mp4';
    const qualityMode = parsedUrl.searchParams.get('mode') || '720p';
    const clientUploadId = (parsedUrl.searchParams.get('uploadId') || '').replace(/[^a-zA-Z0-9_-]/g, '') || `${Date.now()}`;
    const durationSec = parseFloat(parsedUrl.searchParams.get('dur') || '0') || 0;

    if (!room) {
      room = createEmptyRoom(code, { name: fileName, size: totalSize, type: mimeType, isDemo: false });
      rooms.set(code, room);
    }

    if (!room.filmUpload || room.filmUpload.uploadId !== clientUploadId) {
      cleanupRoomFilmFile(room);
      const ext = path.extname(fileName).toLowerCase() || '.mp4';
      const safeExt = ['.mp4', '.webm', '.mov', '.m4v'].includes(ext) ? ext : '.mp4';
      const filePath = path.join(ROOM_FILM_DIR, `room-${code}-${clientUploadId}${safeExt}`);
      try { fs.closeSync(fs.openSync(filePath, 'w')); } catch {}
      const streamUrl = `/api/room-film?room=${code}&v=${clientUploadId}`;
      room.filmUpload = {
        uploadId: clientUploadId,
        name: fileName,
        size: totalSize,
        mimeType,
        qualityMode,
        filePath,
        streamUrl,
        receivedBytes: 0,
        contiguousBytes: 0,
        tailReady: false,
        chunks: new Map(),
        rangeWaiters: [],
        speedBps: 0,
        startedAt: Date.now(),
        lastBroadcastAt: 0,
        streamReady: false,
        ready: false
      };
      room.fileMeta = {
        name: fileName,
        size: totalSize,
        type: mimeType,
        isDemo: false,
        uploadId: clientUploadId,
        streamUrl: null
      };
      for (const peer of room.peers.values()) {
        if (!peer.hasLocalFile) {
          peer.filmReady = false;
        }
      }
    }

    const u = room.filmUpload;
    if (durationSec > 0) u.duration = durationSec;
    const ownerKeyParam = cleanId(parsedUrl.searchParams.get('pk') || '');
    const buffers = [];
    req.on('data', (chunk) => buffers.push(chunk));
    req.on('end', () => {
      if (!room.filmUpload || room.filmUpload.uploadId !== clientUploadId) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, superseded: true }));
        return;
      }
      const buf = Buffer.concat(buffers);
      fs.open(u.filePath, 'r+', (openErr, fd) => {
        if (openErr) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: openErr.message }));
          return;
        }
        fs.write(fd, buf, 0, buf.length, offset, (writeErr) => {
          fs.close(fd, () => {});
          if (writeErr) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: writeErr.message }));
            return;
          }

          const prevLen = u.chunks.get(offset) || 0;
          u.chunks.set(offset, Math.max(prevLen, buf.length));
          if (hasHeadMoov || isTailChunk || (totalSize > 0 && offset + buf.length >= totalSize)) {
            u.tailReady = true;
          }

          let sumBytes = 0;
          for (const len of u.chunks.values()) sumBytes += len;
          u.receivedBytes = Math.min(totalSize || sumBytes, sumBytes);

          let contig = 0;
          while (u.chunks.has(contig)) {
            contig += u.chunks.get(contig);
          }
          u.contiguousBytes = contig;

          notifyUploadWaiters(u);

          const now = Date.now();
          const elapsedSec = Math.max(0.15, (now - u.startedAt) / 1000);
          u.speedBps = Math.round(u.receivedBytes / elapsedSec);

          const preloadBytes = Math.min(totalSize || 1048576, 1024 * 1024);
          const justBecamePreloadReady = (!u.preloadReady && u.contiguousBytes >= preloadBytes && u.tailReady);
          if (justBecamePreloadReady) {
            u.preloadReady = true;
            room.fileMeta.streamUrl = u.streamUrl;
          }

          const fivePctBytes = computeStartBytes(totalSize, u.duration);
          u.startBytes = fivePctBytes;
          const justBecameStreamReady = (!u.streamReady && u.contiguousBytes >= fivePctBytes && u.tailReady);
          if (justBecameStreamReady) {
            u.streamReady = true;
            u.preloadReady = true;
            room.fileMeta.streamUrl = u.streamUrl;
          }

          const isComplete = totalSize > 0 && u.receivedBytes >= totalSize && u.contiguousBytes >= totalSize;
          let pct = 0;
          if (isComplete) {
            pct = 100;
          } else if (totalSize > 0) {
            pct = Math.min(99, Math.floor((u.receivedBytes / totalSize) * 100));
          }
          pct = isComplete ? 100 : Math.max(u.pct || 0, pct);
          u.pct = pct;

          upsertQueueFromForeground(room, ownerKeyParam, {
            uploadId: u.uploadId,
            name: fileName,
            size: totalSize,
            type: mimeType,
            duration: u.duration || 0,
            pct: isComplete ? 100 : pct,
            contiguousBytes: u.contiguousBytes,
            startBytes: u.startBytes,
            streamReady: Boolean(u.streamReady || isComplete),
            ready: isComplete,
            edgeStreamUrl: null,
            edge: false,
            chunkSize: 1024 * 1024
          });

          if (isComplete && !u.ready) {
            u.ready = true;
            u.preloadReady = true;
            u.streamReady = true;
            u.contiguousBytes = totalSize;
            room.fileMeta.streamUrl = u.streamUrl;
            notifyUploadWaiters(u);
            broadcastToRoom(code, {
              type: 'film_transfer_ready',
              uploadId: u.uploadId,
              streamUrl: u.streamUrl,
              fileMeta: room.fileMeta,
              filmTransfer: serializeFilmTransfer(room),
              peerReadiness: getRoomPeerReadiness(room)
            });
          } else if (justBecamePreloadReady || justBecameStreamReady || now - u.lastBroadcastAt >= 120) {
            u.lastBroadcastAt = now;
            broadcastToRoom(code, {
              type: 'film_transfer_progress',
              uploadId: u.uploadId,
              name: fileName,
              receivedBytes: u.receivedBytes,
              contiguousBytes: u.contiguousBytes,
              totalBytes: totalSize,
              pct,
              speedBps: u.speedBps,
              preloadReady: Boolean(u.preloadReady),
              streamReady: Boolean(u.streamReady),
              streamUrl: (u.preloadReady || u.streamReady) ? u.streamUrl : null,
              ready: false,
              ranges: computeChunkRanges(u),
              duration: u.duration || 0,
              startBytes: u.startBytes || 0,
              peerReadiness: getRoomPeerReadiness(room)
            });
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            ok: true,
            uploadId: u.uploadId,
            receivedBytes: u.receivedBytes,
            contiguousBytes: u.contiguousBytes,
            pct,
            preloadReady: Boolean(u.preloadReady),
            streamReady: Boolean(u.streamReady),
            streamUrl: (u.preloadReady || u.streamReady) ? u.streamUrl : null,
            ready: Boolean(u.ready),
            peerReadiness: getRoomPeerReadiness(room)
          }));
        });
      });
    });
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const rawName = parsedUrl.searchParams.get('name') || req.headers['x-file-name'] || 'movie.mp4';
    let fileName = 'movie.mp4';
    try {
      fileName = decodeURIComponent(rawName);
    } catch {
      fileName = rawName;
    }
    const fileSize = parseInt(parsedUrl.searchParams.get('size') || req.headers['x-file-size'] || req.headers['content-length'] || '0', 10) || 0;
    const mimeType = parsedUrl.searchParams.get('type') || req.headers['x-file-type'] || req.headers['content-type'] || 'video/mp4';
    const quality = parsedUrl.searchParams.get('quality') || '720p';
    if (!room) {
      room = createEmptyRoom(code, { name: fileName, size: fileSize, type: mimeType, isDemo: false });
      rooms.set(code, room);
    }
    cleanupRoomFilmFile(room);

    const uploadId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const ext = path.extname(fileName).toLowerCase() || '.mp4';
    const safeExt = ['.mp4', '.webm', '.mov', '.m4v'].includes(ext) ? ext : '.mp4';
    const filePath = path.join(ROOM_FILM_DIR, `room-${code}-${uploadId}${safeExt}`);
    const streamUrl = `/api/room-film?room=${code}&v=${uploadId}`;

    const uploadState = {
      uploadId,
      name: fileName,
      size: fileSize,
      mimeType,
      quality,
      filePath,
      streamUrl,
      receivedBytes: 0,
      speedBps: 0,
      startedAt: Date.now(),
      lastBroadcastAt: 0,
      streamReady: false,
      ready: false
    };
    room.filmUpload = uploadState;
    room.fileMeta = {
      name: fileName,
      size: fileSize,
      type: mimeType,
      quality,
      isDemo: false,
      uploadId,
      streamUrl: null
    };

    const writeStream = fs.createWriteStream(filePath);
    let aborted = false;

    req.on('data', (chunk) => {
      uploadState.receivedBytes += chunk.length;
      const now = Date.now();
      const elapsedSec = Math.max(0.15, (now - uploadState.startedAt) / 1000);
      uploadState.speedBps = Math.round(uploadState.receivedBytes / elapsedSec);

      const total = uploadState.size || uploadState.receivedBytes;
      const unlockBytes = Math.min(Math.max(1024 * 1024, Math.round(total * 0.05)), 8 * 1024 * 1024);
      if (!uploadState.streamReady && uploadState.receivedBytes >= unlockBytes) {
        uploadState.streamReady = true;
        room.fileMeta.streamUrl = streamUrl;
      }
      if (now - uploadState.lastBroadcastAt >= 150) {
        uploadState.lastBroadcastAt = now;
        const pct = total > 0 ? Math.min(99, Math.round((uploadState.receivedBytes / total) * 100)) : 0;
        broadcastToRoom(code, {
          type: 'film_transfer_progress',
          uploadId,
          name: fileName,
          quality,
          receivedBytes: uploadState.receivedBytes,
          totalBytes: total,
          pct,
          speedBps: uploadState.speedBps,
          streamReady: Boolean(uploadState.streamReady),
          streamUrl: uploadState.streamReady ? streamUrl : null,
          ready: false
        });
      }
    });

    req.pipe(writeStream);

    req.on('aborted', () => {
      aborted = true;
      writeStream.destroy();
      if (room.filmUpload && room.filmUpload.uploadId === uploadId) {
        cleanupRoomFilmFile(room);
      }
    });

    writeStream.on('error', (err) => {
      if (aborted) return;
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });

    writeStream.on('finish', () => {
      if (aborted) return;
      if (!room.filmUpload || room.filmUpload.uploadId !== uploadId) {
        fs.unlink(filePath, () => {});
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, superseded: true }));
        return;
      }

      uploadState.ready = true;
      uploadState.streamReady = true;
      if (!uploadState.size) {
        uploadState.size = uploadState.receivedBytes;
      }
      room.fileMeta = {
        name: fileName,
        size: uploadState.size,
        type: mimeType,
        quality,
        isDemo: false,
        uploadId,
        streamUrl
      };

      broadcastToRoom(code, {
        type: 'film_transfer_ready',
        uploadId,
        streamUrl,
        fileMeta: room.fileMeta,
        filmTransfer: serializeFilmTransfer(room),
        peerReadiness: getRoomPeerReadiness(room)
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        uploadId,
        streamUrl,
        size: uploadState.size
      }));
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      service: 'watch.loamly.cn',
      activeRooms: rooms.size,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (pathname === '/api/version') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      ok: true,
      web: APP_VERSION,
      server: APP_VERSION,
      label: `v${APP_VERSION} · ${APP_RELEASE}`,
      buildTime: APP_BUILD_TIME,
      startedAt: SERVER_STARTED_AT
    }));
    return;
  }

  if (pathname === '/api/room-film') {
    handleRoomFilmApi(req, res, parsedUrl);
    return;
  }

  let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (safePath === '/' || safePath === '') {
    safePath = '/index.html';
  }

  const fullPath = path.join(PUBLIC_DIR, safePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(fullPath, (err, stat) => {
    if (!err && stat.isFile()) {
      serveStaticFile(req, res, fullPath);
    } else {
      serveStaticFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    }
  });
});

// 原生 RFC6455 WebSocket 升级处理
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];
  socket.write(responseHeaders.join('\r\n'));
  socket.setNoDelay(true);

  const client = {
    id: crypto.randomBytes(6).toString('hex'),
    socket,
    roomCode: null,
    role: 'host',
    fileMeta: null,
    filmReady: false,
    closed: false,
    buffer: head && head.length ? Buffer.from(head) : Buffer.alloc(0),
    fragments: []
  };

  function processBuffer() {
    while (client.buffer.length >= 2) {
      const firstByte = client.buffer[0];
      const secondByte = client.buffer[1];
      const fin = (firstByte & 0x80) !== 0;
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (client.buffer.length < 4) return;
        payloadLen = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (client.buffer.length < 10) return;
        const bigLen = client.buffer.readBigUInt64BE(2);
        if (bigLen > BigInt(10 * 1024 * 1024)) {
          socket.destroy();
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      const maskLength = masked ? 4 : 0;
      const totalFrameLen = offset + maskLength + payloadLen;
      if (client.buffer.length < totalFrameLen) return;

      let payload = client.buffer.subarray(offset + maskLength, totalFrameLen);
      if (masked) {
        const maskKey = client.buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ maskKey[i & 3];
        }
        payload = unmasked;
      }

      client.buffer = client.buffer.subarray(totalFrameLen);

      if (opcode === 0x08) {
        client.closed = true;
        try {
          socket.end(encodeWsFrame(0x08, Buffer.alloc(0)));
        } catch {}
        removeClientFromRoom(client);
        return;
      } else if (opcode === 0x09) {
        try {
          socket.write(encodeWsFrame(0x0a, payload));
        } catch {}
      } else if (opcode === 0x0a) {
        // Pong
      } else if (opcode === 0x01 || opcode === 0x00) {
        client.fragments.push(payload);
        if (fin) {
          const fullPayload = Buffer.concat(client.fragments);
          client.fragments = [];
          handleWsMessage(client, fullPayload.toString('utf8'));
        }
      }
    }
  }

  if (client.buffer.length > 0) {
    processBuffer();
  }

  socket.on('data', (chunk) => {
    client.buffer = client.buffer.length === 0 ? chunk : Buffer.concat([client.buffer, chunk]);
    if (client.buffer.length > 12 * 1024 * 1024) {
      socket.destroy();
      return;
    }
    processBuffer();
  });

  socket.on('close', () => {
    client.closed = true;
    removeClientFromRoom(client);
  });

  socket.on('error', () => {
    client.closed = true;
    removeClientFromRoom(client);
  });
});

// 定期发送 WebSocket Ping 保活，并清理无人空置超时的房间临时视频文件
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (code === 'UPDT') continue;
    if (room.peers.size === 0 && room.emptySince && now - room.emptySince > ROOM_EMPTY_TTL_MS) {
      cleanupRoomFilmFile(room);
      purgeRoomQueue(room);
      rooms.delete(code);
      continue;
    }
    // 单部影片最多留 24 小时（R2 也有 24 小时自动过期）
    if (Array.isArray(room.queue) && room.queue.length) {
      const expired = room.queue.filter((it) => now - it.addedAt > QUEUE_MAX_AGE_MS && it.id !== room.nowPlayingId);
      if (expired.length) {
        for (const it of expired) {
          deleteEdgeFilm(room.code, it.id);
          deleteLocalFilmFiles(room.code, it.id);
        }
        room.queue = room.queue.filter((it) => !expired.includes(it));
        broadcastQueueState(room);
      }
    }
    for (const peer of room.peers.values()) {
      if (!peer.closed && peer.socket && !peer.socket.destroyed) {
        try {
          peer.socket.write(encodeWsFrame(0x09, Buffer.alloc(0)));
        } catch {}
      }
    }
  }
}, 25000).unref();

restoreAndCleanupPersistedRooms();

server.listen(PORT, HOST, () => {
  console.log(`[Loamly Watch] 服务已启动: http://${HOST}:${PORT} (WebSocket: ws://${HOST}:${PORT}/ws) data=${ROOM_STATE_DIR}`);
});
