import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = createRequire(import.meta.url)('../electron/files.cjs') as {
  atomicWrite(target: string, data: Buffer, options?: { overwrite?: boolean }): Promise<void>;
};

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-writes-')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }); });

describe('exclusive file writes', () => {
  it('lets only one concurrent writer create a target', async () => {
    const target = path.join(dir, 'photo.jpg');
    const results = await Promise.allSettled(['one', 'two'].map((text) => files.atomicWrite(target, Buffer.from(text), { overwrite: false })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.findIndex((r) => r.status === 'fulfilled');
    expect(await fs.readFile(target, 'utf8')).toBe(['one', 'two'][winner]);
    expect(await fs.readdir(dir)).toEqual(['photo.jpg']);
  });

  it('still writes on filesystems without hard links', async () => {
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }));
    const target = path.join(dir, 'photo.jpg');
    await files.atomicWrite(target, Buffer.from('photo'), { overwrite: false });
    expect(await fs.readFile(target, 'utf8')).toBe('photo');
    expect(await fs.readdir(dir)).toEqual(['photo.jpg']);
  });

  it('preserves a file created just before the fallback publishes its output', async () => {
    const target = path.join(dir, 'photo.jpg');
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }));
    // Another writer creates the target just before the exclusive copy publishes ours.
    const copy = fs.copyFile;
    vi.spyOn(fs, 'copyFile').mockImplementation(async (source, dest, flags) => {
      await fs.writeFile(target, 'other writer');
      return copy(source, dest, flags);
    });
    await expect(files.atomicWrite(target, Buffer.from('replacement'), { overwrite: false })).rejects.toThrow('already exists');
    expect(await fs.readFile(target, 'utf8')).toBe('other writer');
    expect(await fs.readdir(dir)).toEqual(['photo.jpg']);
  });

  it('removes a truncated target when the fallback copy fails part-way', async () => {
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }));
    const target = path.join(dir, 'photo.jpg');
    vi.spyOn(fs, 'copyFile').mockImplementation(async (_source, dest) => {
      await fs.writeFile(dest, 'tru');
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    await expect(files.atomicWrite(target, Buffer.from('photo'), { overwrite: false })).rejects.toThrow('disk full');
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('surfaces a real permission error instead of copying', async () => {
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('not permitted'), { code: 'EPERM' }));
    const copy = vi.spyOn(fs, 'copyFile');
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      await expect(files.atomicWrite(path.join(dir, 'photo.jpg'), Buffer.from('photo'), { overwrite: false })).rejects.toThrow('not permitted');
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
    expect(copy).not.toHaveBeenCalled();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('treats EPERM from link as unsupported hard links on Windows', async () => {
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('not permitted'), { code: 'EPERM' }));
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await files.atomicWrite(path.join(dir, 'photo.jpg'), Buffer.from('photo'), { overwrite: false });
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
    expect(await fs.readFile(path.join(dir, 'photo.jpg'), 'utf8')).toBe('photo');
  });

  it('cleans up partial temporary files when writing fails', async () => {
    const write = fs.writeFile;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...args) => {
      await write(file, ...args);
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    await expect(files.atomicWrite(path.join(dir, 'photo.jpg'), Buffer.from('photo'))).rejects.toThrow('disk full');
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
