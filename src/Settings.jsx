import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, Check, AudioLines, MessageSquare, RefreshCw, UserRound, Brain, Trash2 } from 'lucide-react';
import { readJsonResponse, request } from './api.js';
import { phone } from './native.js';
import { memoryKinds, savedMemories, deleteMemory } from './memory.js';
import { selectChatProvider, selectTtsProvider, ttsFormat } from './config.js';

function Field({ label, value, onChange, type = 'text', placeholder, ...props }) {
  return <label className="field"><span>{label}</span><input type={type} value={value ?? ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" {...props} /></label>;
}

export default function Settings({ config, onSave, onClose, account, refreshAccount, localVoice, memories, onMemoriesChange, memory }) {
  const [draft, updateDraft] = useState(structuredClone(config));
  const latestDraft = useRef(draft);
  const [saveError, setSaveError] = useState('');
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
  function setDraft(update) {
    const next = typeof update === 'function' ? update(latestDraft.current) : update;
    latestDraft.current = next;
    updateDraft(next);
    try { onSave(next); setSaveError(''); }
    catch (error) { setSaveError(`设置未保存：${error.message}`); }
  }
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
  const storedMemories = [...savedMemories(memories)].sort((a, b) => b.time - a.time);
  const currentMemories = storedMemories.filter(entry => !entry.supersededBy);
  const oldMemories = storedMemories.filter(entry => entry.supersededBy);
  function memoryEntry(entry) {
    return <article className="memory-entry" key={entry.id}>
      <div><small>{entry.source === 'learned' ? `${entry.scope === 'roleplay' ? '角色' : '现实'} · ${memoryKinds[entry.kind]}` : '已保存的记忆'} · {new Date(entry.time).toLocaleDateString('zh-CN')}</small><button className="icon-button" aria-label={`删除记忆：${entry.text.slice(0, 20)}`} onClick={() => onMemoriesChange(previous => deleteMemory(previous, entry.id))}><Trash2 size={15} /></button></div>
      <p>{entry.text}</p>
      {entry.evidence?.length > 0 && <details><summary>记忆依据{entry.evidence.length > 1 ? ` · ${entry.evidence.length} 处` : ''}</summary>{entry.evidence.map((item, index) => <p key={index}>“{item.quote}”</p>)}</details>}
    </article>;
  }
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="settings-shell">
      <div className="sheet-heading"><h2 id="settings-title">设置</h2><button className="icon-button" onClick={onClose} aria-label="关闭设置"><X /></button></div>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {[['chat', MessageSquare, '对话'], ['voice', AudioLines, '声音'], ['persona', UserRound, '角色'], ['memory', Brain, '记忆']].map(([key, Icon, label], index, tabs) => <button key={key} id={`settings-tab-${key}`} role="tab" aria-controls="settings-panel" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
          setTab(tabs[next][0]); document.getElementById(`settings-tab-${tabs[next][0]}`).focus();
        }}><Icon size={17} />{label}</button>)}
      </div>
      <div className="settings-content" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} ref={content}>
        {tab === 'chat' && <>
          {phone && <div className="phone-server"><span>电脑服务<strong>{phone.serverUrl()}</strong></span><button className="text-button" onClick={() => phone.connect()}>更改连接</button></div>}
          <div className="mode-selector"><button aria-pressed={draft.chat.provider === 'chatgpt'} className={draft.chat.provider === 'chatgpt' ? 'selected' : ''} onClick={() => { if (draft.chat.provider !== 'chatgpt') setDraft(d => selectChatProvider(d, 'chatgpt')); }}>OpenAI 账号登录</button><button aria-pressed={draft.chat.provider !== 'chatgpt'} className={draft.chat.provider !== 'chatgpt' ? 'selected' : ''} onClick={() => { if (draft.chat.provider === 'chatgpt') setDraft(d => selectChatProvider(d, d.chatApiProvider || 'openai')); }}>API 接入</button></div>
          {draft.chat.provider === 'chatgpt' ? <div className="account-panel">
            <h3>ChatGPT 账号</h3>
            <div className={`account-status ${account?.loggedIn ? 'ready' : ''}`}><span className="status-dot" />{account?.loggedIn ? `已连接${account.planType ? ` · ${account.planType}` : ''}` : account?.available === false ? '尚未检测到本机 Codex' : '等待登录' }<button className="icon-button" onClick={refreshAccount} aria-label="刷新登录状态"><RefreshCw size={15} /></button></div>
            {!account?.loggedIn && <div className="login-actions"><button className="primary-button" disabled={loading} onClick={() => startLogin('chatgpt')}>{loading ? '正在发起…' : '使用 OpenAI 登录'}<ExternalLink size={16} /></button><button className="text-button" disabled={loading} onClick={() => startLogin('chatgptDeviceCode')}>在手机上用设备码登录</button></div>}
            {login && !account?.loggedIn && <div className="login-pending">{login.userCode && <><span>在官方页面输入设备码</span><strong className="device-code">{login.userCode}</strong></>}<a className="primary-button" href={login.authUrl || login.verificationUrl} target="_blank" rel="noreferrer">打开 OpenAI 登录页<ExternalLink size={16} /></a><button className="text-button" onClick={cancelLogin}>取消本次登录</button></div>}
            <Field label="模型（留空使用账号默认）" value={draft.chat.model} onChange={v => set('chat', 'model', v)} placeholder="需要指定时再填写" />
            <details className="settings-details"><summary>高级对话设置</summary><Field label="推理强度（可选）" value={draft.chat.reasoningEffort} onChange={v => set('chat', 'reasoningEffort', v)} placeholder="留空使用模型默认，例如 low" /><p className="helper">更高档位通常需要更长等待。</p></details>
          </div> : <>
            <label className="field"><span>接口协议</span><select value={draft.chat.provider} onChange={event => setDraft(d => selectChatProvider(d, event.target.value))}><option value="openai">OpenAI 兼容</option><option value="responses">Responses</option><option value="anthropic">Anthropic</option></select></label>
            <Field label="API 地址" value={draft.chat.baseUrl} onChange={v => set('chat', 'baseUrl', v)} placeholder="https://api.openai.com/v1" />
            <Field label="模型名称" value={draft.chat.model} onChange={v => set('chat', 'model', v)} placeholder="服务提供的模型名称" />
            <Field label="API Key" type="password" value={draft.chat.apiKey} onChange={v => set('chat', 'apiKey', v)} placeholder="本地无鉴权服务可留空" />
          </>}
        </>}
        {tab === 'voice' && <>
          <div className="settings-group">
          <label className="toggle-row"><div><strong>自动朗读回复</strong></div><input aria-label="自动朗读回复" type="checkbox" checked={draft.autoSpeak && draft.tts.provider !== 'off'} onChange={e => setDraft(d => ({ ...d, autoSpeak: e.target.checked, tts: { ...d.tts, provider: d.tts.provider === 'off' ? 'browser' : d.tts.provider } }))} /></label>
          <label className="field"><span>语速 <b>{Number(draft.tts.speed).toFixed(1)}×</b></span><input aria-label="语速" type="range" min="0.5" max="2" step="0.1" value={draft.tts.speed} onChange={e => set('tts', 'speed', Number(e.target.value))} /></label>
          <label className="field"><span>你的语音输入语言</span><select value={draft.language} onChange={e => setDraft(d => ({ ...d, language: e.target.value, stt: { ...d.stt, language: e.target.value.split('-')[0] } }))}><option value="zh-CN">简体中文</option><option value="ja-JP">日本語</option><option value="en-US">English</option></select></label>
          </div>
          <details className="settings-details"><summary>高级声音设置</summary>
          <h3 className="section-label">朗读服务</h3>
          <div className="mode-selector" role="group" aria-label="朗读方式"><button aria-pressed={['browser', 'off'].includes(draft.tts.provider)} className={['browser', 'off'].includes(draft.tts.provider) ? 'selected' : ''} onClick={() => setDraft(d => selectTtsProvider(d, 'browser'))}>系统语音</button><button aria-pressed={!['browser', 'off'].includes(draft.tts.provider)} className={!['browser', 'off'].includes(draft.tts.provider) ? 'selected' : ''} onClick={() => { if (['browser', 'off'].includes(draft.tts.provider)) setDraft(d => selectTtsProvider(d, d.ttsApiFormat || 'openai')); }}>语音 API</button></div>
          {localVoice?.configured && <button className="text-button voice-preset-shortcut" onClick={() => setDraft(d => ({ ...selectTtsProvider(d, localVoice.config.provider), ttsApiFormat: ttsFormat(localVoice.config.provider), tts: { ...d.tts, ...localVoice.config, speed: d.tts.speed } }))}>使用本机配置</button>}
          {!['browser', 'off'].includes(draft.tts.provider) && <>
            <label className="field"><span>语音 API 格式</span><select value={ttsFormat(draft.tts.provider)} onChange={event => setDraft(d => selectTtsProvider(d, event.target.value))}><option value="openai">OpenAI 兼容</option><option value="gpt-sovits">GPT-SoVITS</option><option value="elevenlabs">ElevenLabs</option></select></label>
            <Field label="语音 API 地址" value={draft.tts.baseUrl} onChange={v => set('tts', 'baseUrl', v)} />
            <Field label="语音 API Key" type="password" value={draft.tts.apiKey} onChange={v => set('tts', 'apiKey', v)} />
            {draft.tts.provider !== 'gpt-sovits' && <><Field label="语音模型" value={draft.tts.model} onChange={v => set('tts', 'model', v)} /><Field label="声音 ID" value={draft.tts.voice} onChange={v => set('tts', 'voice', v)} placeholder={draft.tts.provider === 'elevenlabs' ? '你的 ElevenLabs voice_id' : 'alloy'} /></>}
            {draft.tts.provider === 'gpt-sovits' && <><p className="helper">连接已经启动的 GPT-SoVITS 服务。声音取决于加载的模型和参考录音；回复语种在「角色」中选择。</p><Field label="参考音频路径（语音服务器上的文件）" value={draft.tts.referenceAudio} onChange={v => set('tts', 'referenceAudio', v)} placeholder="/path/to/reference.wav" /><Field label="参考音频原文" value={draft.tts.promptText} onChange={v => set('tts', 'promptText', v)} /><div className="field-row"><Field label="参考语言" value={draft.tts.promptLang} onChange={v => set('tts', 'promptLang', v)} /><Field label="默认输出语言" value={draft.tts.textLang} onChange={v => set('tts', 'textLang', v)} /></div></>}
          </>}
          <h3 className="section-label">识别服务</h3>
          <label className="field"><span>语音识别</span><select value={draft.stt.provider} onChange={e => set('stt', 'provider', e.target.value)}><option value="local">电脑本地识别 · 无需 API Key</option><option value="browser">手机系统 / 浏览器语音识别</option><option value="openai">OpenAI 兼容语音识别 API</option></select></label>
          {draft.stt.provider === 'local' ? <p className="helper">录音由电脑上的 Whisper 识别。</p> : draft.stt.provider === 'browser' ? <p className="helper">使用设备的系统识别，需要麦克风权限。</p> : <><Field label="识别 API 地址" value={draft.stt.baseUrl} onChange={v => set('stt', 'baseUrl', v)} /><Field label="识别模型" value={draft.stt.model} onChange={v => set('stt', 'model', v)} /><Field label="识别 API Key" type="password" value={draft.stt.apiKey} onChange={v => set('stt', 'apiKey', v)} /></>}
          </details>
        </>}
        {tab === 'persona' && <>
          <label className="field"><span>她如何回复</span><select value={draft.replyMode || 'zh'} onChange={e => setDraft(d => ({ ...d, replyMode: e.target.value }))}><option value="ja-zh">日语声音 · 中文字幕</option><option value="zh">中文声音 · 中文回复</option><option value="ja">日语声音 · 日文回复</option></select></label>
          <label className="field"><span>补充角色偏好</span><textarea value={draft.persona || ''} onChange={e => setDraft(d => ({ ...d, persona: e.target.value }))} placeholder="例如：叫我小莫；聊天更简短一点；少用专业术语。" rows={6} /></label>
        </>}
        {tab === 'memory' && <>
          <div className="memory-overview"><Brain size={22} /><div><strong>自动记忆</strong><p role="status">{memory.organizing ? '正在整理这次聊天的细节…' : `已记住 ${currentMemories.length} 条资料与经历`}</p></div></div>
          <p className="helper">自动记住偏好、人物、计划和相处细节。保存在此设备，点开依据可查看原话。</p>
          {memory.error && <p className="error-inline" role="status">{memory.error}</p>}
          <div className="memory-heading"><span>记忆内容</span><button className="text-button" disabled={!memories.length} onClick={() => { if (window.confirm('删除全部记忆？现有对话记录仍会保留。')) onMemoriesChange([]); }}>清空记忆</button></div>
          <div className="memory-list">{currentMemories.map(memoryEntry)}</div>
          {oldMemories.length > 0 && <details className="settings-details memory-history"><summary>已更新的历史 · {oldMemories.length}</summary><div className="memory-list">{oldMemories.map(memoryEntry)}</div></details>}
          {!storedMemories.length && <p className="helper">还没有记忆，和她聊聊吧。</p>}
        </>}
        {error && <p className="error-inline" role="alert">{error}</p>}
        {saveError && <p className="error-inline" role="alert">{saveError}</p>}
      </div>
      <div className="settings-footer"><span role="status">{saveError ? '保存失败' : '设置与密钥自动保存在此设备'}</span><button className="primary-button" onClick={onClose}><Check size={17} />完成</button></div>
    </div>
  </dialog>;
}
