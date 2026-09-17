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

function tokens(text) {
  const normalized = simplifyChinese(text).toLowerCase();
  return [...normalized.matchAll(/[a-z0-9_]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu)]
    .flatMap(([word]) => /^[a-z0-9_]+$/.test(word) ? [word] : Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2)));
}

export const memoryKinds = { profile: '个人资料', preference: '偏好与习惯', goal: '目标与进展', event: '事件与计划', relationship: '关系与约定', scene: '剧情进度' };

export function savedMemories(memories) {
  return memories.filter(entry => entry.source !== 'conversation');
}

export function pendingMemories(memories) {
  return memories.filter(entry => entry.source === 'conversation' && !entry.processed);
}

export function extractionBatch(memories) {
  const turns = pendingMemories(memories).slice(-6).sort((a, b) => a.time - b.time).map(entry => {
    const offset = entry.processedChars || 0;
    const end = Math.min(offset + 6000, entry.text.length);
    return { id: entry.id, text: entry.text.slice(Math.max(0, offset - 300), end), reply: (entry.reply || '').slice(0, 3000), time: entry.time, end };
  });
  if (!turns.length) return { turns, context: [] };
  const ids = new Set(turns.map(turn => turn.id));
  const context = memories.filter(entry => entry.source === 'conversation' && !entry.forgotten && !ids.has(entry.id) && entry.time <= turns.at(-1).time)
    .sort((a, b) => b.time - a.time).slice(0, 2).reverse()
    .map(entry => ({ id: entry.id, text: entry.text.slice(-3000), reply: (entry.reply || '').slice(-1500), time: entry.time }));
  return { turns, context };
}

export function rankMemories(memories, query) {
  const words = new Set(tokens(query));
  const normalizedQuery = simplifyChinese(query).toLowerCase();
  const historical = /以前|之前|曾经|过去|去年|上次|变化|原来|住过|历史|当时/.test(query);
  const documents = savedMemories(memories).map(entry => {
    const content = tokens(`${entry.text} ${entry.key || ''} ${(entry.tags || []).join(' ')} ${(entry.entities || []).join(' ')} ${entry.eventDate || ''}`);
    const counts = new Map();
    for (const token of content) counts.set(token, (counts.get(token) || 0) + 1);
    return { entry, counts, length: content.length };
  });
  const frequency = new Map();
  for (const { counts } of documents) for (const word of words) if (counts.has(word)) frequency.set(word, (frequency.get(word) || 0) + 1);
  const average = documents.reduce((sum, doc) => sum + doc.length, 0) / (documents.length || 1) || 1;
  // BM25 rewards distinctive names/details without letting long or repetitive records dominate.
  return documents.map(({ entry, counts, length }, index) => {
      let relevance = 0;
      for (const word of words) {
        const count = counts.get(word) || 0;
        if (!count) continue;
        const df = frequency.get(word);
        const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
        relevance += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * length / average));
      }
      const entityMatches = (entry.entities || []).filter(entity => normalizedQuery.includes(simplifyChinese(entity).toLowerCase())).length;
      const ageDays = Math.max(0, (Date.now() - (entry.time || 0)) / 86400000);
      const score = relevance + entityMatches * 3 +
        (['profile', 'preference', 'goal', 'scene', 'relationship'].includes(entry.kind) ? 0.5 : 0) +
        (entry.importance || 1) * 0.2 + Math.min(0.6, Math.log2(entry.evidence?.length || 1) * 0.15) +
        0.3 / (1 + ageDays / 30) - (entry.supersededBy && !historical ? 10 : 0);
      return { entry, index, score };
    }).sort((a, b) => b.score - a.score || b.entry.time - a.entry.time || b.index - a.index)
    .map(({ entry }) => entry);
}

export function memoryCandidates(memories, query, limit = 160) {
  const ranked = rankMemories(memories, query);
  const anchors = ranked.slice(0, 8);
  const related = ranked.filter(entry => !entry.supersededBy && anchors.some(anchor => anchor.scope === entry.scope &&
    anchor.entities?.some(entity => entry.entities?.includes(entity)))).slice(0, Math.floor(limit / 5));
  const core = ranked.filter(entry => !entry.supersededBy && entry.importance === 3).slice(0, 8);
  const selected = [...new Map([...ranked.slice(0, Math.floor(limit * 0.7)), ...related, ...core, ...ranked].map(entry => [entry.id, entry])).values()].slice(0, limit);
  return selected.map(entry => ({
    id: entry.id, text: entry.text.slice(0, 600), source: entry.source, scope: entry.scope,
    kind: entry.kind, key: entry.key, tags: entry.tags, time: entry.time,
    entities: entry.entities, importance: entry.importance, eventDate: entry.eventDate, state: entry.state,
    ...(entry.supersededBy ? { status: 'superseded' } : {}),
  }));
}

export function mergeFacts(memories, facts, turns, context = []) {
  const sourceIds = new Set(turns.map(turn => turn.id));
  // A deleted source must never be resurrected by an in-flight model response.
  if (turns.some(turn => !memories.some(entry => entry.id === turn.id && !entry.forgotten))) return memories;
  const sources = new Map([...context, ...turns].map(turn => [turn.id, turn]));
  let result = memories.map(entry => {
    if (!sourceIds.has(entry.id)) return entry;
    const end = sources.get(entry.id).end ?? entry.text.length;
    return { ...entry, processedChars: end, processed: end >= entry.text.length };
  });
  for (const fact of facts) {
    if (fact.evidence.some(item => !memories.some(entry => entry.id === item.id && !entry.forgotten))) continue;
    const time = Math.max(...fact.evidence.filter(item => sourceIds.has(item.id)).map(item => sources.get(item.id).time));
    const newEvidence = fact.evidence.map(item => ({ ...item, time: sources.get(item.id).time }));
    const related = result.filter(entry => entry.source === 'learned' && entry.scope === fact.scope && !entry.supersededBy &&
      fact.supersedes.includes(entry.id));
    if (related.some(entry => entry.time > time)) continue;
    const duplicate = result.find(entry => entry.source === 'learned' && entry.scope === fact.scope && !entry.supersededBy && entry.text === fact.text);
    if (duplicate) {
      const evidence = [...new Map([...(duplicate.evidence || []), ...newEvidence].map(item => [`${item.id}:${item.quote}`, item])).values()].slice(-12);
      result = result.map(entry => entry.id === duplicate.id ? { ...entry, evidence, time: Math.max(entry.time, time),
        importance: Math.max(entry.importance || 1, fact.importance || 1),
        entities: [...new Set([...(entry.entities || []), ...(fact.entities || [])])].slice(0, 8),
        tags: [...new Set([...(entry.tags || []), ...fact.tags])].slice(0, 8) } : entry);
      // A return to an earlier value still supersedes the explicitly corrected state.
      const replaced = new Set(related.filter(entry => entry.id !== duplicate.id).map(entry => entry.id));
      result = result.map(entry => replaced.has(entry.id) ? { ...entry, supersededBy: duplicate.id } : entry);
      continue;
    }
    const id = crypto.randomUUID();
    const replaced = new Set(related.map(entry => entry.id));
    const evidence = [...new Map([...related.flatMap(entry => entry.evidence || []), ...newEvidence].map(item => [`${item.id}:${item.quote}`, item])).values()].slice(-12);
    result = result.map(entry => replaced.has(entry.id) ? { ...entry, supersededBy: id } : entry);
    result.push({ id, source: 'learned', time, key: fact.key, text: fact.text, scope: fact.scope, kind: fact.kind,
      tags: fact.tags, evidence, entities: fact.entities || [], importance: fact.importance || 1,
      ...(fact.eventDate ? { eventDate: fact.eventDate } : {}), ...(fact.state ? { state: fact.state } : {}) });
  }
  return result;
}

export function deleteMemory(memories, id) {
  const sources = new Set(memories.find(entry => entry.id === id)?.evidence?.map(item => item.id));
  return memories.filter(entry => entry.id !== id && !entry.evidence?.some(item => item.id === id))
    .map(entry => entry.source === 'conversation' && sources.has(entry.id) ? { ...entry, processed: true, forgotten: true } : entry);
}

function contextMemory(entry) {
  return { text: entry.text, ...(entry.reply ? { reply: entry.reply } : {}),
    ...(entry.source === 'learned' ? { scope: entry.scope, kind: entry.kind, time: entry.time,
      eventDate: entry.eventDate, state: entry.state, entities: entry.entities,
      evidence: entry.evidence?.slice(-2).map(item => ({ quote: item.quote.slice(0, 300), time: item.time })),
      status: entry.supersededBy ? 'superseded' : 'current' } : {}) };
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
  const core = ranked.filter(entry => entry.source === 'learned' && !entry.supersededBy && ['profile', 'preference', 'goal', 'scene', 'relationship'].includes(entry.kind))
    .sort((a, b) => (b.importance || 1) - (a.importance || 1)).slice(0, 6);
  const recalled = recalledIds ? recalledIds.map(id => candidates.find(entry => entry.id === id)).filter(Boolean) : ranked.filter(entry => !entry.supersededBy);
  const anchors = recalled.slice(0, 16);
  const linked = ranked.filter(entry => !entry.supersededBy && !anchors.includes(entry) && anchors.some(anchor => anchor.scope === entry.scope &&
    anchor.entities?.some(entity => entry.entities?.includes(entity)))).slice(0, 4);
  const selectedEntries = [...new Map([...anchors, ...core, ...linked].map(entry => [entry.id, entry])).values()].slice(0, 24);
  let budget = 14000;
  const selected = [];
  for (const entry of selectedEntries) {
    const item = { ...contextMemory(entry), text: entry.text.slice(0, 1200), ...(entry.reply ? { reply: entry.reply.slice(0, 600) } : {}) };
    const size = JSON.stringify(item).length + 1;
    if (size > budget) continue;
    selected.push(item); budget -= size;
  }
  return { messages: recent.map(({ role, content, image }) => ({ role, content, ...(image ? { image } : {}) })), memories: selected };
}
