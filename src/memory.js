import { cleanReply, simplifyChinese } from './config.js';
import { readLocalData, writeLocalData } from './localData.js';

export function rememberTurn(memories, user, assistant) {
  if (!user || !assistant.content || assistant.error || assistant.pending || assistant.demo) return memories;
  if (memories.some(entry => entry.id === assistant.id)) return memories;
  return [...memories, { id: assistant.id, time: assistant.time, text: user.content, reply: cleanReply(assistant.content, true), source: 'conversation' }];
}

export function readMemories() {
  const saved = readLocalData('memories');
  return saved === null ? [] : JSON.parse(saved);
}

export function persistMemories(entries) {
  writeLocalData('memories', JSON.stringify(entries));
}

function terms(text) {
  const normalized = simplifyChinese(text).toLowerCase();
  return new Set([...normalized.matchAll(/[a-z0-9_]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu)]
    .flatMap(([word]) => /^[a-z0-9_]+$/.test(word) ? [word] : Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))));
}

export const memoryKinds = { profile: '个人资料', event: '事件与计划', relationship: '关系与约定', scene: '剧情进度' };

export function savedMemories(memories) {
  return memories.filter(entry => entry.source !== 'conversation');
}

export function pendingMemories(memories) {
  return memories.filter(entry => entry.source === 'conversation' && !entry.processed);
}

export function rankMemories(memories, query) {
  const words = terms(query);
  const historical = /以前|之前|曾经|过去|去年|上次|变化|原来|住过|历史|当时/.test(query);
  return savedMemories(memories)
    .map((entry, index) => {
      const content = terms(`${entry.text} ${entry.key || ''} ${(entry.tags || []).join(' ')}`);
      const overlap = [...words].filter(word => content.has(word)).length;
      const ageDays = Math.max(0, (Date.now() - (entry.time || 0)) / 86400000);
      const score = overlap / Math.sqrt(content.size || 1) * 8 +
        (['profile', 'scene', 'relationship'].includes(entry.kind) ? 0.5 : 0) +
        0.3 / (1 + ageDays / 30) - (entry.supersededBy && !historical ? 10 : 0);
      return { entry, index, score };
    }).sort((a, b) => b.score - a.score || b.entry.time - a.entry.time || b.index - a.index)
    .map(({ entry }) => entry);
}

export function memoryCandidates(memories, query) {
  return rankMemories(memories, query).slice(0, 80).map(entry => ({
    id: entry.id, text: entry.text.slice(0, 400), source: entry.source, scope: entry.scope,
    kind: entry.kind, key: entry.key, tags: entry.tags, time: entry.time,
    ...(entry.supersededBy ? { status: 'superseded' } : {}),
  }));
}

export function mergeFacts(memories, facts, turns) {
  const sourceIds = new Set(turns.map(turn => turn.id));
  // A deleted source must never be resurrected by an in-flight model response.
  if (turns.some(turn => !memories.some(entry => entry.id === turn.id))) return memories;
  let result = memories.map(entry => sourceIds.has(entry.id) ? { ...entry, processed: true } : entry);
  for (const fact of facts) {
    const time = Math.max(...fact.evidence.map(item => turns.find(turn => turn.id === item.id).time));
    const related = result.filter(entry => entry.source === 'learned' && entry.scope === fact.scope && !entry.supersededBy &&
      (fact.supersedes.includes(entry.id) || (entry.kind === fact.kind && entry.key === fact.key && fact.kind !== 'event')));
    if (related.some(entry => entry.time > time)) continue;
    const duplicate = result.find(entry => entry.source === 'learned' && entry.scope === fact.scope && !entry.supersededBy && entry.text === fact.text);
    if (duplicate) continue;
    const id = crypto.randomUUID();
    const replaced = new Set(related.map(entry => entry.id));
    result = result.map(entry => replaced.has(entry.id) ? { ...entry, supersededBy: id } : entry);
    result.push({ id, source: 'learned', time, key: fact.key, text: fact.text, scope: fact.scope, kind: fact.kind,
      tags: fact.tags, evidence: fact.evidence });
  }
  return result;
}

export function deleteMemory(memories, id) {
  return memories.filter(entry => entry.id !== id && !entry.evidence?.some(item => item.id === id));
}

function contextMemory(entry) {
  return { text: entry.text, ...(entry.reply ? { reply: entry.reply } : {}),
    ...(entry.source === 'learned' ? { scope: entry.scope, kind: entry.kind, time: entry.time, status: entry.supersededBy ? 'superseded' : 'current' } : {}) };
}

// Keep the transcript intact; only the context sent to the model is bounded.
export function buildContext(history, memories, recalledIds) {
  const recent = [];
  let size = 0;
  for (let i = history.length - 1; i >= 0 && recent.length < 12; i--) {
    const message = history[i];
    const content = message.role === 'assistant' ? cleanReply(message.content) : message.content;
    if (recent.length && size + content.length > 16000) break;
    recent.unshift({ ...message, content });
    size += content.length;
  }
  while (recent.length > 1 && recent[0].role !== 'user') recent.shift();
  const ids = new Set(recent.map(message => message.id));
  const query = history.slice(-3).map(message => cleanReply(message.content)).join('\n');
  const candidates = savedMemories(memories).filter(entry => !ids.has(entry.id));
  const ranked = rankMemories(candidates, query);
  const core = ranked.filter(entry => entry.source === 'learned' && !entry.supersededBy && ['profile', 'scene', 'relationship'].includes(entry.kind)).slice(0, 2);
  const recalled = recalledIds ? recalledIds.map(id => candidates.find(entry => entry.id === id)).filter(Boolean) : ranked.filter(entry => !entry.supersededBy);
  const selectedEntries = [...new Map([...core, ...recalled].map(entry => [entry.id, entry])).values()].slice(0, 8);
  let budget = 6000;
  const selected = [];
  for (const entry of selectedEntries) {
    const text = entry.text.slice(0, Math.min(1200, budget));
    budget -= text.length;
    const reply = (entry.reply || '').slice(0, Math.min(600, budget));
    budget -= reply.length;
    selected.push({ ...contextMemory(entry), text, ...(reply ? { reply } : { reply: undefined }) });
    if (!budget) break;
  }
  return { messages: recent.map(({ role, content, image }) => ({ role, content, ...(image ? { image } : {}) })), memories: selected };
}
