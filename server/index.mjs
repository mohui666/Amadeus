import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError, chat, speech, transcribe } from './providers.mjs';
import * as defaultCodex from './codex.mjs';
import { processMemory } from './memory.mjs';

const BODY_LIMIT = 24 * 1024 * 1024;
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function checkOrigin(req) {
  const host = new URL(`http://${req.headers.host}`).hostname;
  const allowed = ['localhost', '127.0.0.1', '[::1]', process.env.HOST].filter(Boolean);
  if (!allowed.includes(host)) throw new ApiError(403, '不允许的访问主机，请使用 localhost 或配置的 HOST。');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'API 仅接受同源请求。');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); }
    catch { throw new ApiError(403, '无效的请求来源。'); }
    if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) throw new ApiError(403, 'API 仅接受同源请求。');
  }
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new ApiError(415, '请求必须使用 application/json。');
  let length = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > BODY_LIMIT) throw new ApiError(413, '请求超过 24 MB，请缩短录音或压缩图片。');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('object required');
    return data;
  } catch { throw new ApiError(400, '请求 JSON 格式错误。'); }
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function serveStatic(req, res, pathname, distDir) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new ApiError(400, '路径格式错误。'); }
  let file = resolve(distDir, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!file.startsWith(distDir + sep)) throw new ApiError(403, '禁止访问此路径。');
  let info;
  try { info = await stat(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (extname(decoded)) throw new ApiError(404, '文件不存在。');
    file = resolve(distDir, 'index.html');
    try { info = await stat(file); }
    catch (missing) {
      if (missing.code !== 'ENOENT') throw missing;
      throw new ApiError(404, '前端尚未构建，请先运行 npm run build，或使用 npm run dev。');
    }
  }
  if (!info.isFile()) throw new ApiError(404, '文件不存在。');
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': info.size });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(file), res);
}

export function createAppServer({ distDir = fileURLToPath(new URL('../dist', import.meta.url)), codex = defaultCodex, voiceConfigPath = fileURLToPath(new URL('../.local/voice/client-config.json', import.meta.url)), qwenVoiceConfigPath = fileURLToPath(new URL('../.local/qwen-tts/client-config.json', import.meta.url)) } = {}) {
  const root = resolve(distDir);
  const server = createServer(async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      checkOrigin(req);
      const requestUrl = new URL(req.url, 'http://localhost');
      const path = requestUrl.pathname;
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { status: 'ok' });
      if (req.method === 'GET' && path === '/api/account') return json(res, 200, await codex.getAccount());
      if (req.method === 'GET' && path === '/api/models') {
        try { return json(res, 200, { models: await codex.getModels() }); }
        catch (error) { throw new ApiError(error.status || 502, error.message); }
      }
      if (req.method === 'GET' && path === '/api/local-voice') {
        let config;
        const engine = requestUrl.searchParams.get('engine') || process.env.AMADEUS_VOICE_ENGINE;
        try { config = JSON.parse(await readFile(engine === 'qwen-tts' ? qwenVoiceConfigPath : voiceConfigPath, 'utf8')); }
        catch (error) {
          if (error.code === 'ENOENT') return json(res, 200, { configured: false });
          throw error;
        }
        return json(res, 200, { configured: true, config });
      }
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, '不支持的请求方法。');
        return await serveStatic(req, res, path, root);
      }
      if (!['/api/chat', '/api/memory', '/api/transcribe', '/api/speech', '/api/login', '/api/login/cancel'].includes(path)) throw new ApiError(404, 'API 不存在。');
      if (req.method !== 'POST') throw new ApiError(405, '此接口需要 POST 请求。');
      const body = await readJson(req);
      if (path === '/api/memory') return json(res, 200, await processMemory(body, controller.signal, codex));
      if (path === '/api/login' || path === '/api/login/cancel') {
        try {
          return json(res, 200, path === '/api/login' ? await codex.startLogin(body.type) : await codex.cancelLogin(body.loginId));
        } catch (error) { throw new ApiError(error.status || 502, error.message); }
      }
      if (path === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        for await (const text of chat(body, controller.signal, codex)) sendEvent(res, 'delta', { text });
        sendEvent(res, 'done', {});
        res.end();
      } else if (path === '/api/transcribe') {
        json(res, 200, await transcribe(body, controller.signal));
      } else {
        const result = await speech(body, controller.signal);
        res.writeHead(200, { 'Content-Type': result.contentType, 'Cache-Control': 'no-store' });
        await pipeline(Readable.fromWeb(result.body), res, { signal: controller.signal });
      }
    } catch (error) {
      if (res.destroyed || controller.signal.aborted) return;
      const message = error instanceof ApiError ? error.message : '处理请求失败，请检查 API 返回格式与服务状态。';
      if (res.headersSent) { sendEvent(res, 'error', { message }); res.end(); }
      else json(res, error instanceof ApiError ? error.status : 500, { error: { message } });
    }
  });
  server.on('close', () => { codex.closeCodex?.(); });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 3010);
  const host = process.env.HOST || '127.0.0.1';
  const server = createAppServer();
  server.listen(port, host, () => console.log(`Amadeus server: http://${host}:${port}`));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
