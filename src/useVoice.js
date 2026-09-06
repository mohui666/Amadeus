import { useRef, useState, useEffect } from 'react';
import { readJsonResponse, request, fileDataUrl } from './api.js';
import { simplifyChinese } from './config.js';
import { phone } from './native.js';
import { createSpeechStream, sentenceRanges } from './speechStream.js';
import { readAudio, saveAudio } from './audioStore.js';
import { emotionAt, segmentExpressions } from './expressions.js';

export function useVoice(config, onRecognized, onError) {
  const onTranscript = text => onRecognized(config.language.startsWith('zh') ? simplifyChinese(text) : text);
  const [synthesizing, setSynthesizing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [activeSentence, setActiveSentence] = useState(null);
  const [expression, setExpression] = useState(null);
  const [openingMic, setOpeningMic] = useState(false);
  const openingMicRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [mouth, setMouth] = useState(1);
  const audio = useRef(null);
  const context = useRef(null);
  const frame = useRef(null);
  const ticker = useRef(null);
  const controller = useRef(null);
  const recorder = useRef(null);
  const stream = useRef(null);
  const recognition = useRef(null);
  const generation = useRef(0);
  const recordingGeneration = useRef(0);
  const recordController = useRef(null);
  const objectUrl = useRef(null);
  const speechQueue = useRef(null);
  const playbackEnd = useRef(null);
  const systemSpeech = useRef(null);

  function stop() {
    speechQueue.current?.cancel();
    speechQueue.current = null;
    stopPlayback();
    setSynthesizing(false);
    setExpression(null);
  }

  function showExpression(cues, offset, replyId) {
    const emotion = emotionAt(cues, offset);
    setExpression(previous => previous?.replyId === replyId && previous.emotion === emotion ? previous : { replyId, emotion });
  }

  function stopPlayback() {
    generation.current++;
    systemSpeech.current = null;
    controller.current?.abort();
    if (audio.current) { audio.current.pause(); audio.current = null; }
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
    window.speechSynthesis?.cancel();
    phone?.stopSpeaking();
    cancelAnimationFrame(frame.current);
    clearInterval(ticker.current);
    context.current?.close();
    context.current = null;
    setSpeaking(false);
    setActiveSentence(null);
    setMouth(1);
    playbackEnd.current?.resolve();
    playbackEnd.current = null;
  }

  async function play(url, revoke = false, waitForEnd = false, sentence = null) {
    stopPlayback();
    const id = generation.current;
    const ended = waitForEnd ? new Promise((resolve, reject) => { playbackEnd.current = { resolve, reject }; }) : null;
    ended?.catch(() => {});
    const player = new Audio(url);
    // Generated audio has no word timestamps; place inline cues proportionally
    // within this sentence. Native/system speech uses actual range events below.
    player.ontimeupdate = () => {
      if (id === generation.current && sentence && player.duration > 0) {
        showExpression(sentence.cues, player.currentTime / player.duration * sentence.text.length, sentence.replyId);
      }
    };
    audio.current = player;
    if (revoke) objectUrl.current = url;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      context.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaElementSource(player).connect(analyser);
      analyser.connect(ctx.destination);
      await ctx.resume();
      if (id !== generation.current) return;
      const values = new Uint8Array(analyser.fftSize);
      let last = 0;
      const update = time => {
        if (id !== generation.current) return;
        if (time - last > 100) {
          analyser.getByteTimeDomainData(values);
          const volume = Math.sqrt(values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length);
          setMouth(volume > 0.14 ? 3 : volume > 0.025 ? 2 : 1);
          last = time;
        }
        frame.current = requestAnimationFrame(update);
      };
      frame.current = requestAnimationFrame(update);
    }
    const release = () => { if (revoke) URL.revokeObjectURL(url); };
    player.onended = () => { if (id === generation.current) stopPlayback(); release(); };
    player.onerror = () => {
      if (id === generation.current) {
        const error = new Error('音频无法播放，请检查语音服务的输出格式。');
        if (waitForEnd) playbackEnd.current?.reject(error); else onError(error.message);
        stopPlayback();
      }
      release();
    };
    try { if (id !== generation.current) return; await player.play(); if (id === generation.current) { setSpeaking(true); setActiveSentence(sentence); if (sentence) showExpression(sentence.cues, 0, sentence.replyId); } }
    catch (error) { release(); if (id === generation.current) { stopPlayback(); throw error; } }
    if (ended) await ended;
  }

  async function synthesize(text, language, signal) {
    const voiceConfig = { tts: { ...config.tts, textLang: language } };
    try {
      const response = await request('/api/speech', { config: voiceConfig, text: language === 'zh' ? simplifyChinese(text) : text }, signal);
      return await response.blob();
    } catch (error) {
      if (signal.aborted || error.name !== 'TypeError') throw error;
      throw new Error('语音连接中断或无法连接电脑服务。请检查网络和电脑服务，恢复后点击字幕旁的「重播」。');
    }
  }

  function startSpeechStream(replyId) {
    if (['browser', 'off'].includes(config.tts.provider)) return null;
    stop();
    return savedSpeechStream(replyId, config.replyMode);
  }

  function savedSpeechStream(replyId, mode, record = { id: replyId, segments: [], complete: false }, expressionCues) {
    let index = 0;
    const queue = createSpeechStream({
      mode,
      expressionCues,
      savedSegments: record.segments.slice(),
      synthesize: async (text, language, signal, segment) => {
        const position = index++;
        const saved = record.segments[position];
        if (saved?.text === text && saved.language === language) return saved.blob;
        setSynthesizing(true);
        try {
          const blob = await synthesize(text, language, signal);
          record.segments[position] = { ...segment, text, language, blob };
          await saveAudio(record);
          signal.throwIfAborted();
          return blob;
        }
        finally { if (!signal.aborted) setSynthesizing(false); }
      },
      play: (blob, segment) => play(URL.createObjectURL(blob), true, true, { ...segment, replyId }),
      stop,
      onError: message => onError(`朗读失败：${message}`),
    });
    speechQueue.current = queue;
    return { ...queue, finish(reply) {
      queue.finish(reply);
      queue.synthesized().then(async () => {
        queue.signal.throwIfAborted();
        if (!record.segments.length) return;
        record.complete = true;
        await saveAudio(record);
      }, () => {}).catch(error => { if (error.name !== 'AbortError') onError(`语音保存未完成：${error.message}`); });
    } };
  }

  async function speak(text, language, replyId, cues = []) {
    if (!text) return;
    stop();
    const replay = new AbortController();
    speechQueue.current = { cancel: () => replay.abort() };
    const saved = replyId ? await readAudio(replyId) : null;
    replay.signal.throwIfAborted();
    if (saved) saved.segments = saved.segments.map(segment => ({ ...segment, cues: segmentExpressions(cues, segment.start, segment.end) }));
    if (saved?.complete) {
      for (const [index, segment] of saved.segments.entries()) {
        replay.signal.throwIfAborted();
        await play(URL.createObjectURL(segment.blob), true, true, { ...segment, blob: undefined, index, replyId });
      }
      return;
    }
    if (saved?.segments.length) {
      if (['browser', 'off'].includes(config.tts.provider)) {
        for (const [index, segment] of saved.segments.entries()) {
          replay.signal.throwIfAborted();
          await play(URL.createObjectURL(segment.blob), true, true, { ...segment, blob: undefined, index, replyId });
        }
        onError('已播放保存的语音片段；这条回复的语音尚未生成完整。');
        return;
      }
      const queue = savedSpeechStream(replyId, language === 'ja' ? 'ja' : 'zh', saved, cues);
      queue.finish(text);
      await queue.done().catch(error => { if (error.name === 'AbortError') throw error; });
      return;
    }
    if (config.tts.provider === 'off') return;
    if ((language || config.language).startsWith('zh')) text = simplifyChinese(text);
    if (config.tts.provider === 'browser') {
      if (phone) {
        systemSpeech.current = { text, replyId, cues };
        phone.speak(text, language || config.language, Number(config.tts.speed)); return;
      }
      if (!window.speechSynthesis) throw new Error('此浏览器不支持系统语音，请在设置中选择语音 API。');
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = ({ ja: 'ja-JP', zh: 'zh-CN', en: 'en-US' })[language] || config.language;
      utterance.rate = Number(config.tts.speed);
      const voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith(utterance.lang.split('-')[0]));
      if (voice) utterance.voice = voice;
      const id = generation.current;
      utterance.onstart = () => {
        if (id !== generation.current) return;
        setSpeaking(true);
        setActiveSentence({ replyId, index: 0 });
        showExpression(cues, 0, replyId);
        let n = 0;
        ticker.current = setInterval(() => setMouth([1, 2, 3, 2][n++ % 4]), 150);
      };
      utterance.onboundary = event => {
        if (id !== generation.current) return;
        showExpression(cues, event.charIndex, replyId);
        const index = sentenceRanges(text).findIndex(segment => event.charIndex < segment.end);
        if (index >= 0) setActiveSentence({ replyId, index });
      };
      utterance.onend = () => { if (id === generation.current) stop(); };
      utterance.onerror = event => {
        if (id !== generation.current || ['interrupted', 'canceled'].includes(event.error)) return;
        stop(); onError(`系统语音播放失败：${event.error}`);
      };
      window.speechSynthesis.speak(utterance);
    } else {
      const queue = savedSpeechStream(replyId, language === 'ja' ? 'ja' : 'zh', undefined, cues);
      queue.finish(text);
      await queue.done().catch(error => { if (error.name === 'AbortError') throw error; });
    }
  }

  function cancelRecording() {
    recordingGeneration.current++;
    openingMicRef.current = false;
    setOpeningMic(false);
    recordController.current?.abort();
    recognition.current?.abort();
    phone?.stopRecognition(true);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    setRecording(false);
    setTranscribing(false);
  }

  async function toggleRecording() {
    if (openingMicRef.current) { cancelRecording(); return; }
    if (recording) {
      setRecording(false);
      setTranscribing(true);
      if (phone && config.stt.provider === 'browser') phone.stopRecognition(false);
      recognition.current?.stop();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      return;
    }
    stop();
    const recordingId = ++recordingGeneration.current;
    if (config.stt.provider === 'browser') {
      if (phone) { phone.recognize(config.language); setRecording(true); return; }
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) throw new Error('此浏览器不支持系统语音识别。请在设置中选择语音识别 API，或直接输入文字。');
      const recognizer = new Recognition();
      recognition.current = recognizer;
      recognizer.lang = config.language;
      recognizer.interimResults = false;
      recognizer.onresult = event => { if (recordingId === recordingGeneration.current) onTranscript(event.results[0][0].transcript); };
      recognizer.onerror = event => {
        if (recordingId === recordingGeneration.current && event.error !== 'aborted') onError(`麦克风识别失败：${event.error === 'not-allowed' ? '请允许麦克风权限' : event.error}`);
      };
      recognizer.onend = () => { if (recordingId === recordingGeneration.current) { setRecording(false); recognition.current = null; } };
      recognizer.start();
      setRecording(true);
    } else {
      if (config.stt.provider === 'openai' && new URL(config.stt.baseUrl || 'https://api.openai.com/v1').hostname === 'api.openai.com' && !config.stt.apiKey?.trim()) {
        throw new Error('OpenAI 语音识别需要单独的 API Key。请在声音设置中选择「电脑本地识别」，或填写语音 API Key。');
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('录音需要 HTTPS 或本机 localhost，并允许麦克风权限。');
      openingMicRef.current = true;
      setOpeningMic(true);
      let media;
      try { media = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      finally {
        if (recordingId === recordingGeneration.current) {
          openingMicRef.current = false;
          setOpeningMic(false);
        }
      }
      if (recordingId !== recordingGeneration.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const instance = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      recorder.current = instance;
      const chunks = [];
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = async () => {
        media.getTracks().forEach(track => track.stop());
        if (recordingId !== recordingGeneration.current) return;
        setRecording(false);
        setTranscribing(true);
        recordController.current = new AbortController();
        try {
          const blob = new Blob(chunks, { type: instance.mimeType });
          const data = await fileDataUrl(blob);
          if (recordingId !== recordingGeneration.current) return;
          const response = await request('/api/transcribe', { config, audio: data.split(',')[1], mimeType: blob.type }, recordController.current.signal);
          const { text } = await readJsonResponse(response);
          if (recordingId === recordingGeneration.current) onTranscript(text);
        } catch (error) { if (error.name !== 'AbortError' && recordingId === recordingGeneration.current) onError(error.message); }
        finally { if (recordingId === recordingGeneration.current) setTranscribing(false); }
      };
      instance.start();
      setRecording(true);
    }
  }

  useEffect(() => () => { stop(); cancelRecording(); }, []);
  useEffect(() => {
    if (!phone) return;
    const listener = ({ detail: { type, value } }) => {
      if (type === 'speech-result') { setRecording(false); setTranscribing(false); if (value) onTranscript(value); }
      if (type === 'speech-error') { setRecording(false); setTranscribing(false); onError(value); }
      if (type === 'speech-state') { setRecording(value === 'listening'); setTranscribing(value === 'processing'); }
      if (type === 'tts') {
        if (!systemSpeech.current) return;
        clearInterval(ticker.current);
        setSpeaking(value === 'start'); setMouth(1);
        if (value === 'start') { setActiveSentence({ replyId: systemSpeech.current.replyId, index: 0 }); showExpression(systemSpeech.current.cues, 0, systemSpeech.current.replyId); let n = 0; ticker.current = setInterval(() => setMouth([1, 2, 3, 2][n++ % 4]), 150); }
        else { setActiveSentence(null); systemSpeech.current = null; }
        if (value === 'error') onError('系统声音不可用或未安装该语言，请在声音设置中选择语音 API。');
      }
      if (type === 'tts-range' && systemSpeech.current) {
        showExpression(systemSpeech.current.cues, Number(value), systemSpeech.current.replyId);
        const index = sentenceRanges(systemSpeech.current.text).findIndex(segment => Number(value) < segment.end);
        if (index >= 0) setActiveSentence({ replyId: systemSpeech.current.replyId, index });
      }
    };
    window.addEventListener('amadeus-native', listener);
    return () => window.removeEventListener('amadeus-native', listener);
  }, [onTranscript, onError]);
  return { openingMic, synthesizing, speaking, activeSentence, expression, mouth, recording, transcribing, play, speak, startSpeechStream, stop, toggleRecording, cancelRecording };
}
