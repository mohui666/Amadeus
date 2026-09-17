import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const routes = [
  ['/fine-model/', resolve(root, 'experiments/live2d-authoring/fine/model/runtime')],
  ['/fine/', resolve(root, 'experiments/live2d-authoring/fine/demo')],
  ['/authored-model/', resolve(root, 'experiments/live2d-authoring/model/runtime')],
  ['/authored/', resolve(root, 'experiments/live2d-authoring/demo')],
  ['/model/', resolve(root, '.local/live2d/models/Kurisu')],
  ['/vendor/', resolve(root, '.local/live2d/vendor')],
  ['/voice/', resolve(root, 'public/assets/voice')],
  ['/original/', resolve(root, 'public/assets/kurisu')],
  ['/', resolve(root, 'experiments/live2d')],
];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.moc3': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const [prefix, directory] = routes.find(([prefix]) => pathname.startsWith(prefix));
    const relative = pathname === '/' ? 'index.html' : pathname.slice(prefix.length);
    const file = resolve(directory, relative);
    if (!file.startsWith(directory + sep)) { res.writeHead(403).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': info.size });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(file), res);
  } catch (error) {
    if (res.headersSent) { res.destroy(error); return; }
    const status = error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(status === 500 ? error.message : '文件不存在或路径无效。');
  }
});
server.listen(3012, '127.0.0.1', () => console.log('Live2D testcase: http://127.0.0.1:3012/'));
