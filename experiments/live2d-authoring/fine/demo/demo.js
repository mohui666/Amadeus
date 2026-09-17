const $ = id => document.getElementById(id);
const stage = $('stage'), audio = $('audio');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, dt, tau) => a + (b - a) * (1 - Math.exp(-dt / tau));
const ease = t => t * t * (3 - 2 * t);
const specs = [
  ['x', '左右转头', 'PARAM_ANGLE_X', -15, 15, 0],
  ['y', '抬头低头', 'PARAM_ANGLE_Y', -10, 10, 0],
  ['z', '侧头', 'PARAM_ANGLE_Z', -12, 12, 0],
  ['left', '左眼开合', 'PARAM_EYE_R_OPEN', 0, 1.2, 1],
  ['right', '右眼开合', 'PARAM_EYE_L_OPEN', 0, 1.2, 1],
  ['gazeX', '视线左右', 'PARAM_EYE_BALL_X', -1, 1, 0],
  ['gazeY', '视线上下', 'PARAM_EYE_BALL_Y', -1, 1, 0],
  ['browL', '左眉高度', 'PARAM_BROW_R_Y', -1, 1, 0],
  ['browR', '右眉高度', 'PARAM_BROW_L_Y', -1, 1, 0],
  ['browAngleL', '左眉角度', 'PARAM_BROW_R_ANGLE', -1, 1, 0],
  ['browAngleR', '右眉角度', 'PARAM_BROW_L_ANGLE', -1, 1, 0],
  ['mouth', '张嘴程度', 'PARAM_MOUTH_OPEN_Y', 0, 1, 0],
  ['body', '身体倾斜', 'PARAM_BODY_ANGLE_Z', -5, 5, 0],
];
const defaults = Object.fromEntries(specs.map(([key,,,,,value]) => [key, value]));
const values = {...defaults}, applied = {};
const presets = {
  neutral: {}, focus: {left:.85,right:.85,browAngleL:-.45,browAngleR:-.45},
  surprise: {left:1.15,right:1.15,browL:.5,browR:.5,mouth:.45},
  thought: {x:-5,y:-2,gazeX:.5,gazeY:.2,left:.9,right:.9,browR:.25},
  doubt: {z:6,browL:.4,browR:-.2,browAngleR:-.35,left:.85,right:1},
  rest: {left:0,right:0,y:-3},
};
for (const [key,label,,min,max,value] of specs) {
  const row = document.createElement('label');
  row.innerHTML = `${label}<output id="${key}-value">${value}</output><input id="${key}" type="range" min="${min}" max="${max}" step=".01" value="${value}" disabled>`;
  $('controls').append(row);
}
let app, model, core, rawModel, analyser, samples, audioContext;
let now=0,last=performance.now(),dt=0,paused=false,frame,blinkStart=-1,nextBlink=2.5,demoStart=null,resumeAudio=false,generation=0;
let pointer={x:0,y:0}, pointerActive=false, exact=false;
const report = e => { $('error').textContent=e.message; };
function blinkValue(age) {
  if(age<0||age>=.25)return 1;
  if(age<.065)return 1-ease(age/.065);
  if(age<.11)return 0;
  return ease((age-.11)/.14);
}
function blink(){blinkStart=now;nextBlink=now+3+Math.random()*2.5;}
function stopVoice(){generation++;audio.pause();audio.currentTime=0;resumeAudio=false;}
function pause(value){paused=value;$('pause').textContent=value?'继续':'暂停';if(value){resumeAudio=!audio.paused;audio.pause();}else if(resumeAudio){resumeAudio=false;audio.play().catch(report);}}
function setValues(next){Object.assign(values,defaults,next);for(const [key]of specs)$(key).value=values[key];}
function reset(){stopVoice();pause(false);setValues({});demoStart=null;blinkStart=-1;nextBlink=now+3;exact=false;}
function fit(){
  if(!model)return;
  app.renderer.resize(stage.clientWidth,stage.clientHeight);
  const width=model.internalModel.width,height=model.internalModel.height;
  const base=Math.min((stage.clientWidth-60)/width,(stage.clientHeight-88)/height);
  const zoom=$('zoom').checked;
  model.scale.set(base*(zoom?2.1:1));model.anchor.set(.5,0);
  model.position.set(stage.clientWidth/2,zoom?-stage.clientHeight*.21:44);
}
function updateParameters(){
  if($('auto-blink').checked&&now>=nextBlink)blink();
  const target={...values};
  const idle=$('idle').checked&&!reduced;
  if(idle){target.x+=Math.sin(now*.43)*2;target.y+=Math.sin(now*.67)*1.1;target.z+=Math.sin(now*.51)*1.6;target.body+=Math.sin(now*.51-.5)*.6;}
  if($('follow').checked&&pointerActive){target.gazeX=pointer.x*.65;target.gazeY=pointer.y*.55;target.x+=pointer.x*4;target.y+=pointer.y*2;}
  if(demoStart!==null){
    const age=now-demoStart;
    if(age>=16)demoStart=null;
    else{target.x=Math.sin(age*.55)*10;target.y=Math.sin(age*.72)*4;target.z=Math.sin(age*.6)*5;target.gazeX=Math.sin(age*.8)*.55;target.gazeY=Math.sin(age*.45)*.2;
      target.mouth=age>5&&age<12?.25+.24*Math.sin(age*8):0;target.browL=target.browR=age>8&&age<12?.25:0;}
  }
  if(analyser&&!audio.paused){analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);target.mouth=clamp((rms-.01)*6);}
  const eye=blinkValue(blinkStart<0?-1:now-blinkStart);
  if(eye<1){target.left=Math.min(target.left,eye);target.right=Math.min(target.right,eye);}
  for(const[key,,id,min,max]of specs){
    const value=clamp(target[key],min,max);
    applied[id]=exact||key==='left'||key==='right'?value:smooth(applied[id]??value,value,dt,key==='mouth'?(value>(applied[id]??0)?.035:.085):.16);
    core.setParameterValueById(id,applied[id]);
  }
  core.setParameterValueById('PARAM_BREATH',idle?(Math.sin(now*1.45)+1)*.32:0);
}
function tick(stamp){
  dt=paused?0:Math.min((stamp-last)/1000,.05);last=stamp;now+=dt;
  if(!paused){model.update(dt*1000);app.renderer.render(app.stage);}
  for(const[key,,id]of specs)$(key+'-value').value=(applied[id]??0).toFixed(2);
  $('state').textContent=$('compare').checked?'原始立绘':paused?'已暂停':!audio.paused?'正在说话':demoStart!==null?'动作演示':'细分模型';
  stage.dataset.paused=String(paused);frame=requestAnimationFrame(tick);
}
async function playVoice(){
  stopVoice();pause(false);demoStart=null;values.mouth=0;exact=false;
  const token=generation;
  try{if(!audioContext){audioContext=new AudioContext();analyser=audioContext.createAnalyser();analyser.fftSize=2048;samples=new Float32Array(analyser.fftSize);audioContext.createMediaElementSource(audio).connect(analyser);analyser.connect(audioContext.destination);}await audioContext.resume();if(token===generation)await audio.play();}catch(e){if(token===generation)report(e);}
}
for(const[key]of specs)$(key).oninput=()=>{values[key]=Number($(key).value);demoStart=null;exact=false;if(key==='mouth')stopVoice();if(key==='left'||key==='right'){blinkStart=-1;$('auto-blink').checked=false;}if(key.startsWith('gaze'))$('follow').checked=false;};
document.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>{reset();setValues(presets[button.dataset.preset]);document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
$('demo').onclick=()=>{reset();demoStart=now;blink();};$('blink').onclick=()=>{pause(false);blink();};$('voice').onclick=playVoice;$('pause').onclick=()=>pause(!paused);$('reset').onclick=reset;
$('zoom').onchange=fit;$('compare').onchange=()=>{$('original').hidden=!$('compare').checked;stage.dataset.compare=String($('compare').checked);};
stage.onpointermove=e=>{const b=stage.getBoundingClientRect();pointer={x:clamp((e.clientX-b.left)/b.width*2-1,-1,1),y:clamp(1-(e.clientY-b.top)/b.height*2,-1,1)};pointerActive=true;};stage.onpointerleave=()=>{pointerActive=false;};stage.onclick=()=>{pause(false);blink();};
audio.onerror=()=>report(new Error('原作语音加载失败。'));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!paused)pause(true);});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);audio.pause();audioContext?.close();app?.destroy(false,{children:true,texture:true,baseTexture:true});});new ResizeObserver(fit).observe(stage);
try{
  app=new PIXI.Application({view:$('portrait'),backgroundAlpha:0,antialias:true,autoStart:false,resolution:Math.min(devicePixelRatio,2),autoDensity:true});
  model=await PIXI.live2d.Live2DModel.from('/fine-model/Kurisu-fine.model3.json',{autoUpdate:false,autoInteract:false,motionPreload:PIXI.live2d.MotionPreloadStrategy.NONE});
  core=model.internalModel.coreModel;rawModel=core.getModel();
  const missing=specs.map(([, ,id])=>id).filter(id=>!rawModel.parameters.ids.includes(id));if(missing.length)throw new Error(`模型缺少参数：${missing.join(', ')}`);
  model.internalModel.updateFocus=updateParameters;model.internalModel.updateNaturalMovements=()=>{};model.internalModel.eyeBlink=undefined;
  app.stage.addChild(model);fit();
  window.fineLive2dTest={model,app,rawModel,applied,get paused(){return paused;},setPose(pose){reset();$('idle').checked=false;$('auto-blink').checked=false;$('follow').checked=false;setValues(pose);exact=true;},presets};
  document.querySelectorAll('input,button').forEach(c=>c.disabled=false);if(reduced)$('idle').checked=false;
  document.body.dataset.ready='true';last=performance.now();frame=requestAnimationFrame(tick);
}catch(e){$('state').textContent='模型加载失败';report(e);console.error(e);}
