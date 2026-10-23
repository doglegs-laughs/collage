import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const files = createRequire(import.meta.url)('../electron/files.cjs') as {
  MAX_IMAGE_BYTES: number;
  readImage(file: string): Promise<Buffer>;
};

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-image-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('readImage', () => {
  it('reads a regular file', async () => {
    const file = path.join(dir, 'a.jpg');
    await fs.writeFile(file, Buffer.from([0xff, 0xd8, 1, 2, 3]));
    expect([...(await files.readImage(file))]).toEqual([0xff, 0xd8, 1, 2, 3]);
  });

  it('rejects a directory', async () => {
    await expect(files.readImage(dir)).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO without hanging', async () => {
    const fifo = path.join(dir, 'pipe.jpg');
    execFileSync('mkfifo', [fifo]);
    await expect(files.readImage(fifo)).rejects.toThrow(/regular file/);
  });

  it.skipIf(process.platform === 'win32')('rejects a device file', async () => {
    await expect(files.readImage('/dev/zero')).rejects.toThrow(/regular file/);
  });

  it('rejects a file over the size limit without reading it', async () => {
    const big = path.join(dir, 'big.jpg');
    await fs.writeFile(big, '');
    await fs.truncate(big, files.MAX_IMAGE_BYTES + 1);
    await expect(files.readImage(big)).rejects.toThrow(/too large/);
  });
});
