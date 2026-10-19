import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronBin = require('electron');

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

// Chromium checks its sandbox before main.cjs can apply the environment switch.
const args = ['.', ...(process.env.COLLAGE_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])];
const child = spawn(electronBin, args, { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
let stopping = false;
const stop = async (code) => {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(code ?? 1);
};
child.on('exit', stop);
child.on('error', (error) => {
  console.error('Could not start Electron:', error);
  void stop(1);
});
process.on('SIGINT', () => { child.kill(); });
process.on('SIGTERM', () => { child.kill(); });
