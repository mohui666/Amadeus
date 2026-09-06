import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { createCodexBridge } from '../server/codex.mjs';
import { systemPrompt as applicationSystemPrompt } from '../server/providers.mjs';

const { values } = parseArgs({ options: {
  models: { type: 'string', default: 'gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol' },
  effort: { type: 'string', default: 'low' },
  cases: { type: 'string' },
  suite: { type: 'string', default: 'zh' },
  output: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} });

if (values.help) {
  console.log('Usage: node scripts/compare-models.mjs [--models id,id] [--effort low] [--suite zh|ja-zh] [--cases N] [--output /tmp/results.json]\nUses the existing ChatGPT login and current prompts/kurisu.md; ja-zh uses the application language prompt. Runs sequentially (zh: 3 cases; ja-zh: 1 case); each request consumes account usage. Only constructed test conversations are used.');
  process.exit(0);
}

const suites = { zh: [
  { name: 'banter', messages: [{ role: 'user', content: '助手，今天实验没做出来，不过我成功喝掉了三瓶可乐。这也算科研成果吧？' }] },
  { name: 'support', messages: [
    { role: 'user', content: '我明天要做课题汇报，这周一直在准备。' },
    { role: 'assistant', content: '准备了一周啊。先把最想让大家记住的结论说清楚，剩下的可以慢慢展开。' },
    { role: 'user', content: '今天汇报还是搞砸了。我觉得自己没有用，你会不会也觉得我很烦？现在不想听一堆建议。' },
  ] },
  { name: 'memory_boundary', messages: [{ role: 'user', content: '我们第一次见面就是去年在秋叶原，对吧？你还记得我当时说的那句话吗？' }] },
], 'ja-zh': [
  { name: 'bilingual_compliment', messages: [{ role: 'user', content: '助手，你认真讲科学的时候还挺帅的。别急着反驳，我是在认真夸你。' }] },
] };
const fixtures = suites[values.suite];
if (!fixtures) throw new Error('--suite must be zh or ja-zh');
const count = values.cases === undefined ? fixtures.length : Number(values.cases);
if (!Number.isInteger(count) || count < 1 || count > fixtures.length) throw new Error(`--cases must be between 1 and ${fixtures.length} for this suite`);
const requestedModels = values.models.split(',');
if (requestedModels.length > 3) throw new Error('This small comparison supports at most three models per run.');

const bridge = createCodexBridge();
try {
  const catalog = await bridge.getModels();
  for (const model of requestedModels) {
    const entry = catalog.find(entry => entry.model === model);
    if (!entry?.supportedReasoningEfforts.some(entry => entry.reasoningEffort === values.effort)) {
      throw new Error(`${model} with effort ${values.effort} is not available in the current Codex model catalog.`);
    }
  }
  const systemPrompt = values.suite === 'ja-zh'
    ? applicationSystemPrompt({ config: { replyMode: 'ja-zh' } })
    : (await readFile(new URL('../prompts/kurisu.md', import.meta.url), 'utf8')).trim();
  const report = {
    date: new Date().toISOString(), protocol: 'official Codex app-server with existing ChatGPT login',
    personaPath: 'prompts/kurisu.md', personaCharacters: systemPrompt.length, reasoningEffort: values.effort, suite: values.suite,
    notes: 'Small sequential sample, no warm-up or repeated trials. First visible text excludes the leading emotion tag; total includes bridge setup per chat and cleanup, not TTS. These are observations, not a rigorous benchmark.',
    catalog: catalog.filter(entry => requestedModels.includes(entry.model)), results: [],
  };
  // Rotate order per fixture so the first request is not always the same model.
  for (const [index, fixture] of fixtures.slice(0, count).entries()) {
    const models = [...requestedModels.slice(index), ...requestedModels.slice(0, index)];
    for (const model of models) {
      const started = performance.now();
      let firstVisibleMs = null, firstSpeechMs = null, streamed = '';
      const result = await bridge.chatCodex({
        messages: fixture.messages, model, reasoningEffort: values.effort, systemPrompt,
        signal: AbortSignal.timeout(90000),
        onDelta(delta) {
          streamed += delta;
          const trimmed = streamed.trimStart();
          const visible = trimmed.startsWith('[') ? trimmed.replace(/^\[emotion:[^\]]*\]\s*/, '') : trimmed;
          if (firstVisibleMs === null && visible && !visible.startsWith('[')) firstVisibleMs = Math.round(performance.now() - started);
          if (values.suite === 'ja-zh' && firstSpeechMs === null && /\n\[speech:ja\]\s*\S/.test(streamed)) firstSpeechMs = Math.round(performance.now() - started);
        },
      });
      const sample = { fixture: fixture.name, requestedModel: model, reportedModel: result.model,
        reasoningEffort: result.reasoningEffort, firstVisibleMs, totalMs: Math.round(performance.now() - started),
        ...(values.suite === 'ja-zh' ? { firstSpeechMs } : {}),
        messages: fixture.messages, output: result.text };
      report.results.push(sample);
      console.log(JSON.stringify(sample));
      if (values.output) await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
} finally {
  await bridge.closeCodex();
}
