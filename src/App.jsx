import { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon, Mic, MicOff, Volume2, VolumeX, MessageSquare, Phone, PhoneOff, Send, ImagePlus, X, Maximize, Minimize, Download, Trash2, Play, ChevronLeft, AudioLines, LoaderCircle, Square, Radio, ArrowUpRight } from 'lucide-react';
import Character from './Character.jsx';
import Settings from './Settings.jsx';
import { cleanReply, spokenReply, getEmotion, readSettings, persistSettings } from './config.js';
import { readJsonResponse, apiFetch, fileDataUrl, streamChat } from './api.js';
import { useVoice } from './useVoice.js';
import { phone } from './native.js';
import basePersona from '../prompts/kurisu.md?raw';
import { readLocalData, writeLocalData } from './localData.js';
import { readMemories, persistMemories, buildContext } from './memory.js';
import { useMemory } from './useMemory.js';
import { sentenceRanges } from './speechStream.js';

const clips = [
  { title: '初次见面', text: '说起来，还没正式自我介绍过。我叫牧瀬红莉栖，初次见面，请多关照。', file: 'pleased_to_meet_you', emotion: 'pleasant', duration: '0:07' },
  { title: '打个招呼', text: '你好。', file: 'hello', emotion: 'happy', duration: '0:01' },
  { title: '没有「蒂娜」！', text: '缇娜 禁止！！', file: 'dont_add_tina', emotion: 'angry', duration: '0:01' },
  { title: '尽管问我', text: '尽管问我吧，我会尽力回答你的。', file: 'ask_me_whatever', emotion: 'happy', duration: '0:04' },
  { title: '关于记忆', text: '但是记忆数据和其他数据不同，是很复杂的。', file: 'memory_complex', emotion: 'indifferent', duration: '0:04' },
];

function readHistory() {
  return JSON.parse(readLocalData('history') || '[]');
}

function SpokenText({ text, messageId, activeSentence }) {
  const current = useRef(null);
  const index = messageId && activeSentence?.replyId === messageId ? activeSentence.index : -1;
  useEffect(() => { current.current?.scrollIntoView({ block: 'nearest' }); }, [messageId, index]);
  return sentenceRanges(text).map((sentence, position) => position === index
    ? <mark className="reading-sentence" aria-current="true" ref={current} key={position}>{sentence.text}</mark>
    : <span key={position}>{sentence.text}</span>);
}

function Transcript({ replyMode, messages, busy, activeSentence, onClose, onExport, onClear, onSpeak }) {
  const scroll = useRef(null);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  return <>
    <div className="panel-heading"><div><span className="eyebrow">CONVERSATION LOG</span><h2>我们的对话</h2></div><div className="panel-actions"><button className="icon-button" onClick={onExport} disabled={!messages.length} aria-label="导出对话"><Download size={16} /></button><button className="icon-button" onClick={onClear} disabled={!messages.length || busy} aria-label="清空对话"><Trash2 size={16} /></button><button className="icon-button mobile-only" onClick={onClose} aria-label="关闭对话记录"><X size={18} /></button></div></div>
    <div className="message-list" ref={scroll} aria-live="polite">
      {messages.length === 0 && <div className="empty-log"><MessageSquare strokeWidth={1} size={32} /><p>还没有说出口的话，<br />就从一句「你好」开始吧。</p><span>对话保存在此设备</span></div>}
      {messages.map(message => <article className={`message ${message.role}`} key={message.id}>
        <div className="message-meta"><span>{message.role === 'user' ? 'YOU' : 'Amadeus'}</span><time>{new Date(message.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>{message.demo && <small>原作片段</small>}</div>
        {message.image && <img className="message-image" src={message.image} alt="你发送的图片" />}
        <p><SpokenText text={(message.role === 'assistant' ? cleanReply(message.content, replyMode !== 'ja') : message.content) || (busy ? '…' : '（未收到回复）')} messageId={message.role === 'assistant' ? message.id : null} activeSentence={activeSentence} /></p>
        {message.error && <small className="message-error">{message.error}</small>}
        {message.role === 'assistant' && message.content && !message.demo && <button className="message-replay" disabled={busy || message.pending} onClick={() => onSpeak(message)} aria-label="朗读这条回复"><Volume2 size={13} />朗读</button>}
      </article>)}
    </div>
    <div className="log-bottom"><span className="status-dot" />LOCAL MEMORY<span>{messages.filter(m => m.role === 'user').length} 条消息</span></div>
  </>;
}

export default function App() {
  const [config, setConfig] = useState(readSettings);
  const [messages, setMessages] = useState(readHistory);
  const [memories, setMemories] = useState(readMemories);
  const [settings, setSettings] = useState(false);
  const [panel, setPanel] = useState(null);
  const [account, setAccount] = useState(null);
  const [localVoice, setLocalVoice] = useState(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [emotion, setEmotion] = useState('neutral');
  const [subtitle, setSubtitle] = useState('');
  const [subtitleSource, setSubtitleSource] = useState('');
  const [subtitleMessageId, setSubtitleMessageId] = useState(null);
  const [error, setError] = useState('');
  const [immersive, setImmersive] = useState(Boolean(phone));
  const [showControls, setShowControls] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [booting, setBooting] = useState(false);
  const [logoFrame, setLogoFrame] = useState(1);
  const abort = useRef(null);
  const input = useRef(null);
  const sessionGeneration = useRef(0);
  const persistedMessageCount = useRef(-1);
  const voice = useVoice(config, text => send(text), setError);
  const memory = useMemory(config, memories, setMemories);

  async function refreshAccount() {
    try {
      const response = await apiFetch('/api/account');
      const value = await readJsonResponse(response);
      if (!response.ok) throw new Error(value.error?.message || '账号状态读取失败');
      setAccount(value);
    } catch (e) { setAccount({ available: false, loggedIn: false, error: e.message }); }
  }
  useEffect(() => { refreshAccount(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch('/api/local-voice', { signal: controller.signal }).then(async response => {
      const preset = await readJsonResponse(response);
      if (!response.ok) throw new Error(preset.error?.message || '本机语音配置读取失败');
      setLocalVoice(preset);
      if (preset.configured && !localStorage.getItem('amadeus.settings')) {
        setConfig(previous => ({ ...previous, tts: { ...preset.config } }));
      }
    }).catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (messages.some(message => message.pending) && persistedMessageCount.current === messages.length) return;
    const saved = messages.filter(m => m.content && !m.pending).map(({ image, ...message }) => message);
    try { writeLocalData('history', JSON.stringify(saved)); }
    catch (error) { setError(`对话保存失败：${error.message}`); }
    persistedMessageCount.current = messages.length;
  }, [messages]);
  useEffect(() => {
    try { persistMemories(memories); }
    catch (error) { setError(`记忆保存失败：${error.message}`); }
  }, [memories]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setElapsed(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!booting) return;
    let n = 1;
    const timer = setInterval(() => {
      n++;
      if (n > 39) { clearInterval(timer); setBooting(false); }
      else setLogoFrame(n);
    }, 40);
    return () => clearInterval(timer);
  }, [booting]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!phone) return;
    const listener = ({ detail }) => {
      if (detail.type === 'pause') { if (busy) stopReply(); else voice.stop(); voice.cancelRecording(); }
      if (detail.type !== 'back') return;
      if (settings) setSettings(false);
      else if (panel) setPanel(null);
      else if (showControls) { setShowControls(false); input.current?.blur(); }
      else if (active) hangUp();
      else phone.background();
    };
    window.addEventListener('amadeus-native', listener);
    return () => window.removeEventListener('amadeus-native', listener);
  }, [settings, panel, showControls, active, busy]);

  async function playClip(clip) {
    voice.stop();
    setSubtitleMessageId(null);
    setError(''); setEmotion(clip.emotion); setSubtitle(clip.text); setSubtitleSource('原作语音 · 简中字幕');
    try { await voice.play(`./assets/voice/${clip.file}.ogg`); }
    catch (e) { setError(`语音片段播放失败：${e.message}`); }
  }
  function begin() {
    setActive(true); setElapsed(0); setLogoFrame(1); setBooting(true); setError('');
    setShowControls(false);
  }
  function hangUp() {
    memory.stop();
    sessionGeneration.current++;
    abort.current?.abort(); voice.stop(); voice.cancelRecording();
    setActive(false); setBusy(false); setBooting(false); setEmotion('neutral'); setSubtitle(''); setPanel(null);
  }
  function stopReply() {
    memory.stop();
    sessionGeneration.current++;
    abort.current?.abort(); voice.stop();
    setBusy(false);
    setMessages(previous => previous.map(m => m.pending ? { ...m, pending: false, error: '已停止回复' } : m));
  }
  async function speak(message, requireJapanese = config.replyMode === 'ja-zh') {
    setError('');
    setSubtitle(cleanReply(message.content, config.replyMode !== 'ja'));
    setSubtitleSource('Amadeus'); setSubtitleMessageId(message.id); setEmotion(getEmotion(message.content));
    const spoken = spokenReply(message.content);
    if (requireJapanese && (spoken.language !== 'ja' || !spoken.text)) {
      setError('这次回复没有生成日语朗读内容，中文字幕已保留。');
      return;
    }
    try { await voice.speak(spoken.text, spoken.language || (config.replyMode === 'ja' ? 'ja' : 'zh'), message.id, spoken.cues); }
    catch (e) { if (e.name !== 'AbortError') setError(`朗读失败：${e.message}`); }
  }
  async function send(text = draft) {
    text = text.trim();
    if ((!text && !attachment) || busy) return;
    if (config.chat.provider === 'chatgpt' && !account?.loggedIn) { setSettings(true); setError(account?.error || '请先在连接设置中登录 OpenAI。'); return; }
    if (config.chat.provider !== 'chatgpt' && (!config.chat.baseUrl || !config.chat.model)) { setSettings(true); setError('请先填写对话 API 地址与模型。'); return; }
    voice.stop(); voice.cancelRecording();
    memory.stop();
    if (!active) { setActive(true); setElapsed(0); }
    const generation = sessionGeneration.current;
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: text || '请看看这张图片。', ...(attachment ? { image: attachment.url } : {}), time: Date.now() };
    const replyId = crypto.randomUUID();
    const history = [...messages.filter(m => !m.demo && !m.error && m.content), userMessage];
    setMessages(previous => [...previous, userMessage, { id: replyId, role: 'assistant', content: '', pending: true, time: Date.now() }]);
    setDraft(''); setAttachment(null); setBusy(true); setError(''); setEmotion('thinking'); setSubtitle(''); setSubtitleSource('Amadeus');
    setSubtitleMessageId(replyId);
    const replyController = new AbortController();
    abort.current = replyController;
    let reply = '';
    const speechStream = config.autoSpeak ? voice.startSpeechStream(replyId) : null;
    try {
      const recalledIds = await memory.recall(history, replyController.signal);
      replyController.signal.throwIfAborted();
      await streamChat({ config, basePersona, ...buildContext(history, memories, recalledIds) }, replyController.signal, delta => {
        if (generation !== sessionGeneration.current) return;
        reply += delta;
        if (/\[emotion:\s*\w+\]/i.test(reply) || cleanReply(reply)) setEmotion(getEmotion(reply, !config.autoSpeak));
        setSubtitle(cleanReply(reply, config.replyMode !== 'ja'));
        setMessages(previous => previous.map(m => m.id === replyId ? { ...m, content: reply } : m));
        speechStream?.update(reply);
      });
      if (generation !== sessionGeneration.current) return;
      setMessages(previous => previous.map(m => m.id === replyId ? { ...m, pending: false } : m));
      memory.remember(userMessage, { id: replyId, content: reply, time: Date.now() });
      if (speechStream) { speechStream.finish(reply); await speechStream.ready(); }
      else if (config.autoSpeak) await speak({ id: replyId, content: reply }, config.replyMode === 'ja-zh');
    } catch (e) {
      speechStream?.cancel();
      if (speechStream && generation === sessionGeneration.current) voice.stop();
      const message = e.name === 'AbortError' ? '已停止回复' : e.message;
      setMessages(previous => previous.map(m => m.id === replyId ? { ...m, pending: false, error: message } : m));
      if (e.name !== 'AbortError' && generation === sessionGeneration.current) { setError(message); setEmotion('sad'); }
    } finally { if (generation === sessionGeneration.current) setBusy(false); }
  }
  async function attach(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { setError('请选择 JPG、PNG、WebP 或 GIF 图片。'); return; }
    if (file.size > 8 * 1024 * 1024) { setError('图片请小于 8 MB。'); return; }
    setAttachment({ url: await fileDataUrl(file), name: file.name });
    input.current?.focus();
  }
  function exportHistory() {
    const json = JSON.stringify(messages.map(({ image, ...m }) => ({ ...m, content: m.role === 'assistant' ? cleanReply(m.content) : m.content })), null, 2);
    if (phone) { phone.exportHistory(json); return; }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'amadeus-conversation.json'; a.click(); URL.revokeObjectURL(url);
  }
  function clearHistory() { if (window.confirm('清空此浏览器保存的对话记录？长期记忆会保留，可在设置的「记忆」中单独删除。')) { setMessages([]); setSubtitle(''); } }
  const subtitleReply = messages.find(message => message.id === subtitleMessageId && !message.pending);
  const status = voice.recording ? '正在听你说话' : voice.transcribing ? '正在识别语音' : memory.recalling ? '正在回忆' : voice.synthesizing ? '正在生成语音' : busy ? '正在思考' : voice.speaking ? '正在说话' : active ? '等待你的声音' : '待机';
  const accountLabel = config.chat.provider === 'chatgpt' ? (account?.loggedIn ? 'OpenAI 账号已连接' : 'OpenAI 账号待连接') : `${config.chat.provider.toUpperCase()} · API 已配置`;
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return <main className={`amadeus-app ${phone ? 'native-app' : ''} ${immersive ? 'immersive' : ''} ${showControls ? 'controls-visible' : ''} ${active ? 'call-active' : ''}`}>
    <header className="topbar"><button className="brand" onClick={() => setSettings(true)} aria-label="Amadeus 连接设置"><img src="./assets/interface/amadeus_icon_smaller.png" alt="" /><div><strong>AMADEUS</strong><span>ARTIFICIAL INTELLIGENCE SYSTEM</span></div></button><div className="topbar-right"><span className="desktop-only university">VIKTOR CHONDRIA UNIVERSITY</span><button className="connection-badge" onClick={() => setSettings(true)}><span className={`status-dot ${account?.loggedIn || config.chat.provider !== 'chatgpt' ? 'connected' : ''}`} /><span>{accountLabel}</span><ArrowUpRight size={13} /></button><button className="icon-button" onClick={() => setSettings(true)} aria-label="打开设置"><SettingsIcon size={20} /></button></div></header>
    <div className="workspace">
      <aside className="identity desktop-only">
        <div className="identity-heading"><span className="eyebrow">MEMORY ARCHIVE / 001</span><h1>牧濑<span>红莉栖</span></h1><div className="name-en">KURISU MAKISE</div><p className="name-jp">牧濑 红莉栖</p></div>
        <div className="identity-rule" />
        <dl className="profile-details"><div><dt>所属</dt><dd>维克多·孔多利亚大学</dd></div><div><dt>研究领域</dt><dd>脑科学 · 记忆理论</dd></div><div><dt>系统</dt><dd>Amadeus</dd></div></dl>
        <blockquote>“人的记忆，是可以被<br />数据化的。”<span>MEMORIES MAKE US WHO WE ARE.</span></blockquote>
        <div className="quick-voices"><div className="list-heading"><span>语音片段</span><span>ORIGINAL VOICE</span></div>{clips.slice(0, 3).map(clip => <button key={clip.file} onClick={() => playClip(clip)} disabled={busy}><Play size={13} /><span>{clip.title}</span><small>{clip.duration}</small></button>)}</div>
        <button className="setup-link" onClick={() => setSettings(true)}><SettingsIcon size={15} />设置对话与声音<ArrowUpRight size={15} /></button>
      </aside>

      <section className="call-window" aria-label="Amadeus 通话画面">
        <div className="stage-background" />
        <div className="stage-top"><div><span className="eyebrow">AMADEUS SYSTEM</span><h2>牧濑 红莉栖</h2></div><button className="icon-button" onClick={() => setImmersive(!immersive)} aria-label={immersive ? '退出沉浸模式' : '进入沉浸模式'}>{immersive ? <Minimize size={18} /> : <Maximize size={18} />}</button></div>
        <div className="stage-status"><span className={`status-dot ${active ? 'connected' : ''}`} />{status}<span className="call-timer">{active ? timer : 'STANDBY'}</span></div>
        <Character emotion={subtitleMessageId && voice.expression?.replyId === subtitleMessageId ? voice.expression.emotion : emotion} speaking={voice.speaking} mouth={voice.mouth} listening={voice.recording} thinking={(busy && !subtitle) || voice.transcribing} active={active} menu={Boolean(phone)} onClick={() => immersive ? setShowControls(value => !value) : !busy && playClip(clips[1])} />
        <div className="stage-vignette" />
        <img className="stage-logo" src="./assets/interface/logo39.png" alt="Amadeus" />
        {phone && !active && <div className="classic-launch">
          <button className="classic-settings icon-button" onClick={() => setSettings(true)} aria-label="打开设置"><SettingsIcon size={21} /></button>
          <img className="classic-launch-logo" src="./assets/interface/logo39.png" alt="Amadeus" />
          <div className="classic-connect"><p>Call from Kurisu.</p>
            <button onClick={begin} aria-label="开始通话"><img src="./assets/interface/connect_unselect.png" alt="CONNECT" /></button>
            <button onClick={() => phone.background()} aria-label="取消连接"><img src="./assets/interface/cancel_unselect.png" alt="CANCEL" /></button>
          </div>
        </div>}
        {phone && active && !showControls && error && <button className="classic-error" onClick={() => setShowControls(true)}>{error}</button>}
        {booting && <div className="boot-overlay"><img src={`./assets/interface/logo${logoFrame}.png`} alt="Amadeus 启动动画" /><span>INITIALIZING MEMORY INTERFACE</span></div>}
        {immersive && active && <div className="live-call-status" role="status" aria-live="polite">
          <button className={voice.recording ? 'mic-live' : ''} aria-pressed={voice.recording} disabled={(!voice.recording && busy) || voice.transcribing} onClick={() => voice.toggleRecording().catch(e => setError(e.message))}>
            {voice.openingMic || voice.transcribing ? <LoaderCircle className="spin" size={16} /> : voice.recording ? <Mic size={16} /> : <MicOff size={16} />}
            {voice.openingMic ? '正在开启麦克风 · 点击取消' : voice.recording ? '麦克风已开启 · 点击结束' : voice.transcribing ? '麦克风已关闭 · 正在识别' : '麦克风已关闭 · 点击开启'}
          </button>
          {(voice.synthesizing || voice.speaking) && <span>{voice.synthesizing ? '正在生成语音…' : '正在朗读'}</span>}
        </div>}
        {immersive && !showControls && subtitle && <div className="floating-subtitle">{subtitle && <div className="subtitle"><span className="subtitle-source">{subtitleSource}{subtitleSource === 'Amadeus' && subtitleReply && <button className="subtitle-replay" disabled={busy} onClick={() => { setError(''); speak(subtitleReply); }} aria-label="重播当前回复"><Volume2 size={13} />重播</button>}</span><div className="subtitle-text"><SpokenText text={subtitle} messageId={subtitleMessageId} activeSentence={voice.activeSentence} /></div></div>}</div>}
        <div className="call-bottom">
          {(!immersive || showControls) && subtitle && <div className="subtitle"><span className="subtitle-source">{subtitleSource}{subtitleSource === 'Amadeus' && subtitleReply && <button className="subtitle-replay" disabled={busy} onClick={() => { setError(''); speak(subtitleReply); }} aria-label="重播当前回复"><Volume2 size={13} />重播</button>}</span><div className="subtitle-text"><SpokenText text={subtitle} messageId={subtitleMessageId} activeSentence={voice.activeSentence} /></div></div>}
          {!active && !subtitle && <div className="standby-message"><span>AMADEUS IS HERE.</span><p>好久不见。</p></div>}
          {error && <div className="error-toast" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}><X size={15} /></button></div>}
          {active ? <div className="call-controls"><button className={`round-control ${voice.recording ? 'recording' : ''}`} onClick={() => voice.toggleRecording().catch(e => setError(e.message))} disabled={busy || voice.transcribing} aria-label={voice.recording ? '结束录音并发送' : '开始语音输入'}>{(voice.openingMic || voice.transcribing) ? <LoaderCircle className="spin" /> : voice.recording ? <MicOff /> : <Mic />}<span>{voice.openingMic ? '正在开启 · 可取消' : voice.recording ? '录音中 · 点击结束' : voice.transcribing ? '已关闭 · 识别中' : '麦克风已关闭'}</span></button><button className="round-control hangup" onClick={hangUp} aria-label="挂断通话"><PhoneOff /><span>挂断</span></button><button className="round-control" onClick={() => { if (voice.speaking || voice.synthesizing) voice.stop(); else setConfig(c => { const next = { ...c, autoSpeak: !c.autoSpeak }; persistSettings(next); return next; }); }} aria-label={(voice.speaking || voice.synthesizing) ? '停止朗读' : config.autoSpeak ? '关闭自动朗读' : '开启自动朗读'}>{config.autoSpeak ? <Volume2 /> : <VolumeX />}<span>{(voice.speaking || voice.synthesizing) ? '停止朗读' : '扬声器'}</span></button></div> : <button className="start-call" onClick={begin}><Phone size={20} /><span>开始通话<small>CONNECT TO AMADEUS</small></span><span className="start-arrow">↗</span></button>}
          <div className="composer-wrap">
            {attachment && <div className="attachment"><img src={attachment.url} alt="待发送图片" /><span>{attachment.name}</span><button onClick={() => setAttachment(null)} aria-label="移除待发送图片"><X size={16} /></button></div>}
            <form className="composer" onSubmit={event => { event.preventDefault(); send(); }}><label className={`attach-button ${busy ? 'disabled' : ''}`} title="发送照片"><ImagePlus size={20} /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={attach} disabled={busy} aria-label="添加图片" /></label><input ref={input} type="text" aria-label="给红莉栖的消息" value={draft} onChange={e => setDraft(e.target.value)} placeholder="有什么想对我说的吗？" disabled={busy} />{busy ? <button type="button" className="send-button" onClick={stopReply} aria-label="停止回复"><Square size={15} /></button> : <button type="submit" className="send-button" aria-label="发送消息" disabled={!draft.trim() && !attachment}><Send size={17} /></button>}</form>
          </div>
          <div className="mobile-nav mobile-only"><button onClick={() => setPanel('history')}><MessageSquare size={16} />对话记录{messages.length > 0 && <span>{messages.length}</span>}</button><button onClick={() => setPanel('voices')}><AudioLines size={17} />语音片段</button></div>
          {phone && <div className="native-menu"><button onClick={() => setSettings(true)}><SettingsIcon size={16} />连接设置</button><button onClick={() => { setShowControls(false); input.current?.blur(); }}><X size={16} />收起菜单</button></div>}
        </div>
      </section>

      <aside className="transcript desktop-only"><Transcript activeSentence={voice.activeSentence} replyMode={config.replyMode} messages={messages} busy={busy} onExport={exportHistory} onClear={clearHistory} onSpeak={speak} /></aside>
    </div>
    <footer className="site-footer desktop-only"><span><Radio size={13} />PROJECT AMADEUS <b>0</b></span><span>非官方复刻 · 角色素材来自 STEINS;GATE 0</span><span>EL PSY KONGROO.</span></footer>
    {panel && <div className="mobile-panel-backdrop" onClick={() => setPanel(null)}><section className="mobile-panel" role="dialog" aria-modal="true" aria-label={panel === 'history' ? '对话记录' : '语音片段'} onClick={e => e.stopPropagation()}>{panel === 'history' ? <Transcript activeSentence={voice.activeSentence} replyMode={config.replyMode} messages={messages} busy={busy} onClose={() => setPanel(null)} onExport={exportHistory} onClear={clearHistory} onSpeak={speak} /> : <><div className="panel-heading"><div><span className="eyebrow">ORIGINAL VOICE</span><h2>她的声音</h2></div><button className="icon-button" onClick={() => setPanel(null)} aria-label="关闭语音片段"><X /></button></div><div className="voice-list">{clips.map(clip => <button key={clip.file} onClick={() => { playClip(clip); setPanel(null); }}><span className="voice-play"><Play size={18} /></span><span><strong>{clip.title}</strong><small>日本語オリジナル</small></span><time>{clip.duration}</time></button>)}<p>原有录音片段。自由对话的声音由你设置的语音服务生成。</p></div></>}</section></div>}
    {settings && <Settings config={config} memories={memories} onMemoriesChange={memory.change} memory={memory} localVoice={localVoice} onSave={value => { voice.stop(); voice.cancelRecording(); memory.stop(); setConfig(value); persistSettings(value); setError(''); refreshAccount(); }} onClose={() => setSettings(false)} account={account} refreshAccount={refreshAccount} />}
  </main>;
}
