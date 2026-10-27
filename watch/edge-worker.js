const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, X-File-Name, X-File-Size, X-File-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Retry-After, X-Edge-Col",
  "Access-Control-Max-Age": "86400"
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const colo = (request.cf && request.cf.colo) ? String(request.cf.colo) : "EDGE";

    if (url.pathname === "/health" || url.pathname === "/api/ping") {
      return new Response(JSON.stringify({ ok: true, colo, ts: Date.now() }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "X-Edge-Col": colo }
      });
    }

    const room = (url.searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const uploadId = (url.searchParams.get("uploadId") || url.searchParams.get("v") || "default").replace(/[^a-zA-Z0-9_-]/g, "");
    const partSize = parseInt(url.searchParams.get("partSize") || "4194304", 10) || 4194304;
    const totalSize = parseInt(url.searchParams.get("total") || "0", 10) || 0;
    const mimeType = url.searchParams.get("type") || "video/mp4";

    if (!room) {
      return new Response(JSON.stringify({ ok: false, error: "Missing room" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    // GET /api/edge-parts?room=XXXX&uploadId=...  → 已上传完成的分片序号（断点续传用）
    if (url.pathname === "/api/edge-parts") {
      const prefix = `rooms/${room}/${uploadId}/part-`;
      const parts = [];
      let cursor;
      let guard = 0;
      do {
        const listed = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
        for (const o of listed.objects || []) {
          const idx = parseInt(o.key.slice(prefix.length), 10);
          if (!isNaN(idx)) parts.push({ idx, size: o.size });
        }
        cursor = listed.truncated ? listed.cursor : undefined;
        guard++;
      } while (cursor && guard < 50);
      parts.sort((a, b) => a.idx - b.idx);
      return new Response(JSON.stringify({ ok: true, room, uploadId, parts: parts.map((p) => p.idx), sizes: parts.map((p) => p.size) }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Edge-Col": colo }
      });
    }

    // DELETE /api/edge-film?room=XXXX&uploadId=...  → 删掉这部影片的全部分片（仅接受放映服务器发起的清理）
    if (request.method === "DELETE") {
      const allow = String((env && env.DELETE_ALLOW_IPS) || "39.103.98.109").split(",").map((s) => s.trim()).filter(Boolean);
      const ip = request.headers.get("CF-Connecting-IP") || "";
      if (!allow.includes(ip)) {
        return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
          status: 403,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }
      const rawUpload = (url.searchParams.get("uploadId") || "").replace(/[^a-zA-Z0-9_-]/g, "");
      if (!rawUpload) {
        return new Response(JSON.stringify({ ok: false, error: "Missing uploadId" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }
      const prefix = `rooms/${room}/${rawUpload}/`;
      let deleted = 0;
      let cursor;
      let guard = 0;
      do {
        const listed = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
        const keys = (listed.objects || []).map((o) => o.key);
        if (keys.length) {
          await env.BUCKET.delete(keys);
          deleted += keys.length;
        }
        cursor = listed.truncated ? listed.cursor : undefined;
        guard++;
      } while (cursor && guard < 50);
      return new Response(JSON.stringify({ ok: true, room, uploadId: rawUpload, deleted }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Edge-Col": colo }
      });
    }

    // PUT /api/edge-film?room=XXXX&uploadId=...&offset=...&partSize=4194304&total=...
    if (request.method === "PUT" || request.method === "POST") {
      const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;
      const partIdx = Math.floor(offset / partSize);
      const key = `rooms/${room}/${uploadId}/part-${partIdx}`;
      const bodyBuf = await request.arrayBuffer();
      await env.BUCKET.put(key, bodyBuf, {
        httpMetadata: { contentType: mimeType }
      });
      return new Response(JSON.stringify({
        ok: true,
        colo,
        room,
        uploadId,
        partIdx,
        offset,
        bytes: bodyBuf.byteLength
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "X-Edge-Col": colo }
      });
    }

    // GET / HEAD streaming by HTTP Range across 4MB R2 parts
    if (request.method === "GET" || request.method === "HEAD") {
      if (totalSize <= 0) {
        return new Response("Missing total size", { status: 400, headers: CORS_HEADERS });
      }

      const rangeHeader = request.headers.get("Range") || request.headers.get("range");
      if (request.method === "HEAD" && !rangeHeader) {
        return new Response(null, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": mimeType,
            "Accept-Ranges": "bytes",
            "Content-Length": String(totalSize),
            "X-Edge-Col": colo
          }
        });
      }

      let start = 0;
      let hasExplicitEnd = false;
      let reqEnd = totalSize - 1;

      if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
        if (m) {
          if (m[1] === "" && m[2] !== "") {
            const suffix = parseInt(m[2], 10);
            start = Math.max(0, totalSize - suffix);
            reqEnd = totalSize - 1;
            hasExplicitEnd = true;
          } else {
            start = parseInt(m[1] || "0", 10);
            if (m[2] !== "") {
              reqEnd = Math.min(totalSize - 1, parseInt(m[2], 10));
              hasExplicitEnd = true;
            }
          }
        }
      }

      if (isNaN(start) || start < 0 || start >= totalSize || reqEnd < start) {
        return new Response(null, {
          status: 416,
          headers: {
            ...CORS_HEADERS,
            "Content-Range": `bytes */${totalSize}`,
            "Cache-Control": "no-store"
          }
        });
      }

      // 等待某个分片上传完成：最长 waitMs，轮询间隔 400ms 逐步放宽到 1000ms（仅 head，省读流量）
      const getPartWithWait = async (pIdx, waitMs) => {
        const key = `rooms/${room}/${uploadId}/part-${pIdx}`;
        const first = await env.BUCKET.get(key);
        if (first) return first;
        const deadline = Date.now() + Math.max(0, waitMs);
        let interval = 400;
        while (Date.now() < deadline) {
          await sleep(Math.min(interval, Math.max(50, deadline - Date.now())));
          interval = Math.min(1000, interval + 150);
          const meta = await env.BUCKET.head(key);
          if (meta) {
            const obj = await env.BUCKET.get(key);
            if (obj) return obj;
          }
        }
        return null;
      };

      const notYetResponse = (retryAfterSec) => new Response(JSON.stringify({ ok: false, pending: true, retryAfter: retryAfterSec }), {
        status: 503,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": String(retryAfterSec),
          "Cache-Control": "no-store",
          "X-Edge-Col": colo
        }
      });

      const firstPartIdx = Math.floor(start / partSize);
      const firstPartStart = firstPartIdx * partSize;
      const offsetInFirst = start - firstPartStart;

      const obj0 = await getPartWithWait(firstPartIdx, 45000);
      if (!obj0) {
        // 该段还在上传：告诉播放器稍后重试，而不是 416（416 会让浏览器判定影片损坏）
        return notYetResponse(2);
      }

      const buf0 = await obj0.arrayBuffer();
      if (offsetInFirst >= buf0.byteLength) {
        return new Response(null, {
          status: 416,
          headers: {
            ...CORS_HEADERS,
            "Content-Range": `bytes */${totalSize}`,
            "Cache-Control": "no-store"
          }
        });
      }

      const maxEndInFirst = Math.min(buf0.byteLength - 1, reqEnd - firstPartStart);
      const slice0 = new Uint8Array(buf0, offsetInFirst, maxEndInFirst - offsetInFirst + 1);

      let finalBytes = slice0;
      const nextPartIdx = firstPartIdx + 1;
      const nextPartStart = nextPartIdx * partSize;

      // If request explicitly crosses into nextPartIdx (e.g. tail moov crossing boundary), or slice0 is small (<1MB) and next part exists
      if (nextPartStart < totalSize && reqEnd >= nextPartStart) {
        const needWaitMs = (hasExplicitEnd && (reqEnd - start) <= partSize * 2) ? 10000 : (slice0.byteLength < 1048576 ? 800 : 0);
        if (needWaitMs > 0 || (hasExplicitEnd && reqEnd >= nextPartStart)) {
          const obj1 = await getPartWithWait(nextPartIdx, needWaitMs);
          if (obj1) {
            const buf1 = await obj1.arrayBuffer();
            const maxEndInSecond = Math.min(buf1.byteLength - 1, reqEnd - nextPartStart);
            if (maxEndInSecond >= 0) {
              const slice1 = new Uint8Array(buf1, 0, maxEndInSecond + 1);
              const combined = new Uint8Array(slice0.byteLength + slice1.byteLength);
              combined.set(slice0, 0);
              combined.set(slice1, slice0.byteLength);
              finalBytes = combined;
            }
          }
        }
      }

      const actualEnd = start + finalBytes.byteLength - 1;
      const headers = {
        ...CORS_HEADERS,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${actualEnd}/${totalSize}`,
        "Content-Length": String(finalBytes.byteLength),
        "Cache-Control": "public, max-age=3600",
        "X-Edge-Col": colo
      };

      if (request.method === "HEAD") {
        return new Response(null, { status: 206, headers });
      }
      return new Response(finalBytes, { status: 206, headers });
    }

    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }
};