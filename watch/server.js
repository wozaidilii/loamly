#!/usr/bin/env node
/**
 * Loamly 双人同屏室 · 异地连麦同步播放器 (watch.loamly.cn)
 * 零外部依赖原生 Node.js HTTP 静态托管 + RFC6455 WebSocket 房间信令服务
 * 默认监听 127.0.0.1:3080，由 Nginx 反向代理 / 与 /ws
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '3080', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

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
  '.txt': 'text/plain; charset=utf-8'
};

// 房间状态表: roomCode -> { code, createdAt, fileMeta, playback, peers: Map<clientId, Client> }
const rooms = new Map();

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

// 编码 RFC6455 WebSocket 服务端帧 (服务端发给客户端无需 mask)
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
  } catch (err) {
    // 忽略写入断开连接异常
  }
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
  if (room.peers.size === 0) {
    rooms.delete(code);
    return;
  }

  // 如果原房主离开，把剩余一人提升为 host
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
      peerCount: room.peers.size
    });
  }
}

function handleWsMessage(client, rawText) {
  let msg;
  try {
    msg = JSON.parse(rawText);
  } catch {
    return;
  }
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'create_room': {
      removeClientFromRoom(client);
      const preferred = normalizeRoomCode(msg.roomCode);
      const code = (preferred.length >= 4 && !rooms.has(preferred)) ? preferred : generateRoomCode();
      const room = {
        code,
        createdAt: Date.now(),
        fileMeta: msg.fileMeta || null,
        playback: {
          playing: false,
          currentTime: 0,
          playbackRate: 1,
          updatedAt: Date.now()
        },
        peers: new Map()
      };
      client.role = 'host';
      client.roomCode = code;
      client.fileMeta = msg.fileMeta || null;
      room.peers.set(client.id, client);
      rooms.set(code, room);

      sendWsJson(client, {
        type: 'room_joined',
        roomCode: code,
        clientId: client.id,
        role: 'host',
        peerCount: 1,
        fileMeta: room.fileMeta,
        playback: room.playback
      });
      break;
    }

    case 'join_room': {
      const code = normalizeRoomCode(msg.roomCode);
      if (code.length < 4) {
        sendWsJson(client, { type: 'error', message: '请输入 4~6 位有效房间号' });
        return;
      }

      removeClientFromRoom(client);
      let room = rooms.get(code);

      // 若房间尚不存在，允许直接按该房间号建房进入
      if (!room) {
        room = {
          code,
          createdAt: Date.now(),
          fileMeta: msg.fileMeta || null,
          playback: {
            playing: false,
            currentTime: 0,
            playbackRate: 1,
            updatedAt: Date.now()
          },
          peers: new Map()
        };
        client.role = 'host';
        client.roomCode = code;
        client.fileMeta = msg.fileMeta || null;
        room.peers.set(client.id, client);
        rooms.set(code, room);

        sendWsJson(client, {
          type: 'room_joined',
          roomCode: code,
          clientId: client.id,
          role: 'host',
          peerCount: 1,
          fileMeta: room.fileMeta,
          playback: room.playback
        });
        return;
      }

      if (room.peers.size >= 2 && !room.peers.has(client.id)) {
        sendWsJson(client, {
          type: 'room_full',
          roomCode: code,
          message: '该私密放映室已满员（仅限 2 人同屏）'
        });
        return;
      }

      client.role = room.peers.size === 0 ? 'host' : 'guest';
      client.roomCode = code;
      client.fileMeta = msg.fileMeta || null;
      room.peers.set(client.id, client);

      sendWsJson(client, {
        type: 'room_joined',
        roomCode: code,
        clientId: client.id,
        role: client.role,
        peerCount: room.peers.size,
        fileMeta: room.fileMeta,
        playback: room.playback
      });

      broadcastToRoom(code, {
        type: 'peer_joined',
        peerId: client.id,
        peerCount: room.peers.size,
        peerFileMeta: client.fileMeta || null
      }, client.id);
      break;
    }

    case 'file_meta': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
      client.fileMeta = msg.fileMeta || null;
      if (client.role === 'host' || !room.fileMeta) {
        room.fileMeta = msg.fileMeta || null;
      }

      // 检查双方是否选择了同名同大小的本地文件（0流量秒切模式）
      let sameFileMatched = false;
      if (room.peers.size === 2) {
        const peersArr = Array.from(room.peers.values());
        const f1 = peersArr[0].fileMeta;
        const f2 = peersArr[1].fileMeta;
        if (f1 && f2 && f1.name && f1.name === f2.name && Number(f1.size) === Number(f2.size) && Number(f1.size) > 0) {
          sameFileMatched = true;
        }
      }

      broadcastToRoom(client.roomCode, {
        type: 'file_meta',
        fromId: client.id,
        role: client.role,
        fileMeta: msg.fileMeta,
        sameFileMatched
      }, client.id);

      if (sameFileMatched) {
        broadcastToRoom(client.roomCode, {
          type: 'same_file_matched',
          fileMeta: room.fileMeta
        });
      }
      break;
    }

    case 'webrtc_offer':
    case 'webrtc_answer':
    case 'webrtc_ice':
    case 'transfer_status':
    case 'peer_speaking':
    case 'chat_reaction': {
      if (!client.roomCode) return;
      broadcastToRoom(client.roomCode, {
        ...msg,
        fromId: client.id
      }, client.id);
      break;
    }

    case 'sync_play':
    case 'sync_pause':
    case 'sync_seek':
    case 'sync_rate':
    case 'sync_heartbeat': {
      const room = rooms.get(client.roomCode);
      if (!room) return;
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
        currentTime: room.playback.currentTime,
        playing: room.playback.playing,
        playbackRate: room.playback.playbackRate,
        sentAt: msg.sentAt || Date.now(),
        serverTime: Date.now()
      }, client.id);
      break;
    }

    case 'ping': {
      sendWsJson(client, { type: 'pong', serverTime: Date.now() });
      break;
    }
  }
}

// 静态文件服务（支持 Range 分段请求）
function serveStaticFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
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
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
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
      // SPA 路由回退到 index.html
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
        // Close frame
        client.closed = true;
        try {
          socket.end(encodeWsFrame(0x08, Buffer.alloc(0)));
        } catch {}
        removeClientFromRoom(client);
        return;
      } else if (opcode === 0x09) {
        // Ping -> Pong
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

// 定期发送 WebSocket Ping 保活，防止 Nginx 或移动网络 NAT 超时断连
setInterval(() => {
  for (const room of rooms.values()) {
    for (const peer of room.peers.values()) {
      if (!peer.closed && peer.socket && !peer.socket.destroyed) {
        try {
          peer.socket.write(encodeWsFrame(0x09, Buffer.alloc(0)));
        } catch {}
      }
    }
  }
}, 25000).unref();

server.listen(PORT, HOST, () => {
  console.log(`[Loamly Watch] 服务已启动: http://${HOST}:${PORT} (WebSocket: ws://${HOST}:${PORT}/ws)`);
});
