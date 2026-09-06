import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mergeFacts, deleteMemory, buildContext, memoryCandidates, pendingMemories } from '../src/memory.js';
import { validateFacts, processMemory } from '../server/memory.mjs';

const turn = (id, text, time) => ({ id, text, reply: '听见了。', time, source: 'conversation' });
const fact = (source, text, changes = {}) => ({ key: '居住城市', scope: 'user', kind: 'profile', text,
  tags: ['居住地', '家', '城市'], evidence: [{ id: source.id, quote: source.text }], supersedes: [], ...changes });

test('explicit correction keeps history and evidence, separates roleplay, and rejects older current state', () => {
  const first = turn('t1', '我住北京。', 1000), second = turn('t2', '我已经搬到上海了。', 2000), scene = turn('t3', '剧情里我住秋叶原。', 3000);
  let memories = mergeFacts([first], [fact(first, '用户住北京。')], [first]);
  const oldId = memories.at(-1).id;
  memories = mergeFacts([...memories, second], [fact(second, '用户现居上海。', { supersedes: [oldId] })], [second]);
  memories = mergeFacts([...memories, scene], [fact(scene, '角色住秋叶原。', { scope: 'roleplay', kind: 'scene' })], [scene]);
  assert.ok(memories.find(entry => entry.id === oldId).supersededBy);
  assert.equal(memories.filter(entry => entry.source === 'learned' && !entry.supersededBy).length, 2);
  const current = buildContext([{ role: 'user', content: '我家在哪？' }], memories);
  assert.ok(current.memories.some(entry => entry.text === '用户现居上海。' && entry.scope === 'user'));
  assert.ok(!current.memories.some(entry => entry.text === '用户住北京。'));
  const past = buildContext([{ role: 'user', content: '以前住哪里？' }], memories, [oldId]);
  assert.ok(past.memories.some(entry => entry.status === 'superseded'));
  const stale = turn('t0', '我住天津。', 500);
  memories = mergeFacts([...memories, stale], [fact(stale, '用户住天津。')], [stale]);
  assert.ok(!memories.some(entry => entry.source === 'learned' && entry.text === '用户住天津。'));
  assert.equal(pendingMemories(memories).length, 0);
});

test('duplicate facts are not multiplied and deleting a source removes derived memories', () => {
  const first = turn('t1', '我住北京。', 1000), second = turn('t2', '我住北京。', 2000);
  let memories = mergeFacts([first], [fact(first, '用户住北京。')], [first]);
  memories = mergeFacts([...memories, second], [fact(second, '用户住北京。')], [second]);
  assert.equal(memories.filter(entry => entry.source === 'learned').length, 1);
  assert.ok(deleteMemory(memories, 't1').every(entry => !entry.evidence?.some(item => item.id === 't1')));
  assert.deepEqual(mergeFacts([], [fact(first, '用户住北京。')], [first]), []);
});

test('model output must cite user words and may not supersede manual or other-scope records', () => {
  const source = turn('t1', '我喜欢物理。', 1000);
  assert.throws(() => validateFacts({ facts: [fact(source, '用户喜欢苹果。', { evidence: [{ id: source.id, quote: '我喜欢苹果。' }] })] }, [source], []), /原话证据/);
  const manual = { id: 'manual', source: 'manual', scope: 'user', text: '叫我小莫' };
  assert.throws(() => validateFacts({ facts: [fact(source, '喜欢物理', { supersedes: ['manual'] })] }, [source], [manual]), /更新目标/);
  const story = { ...manual, id: 'story', source: 'learned', scope: 'roleplay' };
  assert.throws(() => validateFacts({ facts: [fact(source, '喜欢物理', { supersedes: ['story'] })] }, [source], [story]), /更新目标/);
});

test('retrieval includes extracted tags and semantic choices, excluding raw archived turns', () => {
  const memories = Array.from({ length: 100 }, (_, i) => ({ id: String(i), text: `事件 ${i}`, source: 'manual', time: i }));
  memories.push({ id: 'special', text: '用户不喝拿铁。', source: 'learned', scope: 'user', kind: 'profile', tags: ['咖啡', '饮品', '口味'], time: Date.now() });
  assert.ok(memoryCandidates(memories, '你记得我的咖啡口味吗？').some(entry => entry.id === 'special'));
  assert.equal(memoryCandidates(memories, '任何话题').length, 80);
  const history = [{ role: 'user', content: '给我推荐一杯热饮' }];
  assert.ok(buildContext(history, memories, ['special']).memories.some(entry => entry.text.includes('拿铁')));
  assert.deepEqual(buildContext(history, [turn('raw', '用户不喝拿铁。', Date.now())]).memories, []);
});

test('Codex memory tasks use a separate purpose, selected model, JSON output and cancellation signal', async () => {
  const source = turn('t1', '我喜欢物理。', 1000);
  const controller = new AbortController();
  const codex = { async chatCodex(args) {
    assert.equal(args.purpose, 'memory'); assert.equal(args.model, 'selected'); assert.equal(args.signal, controller.signal);
    assert.match(args.systemPrompt, /不进行角色对话/);
    args.onDelta(JSON.stringify({ facts: [fact(source, '用户喜欢物理。')] }));
  } };
  const result = await processMemory({ action: 'extract', config: { chat: { provider: 'chatgpt', model: 'selected' } }, turns: [source] }, controller.signal, codex);
  assert.equal(result.facts[0].text, '用户喜欢物理。');
});

for (const provider of ['openai', 'responses', 'anthropic']) {
  test(`${provider} memory retrieval forwards configured protocol and validates selected IDs`, async t => {
    const server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks));
      const prompt = payload.instructions || payload.system || payload.messages[0].content;
      assert.match(prompt, /记忆检索器/); assert.doesNotMatch(prompt, /本轮继续以 Amadeus/);
      const output = '{"ids":["coffee"]}';
      const events = provider === 'responses' ? [{ type: 'response.output_text.delta', delta: output }, { type: 'response.completed' }]
        : provider === 'anthropic' ? [{ type: 'content_block_delta', delta: { type: 'text_delta', text: output } }, { type: 'message_stop' }]
          : [{ choices: [{ delta: { content: output }, finish_reason: 'stop' }] }];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const result = await processMemory({ action: 'recall', config: { chat: { provider, model: 'chosen', baseUrl: `http://127.0.0.1:${server.address().port}` } }, query: '来杯热饮吧', candidates: [{ id: 'coffee', text: '用户不喝拿铁。' }] }, new AbortController().signal);
    assert.deepEqual(result.ids, ['coffee']);
  });
}
