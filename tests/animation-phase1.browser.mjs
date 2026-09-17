import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Local portrait images and original OGG playback; no model, TTS or Android bridge fixtures.
const url = `${process.env.AMADEUS_URL || 'http://127.0.0.1:3010'}/animation-phase1/index.html`;
const output = 'test-results/animation-phase1';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [], apiRequests = [], checks = [];
const record = check => { checks.push(check); console.log(`PASS ${check}`); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1120 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/api/')) apiRequests.push(request.url()); });
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.locator('#motion').uncheck();
  for (const eye of ['open', 'half', 'closed']) {
    await page.locator('#eyes').selectOption(eye);
    for (const mouth of ['1', '2', '3']) {
      await page.locator('#mouth').selectOption(mouth);
      await expect(page.locator('#after')).toHaveAttribute('data-eye', eye);
      await expect(page.locator('#after')).toHaveAttribute('data-mouth', mouth);
      const path = await page.locator('#after').getAttribute('data-frame');
      assert.ok(path.endsWith(eye === 'open' ? `normal${mouth}.png` : `${eye}${mouth}.png`));
      await page.locator('#after').screenshot({ path: `${output}/${eye}${mouth}.png` });
    }
  }
  record('9 eye/mouth combinations render independent complete portraits');
  await page.locator('#zoom').check();
  await page.locator('#overlay').focus();
  await page.locator('#overlay').press('Home');
  for (let i = 0; i < 10; i++) await page.locator('#overlay').press('ArrowRight');
  await expect(page.locator('#overlay')).toHaveValue('0.5');
  await page.locator('#after').screenshot({ path: `${output}/face-overlay.png` });
  await page.locator('#zoom').uncheck();
  await page.locator('#overlay').press('Home');
  await page.locator('#motion').check();
  await page.locator('#demo').click();
  await expect(page.locator('#after')).toHaveAttribute('data-mode', 'listening');
  await expect(page.locator('#after')).toHaveAttribute('data-mode', 'thinking');
  await expect(page.locator('body')).toHaveAttribute('data-audio-playing', 'true');
  const trace = await page.evaluate(() => new Promise(resolve => {
    const rows = [], start = performance.now();
    let nextBlink = 200;
    function sample(now) {
      const age = now - start;
      if (age >= nextBlink) { document.getElementById('blink').click(); nextBlink += 850; }
      rows.push({ age, ...document.getElementById('after').dataset, audioTime: document.getElementById('audio').currentTime, volume: document.getElementById('raw').value });
      if (age >= 4200) resolve(rows); else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  assert.ok(trace.some(row => Number(row.mouth) > 1), 'real original voice must drive mouth opening');
  assert.ok(trace.some(row => row.eye === 'closed' && Number(row.mouth) > 1), 'blink must preserve speaking mouth');
  assert.ok(trace.some(row => row.eye === 'half'));
  assert.ok(trace.at(-1).audioTime > trace[0].audioTime + 3);
  record('original OGG drives mouth animation while half/closed blink frames preserve speech');
  await page.locator('#pause').click();
  await expect(page.locator('body')).toHaveAttribute('data-paused', 'true');
  const held = await page.evaluate(() => ({ time: document.getElementById('audio').currentTime, y: document.getElementById('after').dataset.y }));
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => ({ time: document.getElementById('audio').currentTime, y: document.getElementById('after').dataset.y })), held);
  await page.locator('#pause').click();
  await expect(page.locator('body')).toHaveAttribute('data-audio-playing', 'true');
  await page.locator('#stop').click();
  await expect(page.locator('#after')).toHaveAttribute('data-mouth', '1');
  await expect(page.locator('#after')).toHaveAttribute('data-eye', 'open');
  assert.equal(await page.locator('#audio').evaluate(audio => audio.currentTime), 0);
  await page.locator('#voice').click();
  await page.waitForFunction(() => document.getElementById('audio').currentTime > .3);
  await expect(page.locator('body')).toHaveAttribute('data-audio-playing', 'false', { timeout: 10000 });
  await expect(page.locator('#after')).toHaveAttribute('data-mode', 'idle');
  await expect(page.locator('#after')).toHaveAttribute('data-mouth', '1');
  await page.locator('#speed').selectOption('.5');
  assert.equal(await page.locator('#audio').evaluate(audio => audio.playbackRate), .5);
  await page.locator('#speed').selectOption('1');
  record('pause freezes audio/motion; resume, stop, replay, natural ending and speed controls work');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#after')).toHaveAttribute('data-y', '0.0000');
  await expect(page.locator('#after')).toHaveAttribute('data-scale', '1.000000');
  record('system reduced-motion setting disables portrait displacement');
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const { scroll, viewport } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(scroll <= viewport + 1, `overflow at ${width}: ${scroll}`);
    await expect(page.locator('#demo')).toBeVisible();
    if (width === 390) await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  }
  record('320 / 390 / 768 px layouts fit without horizontal overflow');
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, []);
  record('no browser exceptions or model/TTS API requests');
  await writeFile(`${output}/browser.json`, JSON.stringify({ url, checks, errors, apiRequests, audio: 'bundled original OGG; no synthesis or physical-device proof', trace }, null, 2));
} finally { await browser.close(); }
