const $ = id => document.getElementById(id);
const stage = $('stage'), audio = $('audio');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const expressionParams = { happy: 'Smile', angry: 'Angry', sad: 'Sad', surprised: 'Surprissed', blush: 'ParamCheek' };
const expressionNames = { neutral: '平静', happy: '微笑', angry: '生气', sad: '难过', surprised: '惊讶', blush: '脸红' };
const emotionValues = Object.fromEntries(Object.values(expressionParams).map(id => [id, 0]));
let model, app, physics, core, rawModel, audioContext, analyser, samples;
let emotion = 'neutral', paused = false, resumeAudio = false, playbackGeneration = 0;
let time = 0, last = performance.now(), blinkStart = -1, nextBlink = 2.8;
let x = 0, y = 0, mouth = 0, pointer = { x: 0, y: 0 }, demoStart = null;
let pendingDt = 0, animationFrame, lastStatus = '';
const applied = {};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (current, target, dt, tau) => current + (target - current) * (1 - Math.exp(-dt / tau));
const ease = t => t * t * (3 - 2 * t);

function blinkValue(age) {
  if (age < 0 || age >= .24) return 1;
  if (age < .06) return 1 - ease(age / .06);
  if (age < .105) return 0;
  return ease((age - .105) / .135);
}
function blink() { blinkStart = time; nextBlink = time + 2.8 + Math.random() * 3.2; }
function selectEmotion(value) {
  emotion = value;
  document.querySelectorAll('button[data-emotion]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.emotion === emotion)));
}
function stopVoice() {
  playbackGeneration++;
  audio.pause();
  audio.currentTime = 0;
  resumeAudio = false;
  mouth = 0;
}
function showError(error) { $('error').textContent = error.message; }
function pause(value) {
  paused = value;
  $('pause').textContent = paused ? '继续' : '暂停';
  if (paused) { resumeAudio = !audio.paused; audio.pause(); }
  else if (resumeAudio) { resumeAudio = false; audio.play().catch(showError); }
}
async function playVoice() {
  stopVoice();
  pause(false);
  $('mouth').value = '0';
  $('error').textContent = '';
  const generation = playbackGeneration;
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      samples = new Float32Array(analyser.fftSize);
      audioContext.createMediaElementSource(audio).connect(analyser);
      analyser.connect(audioContext.destination);
    }
    await audioContext.resume();
    if (generation !== playbackGeneration) return;
    await audio.play();
  } catch (error) { if (generation === playbackGeneration) showError(error); }
}

function fitModel() {
  if (!model) return;
  app.renderer.resize(stage.clientWidth, stage.clientHeight);
  const fullbody = $('fullbody').checked;
  const zoom = fullbody ? 1 : 2.4;
  const scale = Math.min(stage.clientWidth / model.internalModel.width, stage.clientHeight / model.internalModel.height) * zoom;
  model.scale.set(scale);
  model.anchor.set(.5, 0);
  model.position.set(stage.clientWidth / 2, fullbody ? 18 : -stage.clientHeight * .075);
}

// Runs inside the SDK before physics, so hair/cloth respond to the same head/body movement.
function updateParameters() {
  const dt = pendingDt;
  const natural = $('breathing').checked && !reducedMotion.matches;
  let targetX = $('follow').checked ? pointer.x * 25 : Number($('yaw').value);
  let targetY = $('follow').checked ? pointer.y * 18 : Number($('pitch').value);
  if (demoStart !== null) {
    const age = time - demoStart;
    if (age >= 12) {
      demoStart = null;
      pointer = { x: 0, y: 0 };
      $('yaw').value = '0'; $('pitch').value = '0';
      selectEmotion('neutral');
      targetX = 0; targetY = 0;
    } else {
      targetX = Math.sin(age * Math.PI / 4) * 22;
      targetY = Math.sin(age * Math.PI / 3) * 10;
      selectEmotion(age < 4 ? 'neutral' : age < 7 ? 'happy' : age < 10 ? 'surprised' : 'neutral');
    }
  }
  x = smooth(x, targetX, dt, .16);
  y = smooth(y, targetY, dt, .16);
  let targetMouth = Number($('mouth').value);
  if (analyser && !audio.paused) {
    analyser.getFloatTimeDomainData(samples);
    const volume = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    targetMouth = clamp((volume - .012) * 7, 0, 1);
  }
  mouth = smooth(mouth, targetMouth, dt, targetMouth > mouth ? .032 : .09);
  if (time >= nextBlink) blink();
  const eyeOpen = blinkValue(blinkStart < 0 ? -1 : time - blinkStart);
  Object.assign(applied, {
    ParamAngleX: x, ParamAngleY: y, ParamAngleZ: x * y / -100,
    ParamEyeBallX: x / 32, ParamEyeBallY: y / 25,
    ParamBodyAngleX: x * .18, ParamBodyAngleY: y * .1,
    ParamBodyAngleZ: natural ? Math.sin(time * .72) * .5 : 0,
    ParamBreath: natural ? .5 + Math.sin(time * Math.PI * 2 / 5.6) * .5 : .5,
    ParamEyeLOpen: eyeOpen, ParamEyeROpen: eyeOpen,
    ParamMouthOpenY: mouth,
  });
  for (const id of Object.keys(emotionValues)) {
    emotionValues[id] = smooth(emotionValues[id], expressionParams[emotion] === id ? 1 : 0, dt, .18);
    applied[id] = emotionValues[id];
  }
  for (const [id, value] of Object.entries(applied)) core.setParameterValueById(id, value);
  model.internalModel.physics = natural ? physics : undefined;
}

function tick(now) {
  pendingDt = paused ? 0 : Math.min((now - last) / 1000, .064);
  last = now;
  time += pendingDt;
  if (!paused) {
    model.update(pendingDt * 1000);
    app.renderer.render(app.stage);
  }
  const status = paused ? '已暂停' : !audio.paused ? '正在说话' : demoStart !== null ? '动作演示' : expressionNames[emotion];
  if (lastStatus !== status) { $('state').textContent = status; lastStatus = status; }
  $('yaw-value').value = `${x.toFixed(0)}°`;
  $('pitch-value').value = `${y.toFixed(0)}°`;
  $('mouth-value').value = `${Math.round(mouth * 100)}%`;
  $('audio-status').textContent = `原作语音 · 初次见面${audio.currentTime > 0 ? `　${audio.currentTime.toFixed(1)} 秒` : ''}`;
  Object.assign(stage.dataset, { emotion, paused: String(paused), speaking: String(!audio.paused), yaw: x.toFixed(2), pitch: y.toFixed(2), mouth: mouth.toFixed(3), eye: (applied.ParamEyeLOpen ?? 1).toFixed(3) });
  animationFrame = requestAnimationFrame(tick);
}

$('demo').onclick = () => { pause(false); demoStart = time; blink(); };
$('voice').onclick = playVoice;
$('pause').onclick = () => pause(!paused);
$('blink').onclick = blink;
$('reset').onclick = () => {
  stopVoice(); pause(false); demoStart = null;
  pointer = { x: 0, y: 0 };
  $('yaw').value = '0'; $('pitch').value = '0'; $('mouth').value = '0';
  selectEmotion('neutral');
  blinkStart = -1; nextBlink = time + 3;
};
document.querySelectorAll('button[data-emotion]').forEach(button => { button.onclick = () => { demoStart = null; selectEmotion(button.dataset.emotion); }; });
for (const id of ['yaw', 'pitch']) $(id).oninput = () => { demoStart = null; $('follow').checked = false; };
$('mouth').oninput = () => { if (!audio.paused) stopVoice(); };
$('fullbody').onchange = fitModel;
stage.addEventListener('pointermove', event => {
  if (!$('follow').checked || paused) return;
  const rect = stage.getBoundingClientRect();
  pointer = { x: clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1), y: clamp(1 - (event.clientY - rect.top) / rect.height * 2, -1, 1) };
  demoStart = null;
});
stage.addEventListener('pointerleave', () => { pointer = { x: 0, y: 0 }; });
audio.onerror = () => showError(new Error('原作语音文件无法播放。'));
document.addEventListener('visibilitychange', () => { if (document.hidden && !paused) pause(true); });
window.addEventListener('pagehide', () => { cancelAnimationFrame(animationFrame); audio.pause(); audioContext?.close(); app?.destroy(false, { children: true, texture: true, baseTexture: true }); });
new ResizeObserver(fitModel).observe(stage);

try {
  const settingsUrl = new URL('/model/Kurisu.model3.json', location.href).href;
  const response = await fetch(settingsUrl);
  if (!response.ok) throw new Error(`模型配置加载失败：HTTP ${response.status}`);
  const settings = await response.json();
  // Use our controlled testcase timeline instead of the model pack's unrelated stock motions.
  settings.FileReferences.Motions = {};
  settings.url = settingsUrl;
  app = new PIXI.Application({ view: $('portrait'), backgroundAlpha: 0, antialias: true, autoStart: false, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
  model = await PIXI.live2d.Live2DModel.from(settings, { autoUpdate: false, autoInteract: false, motionPreload: PIXI.live2d.MotionPreloadStrategy.NONE });
  core = model.internalModel.coreModel;
  rawModel = core.getModel();
  const required = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY', 'ParamBreath', ...Object.values(expressionParams)];
  const missing = required.filter(id => !rawModel.parameters.ids.includes(id));
  if (missing.length) throw new Error(`模型缺少测试需要的参数：${missing.join(', ')}`);
  physics = model.internalModel.physics;
  model.internalModel.updateFocus = updateParameters;
  model.internalModel.updateNaturalMovements = () => {};
  model.internalModel.eyeBlink = undefined;
  app.stage.addChild(model);
  fitModel();
  window.live2dTest = { model, app, rawModel, applied, get paused() { return paused; } };
  document.querySelectorAll('button, input').forEach(control => { control.disabled = false; });
  document.body.dataset.ready = 'true';
  last = performance.now();
  animationFrame = requestAnimationFrame(tick);
} catch (error) { $('state').textContent = '模型加载失败'; showError(error); console.error(error); }
