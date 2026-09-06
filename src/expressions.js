export const emotionNames = new Set(['neutral', 'happy', 'angry', 'sad', 'surprised', 'thinking', 'blush', 'annoyed', 'pleasant', 'indifferent', 'worried', 'disappointed', 'wink', 'skeptical', 'tender', 'amused']);

// Offsets refer to visible/spoken text, never to the control markers.
export function expressionText(raw, initial = 'neutral') {
  raw = raw.replace(/\[(?:e(?:m(?:o(?:t(?:i(?:o(?:n(?::[^\]]*)?)?)?)?)?)?)?)?$/i, '');
  let text = '', end = 0;
  const cues = [{ offset: 0, emotion: initial }];
  for (const match of raw.matchAll(/\[emotion:\s*(\w+)\]/gi)) {
    text += raw.slice(end, match.index);
    const emotion = match[1].toLowerCase();
    if (emotionNames.has(emotion)) cues.push({ offset: text.length, emotion });
    end = match.index + match[0].length;
  }
  text += raw.slice(end);
  const leading = text.length - text.trimStart().length;
  return { text: text.trim(), cues: cues.map(cue => ({ ...cue, offset: Math.max(0, cue.offset - leading) })) };
}

export function emotionAt(cues, offset) {
  return cues?.findLast(cue => cue.offset <= offset)?.emotion || 'neutral';
}

export function segmentExpressions(cues, start, end) {
  return [{ offset: 0, emotion: emotionAt(cues, start) }, ...(cues || [])
    .filter(cue => cue.offset > start && cue.offset < end)
    .map(cue => ({ ...cue, offset: cue.offset - start }))];
}
