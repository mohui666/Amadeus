import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server/index.mjs';
import { defaults, readSettings, persistSettings } from '../src/config.js';

async function start(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function mock(t, respond) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ path: req.url, headers: req.headers, body, json: req.headers['content-type']?.includes('application/json') ? JSON.parse(body) : null });
    respond(res, requests.at(-1));
  });
  return { url: await start(t, server), requests };
}

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  // Split through UTF-8 bytes and CRLF boundaries to exercise streaming decoding.
  const data = Buffer.from(events.map(value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\r\n\r\n`).join(''));
  for (let i = 0; i < data.length; i += 7) res.write(data.subarray(i, i + 7));
  res.end();
}

function post(url, path, body, options = {}) {
  return fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options });
}

function events(text) {
  return text.trim().split('\n\n').map(block => {
    const lines = block.split('\n');
    return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) };
  });
}

const image = 'data:image/png;base64,aW1hZ2U=';
const messages = [{ role: 'user', content: '看看这张图片。', image }, { role: 'assistant', content: '让我看看。' }, { role: 'user', content: '有什么想法？' }];

test('OpenAI-compatible forwards image, key, history and normalizes UTF-8 SSE', async t => {
  const upstream = await mock(t, res => sse(res, [{ choices: [{ delta: { content: '[emotion:happy]\n' } }] }, { choices: [{ delta: { content: '你好，实验助手。' }, finish_reason: 'stop' }] }, '[DONE]']));
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/chat', { config: { chat: { provider: 'openai', baseUrl: upstream.url + '/v1/', apiKey: 'test-secret', model: 'mock-vision' } }, messages, persona: '偏爱简短对话。' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const output = events(await response.text());
  assert.deepEqual(output.map(e => e.event), ['delta', 'delta', 'done']);
  assert.equal(output[1].data.text, '你好，实验助手。');
  const req = upstream.requests[0];
  assert.equal(req.path, '/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer test-secret');
  assert.equal(req.json.model, 'mock-vision');
  assert.equal(req.json.stream, true);
  assert.match(req.json.messages[0].content, /偏爱简短对话/);
  assert.equal(req.json.messages[1].content[1].image_url.url, image);
  assert.equal(req.json.messages[2].role, 'assistant');
});

test('Anthropic uses system field, image source and named text events', async t => {
  const upstream = await mock(t, res => sse(res, [{ type: 'message_start' }, { type: 'content_block_start', content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: '理论需要验证。' } }, { type: 'message_stop' }]));
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/chat', { config: { chat: { provider: 'anthropic', baseUrl: upstream.url + '/v1', apiKey: 'claude-key', model: 'mock-claude' } }, messages });
  assert.deepEqual(events(await response.text()), [{ event: 'delta', data: { text: '理论需要验证。' } }, { event: 'done', data: {} }]);
  const req = upstream.requests[0];
  assert.equal(req.path, '/v1/messages');
  assert.equal(req.headers['x-api-key'], 'claude-key');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.json.max_tokens, 2048);
  assert.match(req.json.system, /牧濑红莉栖/);
  assert.deepEqual(req.json.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } });
});

test('Responses forwards instructions, images, history and streams text deltas', async t => {
  const upstream = await mock(t, res => sse(res, [
    { type: 'response.created' },
    { type: 'response.output_text.delta', delta: '看见了。' },
    { type: 'response.completed', response: { status: 'completed' } },
  ]));
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/chat', { config: { chat: { provider: 'responses', baseUrl: upstream.url + '/v1', apiKey: 'test-key', model: 'mock-vision', reasoningEffort: 'low' } }, messages });
  assert.deepEqual(events(await response.text()), [{ event: 'delta', data: { text: '看见了。' } }, { event: 'done', data: {} }]);
  const req = upstream.requests[0];
  assert.equal(req.path, '/v1/responses');
  assert.equal(req.headers.authorization, 'Bearer test-key');
  assert.equal(req.json.model, 'mock-vision');
  assert.equal(req.json.store, false);
  assert.equal(req.json.stream, true);
  assert.deepEqual(req.json.reasoning, { effort: 'low' });
  assert.equal(req.json.input[1].role, 'assistant');
  assert.equal(req.json.input[1].content, messages[1].content);
  assert.deepEqual(req.json.input[0].content[1], { type: 'input_image', image_url: image });
  assert.match(req.json.instructions, /牧濑红莉栖/);
});

test('Responses incomplete and failed events do not report successful completion', async t => {
  for (const event of [
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
    { type: 'response.failed', response: { error: { message: 'generation failed' } } },
    { type: 'error', message: 'stream failed' },
  ]) {
    const upstream = await mock(t, res => sse(res, [{ type: 'response.output_text.delta', delta: '部分回答' }, event]));
    const url = await start(t, createAppServer());
    const response = await post(url, '/api/chat', { config: { chat: { provider: 'responses', baseUrl: upstream.url, model: 'mock' } }, messages });
    assert.deepEqual(events(await response.text()).map(e => e.event), ['delta', 'error']);
  }
});

test('local STT stays on the computer and does not forward API credentials', async t => {
  const upstream = await mock(t, res => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: '现在听得到吗？' })); });
  const previous = process.env.AMADEUS_STT_URL;
  process.env.AMADEUS_STT_URL = upstream.url + '/v1';
  t.after(() => { if (previous === undefined) delete process.env.AMADEUS_STT_URL; else process.env.AMADEUS_STT_URL = previous; });
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/transcribe', { config: { stt: { provider: 'local', baseUrl: 'https://api.openai.com/v1', apiKey: 'must-stay-local', model: 'whisper-1', language: 'zh' } }, audio: Buffer.from('audio-payload').toString('base64'), mimeType: 'audio/webm;codecs=opus' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, '现在听得到吗？');
  const req = upstream.requests[0];
  assert.equal(req.path, '/v1/audio/transcriptions');
  assert.equal(req.headers.authorization, undefined);
  const form = await new Response(req.body, { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
  assert.equal(form.get('model'), 'base');
  assert.equal(form.get('language'), 'zh');
  assert.equal(await form.get('file').text(), 'audio-payload');
});

test('OpenAI STT without a key returns an actionable local error', async t => {
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/transcribe', { config: { stt: { provider: 'openai', model: 'whisper-1' } }, audio: 'YXVkaW8=' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /电脑本地识别/);
});

test('old default STT settings are repaired without changing custom APIs or later choices', t => {
  let saved;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved, setItem: (_, value) => { saved = value; } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  assert.equal(readSettings().stt.provider, 'local');
  for (const provider of ['browser', 'openai']) {
    const value = { chat: { model: 'keep-chat' }, stt: { ...defaults.stt, provider }, language: 'ja-JP' };
    saved = JSON.stringify(value);
    const repaired = readSettings();
    assert.equal(repaired.stt.provider, 'local');
    assert.equal(repaired.chat.model, 'keep-chat');
    assert.equal(repaired.language, 'ja-JP');
    persistSettings({ ...repaired, stt: { ...repaired.stt, provider: 'browser' } });
    assert.equal(readSettings().stt.provider, 'browser');
  }
  saved = JSON.stringify({ stt: { provider: 'openai', baseUrl: 'http://custom.test/v1', model: 'custom' } });
  assert.equal(readSettings().stt.baseUrl, 'http://custom.test/v1');
  assert.equal(readSettings().stt.provider, 'openai');
});

test('STT sends real multipart audio bytes and returns transcription text', async t => {
  const upstream = await mock(t, res => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: '现在听得到吗？' })); });
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/transcribe', { config: { stt: { provider: 'openai', baseUrl: upstream.url + '/v1', apiKey: 'stt-key', model: 'mock-whisper', language: 'zh' } }, audio: Buffer.from('audio-payload').toString('base64'), mimeType: 'audio/webm;codecs=opus' });
  assert.deepEqual(await response.json(), { text: '现在听得到吗？' });
  const req = upstream.requests[0];
  assert.equal(req.path, '/v1/audio/transcriptions');
  assert.equal(req.headers.authorization, 'Bearer stt-key');
  assert.match(req.headers['content-type'], /multipart\/form-data; boundary=/);
  const form = await new Response(req.body, { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
  assert.equal(form.get('model'), 'mock-whisper');
  assert.equal(form.get('language'), 'zh');
  assert.equal(form.get('file').name, 'recording.webm');
  assert.equal(await form.get('file').text(), 'audio-payload');
});

for (const provider of ['openai', 'elevenlabs', 'gpt-sovits', 'qwen-tts']) {
  test(`${provider} TTS forwards expected payload and returns binary audio`, async t => {
    const audio = Buffer.from([82, 73, 70, 70, 0, 255, 5, 128]);
    const mime = provider === 'gpt-sovits' ? 'audio/wav' : 'audio/mpeg';
    const upstream = await mock(t, res => { res.writeHead(200, { 'Content-Type': mime }); res.end(audio); });
    const url = await start(t, createAppServer());
    const response = await post(url, '/api/speech', { config: { tts: { provider, baseUrl: upstream.url, apiKey: 'tts-key', model: 'mock-tts', voice: 'voice-01', speed: 1.1, referenceAudio: '/voices/reference.wav', promptText: 'こんにちは。', promptLang: 'ja', textLang: 'zh' } }, text: '今天的实验开始吧。' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), mime);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
    const req = upstream.requests[0];
    if (provider === 'openai' || provider === 'qwen-tts') {
      assert.equal(req.path, '/audio/speech');
      assert.equal(req.headers.authorization, 'Bearer tts-key');
      assert.deepEqual(req.json, { model: 'mock-tts', input: '今天的实验开始吧。', voice: 'voice-01', response_format: 'mp3', speed: 1.1, ...(provider === 'qwen-tts' ? { language: 'Chinese' } : {}) });
    } else if (provider === 'elevenlabs') {
      assert.equal(req.path, '/text-to-speech/voice-01');
      assert.equal(req.headers['xi-api-key'], 'tts-key');
      assert.deepEqual(req.json, { text: '今天的实验开始吧。', model_id: 'mock-tts', voice_settings: { speed: 1.1 } });
    } else {
      assert.equal(req.path, '/tts');
      assert.equal(req.json.ref_audio_path, '/voices/reference.wav');
      assert.equal(req.json.prompt_text, 'こんにちは。');
      assert.equal(req.json.prompt_lang, 'ja');
      assert.equal(req.json.text_lang, 'zh');
      assert.equal(req.json.media_type, 'wav');
      assert.equal(req.json.streaming_mode, false);
      assert.equal(req.json.speed_factor, 1.1);
    }
  });
}

test('upstream HTTP errors are reported without exposing the supplied key', async t => {
  const upstream = await mock(t, res => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Invalid key secret-must-not-leak' } })); });
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/chat', { config: { chat: { baseUrl: upstream.url, model: 'mock', apiKey: 'secret-must-not-leak' } }, messages });
  const text = await response.text();
  assert.doesNotMatch(text, /secret-must-not-leak/);
  assert.match(text, /401/);
  assert.deepEqual(events(text).map(e => e.event), ['error']);
  const speech = await post(url, '/api/speech', { config: { tts: { baseUrl: upstream.url, model: 'mock', voice: 'voice', apiKey: 'secret-must-not-leak' } }, text: 'hi' });
  assert.equal(speech.status, 401);
  const speechError = JSON.stringify(await speech.json());
  assert.doesNotMatch(speechError, /secret-must-not-leak/);
  assert.match(speechError, /语音服务鉴权失败/);
});

test('Modal speech with a cleared key explains session-only credentials before making a request', async t => {
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/speech', { config: { tts: { provider: 'qwen-tts', baseUrl: 'https://example.modal.run/v1', model: 'kurisu', voice: 'kurisu', apiKey: '' } }, text: 'こんにちは。' });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.match(result.error.message, /尚未填写 Modal 语音 API Key/);
  assert.match(result.error.message, /重新打开 App 后需重新填写/);
});

test('stream errors and early EOF are not reported as successful completion', async t => {
  for (const payload of [[{ error: { message: 'Overloaded' } }], [{ choices: [{ delta: { content: '未完成' } }] }]]) {
    const upstream = await mock(t, res => sse(res, payload));
    const url = await start(t, createAppServer());
    const response = await post(url, '/api/chat', { config: { chat: { baseUrl: upstream.url, model: 'mock' } }, messages });
    const result = events(await response.text());
    assert.equal(result.at(-1).event, 'error');
    assert.equal(result.some(e => e.event === 'done'), false);
  }
});

test('rejects cross-origin requests, unexpected Host and form posts', async t => {
  const url = await start(t, createAppServer());
  assert.deepEqual(await (await fetch(url + '/api/health')).json(), { status: 'ok' });
  for (const headers of [{ Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await post(url, '/api/chat', {}, { headers: { 'Content-Type': 'application/json', ...headers } });
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(url + '/api/health', { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(invalidHostStatus, 403);
  const sameOrigin = await post(url, '/api/chat', {}, { headers: { 'Content-Type': 'application/json', Origin: url } });
  assert.equal(sameOrigin.status, 200);
  assert.equal(events(await sameOrigin.text())[0].event, 'error');
  assert.equal((await fetch(url + '/api/chat', { method: 'POST', body: 'form=yes' })).status, 415);
  assert.equal((await fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
});

test('limits request bodies before accepting oversized audio or images', async t => {
  const url = await start(t, createAppServer());
  const response = await post(url, '/api/transcribe', { audio: 'a'.repeat(25 * 1024 * 1024) });
  assert.equal(response.status, 413);
});

test('client disconnect cancels an active upstream generation', { timeout: 5000 }, async t => {
  let closed;
  const upstreamClosed = new Promise(resolve => { closed = resolve; });
  const upstream = await mock(t, res => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n');
    res.on('close', closed);
  });
  const url = await start(t, createAppServer());
  const controller = new AbortController();
  const response = await post(url, '/api/chat', { config: { chat: { baseUrl: upstream.url, model: 'mock' } }, messages }, { signal: controller.signal });
  await response.body.getReader().read();
  controller.abort();
  await upstreamClosed;
});

test('serves built files and SPA routes without reading outside dist', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-api-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Amadeus</title>');
  await writeFile(join(directory, 'test.js'), 'export const ready = true;');
  const url = await start(t, createAppServer({ distDir: directory }));
  assert.match(await (await fetch(url + '/')).text(), /Amadeus/);
  assert.match(await (await fetch(url + '/conversation')).text(), /Amadeus/);
  assert.equal((await fetch(url + '/test.js', { method: 'HEAD' })).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(url + '/missing.png')).status, 404);
  assert.equal((await fetch(url + '/..%2f..%2fetc%2fpasswd')).status, 403);
});

test('account and login routes invoke the account bridge without exposing credentials', async t => {
  const calls = [];
  const codex = {
    getAccount: async () => ({ available: true, loggedIn: false, type: null, planType: null }),
    startLogin: async type => { calls.push(['start', type]); return { loginId: 'mock-login', verificationUrl: 'https://auth.openai.com/codex/device' }; },
    cancelLogin: async loginId => { calls.push(['cancel', loginId]); return { cancelled: true }; },
  };
  const url = await start(t, createAppServer({ codex }));
  assert.deepEqual(await (await fetch(url + '/api/account')).json(), { available: true, loggedIn: false, type: null, planType: null });
  assert.equal((await (await post(url, '/api/login', { type: 'chatgptDeviceCode' })).json()).loginId, 'mock-login');
  assert.deepEqual(await (await post(url, '/api/login/cancel', { loginId: 'mock-login' })).json(), { cancelled: true });
  assert.deepEqual(calls, [['start', 'chatgptDeviceCode'], ['cancel', 'mock-login']]);
  assert.equal((await post(url, '/api/login', {}, { headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' } })).status, 403);
});

test('ChatGPT account conversations retain persona, image and stream through the same SSE contract', async t => {
  let received;
  const codex = { chatCodex: async args => { received = args; args.onDelta('[emotion:thinking]\n'); args.onDelta('来验证一下这个假设。'); return { text: '来验证一下这个假设。', model: 'mock-codex' }; } };
  const url = await start(t, createAppServer({ codex }));
  const response = await post(url, '/api/chat', { config: { chat: { provider: 'chatgpt', model: '', reasoningEffort: 'low' }, replyMode: 'ja-zh', persona: '科学地讨论。' }, messages });
  assert.deepEqual(events(await response.text()).map(event => event.event), ['delta', 'delta', 'done']);
  assert.equal(received.model, undefined);
  assert.equal(received.reasoningEffort, 'low');
  assert.equal(received.messages[0].image, image);
  assert.match(received.systemPrompt, /科学地讨论/);
  assert.match(received.systemPrompt, /\[speech:ja\]/);
  assert.ok(received.signal instanceof AbortSignal);
});

test('settings routes expose actual account models and the installed local voice preset', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-voice-'));
  t.after(() => rm(directory, { recursive: true }));
  const voiceConfigPath = join(directory, 'client-config.json');
  const qwenVoiceConfigPath = join(directory, 'qwen-config.json');
  const models = [{ model: 'gpt-5.6-sol', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }];
  const url = await start(t, createAppServer({ voiceConfigPath, qwenVoiceConfigPath, codex: { getModels: async () => models } }));
  assert.deepEqual(await (await fetch(url + '/api/models')).json(), { models });
  assert.deepEqual(await (await fetch(url + '/api/local-voice')).json(), { configured: false });
  const config = { provider: 'gpt-sovits', baseUrl: 'http://127.0.0.1:9880', referenceAudio: '/voices/kurisu.wav', promptText: 'こんにちは。', promptLang: 'ja', textLang: 'ja' };
  await writeFile(voiceConfigPath, JSON.stringify(config));
  assert.deepEqual(await (await fetch(url + '/api/local-voice')).json(), { configured: true, config });
  assert.deepEqual(await (await fetch(url + '/api/local-voice?engine=qwen-tts')).json(), { configured: false });
  const qwenConfig = { provider: 'qwen-tts', baseUrl: 'http://127.0.0.1:19882/v1', model: 'kurisu', voice: 'kurisu' };
  await writeFile(qwenVoiceConfigPath, JSON.stringify(qwenConfig));
  assert.deepEqual(await (await fetch(url + '/api/local-voice?engine=qwen-tts')).json(), { configured: true, config: qwenConfig });
});
