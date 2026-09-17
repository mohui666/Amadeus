const $ = id => document.getElementById(id);
const stage = $('stage'), audio = $('audio');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (a, b, dt, tau) => a + (b - a) * (1 - Math.exp(-dt / tau));
const ease = t => t * t * (3 - 2 * t);
const applied = { ParamAngleZ: 0, ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamMouthOpenY: 0 };
let app, model, core, rawModel, analyser, samples, audioContext;
let now = 0, last = performance.now(), dt = 0, paused = false, resumeAudio = false;
let blinkStart = -1, nextBlink = 2.8, demoStart = null, frame, voiceGeneration = 0;
const error = e => { $('error').textContent = e.message; };

function blinkValue(age) {
  if (age < 0 || age >= .24) return 1;
  if (age < .065) return 1 - ease(age / .065);
  if (age < .105) return 0;
  return ease((age - .105) / .135);
}
function blink() { blinkStart = now; nextBlink = now + 3 + Math.random() * 2.5; }
function stopVoice() { voiceGeneration++; audio.pause(); audio.currentTime = 0; resumeAudio = false; }
function pause(value) {
  paused = value;
  $('pause').textContent = value ? '继续' : '暂停';
  if (value) { resumeAudio = !audio.paused; audio.pause(); }
  else if (resumeAudio) { resumeAudio = false; audio.play().catch(error); }
}
function reset() {
  stopVoice(); pause(false); demoStart = null; blinkStart = -1; nextBlink = now + 3;
  $('tilt').value = '0'; $('left').value = '1'; $('right').value = '1'; $('mouth').value = '0';
}
function fit() {
  if (!model) return;
  app.renderer.resize(stage.clientWidth, stage.clientHeight);
  const scale = Math.min((stage.clientWidth - 60) / model.internalModel.width, (stage.clientHeight - 88) / model.internalModel.height);
  model.scale.set(scale);
  model.anchor.set(.5, 0);
  model.position.set(stage.clientWidth / 2, 44);
}
function updateParameters() {
  if ($('auto-blink').checked && now >= nextBlink) blink();
  let tilt = Number($('tilt').value), mouth = Number($('mouth').value);
  if ($('auto-sway').checked && !reduceMotion) tilt += Math.sin(now * .85) * 13;
  if (demoStart !== null) {
    const age = now - demoStart;
    if (age >= 12) { demoStart = null; }
    else { tilt = Math.sin(age * Math.PI / 3) * 26; mouth = age > 4 && age < 9 ? .55 + Math.sin(age * 9) * .35 : 0; }
  }
  if (analyser && !audio.paused) {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    mouth = clamp((rms - .012) * 7);
  }
  const eye = blinkValue(blinkStart < 0 ? -1 : now - blinkStart);
  applied.ParamAngleZ = smooth(applied.ParamAngleZ, Math.max(-30, Math.min(30, tilt)), dt, .18);
  applied.ParamEyeLOpen = Math.min(Number($('left').value), eye);
  applied.ParamEyeROpen = Math.min(Number($('right').value), eye);
  applied.ParamMouthOpenY = smooth(applied.ParamMouthOpenY, mouth, dt, mouth > applied.ParamMouthOpenY ? .04 : .1);
  for (const [id, value] of Object.entries(applied)) core.setParameterValueById(id, value);
}
function tick(stamp) {
  dt = paused ? 0 : Math.min((stamp - last) / 1000, .064); last = stamp; now += dt;
  if (!paused) { model.update(dt * 1000); app.renderer.render(app.stage); }
  $('tilt-value').value = `${(applied.ParamAngleZ / 30 * 3.5).toFixed(1)}°`;
  for (const [control, parameter] of [['left', 'ParamEyeLOpen'], ['right', 'ParamEyeROpen'], ['mouth', 'ParamMouthOpenY']]) $('' + control + '-value').value = `${Math.round(applied[parameter] * 100)}%`;
  $('state').textContent = $('compare').checked ? '原版静态立绘' : paused ? '已暂停' : !audio.paused ? '正在说话' : demoStart !== null ? '动作演示' : '自制 Live2D';
  stage.dataset.paused = String(paused);
  $('audio-status').textContent = `原作语音 · 初次见面${audio.currentTime ? `　${audio.currentTime.toFixed(1)} 秒` : ''}`;
  frame = requestAnimationFrame(tick);
}
async function playVoice() {
  stopVoice(); pause(false); demoStart = null; $('mouth').value = '0'; $('error').textContent = '';
  const generation = voiceGeneration;
  try {
    if (!audioContext) {
      audioContext = new AudioContext(); analyser = audioContext.createAnalyser(); analyser.fftSize = 2048;
      samples = new Float32Array(analyser.fftSize);
      audioContext.createMediaElementSource(audio).connect(analyser); analyser.connect(audioContext.destination);
    }
    await audioContext.resume();
    if (generation === voiceGeneration) await audio.play();
  } catch (e) { if (generation === voiceGeneration) error(e); }
}
$('demo').onclick = () => { reset(); demoStart = now; blink(); };
$('blink').onclick = () => { pause(false); blink(); };
$('voice').onclick = playVoice;
$('pause').onclick = () => pause(!paused);
$('reset').onclick = reset;
$('tilt').oninput = () => { demoStart = null; $('auto-sway').checked = false; };
for (const id of ['left', 'right']) $(id).oninput = () => { $('auto-blink').checked = false; blinkStart = -1; };
$('mouth').oninput = () => { demoStart = null; stopVoice(); };
$('compare').onchange = () => { $('original').hidden = !$('compare').checked; stage.dataset.compare = String($('compare').checked); };
audio.onerror = () => error(new Error('原作语音加载失败。'));
document.addEventListener('visibilitychange', () => { if (document.hidden && !paused) pause(true); });
window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); audio.pause(); audioContext?.close(); app?.destroy(false, { children: true, texture: true, baseTexture: true }); });
new ResizeObserver(fit).observe(stage);
try {
  app = new PIXI.Application({ view: $('portrait'), backgroundAlpha: 0, antialias: true, autoStart: false, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
  model = await PIXI.live2d.Live2DModel.from('/authored-model/Kurisu-original-v1.model3.json', { autoUpdate: false, autoInteract: false, motionPreload: PIXI.live2d.MotionPreloadStrategy.NONE });
  core = model.internalModel.coreModel; rawModel = core.getModel();
  const missing = Object.keys(applied).filter(id => !rawModel.parameters.ids.includes(id));
  if (missing.length) throw new Error(`导出模型缺少参数：${missing.join(', ')}`);
  model.internalModel.updateFocus = updateParameters;
  model.internalModel.updateNaturalMovements = () => {};
  model.internalModel.eyeBlink = undefined;
  app.stage.addChild(model); fit();
  window.authoredLive2dTest = { model, app, rawModel, applied, get paused() { return paused; } };
  document.querySelectorAll('button, input').forEach(control => { control.disabled = false; });
  if (reduceMotion) $('auto-sway').checked = false;
  document.body.dataset.ready = 'true'; last = performance.now(); frame = requestAnimationFrame(tick);
} catch (e) { $('state').textContent = '模型加载失败'; error(e); console.error(e); }
