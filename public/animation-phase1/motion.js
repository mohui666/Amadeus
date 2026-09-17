// Isolated stage-one testcase. Time values are seconds; motion does not own audio.
export function createMouthDriver() {
  let envelope = 0, mouth = 1, held = 0;
  return {
    update(level, dt) {
      envelope += (level - envelope) * (1 - Math.exp(-dt / (level > envelope ? .032 : .09)));
      held += dt;
      const target = mouth === 3
        ? (envelope < .085 ? (envelope < .016 ? 1 : 2) : 3)
        : mouth === 2
          ? (envelope > .14 ? 3 : envelope < .016 ? 1 : 2)
          : (envelope > .03 ? 2 : 1);
      if (target !== mouth && held >= .045) {
        mouth += Math.sign(target - mouth);
        held = 0;
      }
      return { mouth, envelope };
    },
    reset() { envelope = 0; mouth = 1; held = 0; },
  };
}

export function blinkEye(age) {
  if (age < 0 || age >= .19) return 'open';
  return age < .045 || age >= .11 ? 'half' : 'closed';
}

export function createPortraitMotion(random = Math.random) {
  let phase = 0, amplitude = .65, offset = 0, nodAge = 1;
  let previousMode = 'idle', blinkStart = -1, nextBlink = 2.8 + random() * 3.2;
  const driver = createMouthDriver();
  return {
    blink(time) { blinkStart = time; nextBlink = time + 2.8 + random() * 3.2; },
    stop(time) { driver.reset(); blinkStart = -1; nextBlink = time + 2.8 + random() * 3.2; },
    update({ time, dt, level = 0, mode = 'idle', reducedMotion = false }) {
      if (mode !== previousMode && mode === 'listening') nodAge = 0;
      previousMode = mode;
      phase += dt * Math.PI * 2 / 5.6;
      const ease = 1 - Math.exp(-dt / .3);
      amplitude += ((mode === 'speaking' ? 1 : .65) - amplitude) * ease;
      offset += ((mode === 'thinking' ? -.7 : 0) - offset) * ease;
      nodAge += dt;
      const nod = nodAge < .65 ? Math.sin(Math.PI * nodAge / .65) : 0;
      if (time >= nextBlink) this.blink(time);
      const { mouth, envelope } = driver.update(mode === 'speaking' ? level : 0, dt);
      return {
        mouth, envelope, blinkAge: blinkStart < 0 ? -1 : time - blinkStart,
        eye: blinkStart < 0 ? 'open' : blinkEye(time - blinkStart),
        // Whole-portrait uniform scaling/translation only; no local face deformation.
        y: reducedMotion ? 0 : Math.sin(phase) * amplitude * 1.5 + offset + nod * 1.3,
        scale: reducedMotion ? 1 : 1 + (1 - Math.cos(phase)) * amplitude * .0015,
      };
    },
  };
}

export function framePath(eye, mouth) {
  return eye === 'open'
    ? `../assets/kurisu/kurisu_normal${mouth}.png`
    : `../assets/kurisu/animation-phase1/${eye}${mouth}.png`;
}
