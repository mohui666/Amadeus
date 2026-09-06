import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { createRemoteServer } from '../server/remote.mjs';

async function start(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const origin = 'https://amadeus.example.test';
const authorization = 'Basic ' + Buffer.from('amadeus:fixture-password').toString('base64');

// Node fetch manages Host itself; use real HTTP headers to exercise the public host.
function remoteFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, res => resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers })));
    req.on('error', reject); req.end();
  });
}

test('remote password and origin checks prevent unauthenticated account access', async t => {
  const received = [];
  const upstream = await start(t, createServer((req, res) => {
    received.push(req.headers);
    res.setHeader('Content-Type', 'application/json'); res.end('{"loggedIn":true}');
  }));
  const gateway = await start(t, createRemoteServer({ origin, username: 'amadeus', password: 'fixture-password', upstream }));
  for (const path of ['/', '/api/health', '/api/account', '/api/chat', '/api/speech']) {
    const denied = await remoteFetch(gateway + path, { headers: { Host: 'amadeus.example.test' } });
    assert.equal(denied.status, 401); assert.match(denied.headers.get('www-authenticate'), /Basic/);
  }
  const wrong = await remoteFetch(gateway + '/api/account', { headers: { Host: 'amadeus.example.test', Authorization: authorization + 'wrong' } });
  assert.equal(wrong.status, 401);
  const foreign = await remoteFetch(gateway + '/api/account', { headers: { Host: 'amadeus.example.test', Authorization: authorization, Origin: 'https://another.site' } });
  assert.equal(foreign.status, 403); assert.equal(received.length, 0);
  const good = await remoteFetch(gateway + '/api/account', { headers: { Host: 'amadeus.example.test', Authorization: authorization, Origin: origin } });
  assert.equal(good.status, 200); assert.deepEqual(await good.json(), { loggedIn: true });
  assert.equal(received[0].authorization, undefined);
  assert.equal(received[0].host, new URL(upstream).host); assert.equal(received[0].origin, upstream);
});

test('remote forwarding preserves incremental text and binary speech', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const wav = Buffer.from([82, 73, 70, 70, 0, 255, 128, 0]);
  const upstream = await start(t, createServer(async (req, res) => {
    if (req.url === '/api/speech') { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('event: delta\ndata: {"text":"你好"}\n\n');
    await gate;
    res.end('event: done\ndata: {}\n\n');
  }));
  const gateway = await start(t, createRemoteServer({ origin, username: 'amadeus', password: 'fixture-password', upstream }));
  const headers = { Host: 'amadeus.example.test', Authorization: authorization, Origin: origin };
  const text = await remoteFetch(gateway + '/api/chat', { method: 'POST', headers });
  const reader = text.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /你好/);
  release();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: done/);
  const speech = await remoteFetch(gateway + '/api/speech', { method: 'POST', headers });
  assert.equal(speech.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await speech.arrayBuffer()), wav);
});
