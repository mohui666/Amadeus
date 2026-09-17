import { createPortraitMotion, framePath } from './motion.js';

const $ = id => document.getElementById(id);
const before = $('before'), after = $('after'), audio = $('audio');
const eyeNames = { open: '睁眼', half: '半闭眼', closed: '闭眼' };
const mouthNames = { 1: '闭口', 2: '小张嘴', 3: '大张嘴' };
const modeNames = { idle: '待机', listening: '倾听', thinking: '思考', speaking: '说话' };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const motion = createPortraitMotion();
const images = new Map();
let context, analyser, samples;
let time = 0, last = performance.now(), paused = false, resumeAudio = false;
let demoStart = null, demoVoiceStarted = false, playbackGeneration = 0;
let legacyMouth = 1, legacyAt = 0, legacyMode = 'idle', legacyPhase = 0;
let lastStatus = '', lastTime = '', animationFrame;

function showError(error) { $('error').textContent = error.message; }
function resetPlayback() {
  playbackGeneration++;
  audio.pause();
  audio.currentTime = 0;
  resumeAudio = false;
  demoStart = null;
  demoVoiceStarted = false;
  motion.stop(time);
  legacyMouth = 1;
  $('mode').value = 'idle';
}
function setPaused(value) {
  paused = value;
  $('pause').textContent = paused ? '继续' : '暂停';
  if (paused) {
    resumeAudio = !audio.paused;
    audio.pause();
  } else if (resumeAudio) {
    resumeAudio = false;
    audio.play().catch(showError);
  }
}
async function prepareAudio() {
  if (!context) {
    context = new AudioContext();
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaElementSource(audio).connect(analyser);
    analyser.connect(context.destination);
    samples = new Float32Array(analyser.fftSize);
  }
  await context.resume();
}
async function startPlayback(demo) {
  resetPlayback();
  setPaused(false);
  $('error').textContent = '';
  $('eyes').value = 'auto';
  $('mouth').value = 'auto';
  const generation = playbackGeneration;
  try {
    await prepareAudio();
    if (generation !== playbackGeneration) return;
    if (demo) demoStart = time;
    else {
      $('mode').value = 'speaking';
      await audio.play();
    }
  } catch (error) {
    if (generation !== playbackGeneration) return;
    resetPlayback();
    showError(error);
  }
}

function draw(canvas, image, pose, overlay = 0, original) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h * .9 + pose.y * w / 350);
  ctx.scale(pose.scale, pose.scale);
  ctx.translate(-w / 2, -h * .9);
  // Zoom is a viewport crop for inspection; source proportions stay unchanged.
  const crop = $('zoom').checked ? [238, 320, 737, 1312] : [0, 0, 1213, 2160];
  ctx.globalAlpha = 1 - overlay;
  ctx.drawImage(image, ...crop, 0, 0, w, h);
  if (overlay > 0) {
    // Add weighted premultiplied pixels once, so 50% means equal full-frame overlap.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = overlay;
    ctx.drawImage(original, ...crop, 0, 0, w, h);
  }
  ctx.restore();
}

function tick(now) {
  const dt = paused ? 0 : Math.min((now - last) / 1000, .064) * Number($('speed').value);
  last = now;
  time += dt;
  if (demoStart !== null) {
    const age = time - demoStart;
    if (age < 1) $('mode').value = 'idle';
    else if (age < 2) $('mode').value = 'listening';
    else if (age < 3) $('mode').value = 'thinking';
    else if (!demoVoiceStarted && !paused) {
      demoVoiceStarted = true;
      $('mode').value = 'speaking';
      audio.play().catch(error => { resetPlayback(); showError(error); });
    }
  }
  let level = 0;
  if (analyser && !audio.paused) {
    analyser.getFloatTimeDomainData(samples);
    level = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  }
  const mode = $('mode').value;
  const useMotion = $('motion').checked && !reduced.matches;
  const pose = motion.update({ time, dt, level, mode, reducedMotion: !useMotion });
  const eye = $('eyes').value === 'auto' ? pose.eye : $('eyes').value;
  const mouth = $('mouth').value === 'auto' ? pose.mouth : Number($('mouth').value);
  if (time - legacyAt >= .1) {
    legacyMouth = mode !== 'speaking' ? 1 : level > .14 ? 3 : level > .025 ? 2 : 1;
    legacyAt = time;
  }
  const oldMouth = $('mouth').value === 'auto' ? legacyMouth : mouth;
  const oldEye = $('eyes').value === 'auto'
    ? (pose.blinkAge >= .035 && pose.blinkAge < .175 ? 'closed' : 'open')
    : eye === 'closed' ? 'closed' : 'open';
  if (mode !== legacyMode) { legacyPhase = 0; legacyMode = mode; }
  legacyPhase += dt;
  const oldPose = { y: 0, scale: 1 };
  if (useMotion && (mode === 'idle' || mode === 'speaking')) {
    const amount = (1 - Math.cos(legacyPhase / 5.6 * Math.PI * 2)) / 2;
    oldPose.y = -2 * amount; oldPose.scale = 1 + .003 * amount;
  } else if (useMotion && mode === 'listening' && legacyPhase < .65) {
    oldPose.y = 2 * Math.sin(legacyPhase / .65 * Math.PI);
  }
  const original = images.get(framePath('open', mouth));
  const oldPath = oldEye === 'closed' ? `../assets/kurisu/kurisu_eyes_closed${oldMouth}.png` : framePath('open', oldMouth);
  draw(before, images.get(oldPath), oldPose);
  draw(after, images.get(framePath(eye, mouth)), pose, Number($('overlay').value), original);
  for (const [canvas, eyes, lips, y, scale] of [[before, oldEye, oldMouth, oldPose.y, oldPose.scale], [after, eye, mouth, pose.y, pose.scale]]) {
    Object.assign(canvas.dataset, { eye: eyes, mouth: String(lips), mode, y: y.toFixed(4), scale: scale.toFixed(6), frame: canvas === after ? framePath(eye, mouth) : oldPath });
  }
  const beforeLabel = `${eyeNames[oldEye]} · ${mouthNames[oldMouth]}`;
  const afterLabel = `${eyeNames[eye]} · ${mouthNames[mouth]}`;
  if ($('before-state').textContent !== beforeLabel) $('before-state').textContent = beforeLabel;
  if ($('after-state').textContent !== afterLabel) $('after-state').textContent = afterLabel;
  const status = `${paused ? '已暂停 · ' : ''}${modeNames[mode]}${$('eyes').value !== 'auto' || $('mouth').value !== 'auto' ? ' · 逐帧检查' : ''}`;
  if (status !== lastStatus) { $('status').textContent = status; lastStatus = status; }
  const stamp = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  if (stamp !== lastTime) { $('time').textContent = stamp; lastTime = stamp; }
  if (Number.isFinite(audio.duration)) { $('seek').max = audio.duration; $('seek').value = audio.currentTime; }
  $('raw').value = level;
  $('smooth').value = pose.envelope;
  document.body.dataset.audioPlaying = String(!audio.paused);
  document.body.dataset.paused = String(paused);
  animationFrame = requestAnimationFrame(tick);
}
function formatTime(seconds) { return Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00'; }

$('demo').onclick = () => startPlayback(true);
$('voice').onclick = () => startPlayback(false);
$('pause').onclick = () => setPaused(!paused);
$('stop').onclick = () => { resetPlayback(); setPaused(false); $('eyes').value = 'auto'; $('mouth').value = 'auto'; };
$('blink').onclick = () => { $('eyes').value = 'auto'; motion.blink(time); };
$('mode').onchange = () => {
  demoStart = null;
  if ($('mode').value !== 'speaking') {
    playbackGeneration++;
    audio.pause();
    resumeAudio = false;
    motion.stop(time);
    legacyMouth = 1;
  }
};
$('speed').onchange = () => { audio.playbackRate = Number($('speed').value); };
$('seek').oninput = () => { audio.currentTime = Number($('seek').value); motion.stop(time); };
$('overlay').oninput = () => { $('overlay-value').value = `${Math.round(Number($('overlay').value) * 100)}%`; };
audio.onended = () => { demoStart = null; $('mode').value = 'idle'; motion.stop(time); legacyMouth = 1; };
audio.onerror = () => { resetPlayback(); showError(new Error('原作语音文件无法播放。')); };
document.addEventListener('visibilitychange', () => { if (document.hidden && !paused) setPaused(true); });
window.addEventListener('pagehide', () => { cancelAnimationFrame(animationFrame); audio.pause(); context?.close(); });
const resize = new ResizeObserver(entries => {
  for (const { target, contentRect } of entries) {
    const ratio = Math.min(devicePixelRatio, 2);
    target.width = Math.round(contentRect.width * ratio);
    target.height = Math.round(contentRect.width * 2160 / 1213 * ratio);
  }
});
resize.observe(before);
resize.observe(after);

const paths = ['open', 'half', 'closed'].flatMap(eye => [1, 2, 3].map(mouth => framePath(eye, mouth)));
paths.push(...[1, 2, 3].map(mouth => `../assets/kurisu/kurisu_eyes_closed${mouth}.png`));
try {
  await Promise.all(paths.map(async path => {
    const image = new Image();
    image.src = path;
    await image.decode();
    images.set(path, image);
  }));
  document.querySelectorAll('button, select, #seek').forEach(control => { control.disabled = false; });
  document.body.dataset.ready = 'true';
  last = performance.now();
  animationFrame = requestAnimationFrame(tick);
} catch (error) { $('status').textContent = '素材加载失败'; showError(error); }
