import test from 'node:test';
import assert from 'node:assert/strict';
import { createMouthDriver, createPortraitMotion, blinkEye, framePath } from '../public/animation-phase1/motion.js';

test('mouth rejects threshold chatter, steps through small opening and closes after silence', () => {
  const driver = createMouthDriver();
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push(driver.update(.23, 1 / 60).mouth);
  assert.deepEqual([...new Set(frames)], [1, 2, 3]);
  const jitter = [];
  for (let i = 0; i < 60; i++) jitter.push(driver.update(i % 2 ? .13 : .15, 1 / 60).mouth);
  assert.ok(jitter.every(mouth => mouth === 3));
  const silence = [];
  for (let i = 0; i < 24; i++) silence.push(driver.update(0, 1 / 60).mouth);
  assert.equal(silence.at(-1), 1);
  assert.ok(silence.includes(2));
  driver.update(.3, .2);
  driver.reset();
  assert.deepEqual(driver.update(0, 0), { mouth: 1, envelope: 0 });
});

test('mouth settling is based on elapsed time at 30, 60 and 120 Hz', () => {
  for (const rate of [30, 60, 120]) {
    const driver = createMouthDriver();
    let result;
    for (let i = 0; i < rate / 2; i++) result = driver.update(.22, 1 / rate);
    assert.equal(result.mouth, 3);
    for (let i = 0; i < rate / 2; i++) result = driver.update(0, 1 / rate);
    assert.equal(result.mouth, 1);
  }
});

test('blink passes half/closed/half and all three mouth frames remain available', () => {
  assert.deepEqual([-.1, 0, .05, .12, .20].map(blinkEye), ['open', 'half', 'closed', 'half', 'open']);
  assert.equal(new Set(['open', 'half', 'closed'].flatMap(eye => [1, 2, 3].map(mouth => framePath(eye, mouth)))).size, 9);
  const motion = createPortraitMotion(() => .5);
  for (let i = 0; i < 60; i++) motion.update({ time: i / 60, dt: 1 / 60, mode: 'speaking', level: .25 });
  motion.blink(1);
  const closed = motion.update({ time: 1.06, dt: .06, mode: 'speaking', level: .25 });
  assert.equal(closed.eye, 'closed');
  assert.equal(closed.mouth, 3);
  motion.stop(1.06);
  const stopped = motion.update({ time: 1.06, dt: 0 });
  assert.equal(stopped.eye, 'open');
  assert.equal(stopped.mouth, 1);
});

test('body motion stays continuous across state changes and respects reduced motion', () => {
  const motion = createPortraitMotion(() => .5);
  let previous;
  for (let i = 0; i < 300; i++) {
    const mode = i < 60 ? 'idle' : i < 120 ? 'listening' : i < 180 ? 'thinking' : i < 240 ? 'speaking' : 'idle';
    const next = motion.update({ time: i / 60, dt: 1 / 60, mode, level: .1 });
    if (previous) {
      assert.ok(Math.abs(next.y - previous.y) < .2, `body jump at frame ${i}`);
      assert.ok(Math.abs(next.scale - previous.scale) < .0002);
    }
    previous = next;
  }
  const frozen = motion.update({ time: 5, dt: 0 });
  assert.equal(frozen.y, previous.y);
  const reduced = motion.update({ time: 5.1, dt: .1, reducedMotion: true });
  assert.equal(reduced.y, 0);
  assert.equal(reduced.scale, 1);
});
