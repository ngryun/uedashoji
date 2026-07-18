// 정적 파일 서버 (Range·조건부 캐시·HEAD 지원 — 동영상 시킹/iOS 재생용)
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8735);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.mp4': 'video/mp4', '.css': 'text/css; charset=utf-8',
};

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function cacheControl(pathname) {
  if (pathname.endsWith('/manifest.json') || pathname.endsWith('.html')) return 'no-cache';
  if (pathname.includes('/assets/') || pathname.includes('/lib/')) return 'public, max-age=86400';
  return 'no-cache';
}

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const isPublicPath = pathname === '/index.html' || pathname === '/main.js' || pathname === '/manifest.json'
    || pathname.startsWith('/lib/')
    || (pathname.startsWith('/assets/') && !pathname.startsWith('/assets/.source-map/'));
  if (!isPublicPath || pathname.split('/').some(part => part.startsWith('.'))) {
    res.writeHead(404); res.end('not found'); return;
  }
  const file = resolve(ROOT, `.${pathname}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) {
    res.writeHead(403); res.end(); return;
  }

  let st;
  try { st = statSync(file); } catch { res.writeHead(404); res.end('not found'); return; }
  if (!st.isFile()) { res.writeHead(404); res.end('not found'); return; }

  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const etag = `"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;
  const commonHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl(pathname),
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };

  if (!req.headers.range && req.headers['if-none-match'] === etag) {
    res.writeHead(304, commonHeaders); res.end(); return;
  }

  let start = 0;
  let end = st.size - 1;
  let status = 200;
  if (req.headers.range) {
    const parsed = parseRange(req.headers.range, st.size);
    if (!parsed) {
      res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${st.size}` });
      res.end();
      return;
    }
    ({ start, end } = parsed);
    status = 206;
  }

  const headers = { ...commonHeaders, 'Content-Length': end - start + 1 };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => { if (!res.destroyed) res.destroy(); });
  stream.pipe(res);
}).listen(PORT, HOST, () => console.log(`museum server: http://localhost:${PORT}`));
