import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const bundledPersona = await readFile(new URL('../prompts/kurisu.md', import.meta.url), 'utf8');

// All account, model, local-voice, conversation and generated-speech responses below are fixtures.
// Existing local OGG/PNG assets and the compiled frontend are loaded normally.
const appUrl = process.env.AMADEUS_URL || 'http://127.0.0.1:3010';
const outputDir = resolve('test-results');
await mkdir(outputDir, { recursive: true });

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

function wavFixture(seconds = 1) {
  const samples = 16000 * seconds, sampleRate = 16000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 440 * Math.PI * 2 / sampleRate) * 1800), 44 + i * 2);
  return buffer;
}

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
function record(result) { results.push(result); console.log(`PASS ${result.check}`); }

async function session(viewport, { localVoice = { configured: false }, native = false } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    window.__amadeusMedia = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__amadeusMedia.push(this.src);
      return play.call(this);
    };
    window.__amadeusRecognizers = [];
    window.SpeechRecognition = class {
      start() { window.__amadeusRecognizers.push(this); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
      emit(text) { this.onresult?.({ results: [[{ transcript: text }]] }); }
    };
  });
  if (native) await context.addInitScript(() => {
    window.AmadeusAndroid = {
      serverUrl: () => 'https://example.test/amadeus', serverAuthorization: () => '',
      stopSpeaking() {}, stopRecognition() {}, speak() {}, background() {}, connect() {},
      readRecord: key => JSON.stringify({ value: localStorage.getItem(`native.${key}`) }),
      writeRecord(key, value) { localStorage.setItem(`native.${key}`, value); return ''; },
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  // Use installed fonts so remote Google Fonts latency cannot stall UI fixtures.
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = { modelRequests: 0, speechFailure: false, chats: [], speeches: [], chatGate: null, speechGate: null, pendingChat: false, pendingSpeech: false, reply: '【测试夹具】你好，来验证一下这个假设吧。' };
  state.memoryRequests = []; state.memoryResult = { facts: [] }; state.memoryGate = null;
  await page.route('**/api/memory', async route => {
    const body = route.request().postDataJSON();
    state.memoryRequests.push(body);
    const result = body.action === 'recall' ? { ids: state.recallIds || [] } : typeof state.memoryResult === 'function' ? state.memoryResult(body) : state.memoryResult;
    if (state.memoryGate) await state.memoryGate.promise;
    await route.fulfill({ json: result });
  });
  await page.route('**/api/account', route => route.fulfill({ json: { available: true, loggedIn: true, type: 'chatgpt', planType: 'fixture' } }));
  await page.route('**/api/models', route => { state.modelRequests++; return route.fulfill({ json: { models: [] } }); });
  await page.route('**/api/local-voice*', route => route.fulfill({ json: route.request().url().includes('engine=') ? { configured: false } : localVoice }));
  await page.route('**/api/chat', async route => {
    state.chats.push(route.request().postDataJSON());
    const gate = state.chatGate;
    const reply = state.reply;
    state.pendingChat = true;
    if (gate) await gate.promise;
    const body = `event: delta\ndata: ${JSON.stringify({ text: '[emotion:happy]\n' })}\n\nevent: delta\ndata: ${JSON.stringify({ text: reply })}\n\nevent: done\ndata: {}\n\n`;
    await route.fulfill({ contentType: 'text/event-stream; charset=utf-8', body });
    state.pendingChat = false;
  });
  await page.route('**/api/speech', async route => {
    state.speeches.push(route.request().postDataJSON());
    if (state.speechFailure) { await route.abort('failed'); return; }
    state.pendingSpeech = true;
    if (state.speechGate) await state.speechGate.promise;
    await route.fulfill({ contentType: 'audio/wav', body: wavFixture(state.speechSeconds || 1) });
    state.pendingSpeech = false;
  });
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  return { context, page, state, errors };
}

async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(sizes.scroll <= sizes.width + 1, `Horizontal overflow: ${JSON.stringify(sizes)}`);
}

async function beginCall(page) {
  await page.getByRole('button', { name: /开始通话/ }).click();
  await expect(page.getByRole('button', { name: '挂断通话' })).toBeVisible();
  await expect(page.locator('.boot-overlay')).toHaveCount(0, { timeout: 5000 });
}

async function configureApi(page) {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.getByRole('button', { name: 'OpenAI 账号登录', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'API 接入', exact: true }).click();
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('API 地址', { exact: true })).toHaveValue('');
  assert.deepEqual(await page.getByRole('combobox', { name: /^接口协议/ }).locator('option').allTextContents(), ['OpenAI 兼容', 'Responses', 'Anthropic']);
  await page.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:11434/v1');
  await page.getByLabel('模型名称', { exact: true }).fill('fixture-vision');
  await page.getByLabel('API Key · 仅本次打开有效', { exact: true }).fill('fixture-chat-secret');
  await page.getByRole('button', { name: 'OpenAI 账号登录', exact: true }).click();
  await expect(page.getByLabel('模型（留空使用账号默认）')).toHaveValue('');
  await page.getByRole('button', { name: 'API 接入', exact: true }).click();
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('API 地址', { exact: true })).toHaveValue('');
  assert.deepEqual(await page.getByRole('combobox', { name: /^接口协议/ }).locator('option').allTextContents(), ['OpenAI 兼容', 'Responses', 'Anthropic']);
  await page.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:11434/v1');
  await page.getByLabel('模型名称', { exact: true }).fill('fixture-vision');
  await page.getByLabel('API Key · 仅本次打开有效', { exact: true }).fill('fixture-chat-secret');
  await page.getByRole('tab', { name: '声音', exact: true }).click();
  await page.getByText('高级声音设置', { exact: true }).click();
  await page.getByRole('combobox', { name: /^语音合成/ }).selectOption('openai');
  await page.getByRole('combobox', { name: /^语音识别/ }).selectOption('browser');
  await page.getByLabel('语音 API Key · 仅本次打开有效', { exact: true }).fill('fixture-voice-secret');
  await page.getByRole('tab', { name: '角色', exact: true }).click();
  await page.getByRole('combobox', { name: /^她如何回复/ }).selectOption('zh');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  assert.doesNotMatch(stored, /fixture-chat-secret|fixture-voice-secret/);
}

try {
  const desktop = await session({ width: 1440, height: 1000 });
  const { page, state, errors } = desktop;
  await noOverflow(page);
  await expect(page.locator('.character')).toBeVisible();
  assert.ok(await page.locator('.character').evaluate(image => image.complete && image.naturalWidth > 100));
  await beginCall(page);
  assert.equal(await page.evaluate(() => window.__amadeusMedia.length), 0, 'connecting must not introduce herself');
  const decoded = await page.evaluate(async () => {
    const audioContext = new AudioContext();
    const results = [];
    for (const name of ['pleased_to_meet_you', 'hello', 'dont_add_tina', 'ask_me_whatever', 'memory_complex']) {
      const response = await fetch(`/assets/voice/${name}.ogg`);
      const audio = await audioContext.decodeAudioData(await response.arrayBuffer());
      results.push({ name, duration: audio.duration, channels: audio.numberOfChannels });
    }
    await audioContext.close();
    return results;
  });
  assert.equal(decoded.length, 5);
  assert.ok(decoded.every(clip => clip.duration > 0 && clip.channels > 0));
  record({ check: 'desktop layout, character asset, call startup and five real OGG files decoded', status: 'PASS', decoded });
  await page.getByRole('button', { name: '进入沉浸模式', exact: true }).click();
  await expect(page.getByLabel('给红莉栖的消息')).toBeHidden();
  await page.locator('.character-hit').click({ position: { x: 180, y: 300 } });
  await expect(page.getByLabel('给红莉栖的消息')).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: '退出沉浸模式', exact: true }).click();
  record({ check: 'immersive character view and tap-to-reveal controls', status: 'PASS' });

  await configureApi(page);
  const fixtureImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('添加图片', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: fixtureImage });
  await expect(page.getByAltText('待发送图片', { exact: true })).toBeVisible();
  await page.getByLabel('给红莉栖的消息').fill('【测试夹具】这张图片里有什么？');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.transcript .message.assistant p')).toHaveText(state.reply);
  await expect(page.getByLabel('给红莉栖的消息')).toBeEnabled();
  assert.equal(state.chats[0].config.chat.apiKey, 'fixture-chat-secret');
  assert.match(state.chats[0].messages.at(-1).image, /^data:image\/png;base64,/);
  assert.equal(state.speeches[0].config.tts.apiKey, 'fixture-voice-secret');
  assert.equal(state.speeches[0].text, state.reply);
  assert.doesNotMatch(state.speeches[0].text, /emotion:/);
  await expect(page.locator('.character')).toHaveAttribute('src', /kurisu_happy/);
  await page.screenshot({ path: resolve(outputDir, 'desktop-fixture.png'), fullPage: true });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.transcript .message.assistant p')).toHaveText(state.reply);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('amadeus.settings')));
  assert.equal(persisted.chat.model, 'fixture-vision');
  assert.equal(persisted.chat.apiKey, undefined);
  assert.equal(persisted.tts.apiKey, undefined);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.getByLabel('API Key · 仅本次打开有效', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  record({ check: 'API/account switch, memory-only secrets, fixture image+SSE+TTS and refresh history', status: 'PASS' });

  const speechCount = state.speeches.length;
  state.chatGate = deferred(); state.reply = '不得在停止后出现的文本夹具';
  await page.getByLabel('给红莉栖的消息').fill('【测试夹具】停止文本响应');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => state.pendingChat).toBeTruthy();
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await expect(page.getByLabel('给红莉栖的消息')).toBeEnabled();
  state.chatGate.release(); state.chatGate = null;
  await expect.poll(() => state.pendingChat).toBeFalsy();
  assert.equal(state.speeches.length, speechCount);
  await expect(page.getByText('不得在停止后出现的文本夹具', { exact: true })).toHaveCount(0);
  record({ check: 'stop cancels pending conversation and prevents late response or TTS', status: 'PASS' });

  state.reply = '【测试夹具】这段语音必须可以取消。';
  state.speechGate = deferred();
  await page.getByLabel('给红莉栖的消息').fill('【测试夹具】停止等待中的语音合成');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => state.pendingSpeech).toBeTruthy();
  const audioBeforeStop = await page.evaluate(() => window.__amadeusMedia.length);
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await expect(page.getByLabel('给红莉栖的消息')).toBeEnabled();
  state.speechGate.release(); state.speechGate = null;
  await expect.poll(() => state.pendingSpeech).toBeFalsy();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__amadeusMedia.length), audioBeforeStop);
  record({ check: 'stop aborts delayed generated speech without subsequent audio', status: 'PASS' });

  state.chatGate = deferred(); state.reply = '不得在挂断后出现的文本夹具';
  const beforeHangupSpeech = state.speeches.length;
  await page.getByLabel('给红莉栖的消息').fill('【测试夹具】挂断取消');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => state.pendingChat).toBeTruthy();
  await page.getByRole('button', { name: '挂断通话', exact: true }).click();
  state.chatGate.release(); state.chatGate = null;
  await expect.poll(() => state.pendingChat).toBeFalsy();
  await expect(page.getByRole('button', { name: /开始通话/ })).toBeVisible();
  await expect(page.getByText('不得在挂断后出现的文本夹具', { exact: true })).toHaveCount(0);
  assert.equal(state.speeches.length, beforeHangupSpeech);
  record({ check: 'hangup cancels pending response and prevents late speech', status: 'PASS' });

  await beginCall(page);
  await page.getByRole('button', { name: '开始语音输入', exact: true }).click();
  await page.getByRole('button', { name: '挂断通话', exact: true }).click();
  await beginCall(page);
  await page.getByRole('button', { name: '开始语音输入', exact: true }).click();
  const chatBeforeLateInput = state.chats.length;
  await page.evaluate(() => window.__amadeusRecognizers[0].emit('不得从旧录音进入新会话的夹具'));
  await page.waitForTimeout(200);
  assert.equal(state.chats.length, chatBeforeLateInput);
  await expect(page.getByLabel('给红莉栖的消息')).toHaveValue('');
  await page.getByRole('button', { name: '挂断通话', exact: true }).click();
  record({ check: 'cancelled recognizer cannot deliver stale input into a later call', status: 'PASS', fixture: 'SpeechRecognition' });
  assert.equal(state.modelRequests, 0);
  assert.deepEqual(errors, []);
  state.speechFailure = true;
  await page.getByRole('button', { name: '朗读这条回复', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.__amadeusMedia.at(-1)?.startsWith('blob:'))).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  state.speechFailure = false;
  await desktop.context.close();

  const localVoice = { configured: true, config: {
    provider: 'gpt-sovits', baseUrl: 'http://127.0.0.1:9880', apiKey: '', model: '', voice: '', speed: 1,
    referenceAudio: '/fixture/kurisu-reference.wav', promptText: '初めまして。よろしく。', promptLang: 'ja', textLang: 'zh',
  } };
  const bilingual = await session({ width: 1440, height: 1000 }, { localVoice });
  const bilingualPage = bilingual.page, bilingualState = bilingual.state;
  const persona = '【测试夹具】叫我小林，回答简短一点。';
  await bilingualPage.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(bilingualPage.getByLabel('模型（留空使用账号默认）')).toHaveValue('');
  await bilingualPage.getByLabel('模型（留空使用账号默认）').fill('gpt-5.6-sol');
  await bilingualPage.getByText('高级对话设置', { exact: true }).click();
  await bilingualPage.getByLabel('推理强度（可选）').fill('low');
  await expect(bilingualPage.getByLabel('模型（留空使用账号默认）')).toHaveValue('gpt-5.6-sol');
  await expect(bilingualPage.getByLabel('推理强度（可选）')).toHaveValue('low');
  await bilingualPage.getByRole('tab', { name: '角色', exact: true }).click();
  await bilingualPage.getByLabel('补充角色偏好', { exact: true }).fill(persona);
  await bilingualPage.getByRole('combobox', { name: /^她如何回复/ }).selectOption('ja-zh');
  await bilingualPage.getByRole('tab', { name: '声音', exact: true }).click();
  await bilingualPage.getByText('高级声音设置', { exact: true }).click();
  await bilingualPage.getByRole('combobox', { name: /^语音合成/ }).selectOption('browser');
  await bilingualPage.getByRole('button', { name: '使用本机配置', exact: true }).click();
  await expect(bilingualPage.getByRole('combobox', { name: /^语音合成/ })).toHaveValue('gpt-sovits');
  await expect(bilingualPage.getByLabel('参考音频路径（语音服务器上的文件）', { exact: true })).toHaveValue(localVoice.config.referenceAudio);
  await expect(bilingualPage.getByLabel('参考音频原文', { exact: true })).toHaveValue(localVoice.config.promptText);
  await bilingualPage.getByRole('button', { name: '保存设置', exact: true }).click();
  const bilingualSettings = await bilingualPage.evaluate(() => JSON.parse(localStorage.getItem('amadeus.settings')));
  assert.equal(bilingualSettings.chat.model, 'gpt-5.6-sol');
  assert.equal(bilingualSettings.chat.reasoningEffort, 'low');
  assert.equal(bilingualSettings.persona, persona);
  assert.equal(bilingualSettings.replyMode, 'ja-zh');
  assert.equal(bilingualSettings.tts.textLang, 'zh');
  const chinese = '【测试夹具】先休息一会儿吧，小林。', japanese = '少し休もう、小林。';
  bilingualState.reply = `${chinese}\n[speech:ja]\n${japanese}`;
  await bilingualPage.getByLabel('给红莉栖的消息').fill('【测试夹具】我累了。');
  await bilingualPage.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(bilingualPage.locator('.transcript .message.assistant p')).toHaveText(chinese);
  await expect(bilingualPage.locator('.subtitle-text')).toHaveText(chinese);
  await expect(bilingualPage.getByText(japanese, { exact: true })).toHaveCount(0);
  await expect(bilingualPage.getByLabel('给红莉栖的消息')).toBeEnabled();
  await expect(bilingualPage.locator('.subtitle-text .reading-sentence')).toHaveText(chinese);
  await expect(bilingualPage.locator('.transcript .reading-sentence')).toHaveText(chinese);
  assert.equal(bilingualState.chats[0].config.chat.model, 'gpt-5.6-sol');
  assert.equal(bilingualState.chats[0].config.chat.reasoningEffort, 'low');
  assert.equal(bilingualState.chats[0].config.persona, persona);
  assert.equal(bilingualState.chats[0].config.replyMode, 'ja-zh');
  assert.equal(bilingualState.chats[0].basePersona, bundledPersona);
  assert.equal(bilingualState.speeches.length, 1);
  assert.equal(bilingualState.speeches[0].text, japanese);
  assert.equal(bilingualState.speeches[0].config.tts.provider, 'gpt-sovits');
  assert.equal(bilingualState.speeches[0].config.tts.textLang, 'ja');
  await bilingualPage.reload({ waitUntil: 'networkidle' });
  await bilingual.context.setOffline(true);
  await bilingualPage.getByRole('button', { name: '朗读这条回复', exact: true }).click();
  await expect.poll(() => bilingualPage.evaluate(() => window.__amadeusMedia.filter(url => url.startsWith('blob:')).length)).toBe(1);
  assert.equal(bilingualState.speeches.length, 1, 'saved audio replays after reload with no network');
  await expect(bilingualPage.locator('.subtitle-text .reading-sentence')).toHaveText(chinese);
  await expect(bilingualPage.locator('.subtitle-text .reading-sentence')).toHaveCount(0);
  await bilingual.context.setOffline(false);
  bilingualState.reply = '【测试夹具】这次只有中文字幕。';
  await bilingualPage.getByLabel('给红莉栖的消息').fill('【测试夹具】验证缺少日语段。');
  await bilingualPage.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(bilingualPage.locator('.transcript .message.assistant p').last()).toHaveText(bilingualState.reply);
  await expect(bilingualPage.getByLabel('给红莉栖的消息')).toBeEnabled();
  await expect(bilingualPage.getByRole('alert')).toContainText('没有生成日语朗读内容');
  assert.equal(bilingualState.speeches.length, 1);
  assert.doesNotMatch(bilingualState.chats[1].messages.find(message => message.role === 'assistant').content, /speech:|少し休もう/);
  await bilingualPage.getByRole('button', { name: '关闭错误提示', exact: true }).click();
  await bilingualPage.getByRole('button', { name: '朗读这条回复', exact: true }).last().click();
  await expect(bilingualPage.getByRole('alert')).toContainText('没有生成日语朗读内容');
  assert.equal(bilingualState.speeches.length, 1);
  assert.deepEqual(bilingual.errors, []);
  await bilingual.context.close();
  record({ check: 'Sol low and persona settings, local-voice preset, Chinese subtitles with Japanese-only auto/replay speech, missing Japanese stays silent', status: 'PASS' });

  const mobile = await session({ width: 390, height: 844 });
  await noOverflow(mobile.page);
  await expect(mobile.page.locator('.identity')).toBeHidden();
  await expect(mobile.page.locator('.transcript')).toBeHidden();
  await expect(mobile.page.getByLabel('给红莉栖的消息')).toBeVisible();
  await beginCall(mobile.page);
  await mobile.page.getByRole('button', { name: '语音片段', exact: true }).click();
  await expect(mobile.page.getByRole('dialog', { name: '语音片段', exact: true })).toBeVisible();
  await mobile.page.getByRole('dialog', { name: '语音片段', exact: true }).getByRole('button', { name: /打个招呼/ }).click();
  await expect.poll(() => mobile.page.evaluate(() => window.__amadeusMedia.some(url => url.endsWith('/hello.ogg')))).toBeTruthy();
  await mobile.page.getByRole('button', { name: '打开设置', exact: true }).click();
  await noOverflow(mobile.page);
  await mobile.page.getByRole('tab', { name: '声音', exact: true }).click();
  await mobile.page.getByRole('checkbox').uncheck();
  await mobile.page.getByRole('button', { name: '保存设置', exact: true }).click();
  await mobile.page.getByLabel('给红莉栖的消息').fill('【测试夹具】手机界面测试');
  await mobile.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(mobile.page.getByLabel('给红莉栖的消息')).toBeEnabled();
  await expect(mobile.page.locator('.subtitle-text')).toHaveText(mobile.state.reply);
  await noOverflow(mobile.page);
  await mobile.page.screenshot({ path: resolve(outputDir, 'mobile-fixture.png'), fullPage: true });
  await mobile.page.getByRole('button', { name: /对话记录/ }).click();
  await expect(mobile.page.getByRole('dialog', { name: '对话记录', exact: true }).locator('.message.assistant p')).toHaveText(mobile.state.reply);
  await noOverflow(mobile.page);
  await mobile.page.getByRole('button', { name: '关闭对话记录', exact: true }).click();
  await mobile.page.getByRole('button', { name: '挂断通话', exact: true }).click();
  for (const width of [320, 375, 430]) {
    await mobile.page.setViewportSize({ width, height: 740 });
    await noOverflow(mobile.page);
    await expect(mobile.page.getByLabel('给红莉栖的消息')).toBeVisible();
  }
  assert.deepEqual(mobile.errors, []);
  await mobile.context.close();
  record({ check: '390px mobile layout, settings, voice panel, fixture conversation and history panel', status: 'PASS' });
  const native = await session({ width: 393, height: 878 }, { native: true });
  await native.page.getByRole('button', { name: '打开设置', exact: true }).click();
  await native.page.getByRole('button', { name: 'API 接入', exact: true }).click();
  await expect(native.page.getByLabel('模型名称', { exact: true })).toHaveValue('');
  for (const protocol of ['openai', 'responses', 'anthropic']) {
    await native.page.getByRole('combobox', { name: /^接口协议/ }).selectOption(protocol);
    await expect(native.page.getByLabel('模型名称', { exact: true })).toHaveValue('');
  }
  await native.page.getByRole('combobox', { name: /^接口协议/ }).selectOption('openai');
  await native.page.getByLabel('API 地址', { exact: true }).fill('http://fixture.test/v1');
  await native.page.getByLabel('模型名称', { exact: true }).fill('fixture-model');
  for (const width of [320, 393, 430]) {
    await native.page.setViewportSize({ width, height: 878 });
    await noOverflow(native.page);
    const metrics = await native.page.getByRole('combobox', { name: /^接口协议/ }).evaluate(select => {
      const css = getComputedStyle(select);
      return { height: select.clientHeight, content: parseFloat(css.fontSize) * 1.5 + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) };
    });
    assert.ok(metrics.height >= metrics.content, JSON.stringify(metrics));
    await expect(native.page.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport();
  }
  await native.page.setViewportSize({ width: 393, height: 878 });
  await native.page.getByRole('combobox', { name: /^接口协议/ }).scrollIntoViewIfNeeded();
  await native.page.screenshot({ path: resolve(outputDir, 'native-settings-fixed.png') });
  await native.page.getByRole('tab', { name: '声音', exact: true }).click();
  await native.page.getByText('高级声音设置', { exact: true }).click();
  await native.page.getByRole('combobox', { name: /^语音合成/ }).selectOption('openai');
  await native.page.getByRole('tab', { name: '角色', exact: true }).click();
  await native.page.getByRole('combobox', { name: /^她如何回复/ }).selectOption('zh');
  await native.page.getByRole('button', { name: '保存设置', exact: true }).click();
  await native.page.getByRole('button', { name: '开始通话', exact: true }).click();
  await expect(native.page.locator('.boot-overlay')).toHaveCount(0, { timeout: 5000 });
  await native.page.getByRole('button', { name: '展开或收起通话菜单' }).click({ position: { x: 180, y: 200 } });
  native.state.reply = '你好。我是牧濑红莉栖——准确地说，是以她的记忆和人格构成的 Amadeus。你连续叫了我几次，是想确认我有没有在听吗？';
  native.state.speechFailure = true;
  await native.page.getByLabel('给红莉栖的消息').fill('测试字幕和语音连接');
  await native.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(native.page.getByRole('alert')).toContainText('语音连接中断');
  await expect(native.page.getByRole('button', { name: '重播当前回复' })).toBeEnabled();
  for (const size of [{ width: 393, height: 878 }, { width: 360, height: 740 }, { width: 393, height: 450 }]) {
    await native.page.setViewportSize(size);
    const portrait = await native.page.locator('.character-hit').boundingBox();
    const controls = await native.page.locator('.call-bottom').boundingBox();
    assert.ok(portrait.y + portrait.height <= controls.y + 1, 'Controls overlap the character');
    await noOverflow(native.page);
    await native.page.getByRole('button', { name: '收起菜单' }).scrollIntoViewIfNeeded();
    await expect(native.page.getByRole('button', { name: '收起菜单' })).toBeInViewport();
  }
  await native.page.setViewportSize({ width: 393, height: 878 });
  await native.page.locator('.call-bottom').evaluate(element => { element.scrollTop = 0; });
  await native.page.screenshot({ path: resolve(outputDir, 'native-call-fixed.png') });
  native.state.speechFailure = false;
  const chatsBeforeReplay = native.state.chats.length;
  await native.page.getByRole('button', { name: '重播当前回复' }).click();
  await expect(native.page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => native.state.speeches.length).toBe(4);
  assert.equal(native.state.speeches.slice(1).map(request => request.text).join(''), native.state.reply);
  assert.equal(native.state.chats.length, chatsBeforeReplay);
  assert.equal(native.state.modelRequests, 0);
  await expect(native.page.locator('.reading-sentence')).toHaveCount(0);
  await native.page.reload({ waitUntil: 'networkidle' });
  await native.page.getByRole('button', { name: '开始通话', exact: true }).click();
  await expect(native.page.locator('.boot-overlay')).toHaveCount(0);
  assert.equal(await native.page.evaluate(() => window.__amadeusMedia.length), 0);
  await native.page.getByRole('button', { name: '展开或收起通话菜单' }).click({ position: { x: 180, y: 200 } });
  await native.page.getByRole('button', { name: /对话记录/ }).click();
  await native.context.setOffline(true);
  await native.page.getByRole('button', { name: '朗读这条回复' }).last().click();
  await expect(native.page.locator('.mobile-panel .reading-sentence')).toHaveText('你好。');
  await expect(native.page.locator('.mobile-panel .reading-sentence')).toContainText('我是牧濑红莉栖');
  await expect(native.page.locator('.mobile-panel .reading-sentence')).toContainText('你连续叫了我几次');
  await expect(native.page.locator('.mobile-panel .reading-sentence')).toHaveCount(0);
  assert.equal(native.state.speeches.length, 4, 'native saved sentences replay offline without synthesis');
  assert.deepEqual(native.errors, []);
  await native.context.close();
  record({ check: 'Android bridge fixture: three manual protocols, unclipped selects, portrait separation, speech failure and replay without another chat request', status: 'PASS' });
  const memory = await session({ width: 360, height: 740 });
  await memory.page.evaluate(() => {
    localStorage.setItem('amadeus.settings', JSON.stringify({ autoSpeak: false, memoryEnabled: false, semanticMemory: false }));
    localStorage.setItem('amadeus.memories', JSON.stringify([
      { id: 'saved-name', source: 'manual', text: '我叫小莫，喜欢量子物理。', time: 1 },
      ...Array.from({ length: 7 }, (_, i) => ({ id: `queued-${i}`, source: 'conversation', text: `旧话题${i}。`, reply: '知道了。', time: i + 1 })),
    ]));
  });
  await memory.page.reload({ waitUntil: 'networkidle' });
  await memory.page.getByRole('button', { name: '打开设置', exact: true }).click();
  await memory.page.getByRole('tab', { name: '记忆', exact: true }).click();
  await expect(memory.page.getByLabel('想让她记住的事')).toHaveCount(0);
  await expect(memory.page.getByRole('button', { name: '整理已有对话' })).toHaveCount(0);
  await expect(memory.page.getByRole('checkbox')).toHaveCount(0);
  await expect(memory.page.getByLabel('查找记忆')).toHaveCount(0);
  await expect(memory.page.locator('.memory-entry')).toHaveCount(1);
  await noOverflow(memory.page);
  await memory.page.screenshot({ path: resolve(outputDir, 'memory-mobile.png') });
  await memory.page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await memory.page.reload({ waitUntil: 'networkidle' });
  await memory.page.getByLabel('给红莉栖的消息').fill('你还记得我的名字吗？');
  await memory.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => memory.state.chats.length).toBe(1);
  assert.ok(memory.state.chats[0].memories.some(entry => entry.text.includes('小莫')));
  await expect(memory.page.getByLabel('给红莉栖的消息')).toBeEnabled();
  await expect.poll(() => memory.state.memoryRequests.filter(request => request.action === 'extract').length).toBe(2);
  await expect.poll(() => memory.page.evaluate(() => JSON.parse(localStorage.getItem('amadeus.memories')).filter(entry => entry.source === 'conversation' && !entry.processed).length)).toBe(0);
  await memory.page.getByRole('button', { name: '对话记录' }).click();
  memory.page.once('dialog', dialog => dialog.accept());
  await memory.page.getByRole('button', { name: '清空对话', exact: true }).last().click();
  await memory.page.getByRole('button', { name: '关闭对话记录' }).click();
  await memory.page.getByRole('button', { name: '打开设置', exact: true }).click();
  await memory.page.getByRole('tab', { name: '记忆', exact: true }).click();
  await expect(memory.page.locator('.memory-entry')).toHaveCount(1);
  memory.page.once('dialog', dialog => dialog.accept());
  await memory.page.getByRole('button', { name: '清空记忆', exact: true }).click();
  await expect(memory.page.locator('.memory-entry')).toHaveCount(0);
  await memory.page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await memory.page.evaluate(() => JSON.parse(localStorage.getItem('amadeus.memories'))), []);
  assert.deepEqual(memory.errors, []);
  await memory.context.close();
  record({ check: 'mobile memory persists, enters chat context, survives transcript clearing and can be deleted', status: 'PASS' });
  const smart = await session({ width: 390, height: 844 });
  await smart.page.evaluate(() => localStorage.setItem('amadeus.settings', JSON.stringify({ autoSpeak: false, memoryEnabled: true, semanticMemory: true })));
  await smart.page.reload({ waitUntil: 'networkidle' });
  smart.state.memoryResult = body => ({ facts: [{ key: '居住城市', text: body.turns.at(-1).text.includes('上海') ? '用户现居上海。' : '用户住北京。', scope: 'user', kind: 'profile', tags: ['家', '城市'], evidence: [{ id: body.turns.at(-1).id, quote: body.turns.at(-1).text }], supersedes: body.existing.map(entry => entry.id) }] });
  for (const text of ['我住北京。', '我已经搬到上海了。']) {
    await smart.page.getByLabel('给红莉栖的消息').fill(text);
    await smart.page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(smart.page.getByLabel('给红莉栖的消息')).toBeEnabled();
    await expect.poll(() => smart.page.evaluate(() => JSON.parse(localStorage.getItem('amadeus.memories')).filter(entry => entry.source === 'learned').length)).toBe(text.includes('上海') ? 2 : 1);
  }
  await smart.page.getByRole('button', { name: '打开设置', exact: true }).click();
  await smart.page.getByRole('tab', { name: '记忆', exact: true }).click();
  await expect(smart.page.getByRole('combobox', { name: '记忆分类' })).toHaveCount(0);
  await expect(smart.page.locator('.memory-entry')).toHaveCount(2);
  await expect(smart.page.locator('.memory-entry').first()).toContainText('用户现居上海。');
  await smart.page.getByText('记忆依据', { exact: true }).first().click();
  await expect(smart.page.locator('.memory-entry').first()).toContainText('我已经搬到上海了。');
  await noOverflow(smart.page);
  await smart.page.screenshot({ path: resolve(outputDir, 'smart-memory.png') });
  await smart.page.getByRole('button', { name: '关闭设置', exact: true }).click();
  smart.state.memoryGate = deferred();
  await smart.page.getByLabel('给红莉栖的消息').fill('我住天津。');
  await smart.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => smart.state.memoryRequests.length).toBe(3);
  await smart.page.getByRole('button', { name: '打开设置', exact: true }).click();
  await smart.page.getByRole('tab', { name: '记忆', exact: true }).click();
  smart.page.once('dialog', dialog => dialog.accept());
  await smart.page.getByRole('button', { name: '清空记忆', exact: true }).click();
  smart.state.memoryGate.release(); smart.state.memoryGate = null;
  await smart.page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await smart.page.evaluate(() => JSON.parse(localStorage.getItem('amadeus.memories'))), []);
  await smart.page.evaluate(() => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: `old-${i}`, source: 'learned', kind: 'event', scope: 'user', text: `过去的第 ${i} 次散步`, time: i }));
    entries.push({ id: 'coffee', source: 'learned', scope: 'user', kind: 'event', text: '喝拿铁后睡不着。', time: 100 });
    localStorage.setItem('amadeus.memories', JSON.stringify(entries));
  });
  await smart.page.reload({ waitUntil: 'networkidle' });
  smart.state.recallIds = ['coffee']; smart.state.memoryResult = { facts: [] };
  await smart.page.getByLabel('给红莉栖的消息').fill('晚上想来杯热饮，有什么建议？');
  await smart.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => smart.state.chats.length).toBe(4);
  assert.ok(smart.state.memoryRequests.some(request => request.action === 'recall'));
  assert.ok(smart.state.chats.at(-1).memories.some(entry => entry.text === '喝拿铁后睡不着。'));
  assert.deepEqual(smart.errors, []);
  await smart.context.close();
  record({ check: 'structured facts, correction history, source evidence, deletion during extraction and semantic recall fixture', status: 'PASS' });
  const expressive = await session({ width: 390, height: 844 });
  await configureApi(expressive.page);
  expressive.state.speechSeconds = 6;
  expressive.state.reply = '嗯，[emotion:skeptical]这份结论还需要再核对一下，[emotion:tender]没关系，我们一起慢慢来。';
  await expressive.page.evaluate(() => {
    window.expressionEvents = [];
    const character = document.querySelector('.character-hit');
    new MutationObserver(() => window.expressionEvents.push({ ...character.dataset })).observe(character, { attributes: true });
  });
  await expressive.page.getByLabel('给红莉栖的消息').fill('【测试夹具】请核对结论。');
  await expressive.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(expressive.page.locator('.character-hit')).toHaveAttribute('data-expression', 'skeptical');
  await expect(expressive.page.locator('.character-hit')).toHaveAttribute('data-state', 'speaking');
  await expect(expressive.page.locator('.character')).toHaveAttribute('src', /assets\/kurisu\/expressions-v3\/skeptical[1234]\.png$/);
  await expressive.page.screenshot({ path: resolve(outputDir, 'expression-skeptical.png') });
  await expect(expressive.page.locator('.character-hit')).toHaveAttribute('data-expression', 'tender');
  await expressive.page.screenshot({ path: resolve(outputDir, 'expression-tender.png') });
  await expect(expressive.page.locator('.character-hit')).toHaveAttribute('data-state', 'idle');
  assert.equal(expressive.state.speeches.length, 1, 'inline markers must not fragment speech synthesis');
  assert.doesNotMatch(expressive.state.speeches[0].text, /emotion:/);
  assert.doesNotMatch(await expressive.page.locator('.subtitle-text').textContent(), /emotion:/);
  assert.ok(await expressive.page.evaluate(() => window.expressionEvents.some(event => event.blinking === 'true' && event.state === 'speaking')), 'speaking must not suppress blinking');
  await expressive.page.getByRole('button', { name: '重播当前回复', exact: true }).click();
  await expect(expressive.page.locator('.character-hit')).toHaveAttribute('data-expression', 'skeptical');
  await expect(expressive.page.locator('.character-hit')).toHaveAttribute('data-expression', 'tender');
  assert.equal(expressive.state.speeches.length, 1, 'replay keeps the same audio cache and expression cues');
  await expect(expressive.page.locator('.character')).toHaveAttribute('src', /assets\/kurisu\/expressions-v3\/tender[1234]\.png$/);
  assert.deepEqual(expressive.errors, []);
  await expressive.context.close();
  record({ check: 'inline emotion playback, speaking blink, cached replay and original-reference expression frames', status: 'PASS' });
  console.log(JSON.stringify({ source: appUrl, network: 'Account, models, local voice, chat and generated speech are fixture responses; no real provider calls.', checks: results }, null, 2));
} finally {
  await browser.close();
}
