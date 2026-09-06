import { phone } from './native.js';

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  const authorization = phone?.serverAuthorization?.();
  if (authorization) headers.set('Authorization', authorization);
  const url = new URL(path.replace(/^\//, ''), document.baseURI);
  const response = await fetch(url, { cache: 'no-store', ...options, headers });
  if (/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new Error(`接口 ${url.pathname} 返回了网页而非 API 数据（HTTP ${response.status}）。请检查电脑服务地址和公网路径；当前公网入口应包含 /amadeus/。`);
  }
  return response;
}

export async function readJsonResponse(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch {
    const path = new URL(response.url || document.baseURI).pathname;
    throw new Error(`接口 ${path} 未返回有效 JSON（HTTP ${response.status}）。请检查电脑服务连接及所配置的公网地址和路径。`);
  }
}

export async function request(path, body, signal) {
  const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const error = await readJsonResponse(response);
    throw new Error(error.error?.message || error.error || error.message || `HTTP ${response.status}`);
  }
  return response;
}

export async function streamChat(body, signal, onDelta) {
  const response = await request('/api/chat', body, signal);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = block.match(/^event:\s*(.*)$/m)?.[1];
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === 'error') throw new Error(parsed.message);
      if (event === 'delta') onDelta(parsed.text);
      if (event === 'done') completed = true;
    }
    if (done) break;
  }
  if (!completed) throw new Error('连接已中断，回复未完成。');
}

export function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.readAsDataURL(file);
  });
}
