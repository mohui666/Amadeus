import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { stat } from 'node:fs/promises';
import { createCodexBridge } from '../server/codex.mjs';

const defaultModels = [{
  id: 'test-model', model: 'test-model', displayName: 'Test model', description: 'Default model',
  isDefault: true, defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'medium', description: 'Balanced' }],
}];

function mockCodex({ holdTurn = false, holdExit = false, turnError, models = defaultModels, account = { type: 'chatgpt', email: 'private@example.test', planType: 'plus' } } = {}) {
  const calls = [], events = new EventEmitter();
  let process, spawnOptions;
  const emit = message => process.stdout.write(`${JSON.stringify(message)}\n`);
  const exit = () => { process.emit('exit', 0); process.stdout.end(); process.stderr.end(); };
  const bridge = createCodexBridge({ spawnProcess(binary, args, options) {
    spawnOptions = { binary, args, options };
    process = new EventEmitter();
    process.stdout = new PassThrough();
    process.stderr = new PassThrough();
    process.killed = false;
    process.kill = () => { process.killed = true; if (!holdExit) exit(); };
    process.stdin = new Writable({ write(chunk, encoding, done) {
      const message = JSON.parse(chunk.toString()); calls.push(message);
      queueMicrotask(() => {
        if (!message.method) { events.emit('response', message); return; }
        events.emit(message.method, message);
        const { id, method, params } = message;
        if (id === undefined) return;
        let result = {};
        if (method === 'account/read') result = { account };
        if (method === 'config/read') result = { config: { mcp_servers: { private_connector: { enabled: true } } } };
        if (method === 'model/list') result = { data: models, nextCursor: null };
        if (method === 'account/login/start') result = params.type === 'chatgpt'
          ? { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/authorize?test=true' }
          : { type: 'chatgptDeviceCode', loginId: 'login-2', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-CODE' };
        if (method === 'account/login/cancel') result = { status: 'canceled' };
        if (method === 'thread/start') result = { thread: { id: 'thread-1', ephemeral: true }, model: params.model };
        if (method === 'turn/start') result = { turn: { id: 'turn-1' } };
        emit({ id, result });
        if (method === 'turn/start') {
          emit({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
          if (!holdTurn) {
            emit({ method: 'item/agentMessage/delta', params: { threadId: 'unrelated-thread', delta: '不能泄漏' } });
            emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', delta: '[emotion:happy]\n' } });
            emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', delta: '你好。' } });
            emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: turnError ? 'failed' : 'completed', ...(turnError ? { error: turnError } : {}) } } });
          }
        }
      });
      done();
    } });
    return process;
  } });
  return { bridge, calls, emit, events, exit, get spawnOptions() { return spawnOptions; } };
}

test('shutdown waits for the Codex process to release its working directory before removal', async () => {
  const mock = mockCodex({ holdExit: true });
  await mock.bridge.getAccount();
  let completed = false;
  const closing = mock.bridge.closeCodex().then(() => { completed = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    assert.ok((await stat(mock.spawnOptions.options.cwd)).isDirectory());
  } finally { mock.exit(); await closing; }
  await assert.rejects(stat(mock.spawnOptions.options.cwd), { code: 'ENOENT' });
});

test('account status excludes email and never starts login automatically', async t => {
  const mock = mockCodex(); t.after(() => mock.bridge.closeCodex());
  assert.equal(mock.spawnOptions, undefined, 'process starts lazily');
  assert.deepEqual(await mock.bridge.getAccount(), { available: true, loggedIn: true, type: 'chatgpt', planType: 'plus' });
  assert.equal(mock.calls.some(call => call.method === 'account/login/start'), false);
  assert.ok(mock.spawnOptions.args.includes('features.shell_tool=false'));
});

test('browser and device-code login are explicit and cancellable', async t => {
  const mock = mockCodex({ account: null }); t.after(() => mock.bridge.closeCodex());
  assert.equal((await mock.bridge.getAccount()).loggedIn, false);
  const browser = await mock.bridge.startLogin('chatgpt');
  assert.equal(browser.authUrl, 'https://auth.openai.com/authorize?test=true');
  assert.deepEqual(await mock.bridge.cancelLogin(browser.loginId), { status: 'canceled' });
  const device = await mock.bridge.startLogin('chatgptDeviceCode');
  assert.equal(device.userCode, 'TEST-CODE');
  mock.emit({ method: 'account/login/completed', params: { loginId: device.loginId, success: true } });
  assert.equal((await mock.bridge.getAccount()).login.status, 'complete');
  assert.equal(mock.calls.some(call => call.method === 'account/logout'), false);
  await assert.rejects(mock.bridge.startLogin('apiKey'), { status: 400 });
});

test('model catalog exposes only picker fields and supported reasoning efforts', async t => {
  const mock = mockCodex({ models: [{ ...defaultModels[0], internalField: 'not-for-clients' }] });
  t.after(() => mock.bridge.closeCodex());
  assert.deepEqual(await mock.bridge.getModels(), defaultModels);
  assert.equal(mock.calls.some(call => call.method === 'thread/start'), false);
});

test('chat streams only its own thread, carries images, and disables environment and inherited tools', async t => {
  const mock = mockCodex(); t.after(() => mock.bridge.closeCodex());
  const chunks = [], image = 'data:image/png;base64,dGVzdA==';
  const result = await mock.bridge.chatCodex({
    messages: [{ role: 'user', content: '这是什么？', image }],
    systemPrompt: '你是 Amadeus。', onDelta: chunk => chunks.push(chunk),
  });
  assert.equal(result.text, '[emotion:happy]\n你好。');
  assert.deepEqual(chunks, ['[emotion:happy]\n', '你好。']);
  const start = mock.calls.find(call => call.method === 'thread/start').params;
  assert.equal(start.ephemeral, true);
  assert.equal(start.model, undefined);
  assert.equal(mock.calls.some(call => call.method === 'model/list'), false);
  assert.equal(start.config.model_reasoning_effort, undefined);
  assert.deepEqual(start.environments, []);
  assert.equal(start.sandbox, 'read-only');
  assert.equal(start.config['features.shell_tool'], false);
  assert.equal(start.config['mcp_servers.private_connector.enabled'], false);
  assert.equal(start.config.web_search, 'disabled');
  assert.equal(start.config['features.memories'], false);
  assert.equal(start.baseInstructions, '你是 Amadeus。');
  assert.notEqual(start.cwd, process.cwd());
  const turn = mock.calls.find(call => call.method === 'turn/start').params;
  assert.equal(turn.effort, undefined);
  assert.deepEqual(turn.input[1], { type: 'image', url: image });
  assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.ok(mock.calls.some(call => call.method === 'thread/unsubscribe'));
});

test('explicit model and low effort override inherited and catalog defaults', async t => {
  const selected = { ...defaultModels[0], id: 'selected-model', model: 'selected-model', isDefault: false };
  const mock = mockCodex({ models: [...defaultModels, selected] }); t.after(() => mock.bridge.closeCodex());
  const result = await mock.bridge.chatCodex({
    messages: [{ role: 'user', content: '你好。' }], model: 'selected-model', reasoningEffort: 'low',
    systemPrompt: '你是 Amadeus。', onDelta() {},
  });
  assert.equal(result.model, 'selected-model');
  assert.equal(mock.calls.some(call => call.method === 'model/list'), false);
  assert.equal(result.reasoningEffort, 'low');
  const start = mock.calls.find(call => call.method === 'thread/start').params;
  assert.equal(start.model, 'selected-model');
  assert.equal(start.config.model_reasoning_effort, 'low');
  assert.equal(mock.calls.find(call => call.method === 'turn/start').params.effort, 'low');
});

test('abort interrupts the actual turn and unloads its ephemeral thread', async t => {
  const mock = mockCodex({ holdTurn: true }); t.after(() => mock.bridge.closeCodex());
  const controller = new AbortController();
  const started = once(mock.events, 'turn/start');
  const result = mock.bridge.chatCodex({ messages: [{ role: 'user', content: '你好' }], systemPrompt: '对话', signal: controller.signal, onDelta() {} });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await started;
  controller.abort();
  await rejected;
  assert.ok(mock.calls.some(call => call.method === 'turn/interrupt' && call.params.turnId === 'turn-1'));
  assert.ok(mock.calls.some(call => call.method === 'thread/unsubscribe'));
});

test('server-initiated tool approvals are denied', async t => {
  const mock = mockCodex(); t.after(() => mock.bridge.closeCodex());
  await mock.bridge.getAccount();
  const response = once(mock.events, 'response');
  mock.emit({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: {} });
  assert.deepEqual((await response)[0], { id: 'approval-1', result: { decision: 'decline' } });
});

test('a missing ChatGPT account produces an actionable error and no model call', async t => {
  const mock = mockCodex({ account: null }); t.after(() => mock.bridge.closeCodex());
  await assert.rejects(mock.bridge.chatCodex({ messages: [{ role: 'user', content: '你好' }], systemPrompt: '对话', onDelta() {} }), { status: 401 });
  assert.equal(mock.calls.some(call => call.method === 'turn/start'), false);
});

test('a model requiring a newer Codex tells the user to configure it manually', async t => {
  const mock = mockCodex({ turnError: { codexErrorInfo: 'other', message: "The selected model requires a newer version of Codex." } });
  t.after(() => mock.bridge.closeCodex());
  await assert.rejects(mock.bridge.chatCodex({ messages: [{ role: 'user', content: '你好' }], systemPrompt: '对话', onDelta() {} }), error => error.status === 400 && /手动填写可用模型/.test(error.message));
  assert.equal(mock.calls.some(call => call.method === 'model/list'), false);
});
