import { useEffect, useRef, useState } from 'react';
import { request, readJsonResponse } from './api.js';
import { rememberTurn, pendingMemories, memoryCandidates, mergeFacts } from './memory.js';
import { cleanReply } from './config.js';

export function useMemory(config, memories, setMemories) {
  const current = useRef(memories);
  current.current = memories;
  const job = useRef(null);
  const recallJob = useRef(null);
  const [organizing, setOrganizing] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const [error, setError] = useState('');

  function stop() {
    job.current?.abort(); job.current = null; setOrganizing(false);
    recallJob.current?.abort(); recallJob.current = null; setRecalling(false);
  }
  function change(update) {
    stop(); setError('');
    const next = typeof update === 'function' ? update(current.current) : update;
    current.current = next; setMemories(next);
  }
  useEffect(() => () => { job.current?.abort(); recallJob.current?.abort(); }, []);

  async function organize() {
    if (job.current) return;
    const controller = new AbortController(); job.current = controller;
    setOrganizing(true); setError('');
    // Each pass processes distinct source turns; failures are surfaced, never retried.
    try {
      do {
        const pending = pendingMemories(current.current);
        const batch = pending.slice(-6);
        if (!batch.length) break;
        const turns = batch.map(entry => ({ id: entry.id, text: entry.text.slice(0, 6000), reply: (entry.reply || '').slice(0, 3000), time: entry.time }));
        const existing = memoryCandidates(current.current.filter(entry => entry.source === 'learned' && !entry.supersededBy), turns.map(turn => turn.text).join('\n'));
        const response = await request('/api/memory', { action: 'extract', config: { chat: config.chat }, turns, existing }, controller.signal);
        const { facts } = await readJsonResponse(response);
        controller.signal.throwIfAborted();
        const next = mergeFacts(current.current, facts, turns);
        current.current = next; setMemories(next);
      } while (pendingMemories(current.current).length);
    } catch (error) {
      if (!controller.signal.aborted) setError(`记忆整理未完成：${error.message}`);
    } finally {
      if (job.current === controller) { job.current = null; setOrganizing(false); }
    }
  }

  function remember(user, assistant) {
    const next = rememberTurn(current.current, user, assistant);
    current.current = next; setMemories(next);
    void organize();
  }

  async function recall(history, signal) {
    const query = history.slice(-3).map(message => `${message.role}: ${cleanReply(message.content)}`).join('\n').slice(-6000);
    const recentIds = new Set(history.slice(-12).map(message => message.id));
    const candidates = memoryCandidates(current.current.filter(entry => !recentIds.has(entry.id)), query);
    if (candidates.length <= 8) return undefined;
    const controller = new AbortController(); recallJob.current = controller;
    setRecalling(true);
    try {
      const response = await request('/api/memory', { action: 'recall', config: { chat: config.chat }, query, candidates }, AbortSignal.any([signal, controller.signal]));
      const result = await readJsonResponse(response);
      controller.signal.throwIfAborted();
      return result.ids;
    } finally { if (recallJob.current === controller) { recallJob.current = null; setRecalling(false); } }
  }

  return { organizing, recalling, error, stop, change, remember, recall };
}
