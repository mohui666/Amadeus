import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, Check, AudioLines, MessageSquare, RefreshCw, UserRound, Brain, Trash2 } from 'lucide-react';
import { readJsonResponse, request } from './api.js';
import { phone } from './native.js';
import { memoryKinds, savedMemories, deleteMemory } from './memory.js';

function Field({ label, value, onChange, type = 'text', placeholder, ...props }) {
  return <label className="field"><span>{label}</span><input type={type} value={value ?? ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" {...props} /></label>;
}

export default function Settings({ config, onSave, onClose, account, refreshAccount, localVoice, memories, onMemoriesChange, memory }) {
  const [draft, setDraft] = useState(structuredClone(config));
  const [tab, setTab] = useState('chat');
  const [login, setLogin] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const dialog = useRef(null);
  const content = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => { content.current.scrollTop = 0; }, [tab]);
  useEffect(() => {
    if (!login || account?.loggedIn) return;
    const timer = setInterval(refreshAccount, 2500);
    return () => clearInterval(timer);
  }, [login, account?.loggedIn]);
  function set(group, key, value) { setDraft(previous => ({ ...previous, [group]: { ...previous[group], [key]: value } })); }
  async function startLogin(type) {
    setLoading(true); setError('');
    try {
      const response = await request('/api/login', { type });
      setLogin(await readJsonResponse(response));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  async function cancelLogin() {
    try { await request('/api/login/cancel', { loginId: login.loginId }); setLogin(null); }
    catch (e) { setError(e.message); }
  }
  return <dialog ref={dialog} className="settings-dialog" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="settings-shell">
      <div className="sheet-heading"><div><span className="eyebrow">AMADEUS</span><h2>设置</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭设置"><X /></button></div>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {[['chat', MessageSquare, '对话'], ['voice', AudioLines, '声音'], ['persona', UserRound, '角色'], ['memory', Brain, '记忆']].map(([key, Icon, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><Icon size={17} />{label}</button>)}
      </div>
      <div className="settings-content" ref={content}>
        {tab === 'chat' && <>
          {phone && <div className="phone-server"><span>电脑服务<strong>{phone.serverUrl()}</strong></span><button className="text-button" onClick={() => phone.connect()}>更改连接</button></div>}
          <div className="mode-selector"><button className={draft.chat.provider === 'chatgpt' ? 'selected' : ''} onClick={() => setDraft(d => ({ ...d, chat: { provider: 'chatgpt', baseUrl: '', apiKey: '', model: '' } }))}>OpenAI 账号登录</button><button className={draft.chat.provider !== 'chatgpt' ? 'selected' : ''} onClick={() => { if (draft.chat.provider === 'chatgpt') setDraft(d => ({ ...d, chat: { provider: 'openai', baseUrl: '', apiKey: '', model: '', reasoningEffort: '' } })); }}>API 接入</button></div>
          {draft.chat.provider === 'chatgpt' ? <div className="account-panel">
            <h3>ChatGPT 账号</h3>
            <div className={`account-status ${account?.loggedIn ? 'ready' : ''}`}><span className="status-dot" />{account?.loggedIn ? `已连接${account.planType ? ` · ${account.planType}` : ''}` : account?.available === false ? '尚未检测到本机 Codex' : '等待登录' }<button className="icon-button" onClick={refreshAccount} aria-label="刷新登录状态"><RefreshCw size={15} /></button></div>
            {!account?.loggedIn && <div className="login-actions"><button className="primary-button" disabled={loading} onClick={() => startLogin('chatgpt')}>{loading ? '正在发起…' : '使用 OpenAI 登录'}<ExternalLink size={16} /></button><button className="text-button" disabled={loading} onClick={() => startLogin('chatgptDeviceCode')}>在手机上用设备码登录</button></div>}
            {login && !account?.loggedIn && <div className="login-pending">{login.userCode && <><span>在官方页面输入设备码</span><strong className="device-code">{login.userCode}</strong></>}<a className="primary-button" href={login.authUrl || login.verificationUrl} target="_blank" rel="noreferrer">打开 OpenAI 登录页<ExternalLink size={16} /></a><button className="text-button" onClick={cancelLogin}>取消本次登录</button></div>}
            <Field label="模型（留空使用账号默认）" value={draft.chat.model} onChange={v => set('chat', 'model', v)} placeholder="需要指定时再填写" />
            <details className="settings-details"><summary>高级对话设置</summary><Field label="推理强度（可选）" value={draft.chat.reasoningEffort} onChange={v => set('chat', 'reasoningEffort', v)} placeholder="留空使用模型默认，例如 low" /><p className="helper">更高档位通常需要更长等待。</p></details>
          </div> : <>
            <label className="field"><span>接口协议</span><select value={draft.chat.provider} onChange={event => set('chat', 'provider', event.target.value)}><option value="openai">OpenAI 兼容</option><option value="responses">Responses</option><option value="anthropic">Anthropic</option></select></label>
            <Field label="API 地址" value={draft.chat.baseUrl} onChange={v => set('chat', 'baseUrl', v)} placeholder="https://api.openai.com/v1" />
            <Field label="模型名称" value={draft.chat.model} onChange={v => set('chat', 'model', v)} placeholder="服务提供的模型名称" />
            <Field label="API Key · 仅本次打开有效" type="password" value={draft.chat.apiKey} onChange={v => set('chat', 'apiKey', v)} placeholder="本地无鉴权服务可留空" />
            <p className="helper">密钥仅本次打开有效，不会保存。</p>
          </>}
        </>}
        {tab === 'voice' && <>
          <label className="toggle-row"><div><strong>自动朗读回复</strong></div><input aria-label="自动朗读回复" type="checkbox" checked={draft.autoSpeak} onChange={e => setDraft(d => ({ ...d, autoSpeak: e.target.checked }))} /></label>
          <label className="field"><span>语速 <b>{Number(draft.tts.speed).toFixed(1)}×</b></span><input aria-label="语速" type="range" min="0.5" max="2" step="0.1" value={draft.tts.speed} onChange={e => set('tts', 'speed', Number(e.target.value))} /></label>
          <label className="field"><span>你的语音输入语言</span><select value={draft.language} onChange={e => setDraft(d => ({ ...d, language: e.target.value, stt: { ...d.stt, language: e.target.value.split('-')[0] } }))}><option value="zh-CN">简体中文</option><option value="ja-JP">日本語</option><option value="en-US">English</option></select></label>
          <details className="settings-details"><summary>高级声音设置</summary>
          <h3 className="section-label">朗读服务</h3>
          <label className="field"><span>语音合成</span><select value={draft.tts.provider} onChange={event => {
            const provider = event.target.value;
            const values = provider === 'gpt-sovits' ? { baseUrl: 'http://127.0.0.1:19880', model: '', voice: '' } : provider === 'qwen-tts' ? { baseUrl: 'http://127.0.0.1:19882/v1', model: 'kurisu', voice: 'kurisu' } : provider === 'elevenlabs' ? { baseUrl: 'https://api.elevenlabs.io/v1', model: 'eleven_multilingual_v2', voice: '' } : { baseUrl: 'https://api.openai.com/v1', model: 'tts-1', voice: 'alloy' };
            setDraft(d => ({ ...d, tts: { ...d.tts, ...values, provider, apiKey: '' } }));
          }}><option value="browser">系统语音 · 无需 API Key</option><option value="openai">OpenAI 兼容语音 API</option><option value="gpt-sovits">GPT-SoVITS · 本地角色声音</option><option value="qwen-tts">Qwen3-TTS · 本地训练声音</option><option value="elevenlabs">ElevenLabs</option><option value="off">关闭朗读</option></select></label>
          {draft.tts.provider === 'browser' && <p className="helper">使用设备的系统声音。</p>}
          {localVoice?.configured && <button className="text-button voice-preset-shortcut" onClick={() => setDraft(d => ({ ...d, tts: { ...localVoice.config } }))}>使用本机配置</button>}
          {!['browser', 'off'].includes(draft.tts.provider) && <>
            <Field label="语音 API 地址" value={draft.tts.baseUrl} onChange={v => set('tts', 'baseUrl', v)} />
            <Field label="语音 API Key · 仅本次打开有效" type="password" value={draft.tts.apiKey} onChange={v => set('tts', 'apiKey', v)} />
            {draft.tts.provider !== 'gpt-sovits' && <><Field label="语音模型" value={draft.tts.model} onChange={v => set('tts', 'model', v)} /><Field label="声音 ID" value={draft.tts.voice} onChange={v => set('tts', 'voice', v)} placeholder={draft.tts.provider === 'elevenlabs' ? '你的 ElevenLabs voice_id' : 'alloy'} /></>}
            {draft.tts.provider === 'gpt-sovits' && <><p className="helper">连接已经启动的 GPT-SoVITS 服务。声音取决于加载的模型和参考录音；回复语种在「角色」中选择。</p><Field label="参考音频路径（语音服务器上的文件）" value={draft.tts.referenceAudio} onChange={v => set('tts', 'referenceAudio', v)} placeholder="/path/to/reference.wav" /><Field label="参考音频原文" value={draft.tts.promptText} onChange={v => set('tts', 'promptText', v)} /><div className="field-row"><Field label="参考语言" value={draft.tts.promptLang} onChange={v => set('tts', 'promptLang', v)} /><Field label="默认输出语言" value={draft.tts.textLang} onChange={v => set('tts', 'textLang', v)} /></div></>}
          </>}
          <h3 className="section-label">识别服务</h3>
          <label className="field"><span>语音识别</span><select value={draft.stt.provider} onChange={e => set('stt', 'provider', e.target.value)}><option value="local">电脑本地识别 · 无需 API Key</option><option value="browser">手机系统 / 浏览器语音识别</option><option value="openai">OpenAI 兼容语音识别 API</option></select></label>
          {draft.stt.provider === 'local' ? <p className="helper">录音由电脑上的 Whisper 识别。</p> : draft.stt.provider === 'browser' ? <p className="helper">使用设备的系统识别，需要麦克风权限。</p> : <><Field label="识别 API 地址" value={draft.stt.baseUrl} onChange={v => set('stt', 'baseUrl', v)} /><Field label="识别模型" value={draft.stt.model} onChange={v => set('stt', 'model', v)} /><Field label="识别 API Key · 仅本次打开有效" type="password" value={draft.stt.apiKey} onChange={v => set('stt', 'apiKey', v)} /></>}
          </details>
        </>}
        {tab === 'persona' && <>
          <p className="helper">Amadeus 红莉栖 · 延续你们的关系与对话。</p>
          <label className="field"><span>她如何回复</span><select value={draft.replyMode || 'zh'} onChange={e => setDraft(d => ({ ...d, replyMode: e.target.value }))}><option value="ja-zh">日语声音 · 中文字幕</option><option value="zh">中文声音 · 中文回复</option><option value="ja">日语声音 · 日文回复</option></select></label>
          <label className="field"><span>补充角色偏好</span><textarea value={draft.persona || ''} onChange={e => setDraft(d => ({ ...d, persona: e.target.value }))} placeholder="例如：叫我小莫；聊天更简短一点；少用专业术语。" rows={6} /></label>
          <p className="helper">在这里补充你希望的称呼、语气和相处方式。</p>
        </>}
        {tab === 'memory' && <>
          <h3 className="section-label">自动记忆</h3>
          <p className="helper">她会在对话后自动记住重要的资料、经历和约定，并在聊天时回忆相关内容。记忆保存在此设备，你可以删除不想保留的内容。</p>
          <p className="helper" role="status">{memory.organizing ? '正在记忆…' : '自动记忆已开启'}</p>
          {memory.error && <p className="error-inline" role="status">{memory.error}</p>}
          <div className="memory-heading"><span>已保存 {savedMemories(memories).length} 条记忆</span><button className="text-button" disabled={!memories.length} onClick={() => { if (window.confirm('删除全部记忆？现有对话记录仍会保留。')) onMemoriesChange([]); }}>清空记忆</button></div>
          <div className="memory-list">{[...savedMemories(memories)].reverse().map(entry => <article className="memory-entry" key={entry.id}>
            <div><small>{entry.source === 'learned' ? `${entry.scope === 'roleplay' ? '角色' : '现实'} · ${memoryKinds[entry.kind]}${entry.supersededBy ? ' · 已更新' : ''}` : '已保存的记忆'} · {new Date(entry.time).toLocaleDateString('zh-CN')}</small><button className="icon-button" aria-label={`删除记忆：${entry.text.slice(0, 20)}`} onClick={() => onMemoriesChange(previous => deleteMemory(previous, entry.id))}><Trash2 size={15} /></button></div>
            <p>{entry.text}</p>
            {entry.evidence && <details><summary>记忆依据</summary>{entry.evidence.map((item, index) => <p key={index}>“{item.quote}”</p>)}</details>}
          </article>)}</div>
          {!savedMemories(memories).length && <p className="helper">还没有记忆，和她聊聊吧。</p>}
        </>}
        {error && <p className="error-inline" role="alert">{error}</p>}
      </div>
      <div className="settings-footer"><button className="text-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => { onSave(draft); onClose(); }}><Check size={17} />保存设置</button></div>
    </div>
  </dialog>;
}
