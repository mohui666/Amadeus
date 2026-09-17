import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = 'test-results/live2d';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 1060 } });
const page = await context.newPage();
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
const setRange = async (id, value) => {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};
const settle = () => page.waitForTimeout(850);
const snapshot = () => page.evaluate(() => ({
  vertices: window.live2dTest.rawModel.drawables.vertexPositions.flatMap(values => Array.from(values)),
  transform: [window.live2dTest.model.x, window.live2dTest.model.y, window.live2dTest.model.scale.x, window.live2dTest.model.scale.y],
}));
const changedVertices = (a, b) => a.vertices.reduce((sum, value, index) => sum + (Math.abs(value - b.vertices[index]) > .00001 ? 1 : 0), 0);
const screenshot = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: true });

try {
  await page.goto('http://127.0.0.1:3012/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  const model = await page.evaluate(() => ({
    coreVersion: Live2DCubismCore.Version.csmGetVersion(),
    parameters: window.live2dTest.rawModel.parameters.count,
    drawables: window.live2dTest.rawModel.drawables.count,
    physics: !!window.live2dTest.model.internalModel.physics,
  }));
  assert.equal(model.parameters, 72);
  assert.equal(model.drawables, 114);
  assert.ok(model.physics);
  for (const extension of ['.moc3', 'texture_00.png', '.physics3.json']) assert.ok(requests.some(url => url.endsWith(extension)), extension);
  console.log('PASS: actual Cubism model, texture and physics loaded', model);

  await page.locator('#follow').uncheck();
  await page.locator('#breathing').uncheck();
  await page.locator('#reset').click();
  await settle();
  const front = await snapshot();
  await screenshot('01-neutral');
  await setRange('yaw', -22); await settle();
  const left = await snapshot();
  await screenshot('02-left');
  await setRange('yaw', 22); await setRange('pitch', 12); await settle();
  const right = await snapshot();
  await screenshot('03-right-up');
  assert.deepEqual(front.transform, left.transform);
  assert.deepEqual(front.transform, right.transform);
  assert.ok(changedVertices(front, left) > 100);
  assert.ok(changedVertices(left, right) > 100);
  console.log('PASS: head turns deform mesh vertices with a fixed container transform', changedVertices(front, left), changedVertices(left, right));

  await page.locator('#reset').click(); await settle();
  for (const [emotion, parameter] of Object.entries({ happy: 'Smile', angry: 'Angry', sad: 'Sad', surprised: 'Surprissed', blush: 'ParamCheek' })) {
    await page.locator(`button[data-emotion="${emotion}"]`).click(); await settle();
    assert.equal(await page.locator(`button[data-emotion="${emotion}"]`).getAttribute('aria-pressed'), 'true');
    assert.ok(await page.evaluate(id => window.live2dTest.applied[id] > .97, parameter));
    await screenshot(`expression-${emotion}`);
  }
  console.log('PASS: five expressions blend to the actual model parameters');

  await page.locator('#reset').click(); await settle();
  await page.locator('#blink').click();
  const eyes = await page.evaluate(async () => {
    const values = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise(requestAnimationFrame);
      values.push(window.live2dTest.applied.ParamEyeLOpen);
    }
    return values;
  });
  assert.ok(Math.min(...eyes) < .05);
  assert.ok(eyes.some(value => value > .05 && value < .95));
  assert.ok(eyes.at(-1) > .99);
  await setRange('mouth', .65); await settle();
  assert.ok(await page.evaluate(() => window.live2dTest.applied.ParamMouthOpenY > .64));
  const openMouth = await snapshot();
  await setRange('mouth', 0); await settle();
  assert.ok(changedVertices(openMouth, await snapshot()) > 10);
  console.log('PASS: continuous eyelid movement and real mouth deformation');

  await page.locator('#voice').click();
  await page.waitForFunction(() => !document.getElementById('audio').paused);
  const mouthSamples = await page.evaluate(async () => {
    const values = [];
    for (let i = 0; i < 60; i++) { await new Promise(requestAnimationFrame); values.push(window.live2dTest.applied.ParamMouthOpenY); }
    return values;
  });
  assert.ok(Math.max(...mouthSamples) > .08);
  assert.ok(Math.max(...mouthSamples) - Math.min(...mouthSamples) > .05);
  await page.locator('#pause').click();
  assert.ok(await page.evaluate(() => document.getElementById('audio').paused));
  const pausedFrame = await snapshot();
  await page.waitForTimeout(250);
  assert.deepEqual(await snapshot(), pausedFrame);
  await page.locator('#pause').click();
  await page.waitForFunction(() => !document.getElementById('audio').paused);
  await page.locator('#reset').click(); await settle();
  assert.ok(await page.evaluate(() => document.getElementById('audio').paused && document.getElementById('audio').currentTime === 0 && window.live2dTest.applied.ParamMouthOpenY < .01));
  console.log('PASS: actual audio drives varying mouth values; pause/resume/reset synchronize audio and animation');

  await page.locator('#breathing').check();
  await page.locator('#demo').click();
  await page.waitForTimeout(4500);
  assert.equal(await page.locator('#stage').getAttribute('data-emotion'), 'happy');
  assert.ok(await page.evaluate(() => Math.abs(window.live2dTest.applied.ParamAngleX) > 1 && !!window.live2dTest.model.internalModel.physics));
  await page.locator('#reset').click(); await settle();
  await page.locator('#fullbody').check();
  await screenshot('04-fullbody');
  await page.locator('#fullbody').uncheck();
  console.log('PASS: continuous demo timeline, SDK physics and full-body framing');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#follow').check();
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const stage = await page.locator('#stage').boundingBox();
  await page.mouse.move(stage.x + stage.width * .9, stage.y + stage.height * .3); await settle();
  assert.ok(await page.evaluate(() => window.live2dTest.applied.ParamAngleX > 15));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.mouse.move(0, 0); await settle();
  await screenshot('05-mobile');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => !window.live2dTest.model.internalModel.physics && window.live2dTest.applied.ParamBreath === .5));
  assert.equal(await page.locator('#error').textContent(), '');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:3012/')));
  console.log('PASS: 390/320px layout, pointer follow, reduced motion and no external/API requests or runtime errors');
} finally {
  await browser.close();
}
