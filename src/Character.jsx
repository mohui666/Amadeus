import { useEffect, useState } from 'react';

const expressions = {
  neutral: 'normal', happy: 'happy', angry: 'angry', sad: 'sad', surprised: 'sided_surprised',
  thinking: 'sided_thinking', blush: 'blush', annoyed: 'annoyed', pleasant: 'sided_pleasant',
  indifferent: 'indifferent', worried: 'sided_worried', disappointed: 'disappointed', wink: 'winking',
};
const generated = new Set(['skeptical', 'tender', 'amused']);

export default function Character({ emotion, mouth, speaking, listening, thinking, active, onClick, menu = false }) {
  const [blink, setBlink] = useState(false);
  const mood = listening ? 'neutral' : thinking ? 'thinking' : emotion;
  const expression = expressions[mood] || 'normal';
  const closedEyes = expression.startsWith('sided_') || expression === 'side' ? 'sided_eyes_closed' : 'eyes_closed';
  useEffect(() => {
    let timer, openEyes;
    function schedule() {
      timer = setTimeout(() => {
        setBlink(true);
        openEyes = setTimeout(() => { setBlink(false); schedule(); }, 110 + Math.random() * 55);
      }, 2800 + Math.random() * 3200);
    }
    schedule();
    return () => { clearTimeout(timer); clearTimeout(openEyes); };
  }, []);
  useEffect(() => {
    if (generated.has(mood)) {
      for (const frame of [1, 2, 3, 4]) new Image().src = `./assets/kurisu/expressions-v3/${mood}${frame}.png`;
      return;
    }
    for (const exp of new Set([expression, 'eyes_closed', 'sided_eyes_closed'])) {
      for (const frame of [1, 2, 3]) new Image().src = './assets/kurisu/kurisu_' + exp + frame + '.png';
    }
  }, [mood]);
  const state = listening ? 'listening' : speaking ? 'speaking' : thinking ? 'thinking' : active ? 'idle' : 'standby';
  return <button className="character-hit" data-state={state} data-expression={mood} data-blinking={blink} aria-label={menu ? '展开或收起通话菜单' : '让红莉栖打个招呼'} onClick={onClick}>
    <img className="character" src={generated.has(mood) ? `./assets/kurisu/expressions-v3/${mood}${blink ? 4 : speaking ? mouth : 1}.png` : './assets/kurisu/kurisu_' + (blink ? closedEyes : expression) + (speaking ? mouth : 1) + '.png'} alt="牧濑红莉栖，身穿白大褂的 Amadeus 形象" draggable="false" />
  </button>;
}
