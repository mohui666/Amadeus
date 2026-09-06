import { spokenReply } from './config.js';
import { segmentExpressions } from './expressions.js';

export function sentenceRanges(text, final = true) {
  const ranges = [];
  let start = 0;
  for (const match of text.matchAll(/[。！？!?]+[」』”’）)"”]*|\.(?=\s)/g)) {
    const end = match.index + match[0].length;
    // Trailing punctuation/quotes may still grow in the next network chunk.
    if (!final && end === text.length) break;
    if (text.slice(start, end).trim()) ranges.push({ start, end, text: text.slice(start, end) });
    start = end;
  }
  if (final && text.slice(start).trim()) ranges.push({ start, end: text.length, text: text.slice(start) });
  return ranges;
}

// Synthesis runs ahead of ordered playback; all pending work shares cancellation.
export function createSpeechStream({ mode, synthesize, play, stop, onError, savedSegments = [], expressionCues }) {
  const controller = new AbortController();
  const { signal } = controller;
  let consumed = 0;
  let synthesis = Promise.resolve();
  let playback = Promise.resolve();
  let firstAudio;
  let segmentIndex = 0;
  const cancel = () => controller.abort();
  const fail = error => {
    if (signal.aborted) return;
    cancel();
    stop();
    onError(error.message);
  };
  function enqueue(text, language, start, end, cues) {
    if (!text.trim() || signal.aborted) return;
    const leading = text.length - text.trimStart().length;
    const segment = { text: text.trim(), language, start, end, index: segmentIndex++, cues: segmentExpressions(cues, start + leading, end) };
    const prepared = synthesis.then(() => { signal.throwIfAborted(); return synthesize(segment.text, language, signal, segment); });
    synthesis = prepared;
    firstAudio ??= prepared;
    prepared.catch(() => {}); // Report in playback order, after already prepared sentences.
    playback = playback.then(async () => {
      const audio = await prepared;
      signal.throwIfAborted();
      await play(audio, segment);
    });
    playback.catch(fail);
  }
  function update(reply, final = false) {
    if (signal.aborted) return;
    const spoken = spokenReply(reply, mode === 'ja-zh');
    if (mode !== 'ja-zh') spoken.language = mode === 'ja' ? 'ja' : 'zh';
    if (mode === 'ja-zh' && (spoken.language !== 'ja' || !spoken.text)) {
      if (final) fail(new Error('这次回复没有生成日语朗读内容，中文字幕已保留。'));
      return;
    }
    // Preserve the original saved boundaries, including older streaming splits.
    while (savedSegments[segmentIndex]) {
      const saved = savedSegments[segmentIndex];
      const remaining = spoken.text.slice(consumed);
      const whitespace = remaining.length - remaining.trimStart().length;
      if (saved.language !== spoken.language || !remaining.trimStart().startsWith(saved.text)) break;
      const end = consumed + whitespace + saved.text.length;
      enqueue(saved.text, spoken.language, consumed + whitespace, end, expressionCues || spoken.cues);
      consumed = end;
    }
    const offset = consumed;
    for (const segment of sentenceRanges(spoken.text.slice(offset), final)) {
      enqueue(segment.text, spoken.language, offset + segment.start, offset + segment.end, expressionCues || spoken.cues);
      consumed = offset + segment.end;
    }
  }
  return { update, finish: reply => update(reply, true), cancel, signal, ready: () => firstAudio?.catch(() => {}), synthesized: () => synthesis, done: () => playback };
}
