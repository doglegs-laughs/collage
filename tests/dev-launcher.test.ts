import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('vite', () => ({ createServer: vi.fn() }));

let child: EventEmitter;
let close: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  child = new EventEmitter();
  close = vi.fn().mockResolvedValue(undefined);
  vi.mocked(spawn).mockReturnValue(child as ReturnType<typeof spawn>);
  vi.mocked(createServer).mockResolvedValue({ listen: vi.fn().mockResolvedValue(undefined), close, resolvedUrls: { local: ['http://localhost:5173/'] } } as unknown as Awaited<ReturnType<typeof createServer>>);
  vi.spyOn(process, 'on').mockReturnValue(process);
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function launch() {
  const script = '../scripts/dev.mjs';
  await import(script);
}

it('passes the explicit sandbox opt-out before Electron starts', async () => {
  vi.stubEnv('COLLAGE_NO_SANDBOX', '1');
  await launch();
  expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toEqual(['.', '--no-sandbox']);
});

it('keeps Chromium sandboxing enabled by default', async () => {
  vi.stubEnv('COLLAGE_NO_SANDBOX', '');
  await launch();
  expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toEqual(['.']);
});

it('reports a crashed Electron process as failure and shuts down Vite', async () => {
  await launch();
  child.emit('exit', null, 'SIGABRT');
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
  expect(close).toHaveBeenCalledOnce();
});

it('handles an executable spawn failure without leaving Vite running', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await launch();
  child.emit('error', new Error('ENOENT'));
  child.emit('exit', 1);
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
  expect(close).toHaveBeenCalledOnce();
});
