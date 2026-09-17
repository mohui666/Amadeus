const $=id=>document.getElementById(id),frame=$('engine'),audio=$('audio');
let api,playing=false,demoStart=null,context,analyser,samples,mouth=0,last=performance.now();
const poses={neutral:{},left:{angleX:-.65},right:{angleX:.65},closed:{eyeOpenL:0,eyeOpenR:0},half:{eyeOpenL:.5,eyeOpenR:.5},mouth:{mouthOpen:1},combo:{angleX:.65,angleY:.3,mouthOpen:.8},blinkTurn:{angleX:-.65,angleY:-.2,eyeOpenL:0,eyeOpenR:0}};
const sliders={yaw:'angleX',pitch:'angleY',eye:'eyeOpenL',mouth:'mouthOpen'};
function sync(){const p=api.state.params;for(const [id,k] of Object.entries(sliders)){$(id).value=p[k];$(id+'Value').value=id==='eye'||id==='mouth'?Math.round(p[k]*100)+'%':p[k].toFixed(2);}}
function stopVoice(){audio.pause();audio.currentTime=0;mouth=0;if(api)api.setTargets({mouthOpen:0});$('audioStatus').textContent='原作语音 · 初次见面';}
function syncAuto(){for(const [id,k] of [['idle','idle'],['blink','blink'],['physics','phys']])$(id).checked=api.state.auto[k];}
function staticPose(p){stopVoice();demoStart=null;api.setPose(p);playing=false;$('pause').textContent='继续';$('state').textContent='固定姿态';sync();syncAuto();}
for(const b of document.querySelectorAll('[data-pose]'))b.onclick=()=>{staticPose(poses[b.dataset.pose]);document.querySelectorAll('[data-pose]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));};
for(const [id,key] of Object.entries(sliders))$(id).oninput=()=>{const p=Object.fromEntries(Object.entries(sliders).map(([id,k])=>[k,Number($(id).value)]));p.eyeOpenR=p.eyeOpenL;staticPose(p);};
for(const [id,key] of [['idle','idle'],['blink','blink'],['physics','phys']])$(id).onchange=()=>{api.setAuto(key,$(id).checked);api.setPaused(false);playing=true;$('pause').textContent='暂停';$('state').textContent='连续动作';};
$('fullbody').onchange=()=>{api.setFullbody($('fullbody').checked);$('stage').classList.toggle('full',$('fullbody').checked);};
$('compare').onchange=()=>{$('original').hidden=!$('compare').checked;};
$('pause').onclick=()=>{playing=!playing;api.setPaused(!playing);if(!playing){demoStart=null;audio.pause();}$('pause').textContent=playing?'暂停':'继续';$('state').textContent=playing?'连续动作':'已暂停';};
$('reset').onclick=()=>{stopVoice();demoStart=null;api.reset();playing=true;for(const id of ['idle','blink','physics'])$(id).checked=true;$('pause').textContent='暂停';$('state').textContent='轻微待机';sync();};
$('demo').onclick=()=>{stopVoice();api.reset();api.setAuto('idle',false);api.setAuto('blink',false);syncAuto();playing=true;demoStart=performance.now();$('pause').textContent='暂停';$('state').textContent='12 秒动作演示';};
$('voice').onclick=async()=>{
 try{stopVoice();demoStart=null;api.reset();syncAuto();playing=true;$('pause').textContent='暂停';$('error').textContent='';
 if(!context){context=new AudioContext();analyser=context.createAnalyser();analyser.fftSize=2048;samples=new Float32Array(analyser.fftSize);context.createMediaElementSource(audio).connect(analyser);analyser.connect(context.destination);}
 await context.resume();await audio.play();$('state').textContent='语音口型';
 }catch(e){$('error').textContent=e.message;}
};
$('stopVoice').onclick=stopVoice;
audio.onended=()=>{mouth=0;api.setTargets({mouthOpen:0});$('state').textContent='轻微待机';};
function tick(now){
 const dt=Math.min((now-last)/1000,.05);last=now;
 if(!api){const candidate=frame.contentWindow.animeDemo;if(candidate?.ready){api=candidate;playing=true;document.querySelectorAll('button,input').forEach(x=>x.disabled=false);$('state').textContent='轻微待机';document.body.dataset.ready='true';window.anime25dTest={get api(){return api;},poses,setPose:staticPose,get audioMouth(){return mouth;}};}else if(candidate?.error)$('error').textContent=candidate.error;}
 if(api&&demoStart!==null){const t=(now-demoStart)/1000;if(t>=12){demoStart=null;api.reset();$('state').textContent='轻微待机';}else{const cycle=t%3.6,eye=cycle<.08?1-cycle/.08:cycle<.12?0:cycle<.24?(cycle-.12)/.12:1;api.setTargets({angleX:Math.sin(t*Math.PI/4)*.55,angleY:Math.sin(t*Math.PI/3)*.25,angleZ:Math.sin(t*.65)*.25,eyeOpenL:eye,eyeOpenR:eye,mouthOpen:t>4&&t<9?.08+.62*Math.pow(Math.sin(t*6),2):0});}}
 if(api&&analyser&&!audio.paused){analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length),target=Math.max(0,Math.min(1,(rms-.008)*10));mouth+=(target-mouth)*(1-Math.exp(-dt/(target>mouth?.035:.09)));api.setTargets({mouthOpen:mouth});$('audioStatus').textContent=`正在播放 · ${audio.currentTime.toFixed(1)} 秒 · 开口 ${Math.round(mouth*100)}%`;}
 requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
