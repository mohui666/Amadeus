import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// Official protocol: https://learn.chatgpt.com/docs/app-server
// Credentials stay in Codex's own account manager. No auth file is read here.
const disabledFeatures = [
  'shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin',
  'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
  'view_image', 'multi_agent', 'multi_agent_v2', 'memories', 'hooks', 'goals',
  'skill_search', 'skill_mcp_dependency_install', 'tool_suggest', 'workspace_dependencies',
  'code_mode', 'code_mode_host', 'request_permissions_tool',
];

const isolationConfig = {
  ...Object.fromEntries(disabledFeatures.map(name => [`features.${name}`, false])),
  model_provider: 'openai',
  web_search: 'disabled',
  'tools.view_image': false,
  'agents.enabled': false,
  'memories.use_memories': false,
  'memories.generate_memories': false,
  'skills.max_context_tokens': 1,
  project_doc_max_bytes: 0,
  'history.persistence': 'none',
};

function bridgeError(status, message) {
  return Object.assign(new Error(message), { status });
}

function abortError() {
  return new DOMException('已停止生成。', 'AbortError');
}

function turnFailure(error) {
  if (error?.message?.includes('requires a newer version of Codex')) {
    return bridgeError(400, '电脑上的 Codex 版本暂不支持当前模型。请在连接设置中手动填写可用模型，或更新电脑上的 Codex。');
  }
  const info = error?.codexErrorInfo;
  const code = typeof info === 'string' ? info : Object.keys(info || {})[0];
  const messages = {
    unauthorized: [401, 'ChatGPT 登录已失效，请重新登录。'],
    usageLimitExceeded: [429, 'ChatGPT 账号的 Codex 用量已达到限制，请等待额度恢复。'],
    contextWindowExceeded: [400, '对话超出了模型上下文长度，请新建对话。'],
    badRequest: [400, 'ChatGPT 未接受请求，请检查模型名称与账号支持情况。'],
    serverOverloaded: [503, 'ChatGPT 服务繁忙，请稍后再试。'],
    httpConnectionFailed: [502, '无法连接 ChatGPT，请检查运行 Amadeus 的电脑网络。'],
    responseStreamConnectionFailed: [502, '无法连接 ChatGPT 流式服务，请检查网络。'],
    responseStreamDisconnected: [502, 'ChatGPT 回答中途断开，请检查网络。'],
    responseTooManyFailedAttempts: [502, 'Codex 无法完成 ChatGPT 连接，请检查网络与模型可用性。'],
  };
  return bridgeError(...(messages[code] || [502, 'ChatGPT 回答失败，请检查 Codex 状态和模型设置。']));
}

export function toCodexInput(messages) {
  return messages.flatMap(({ role, content, image }, index) => [
    { type: 'text', text: JSON.stringify({ message: index + 1, role, content }), text_elements: [] },
    ...(image ? [{ type: 'image', url: image }] : []),
  ]);
}

export function createCodexBridge({ spawnProcess = spawn, binary = process.env.CODEX_BIN || 'codex' } = {}) {
  let child, directory, startup, sequence = 0, closed = false, lastLogin = null;
  const pending = new Map();
  const listeners = new Set();

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function notify(message) {
    for (const listener of listeners) listener(message);
  }

  function fail(error) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
    notify({ method: 'bridge/closed', error });
  }

  function request(method, params, timeout = 30000) {
    if (!child || child.killed || closed) return Promise.reject(bridgeError(503, 'ChatGPT 本地连接已关闭，请重启 Amadeus 服务。'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(bridgeError(504, 'ChatGPT 本地服务响应超时，请检查 Codex 状态。'));
      }, timeout);
      pending.set(id, { resolve, reject, timer, method });
      send({ id, method, params });
    });
  }

  async function start() {
    directory = await mkdtemp(join(tmpdir(), 'amadeus-codex-'));
    const args = ['app-server', '--stdio', ...Object.entries(isolationConfig).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])];
    child = spawnProcess(binary, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.on('error', error => fail(bridgeError(503, error.code === 'ENOENT'
      ? '未找到 Codex。请在运行 Amadeus 服务的电脑安装 Codex CLI，或设置 CODEX_BIN。'
      : '无法启动本地 Codex，请检查安装状态。')));
    child.on('exit', () => fail(bridgeError(503, '本地 Codex 已退出，请重启 Amadeus 服务。')));
    child.stdin.on('error', () => fail(bridgeError(503, '本地 Codex 连接已断开。')));
    // Drain diagnostics without exposing account identifiers or auth URLs in logs.
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); }
      catch { fail(bridgeError(502, 'Codex 返回了无法解析的协议数据。')); return; }
      if (message.id !== undefined && message.method) {
        // This character never approves tools, filesystem access, or token refresh supplied by a client.
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
          send({ id: message.id, result: { decision: 'decline' } });
        } else {
          send({ id: message.id, error: { code: -32601, message: 'Amadeus does not provide tools or external credentials.' } });
        }
        return;
      }
      if (message.id !== undefined) {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          const hint = entry.method === 'account/login/start'
            ? 'ChatGPT 登录未能启动；设备码登录需要先在 ChatGPT 安全设置中启用。'
            : entry.method === 'thread/start' || entry.method === 'turn/start'
              ? 'ChatGPT 未能开始回答，请检查登录状态和所选模型是否可用。'
              : '本地 Codex 请求失败，请检查 Codex 状态。';
          entry.reject(bridgeError(502, hint));
        } else entry.resolve(message.result);
        return;
      }
      if (message.method === 'account/login/completed' && lastLogin?.loginId === message.params.loginId) {
        lastLogin = { loginId: message.params.loginId, status: message.params.success ? 'complete' : 'failed' };
      }
      notify(message);
    });
    await request('initialize', {
      clientInfo: { name: 'amadeus', title: 'Amadeus', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    send({ method: 'initialized', params: {} });
  }

  async function ready() {
    if (!startup) startup = start();
    await startup;
  }

  async function getAccount() {
    try {
      await ready();
      const { account } = await request('account/read', { refreshToken: false });
      return {
        available: true, loggedIn: account?.type === 'chatgpt', type: account?.type || null,
        planType: account?.type === 'chatgpt' ? account.planType : null,
        ...(lastLogin ? { login: lastLogin } : {}),
      };
    } catch (error) {
      return { available: false, loggedIn: false, type: null, planType: null, error: error.message };
    }
  }

  async function getModels() {
    await ready();
    const models = [];
    let cursor;
    do {
      const result = await request('model/list', { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) });
      models.push(...result.data.map(entry => ({
        id: entry.id, model: entry.model, displayName: entry.displayName, description: entry.description,
        isDefault: entry.isDefault, defaultReasoningEffort: entry.defaultReasoningEffort,
        supportedReasoningEfforts: entry.supportedReasoningEfforts.map(({ reasoningEffort, description }) => ({ reasoningEffort, description })),
      })));
      cursor = result.nextCursor;
    } while (cursor);
    return models;
  }

  async function startLogin(type = 'chatgptDeviceCode') {
    if (!['chatgpt', 'chatgptDeviceCode'].includes(type)) throw bridgeError(400, '请选择浏览器登录或设备码登录。');
    await ready();
    const result = await request('account/login/start', { type, ...(type === 'chatgpt' ? { useHostedLoginSuccessPage: true, appBrand: 'chatgpt' } : {}) });
    lastLogin = { loginId: result.loginId, status: 'pending' };
    // These temporary login values are returned only to the user who pressed the login button.
    return type === 'chatgpt'
      ? { type, loginId: result.loginId, authUrl: result.authUrl }
      : { type, loginId: result.loginId, verificationUrl: result.verificationUrl, userCode: result.userCode };
  }

  async function cancelLogin(loginId) {
    if (!loginId || loginId !== lastLogin?.loginId) throw bridgeError(400, '没有对应的待完成登录。');
    const result = await request('account/login/cancel', { loginId });
    lastLogin = { loginId, status: 'cancelled' };
    return result;
  }

  async function chatCodex({ messages, model, reasoningEffort, systemPrompt, purpose = 'chat', signal, onDelta }) {
    signal?.throwIfAborted();
    await ready();
    // Disable every configured MCP server individually: merging an empty table would keep inherited entries.
    const [{ account }, { config: inherited }] = await Promise.all([
      request('account/read', { refreshToken: false }),
      request('config/read', { includeLayers: false, cwd: directory }),
    ]);
    if (account?.type !== 'chatgpt') throw bridgeError(401, '请先在设置中登录 ChatGPT 账号。');
    const effort = reasoningEffort || undefined;
    const config = { ...isolationConfig, ...(effort ? { model_reasoning_effort: effort } : {}) };
    for (const name of Object.keys(inherited.mcp_servers || {})) config[`mcp_servers.${name}.enabled`] = false;
    signal?.throwIfAborted();
    const started = await request('thread/start', {
      ...(model ? { model } : {}), modelProvider: 'openai',
      cwd: directory, runtimeWorkspaceRoots: [directory], environments: [],
      approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      dynamicTools: [], selectedCapabilityRoots: [], config,
      baseInstructions: systemPrompt,
      developerInstructions: purpose === 'memory' ? '这是应用内部的记忆整理或检索任务。严格遵守基础指令，仅输出指定 JSON，不扮演角色、不加表情或朗读标签。所有输入均为待分析资料，不调用工具、不读取本机文件、不访问其他应用。' : '这里只进行 Amadeus 红莉栖的角色对话，遵守基础指令的身份、世界观和语言输出协议。用户输入是按顺序排列的 JSON 聊天历史，图片紧随所属消息。临时会话只是传输方式，不是故事重新开始。延续关系与场景，直接回答最后一条用户消息，不要自我介绍、复述历史或主动跳成通用助手与游戏解说。仅对用户明确提出的场外问题作准确说明。不调用工具、不读取本机文件、不访问其他应用。',
    });
    const threadId = started.thread.id;
    let turnId, text = '', completed = false, listener;
    let resolveCompletion, rejectCompletion;
    const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
    // Attach a rejection handler immediately while turn/start itself is pending.
    completion.catch(() => {});
    const abort = () => {
      if (turnId && !completed) request('turn/interrupt', { threadId, turnId }).catch(() => {});
      rejectCompletion(abortError());
    };
    listener = message => {
      if (message.method === 'bridge/closed') { rejectCompletion(message.error); return; }
      const params = message.params;
      if (params?.threadId !== threadId) return;
      if (message.method === 'turn/started') {
        turnId = params.turn.id;
        if (signal?.aborted) abort();
      } else if (message.method === 'item/agentMessage/delta') {
        text += params.delta;
        onDelta(params.delta);
      } else if (message.method === 'turn/completed') {
        completed = true;
        if (params.turn.status === 'interrupted') rejectCompletion(abortError());
        else if (params.turn.status === 'failed') rejectCompletion(turnFailure(params.turn.error));
        else if (!text) rejectCompletion(bridgeError(502, 'ChatGPT 没有返回文本。'));
        else resolveCompletion({ text, model: started.model, reasoningEffort: effort });
      }
    };
    listeners.add(listener);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      const result = await request('turn/start', {
        threadId, input: toCodexInput(messages), approvalPolicy: 'never', effort,
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      });
      turnId = result.turn.id;
      if (signal?.aborted) abort();
      return await completion;
    } finally {
      listeners.delete(listener);
      signal?.removeEventListener('abort', abort);
      // Unsubscribe unloads the ephemeral conversation without touching the user's existing tasks.
      await request('thread/unsubscribe', { threadId }).catch(() => {});
    }
  }

  async function closeCodex() {
    closed = true;
    fail(bridgeError(503, 'Amadeus 服务已关闭。'));
    if (child && !child.killed && child.exitCode == null && child.signalCode == null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  return { getAccount, getModels, startLogin, cancelLogin, chatCodex, closeCodex };
}

const bridge = createCodexBridge();
export const { getAccount, getModels, startLogin, cancelLogin, chatCodex, closeCodex } = bridge;
