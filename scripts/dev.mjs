import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronBin = require('electron');

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

const child = spawn(electronBin, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
const stop = async (code) => {
  await server.close();
  process.exit(code ?? 0);
};
child.on('exit', stop);
process.on('SIGINT', () => { child.kill(); });
process.on('SIGTERM', () => { child.kill(); });
