import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const access = JSON.parse(await readFile(new URL('../.local/remote/access.json', import.meta.url), 'utf8'));
const binary = process.platform === 'win32' ? '.local/remote/windows/chisel.exe' : '.local/remote/chisel';
const tunnel = spawn(`${root}/${binary}`, [
  'client', '--keepalive', '10s', `${access.origin}/_tunnel`, 'R:0.0.0.0:3011:127.0.0.1:3011',
], { stdio: 'inherit', windowsHide: true, env: { ...process.env, AUTH: `${access.username}:${access.password}` } });
tunnel.on('error', error => { console.error(error.message); process.exitCode = 1; });
tunnel.on('exit', code => { process.exitCode = code || 0; });
process.once('SIGINT', () => tunnel.kill('SIGINT'));
process.once('SIGTERM', () => tunnel.kill('SIGTERM'));
