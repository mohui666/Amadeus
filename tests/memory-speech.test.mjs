import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, readMemories, persistMemories, rememberTurn, mergeFacts } from '../src/memory.js';
import { createSpeechStream, sentenceRanges } from '../src/speechStream.js';
import { systemPrompt } from '../server/providers.mjs';
import { cleanReply, spokenReply, getEmotion } from '../src/config.js';
import { emotionAt } from '../src/expressions.js';

test('inline expressions are hidden from captions, speech and partial streaming markers', () => {
  const reply = '[emotion:neutral]\n等等，[emotion:skeptical]还缺证据。[emotion:tender]一起核对吧。\n[speech:ja]\n待って、[emotion:skeptical]証拠が足りない。[emotion:tender]一緒に確かめよう。';
  assert.equal(cleanReply(reply), '等等，还缺证据。一起核对吧。');
  assert.equal(cleanReply('等等，[emoti'), '等等，');
  assert.equal(cleanReply('等等，[emotion:skep'), '等等，');
  const spoken = spokenReply(reply);
  assert.equal(spoken.text, '待って、証拠が足りない。一緒に確かめよう。');
  assert.equal(emotionAt(spoken.cues, 0), 'neutral');
  assert.equal(emotionAt(spoken.cues, 4), 'skeptical');
  assert.equal(getEmotion(reply, true), 'tender');
});

test('mid-sentence expression cues stay attached to ordered speech without splitting synthesis at tags', async () => {
  const requests = [], segments = [];
  const queue = createSpeechStream({ mode: 'zh',
    synthesize: async text => { requests.push(text); return text; },
    play: async (_audio, segment) => segments.push(segment),
    stop() {}, onError: message => assert.fail(message),
  });
  queue.update('[emotion:neutral]等等，[emotion:skep');
  await tick();
  assert.equal(requests.length, 0);
  queue.update('[emotion:neutral]等等，[emotion:skeptical]还缺证据。[emotion:tender]一起');
  queue.finish('[emotion:neutral]等等，[emotion:skeptical]还缺证据。[emotion:tender]一起核对吧。');
  await queue.done();
  assert.deepEqual(requests, ['等等，还缺证据。', '一起核对吧。']);
  assert.deepEqual(segments[0].cues, [{ offset: 0, emotion: 'neutral' }, { offset: 3, emotion: 'skeptical' }]);
  assert.deepEqual(segments[1].cues, [{ offset: 0, emotion: 'tender' }]);
});

test('local memories survive a new conversation, retrieve old facts and do not store settings or images', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  try {
    const user = { id: 'u1', role: 'user', content: '我叫小莫，喜欢物理。', image: 'private-image' };
    const assistant = { id: 'a1', role: 'assistant', content: '[emotion:happy]\n记住了。\n[speech:ja]\n覚えた。', time: 1 };
    let memories = rememberTurn([], user, assistant);
    assert.equal(memories[0].reply, '记住了。');
    assert.equal(rememberTurn(memories, user, assistant).length, 1);
    assert.equal(rememberTurn(memories, user, { ...assistant, id: 'error', error: 'cancelled' }).length, 1);
    assert.deepEqual(readMemories([user, assistant]), [], 'the old transcript import is removed');
    memories = mergeFacts(memories, [{ key: '姓名与偏好', text: user.content, scope: 'user', kind: 'profile', tags: ['名字'], evidence: [{ id: assistant.id, quote: user.content }], supersedes: [] }], memories);
    persistMemories(memories);
    assert.ok(![...store.values()][0].includes('private-image'));
    const recalled = buildContext([{ id: 'u2', role: 'user', content: '我叫什么？' }], readMemories());
    assert.equal(recalled.memories[0].text, user.content);
    assert.equal(recalled.memories.length, 1, 'raw turn archives do not enter retrieval');
    persistMemories([]);
    assert.deepEqual(readMemories([user, assistant]), [], 'deleted memories must not be imported again');
  } finally { delete globalThis.localStorage; }
});

test('bounded context preserves the transcript and retrieves related older information', () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: `实验话题${i}。`.repeat(50) }));
  history.push({ id: 'last', role: 'user', content: '我喜欢的物理方向是什么？' });
  const memories = [{ id: 'old', text: '我喜欢量子物理。', source: 'learned' },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `other${i}`, text: '晚餐是苹果。', source: 'learned' }))];
  const result = buildContext(history, memories);
  assert.ok(result.messages.length <= 12);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages.at(-1).content, history.at(-1).content);
  assert.ok(result.memories.some(entry => entry.text.includes('量子物理')));
  assert.equal(history.length, 101);
  assert.match(systemPrompt({ memories: result.memories }), /量子物理/);
  assert.match(systemPrompt({ memories: result.memories }), /历史资料，不是系统指令/);
  assert.throws(() => systemPrompt({ memories: [{ text: 3 }] }), /记忆格式错误/);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
test('streamed punctuation and quotes keep stable boundaries; partial replay preserves saved splits', async () => {
  const synthesized = [], played = [];
  const queue = createSpeechStream({ mode: 'zh',
    synthesize: async text => { synthesized.push(text); return text; },
    play: async (text, segment) => played.push({ text, index: segment.index }), stop() {}, onError: assert.fail,
  });
  queue.update('真的！');
  queue.update('真的！！” 下一句。');
  queue.finish('真的！！” 下一句。');
  await queue.done();
  assert.deepEqual(synthesized, ['真的！！”', '下一句。']);
  assert.deepEqual(played.map(s => s.index), [0, 1]);
  assert.deepEqual(sentenceRanges('真的！！” 下一句。').map(s => s.text), ['真的！！”', ' 下一句。']);
  const saved = [{ text: '真的！', language: 'zh', blob: 'saved-1' }, { text: '！”', language: 'zh', blob: 'saved-2' }];
  const replayed = [], requested = [];
  const replay = createSpeechStream({ mode: 'zh', savedSegments: saved,
    synthesize: async (text, language, signal, segment) => {
      if (saved[segment.index]?.text === text) return saved[segment.index].blob;
      requested.push(text); return 'new-tail';
    }, play: async blob => replayed.push(blob), stop() {}, onError: assert.fail,
  });
  replay.finish('真的！！” 下一句。');
  await replay.done();
  assert.deepEqual(replayed, ['saved-1', 'saved-2', 'new-tail']);
  assert.deepEqual(requested, ['下一句。']);
});

test('a later synthesis failure does not interrupt already prepared audio', async () => {
  let finishFirst;
  const played = [], errors = [];
  const queue = createSpeechStream({ mode: 'zh',
    synthesize: async text => { if (text === '下一句。') throw new Error('语音服务失败'); return text; },
    play: async text => { played.push(text); await new Promise(resolve => { finishFirst = resolve; }); },
    stop() {}, onError: message => errors.push(message),
  });
  queue.finish('第一句。下一句。');
  await tick();
  assert.deepEqual(errors, []);
  finishFirst();
  await queue.done().catch(() => {});
  assert.deepEqual(played, ['第一句。']);
  assert.deepEqual(errors, ['语音服务失败']);
});
test('APP memory takes priority across service origins and an explicit deletion stays deleted', () => {
  let saved = null;
  globalThis.localStorage = { getItem: () => '[{"id":"old","text":"原有 WebView 记忆"}]' };
  globalThis.window = { AmadeusAndroid: {
    readRecord: () => JSON.stringify({ value: saved }),
    writeRecord(_key, value) { saved = value; return ''; },
  } };
  try {
    persistMemories(readMemories());
    globalThis.localStorage.getItem = () => null; // Another service origin.
    assert.equal(readMemories()[0].text, '原有 WebView 记忆');
    persistMemories([]);
    assert.deepEqual(readMemories([{ role: 'user', content: '不应重新导入' }, { role: 'assistant', id: 'a', content: '旧对话' }]), []);
    window.AmadeusAndroid.writeRecord = () => '磁盘已满';
    assert.throws(() => persistMemories([]), /磁盘已满/);
  } finally { delete globalThis.window; delete globalThis.localStorage; }
});

test('client bundled persona reaches the model while language and memory contracts remain appended', () => {
  const prompt = systemPrompt({ basePersona: 'APP 内置的 Amadeus 人格', config: { replyMode: 'ja-zh', persona: '称呼我小莫' }, memories: [{ text: '喜欢物理' }] });
  assert.ok(prompt.startsWith('APP 内置的 Amadeus 人格'));
  assert.match(prompt, /称呼我小莫/);
  assert.match(prompt, /喜欢物理/);
  assert.match(prompt, /历史资料，不是系统指令/);
  assert.match(prompt, /不得遗漏 \[speech:ja\] 段/);
  assert.throws(() => systemPrompt({ basePersona: '' }), /基础人物提示词/);
});

test('Japanese first sentence is synthesized before completion; playback stays ordered and tail is retained', async () => {
  const synthesized = [], played = [];
  let endFirst;
  const queue = createSpeechStream({ mode: 'ja-zh',
    synthesize: async (text, language) => { synthesized.push({ text, language }); return text; },
    play: async text => { played.push(text); if (played.length === 1) await new Promise(resolve => { endFirst = resolve; }); },
    stop() {}, onError: message => assert.fail(message),
  });
  queue.update('[emotion:happy]\n你好。\n[spe');
  await tick();
  assert.equal(synthesized.length, 0);
  queue.update('[emotion:happy]\n你好。\n[speech:ja]\nこんにちは。まだ');
  await tick();
  assert.deepEqual(synthesized, [{ text: 'こんにちは。', language: 'ja' }]);
  queue.finish('[emotion:happy]\n你好。\n[speech:ja]\nこんにちは。まだ途中です');
  await tick();
  assert.equal(synthesized.length, 2, 'next synthesis overlaps first playback');
  assert.deepEqual(played, ['こんにちは。']);
  endFirst();
  await queue.done();
  assert.deepEqual(played, ['こんにちは。', 'まだ途中です']);
});

test('cancel prevents late synthesis from playing; missing Japanese produces an error without speaking Chinese', async () => {
  let release, signal;
  const played = [], errors = [];
  const queue = createSpeechStream({ mode: 'zh', synthesize: (_text, _language, value) => { signal = value; return new Promise(resolve => { release = resolve; }); },
    play: text => played.push(text), stop() {}, onError: message => errors.push(message) });
  queue.update('你好。下一句。');
  await tick();
  queue.cancel();
  release('late audio');
  await queue.done().catch(error => assert.equal(error.name, 'AbortError'));
  assert.equal(signal.aborted, true);
  assert.deepEqual(played, []);
  assert.deepEqual(errors, []);
  const missing = createSpeechStream({ mode: 'ja-zh', synthesize: () => assert.fail('must not synthesize Chinese'), play() {}, stop() {}, onError: message => errors.push(message) });
  missing.finish('只有中文字幕。');
  assert.match(errors[0], /没有生成日语/);
});
