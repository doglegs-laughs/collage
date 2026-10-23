import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { rendererUrl, sameDocument, trustedSender } = createRequire(import.meta.url)('../electron/security.cjs');

describe('privileged renderer boundary', () => {
  it('accepts only the application document, allowing fragment changes', () => {
    const expected = rendererUrl('/app/index.html');
    expect(sameDocument(`${expected}#page-2`, expected)).toBe(true);
    for (const url of ['file:///tmp/evil.html', 'data:text/html,hello', 'file:///app/index.html/evil', `${expected}?evil=1`]) {
      expect(sameDocument(url, expected)).toBe(false);
    }
  });

  it('rejects deceptive development URL prefixes and remote development servers', () => {
    const expected = rendererUrl('/app/index.html', 'http://localhost:5173/');
    for (const url of ['http://localhost:5173.evil.test/', 'http://localhost:5173/evil', 'http://localhost:5173@evil.test/']) {
      expect(sameDocument(url, expected)).toBe(false);
    }
    for (const url of ['https://evil.test/', 'file:///tmp/evil.html', 'http://user@localhost:5173/']) {
      expect(() => rendererUrl('/app/index.html', url)).toThrow();
    }
  });

  it('requires the live window, its main frame, and the expected URL for IPC', () => {
    const url = 'file:///app/index.html';
    const mainFrame = { url };
    const webContents = { mainFrame };
    const window = { webContents, isDestroyed: () => false };
    const event = { sender: webContents, senderFrame: mainFrame };
    expect(trustedSender(event, window, url)).toBe(true);
    expect(trustedSender({ ...event, sender: {} }, window, url)).toBe(false);
    expect(trustedSender({ ...event, senderFrame: { url } }, window, url)).toBe(false);
    expect(trustedSender(event, null, url)).toBe(false);
    expect(trustedSender(event, { ...window, isDestroyed: () => true }, url)).toBe(false);
    mainFrame.url = 'https://evil.test/';
    expect(trustedSender(event, window, url)).toBe(false);
  });
});

describe('remote (UNC) paths', () => {
  const { isRemotePath, assertLocalPath } = createRequire(import.meta.url)('../electron/security.cjs');
  it('flags UNC and device-namespace paths but not local ones', () => {
    for (const p of ['\\\\host\\share\\a.jpg', '//host/share/a.jpg', '\\\\?\\UNC\\host\\share\\a.jpg', '\\/host/a.jpg', '/\\host']) {
      expect(isRemotePath(p)).toBe(true);
      expect(() => assertLocalPath(p)).toThrow();
    }
    for (const p of ['/Users/me/a.jpg', 'C:\\Users\\me\\a.jpg', 'a.jpg', '/a//b.jpg', '', 42, undefined]) expect(isRemotePath(p)).toBe(false);
  });
});
