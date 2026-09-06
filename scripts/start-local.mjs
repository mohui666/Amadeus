import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const qwen = process.argv.includes('--qwen');
const children = [
  spawn('.local/voice/venv/bin/python', ['-u', 'scripts/asr-api.py'], { cwd, stdio: 'inherit' }),
  spawn('bash', [qwen ? 'scripts/start-qwen.sh' : 'scripts/start-voice.sh'], { cwd, stdio: 'inherit' }),
  spawn(process.execPath, ['server/index.mjs'], { cwd, stdio: 'inherit', env: { ...process.env, AMADEUS_VOICE_ENGINE: qwen ? 'qwen-tts' : 'gpt-sovits' } }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); close(1); });
  child.on('exit', code => close(code || 0));
}
process.once('SIGINT', () => close());
process.once('SIGTERM', () => close());
