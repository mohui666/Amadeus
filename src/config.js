import { Converter } from 'opencc-js/t2cn';
import { expressionText } from './expressions.js';

export const simplifyChinese = Converter({ from: 't', to: 'cn' });

export const defaults = {
  chat: { provider: 'chatgpt', baseUrl: '', apiKey: '', model: '', reasoningEffort: '' },
  stt: { provider: 'local', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'whisper-1', language: 'zh' },
  speechInputVersion: 1,
  tts: { provider: 'browser', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'tts-1', voice: 'alloy', speed: 1, referenceAudio: '', promptText: '', promptLang: 'ja', textLang: 'zh' },
  autoSpeak: true,
  language: 'zh-CN',
  replyMode: 'ja-zh',
  persona: '',
};

export function readSettings() {
  const saved = localStorage.getItem('amadeus.settings');
  if (!saved) return structuredClone(defaults);
  try {
    const value = JSON.parse(saved);
    delete value.memoryEnabled;
    delete value.semanticMemory;
    // Repair the old default input routes while keeping custom API configurations.
    if (!value.speechInputVersion && (value.stt?.provider === 'browser' ||
      (value.stt?.provider === 'openai' && value.stt.baseUrl?.replace(/\/+$/, '') === 'https://api.openai.com/v1' && value.stt.model === 'whisper-1' && !value.stt.apiKey))) {
      value.stt = { ...value.stt, provider: 'local' };
    }
    return { ...defaults, ...value, chat: { ...defaults.chat, ...value.chat, apiKey: '' }, stt: { ...defaults.stt, ...value.stt, apiKey: '' }, tts: { ...defaults.tts, ...value.tts, apiKey: '' } };
  } catch { return structuredClone(defaults); }
}

export function persistSettings(config) {
  const saved = structuredClone(config);
  delete saved.memoryEnabled;
  delete saved.semanticMemory;
  for (const kind of ['chat', 'stt', 'tts']) delete saved[kind].apiKey;
  localStorage.setItem('amadeus.settings', JSON.stringify(saved));
}

function rawReply(text) {
  const start = text.trimStart().toLowerCase();
  if (start.startsWith('[') && !start.includes(']') && ('emotion:'.startsWith(start.slice(1)) || start.startsWith('[emotion:'))) return '';
  const content = text.replace(/^\s*\[emotion:\s*\w+\]\s*/i, '');
  const boundary = content.search(/\[speech:/i);
  if (boundary !== -1) return content.slice(0, boundary).trimEnd();
  return content.replace(/\n\[(?:s(?:p(?:e(?:e(?:c(?:h)?)?)?)?)?)?$/i, '').trimEnd();
}
export function cleanReply(text, simplified = false) {
  const content = expressionText(rawReply(text)).text;
  return simplified ? simplifyChinese(content) : content;
}
export function spokenReply(text, translated = true) {
  const match = translated && /\[speech:(ja|zh|en)\]\s*([\s\S]*)$/i.exec(text);
  return { ...expressionText(match ? match[2] : rawReply(text), getEmotion(text)), language: match ? match[1].toLowerCase() : null };
}
export function getEmotion(text, latest = false) {
  const first = text.match(/^\s*\[emotion:\s*(\w+)\]/i)?.[1]?.toLowerCase() || 'neutral';
  return latest ? expressionText(rawReply(text), first).cues.at(-1).emotion : first;
}
