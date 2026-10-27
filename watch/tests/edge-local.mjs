// Local harness: runs edge-worker.js with an in-memory fake R2 bucket on port 8788
import http from 'node:http';
import worker from '/workspace/watch-loamly/edge-worker.js';
const store = new Map();
const mk = (key) => { const b = store.get(key); return b && { key, size: b.byteLength, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
const BUCKET = {
  async put(key, buf) { store.set(key, Buffer.from(buf)); },
  async get(key) { return mk(key) || null; },
  async head(key) { const o = mk(key); return o ? { key, size: o.size } : null; },
  async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
  async list({ prefix }) { return { objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(k => ({ key: k, size: store.get(k).byteLength })), truncated: false }; }
};
const PUT_DELAY = parseInt(process.env.PUT_DELAY || '0', 10);
http.createServer(async (req, res) => { try {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = new Headers(); headers.set('cf-connecting-ip', (req.socket.remoteAddress||'').replace('::ffff:','')); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(',') : v);
  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = body;
  if (PUT_DELAY && req.method === 'PUT') await new Promise(r => setTimeout(r, PUT_DELAY));
  const t0 = Date.now();
  const r = await worker.fetch(new Request('http://127.0.0.1:8788' + req.url, init), { BUCKET, DELETE_ALLOW_IPS: process.env.DELETE_ALLOW_IPS || '127.0.0.1' }, {});
  const out = Buffer.from(await r.arrayBuffer());
  const h = {}; r.headers.forEach((v, k) => h[k] = v);
  if (req.method === 'DELETE') console.log('DELETE', req.url, '->', r.status, out.toString()); if (req.method === 'GET' && !req.url.startsWith('/api/ping')) console.log(new Date().toISOString().slice(11,19), req.method, req.url.slice(0, 90), req.headers.range || '', '->', r.status, out.length, (Date.now() - t0) + 'ms');
  res.writeHead(r.status, h); res.end(out);
 } catch (e) { console.log('harness err', e.code || e.message); try { res.destroy(); } catch {} } }).listen(8788, () => console.log('edge-local on 8788'));

process.on('uncaughtException', e => console.log('uncaught', e.code||e.message));
