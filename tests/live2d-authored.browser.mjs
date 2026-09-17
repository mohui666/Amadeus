import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = 'test-results/live2d-authored';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1060 } });
const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', req => requests.push(req.url()));
const range = (id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const snapshot = () => page.evaluate(() => {
  const { rawModel, model } = window.authoredLive2dTest;
  return { meshes: Object.fromEntries(rawModel.drawables.ids.map((id, i) => [id, Array.from(rawModel.drawables.vertexPositions[i])])), transform: [model.x, model.y, model.scale.x, model.scale.y] };
});
const changed = (a, b) => Object.fromEntries(Object.keys(a.meshes).map(id => [id, a.meshes[id].filter((v, i) => Math.abs(v - b.meshes[id][i]) > .00001).length]));
const settle = () => page.waitForTimeout(900);
const shot = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: true });

try {
  await page.goto('http://127.0.0.1:3012/authored/index.html');
  await page.waitForSelector('body[data-ready=true]', { timeout: 30000 });
  const info = await page.evaluate(() => ({ parameters: window.authoredLive2dTest.rawModel.parameters.count, meshes: window.authoredLive2dTest.rawModel.drawables.ids, core: Live2DCubismCore.Version.csmGetVersion() }));
  assert.equal(info.meshes.length, 5);
  assert.ok(requests.some(url => url.endsWith('Kurisu-original-v1.moc3')));
  assert.ok(requests.some(url => url.endsWith('texture_00.png')));
  console.log('PASS: actual authored moc3 and texture loaded', info);
  await page.locator('#auto-blink').uncheck(); await page.locator('#auto-sway').uncheck(); await page.locator('#reset').click(); await settle();
  const neutral = await snapshot(); await shot('01-neutral');
  await range('tilt', -30); await settle(); const left = await snapshot(); await shot('02-tilt-left');
  await range('tilt', 30); await settle(); const right = await snapshot(); await shot('03-tilt-right');
  assert.deepEqual(left.transform, right.transform);
  const tiltChange = changed(left, right);
  assert.equal(tiltChange.body, 0); assert.ok(tiltChange.head > 20);
  console.log('PASS: head deformation rotates independently of body', tiltChange);
  await range('tilt', 0);
  await page.waitForFunction(() => Math.abs(window.authoredLive2dTest.applied.ParamAngleZ) < .0001);
  const eyeReference = await snapshot();
  await range('left', 0); await settle(); const leftClosed = await snapshot();
  assert.ok(changed(eyeReference, leftClosed).ArtMesh0 > 0); assert.equal(changed(eyeReference, leftClosed).ArtMesh, 0);
  await range('right', 0); await settle(); const bothClosed = await snapshot(); await shot('04-eyes-closed');
  assert.ok(changed(leftClosed, bothClosed).ArtMesh > 0);
  await range('left', .5); await range('right', .5); await settle(); await shot('05-eyes-half');
  await range('left', 1); await range('right', 1); await range('mouth', 1); await settle();
  const openMouth = await snapshot(); await shot('06-mouth-open');
  assert.ok(changed(neutral, openMouth).mouth > 0);
  console.log('PASS: both eye meshes and mouth have working keyforms');
  await range('mouth', 0); await settle(); await page.locator('#blink').click();
  const eyes = await page.evaluate(async () => {
    const values = [], start = performance.now();
    while (performance.now() - start < 400) { await new Promise(requestAnimationFrame); values.push(window.authoredLive2dTest.applied.ParamEyeLOpen); }
    return values;
  });
  assert.ok(Math.min(...eyes) < .05); assert.ok(eyes.some(v => v > .05 && v < .95)); assert.ok(eyes.at(-1) > .99);
  await page.locator('#voice').click(); await page.waitForFunction(() => !document.getElementById('audio').paused);
  const mouth = await page.evaluate(async () => {
    const values = [];
    for (let i = 0; i < 70; i++) { await new Promise(requestAnimationFrame); values.push(window.authoredLive2dTest.applied.ParamMouthOpenY); }
    return values;
  });
  assert.ok(Math.max(...mouth) > .08); assert.ok(Math.max(...mouth) - Math.min(...mouth) > .05);
  await page.locator('#pause').click(); const frozen = await snapshot(); await page.waitForTimeout(150); assert.deepEqual(await snapshot(), frozen);
  assert.ok(await page.evaluate(() => document.getElementById('audio').paused));
  console.log('PASS: continuous blink, audio-driven mouth, and pause');
  await page.locator('#compare').check(); assert.ok(await page.locator('#original').isVisible());
  await shot('07-original-comparison'); await page.locator('#compare').uncheck(); await page.locator('#reset').click();
  await page.setViewportSize({ width: 390, height: 844 }); await settle(); await shot('08-mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('PASS: original portrait comparison and mobile viewport; no page errors');
} finally { await browser.close(); }
