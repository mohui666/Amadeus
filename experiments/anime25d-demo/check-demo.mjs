import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const out='experiments/anime25d-demo/qa';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:3013/');
await page.waitForSelector('body[data-ready=true]',{timeout:30000});
const state=await page.evaluate(()=>window.anime25dTest.api.state);
assert.equal(state.synthetic.eye,false);assert.equal(state.synthetic.mouth,false);assert.equal(state.warnings.length,0);
for(const name of ['neutral','left','right','closed','half','mouth','combo','blinkTurn']){
 await page.locator(`[data-pose=${name}]`).click();
 await page.locator('#stage').screenshot({path:`${out}/${name}.png`});
}
await page.locator('#demo').click();
const start=await page.evaluate(()=>window.anime25dTest.api.vertices());
await page.waitForTimeout(1800);
const end=await page.evaluate(()=>window.anime25dTest.api.vertices());
assert(start.some((a,i)=>a.vertices.some((v,j)=>Math.abs(v-end[i].vertices[j])>.1)));
for(let i=0;i<11;i++){
 await page.waitForTimeout(950);
 const finite=await page.evaluate(()=>window.anime25dTest.api.vertices().every(l=>l.vertices.every(Number.isFinite)));assert(finite);
 if(i%3===0)await page.locator('#stage').screenshot({path:`${out}/motion-${i}.png`});
}
assert.equal(await page.locator('#state').textContent(),'轻微待机');
await page.screenshot({path:`${out}/page.png`});
await page.locator('#voice').click();
await page.waitForFunction(()=>document.querySelector('#audio').currentTime>.15,{},{timeout:15000});
let maxMouth=0;
for(let i=0;i<12;i++){await page.waitForTimeout(150);maxMouth=Math.max(maxMouth,await page.evaluate(()=>window.anime25dTest.audioMouth));}
assert(maxMouth>.03,'Playing audio must produce mouth movement');
await page.locator('#stopVoice').click();await page.waitForTimeout(400);
const stopped=await page.evaluate(()=>({paused:document.querySelector('#audio').paused,mouth:window.anime25dTest.api.state.params.mouthOpen}));
assert(stopped.paused);assert(stopped.mouth<.02);
await page.setViewportSize({width:390,height:844});
await page.locator('[data-pose=neutral]').click();await page.screenshot({path:`${out}/mobile.png`,fullPage:true});
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert(!overflow);
assert.equal(errors.length,0);
const result={errors,layers:state.layers,synthetic:state.synthetic,warnings:state.warnings,poses:8,fullDemoSeconds:12,motionVerticesChanged:true,maxAudioMouth:maxMouth,stopped,mobileOverflow:overflow};
fs.writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
