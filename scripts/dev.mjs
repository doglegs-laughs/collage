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
let signalled = false;
const stop = async (code) => {
  if (stopping) return;
  stopping = true;
  try {
    await server.close();
  } catch (error) {
    console.error('Could not close the Vite server:', error);
  } finally {
    process.exit(code);
  }
};
// Electron stopped because we asked it to (Ctrl-C / SIGTERM) is a normal exit; any other signal is a crash.
child.on('exit', (code, signal) => void stop(signalled ? 0 : (code ?? 1)));
child.on('error', (error) => {
  console.error('Could not start Electron:', error);
  void stop(1);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { signalled = true; child.kill(); });
