import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PNG} from '../../.local/live2d/authoring/node_modules/pngjs/lib/png.js';
import {writePsdBuffer} from '../../.local/live2d/authoring/node_modules/ag-psd/dist/index.js';
const here=fileURLToPath(new URL('./',import.meta.url));
const upstream=fileURLToPath(new URL('../../.local/anime25d/upstream/',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(here+'assets/layers.json'));
const children=manifest.layers.map(({name,file})=>{
 const p=PNG.sync.read(fs.readFileSync(here+'assets/'+file));
 let l=p.width,t=p.height,r=0,b=0;
 for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(p.data[(y*p.width+x)*4+3]){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}
 const crop=new PNG({width:r-l,height:b-t});PNG.bitblt(p,crop,l,t,r-l,b-t,0,0);
 return {name,left:l,top:t,opacity:1,imageData:{width:crop.width,height:crop.height,data:new Uint8ClampedArray(crop.data)}};
});
fs.writeFileSync(here+'engine/sample.psd',writePsdBuffer({width:manifest.width,height:manifest.height,children},{generateThumbnail:false}));
fs.copyFileSync(upstream+'index.html',here+'engine/index.html');
for(const f of ['ag-psd.min.js','rigger.js','runtime.js','app.css','psd-worker.js','genericparts.js'])fs.copyFileSync(upstream+'lib/'+f,here+'engine/lib/'+f);
fs.copyFileSync(upstream+'LICENSE',here+'engine/LICENSE');
let app=fs.readFileSync(upstream+'lib/app.js','utf8').replace(/\r\n/g,'\n');
app=app.replace('const QUERY=', 'let demoCrop=.68;\nconst QUERY=');
app=app.replace('st.clientHeight/CH','st.clientHeight/(CH*demoCrop)');
fs.appendFileSync(here+'engine/lib/app.css','\nbody.obs #stage{display:block}body.obs #cv{position:absolute;top:0;left:50%;transform:translateX(-50%);max-width:none;max-height:none}\n');
app=app.replace('const customGenericReady=loadCustomGeneric();','const customGenericReady=Promise.resolve();');
app=app.replace('genericOpts().generic','undefined');
app=app.replace('resetParams();restoreSettings(true);','configureDemo();');
app=app.replace("hold=blinkVariant===2?3.4:0.34","hold=blinkVariant===2?0.08:0.04");
app=app.replace('0.18*Math.sin(p*Math.PI*4.0)','0.015*Math.sin(p*Math.PI*4.0)').replace('0.10*Math.sin(p*Math.PI*4.0','0.01*Math.sin(p*Math.PI*4.0');
app=app.replace('1-Math.exp(-dt*14)','1-Math.exp(-dt*(k.startsWith(\'eyeOpen\')?60:14))');
app=app.replace("if(L.bn!=='eyewhite'||!L.side)continue;const bit=L.side==='L'?1:2;", "if(L.bn!=='eyewhite'&&L.name!=='mouth_open_1')continue;const bit=L.name==='mouth_open_1'?4:L.side==='L'?1:2;");
app=app.replace("if(L.bn==='irides'&&L.side){const bit=L.side==='L'?1:2;", "if((L.bn==='irides'&&L.side)||L.name==='mouth_open_2'||L.name==='mouth_open_3'){const bit=L.bn==='mouth_open'?4:L.side==='L'?1:2;");
app=app.replace("e.breath=0.5+0.5*Math.sin(t*2*Math.PI/3.4);","e.breath=auto.idle?0.5+0.5*Math.sin(t*2*Math.PI/5.6):0;");
app=app.replace("e.breathHead=0.5+0.5*Math.sin(t*2*Math.PI/3.4-0.6);","e.breathHead=auto.idle?0.5+0.5*Math.sin(t*2*Math.PI/5.6-0.6):0;");
const bridge=`
const demoDefaults={...DEFAULTS,physAmp:.45,soft:.45,fhAmp:.30,fhSoft:.30,bust:0,mouthEase:.05,eyeEase:.1};
function configureDemo(){
 for(const key of ['idle','blink','rand','talk','mouse','mic','cam','phys'])setAuto(key,['idle','blink','phys'].includes(key));
 for(const [k,v] of Object.entries(demoDefaults))setSlider(k,v);
 Object.assign(cur,T);lastFrame=null;setBackground('dark');
 document.body.dataset.ready='true';
}
window.animeDemo={
 setFullbody(v){demoCrop=v?1:.68;fit();},
 get ready(){return document.body.dataset.ready==='true';},
 get error(){return statusEl.classList.contains('error')?statusEl.textContent:'';},
 get state(){return {params:{...cur},paused,auto:{...auto},warnings:currentRig?.warnings,synthetic:currentRig?.synth,layers:layers.length,anchors:A};},
 setTargets(p){for(const [k,v] of Object.entries(p))setSlider(k,v);},
 setPose(p){for(const k of ['idle','blink','rand','talk','mouse','phys'])setAuto(k,false);paused=true;Object.assign(cur,demoDefaults,p);Object.assign(T,cur);lastFrame={...cur,breath:0,breathHead:0,irisBounceX:1,irisBounceY:1};render(lastFrame);},
 reset(){paused=false;configureDemo();},
 setPaused(v){paused=v;},
 setAuto(k,v){setAuto(k,v);},
 blink(){blinkT=0;blinkVariant=1;blinkBounceStarted=false;nextBlink=performance.now()+4000;},
 vertices(){return layers.map(L=>({name:L.name,vertices:Array.from(L.cur)}));}
};
`;
const end='requestAnimationFrame(tick);\n})();';
if(!app.includes(end))throw new Error('Upstream application ending changed');
app=app.replace(end,bridge+'\n'+end);
fs.writeFileSync(here+'engine/lib/app.js',app);
console.log(JSON.stringify({layers:children.length,psd:'engine/sample.psd'}));
