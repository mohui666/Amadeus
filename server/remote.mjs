import { createServer, request } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// The tunnel reaches this password-protected listener; the local app stays on 3010.
export function createRemoteServer({ origin, username, password, upstream = 'http://127.0.0.1:3010' }) {
  if (!username || !password) throw new Error('远程入口需要用户名和密码。');
  const publicUrl = new URL(origin);
  const target = new URL(upstream);
  const expected = Buffer.from('Basic ' + Buffer.from(`${username}:${password}`).toString('base64'));
  return createServer((req, res) => {
    function reject(status, message) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        ...(status === 401 ? { 'WWW-Authenticate': 'Basic realm="Amadeus", charset="UTF-8"' } : {}) });
      res.end(JSON.stringify({ error: { message } }));
    }
    if (req.headers.host !== publicUrl.host ||
        (req.headers.origin && req.headers.origin !== publicUrl.origin) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      reject(403, '远程请求的地址或来源不匹配。'); return;
    }
    const supplied = Buffer.from(req.headers.authorization || '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      reject(401, '电脑服务登录失败，请在“更改连接”中填写正确的用户名和密码。'); return;
    }
    // Validate the public origin before mapping it to the local server's origin.
    const headers = { ...req.headers, host: target.host };
    delete headers.authorization;
    if (headers.origin) headers.origin = target.origin;
    const upstreamRequest = request({ hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers }, upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
      upstreamResponse.pipe(res);
      upstreamResponse.on('error', () => res.destroy());
    });
    upstreamRequest.on('error', () => {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy();
      else reject(502, '无法连接电脑上的 Amadeus 服务。');
    });
    res.on('close', () => upstreamRequest.destroy());
    req.on('aborted', () => upstreamRequest.destroy());
    req.pipe(upstreamRequest);
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const configPath = fileURLToPath(new URL('../.local/remote/access.json', import.meta.url));
  const server = createRemoteServer(JSON.parse(await readFile(configPath, 'utf8')));
  server.listen(3011, '127.0.0.1', () => console.log('Amadeus password-protected remote listener: 127.0.0.1:3011'));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
