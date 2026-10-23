const { pathToFileURL } = require('node:url');

/** Only the application document receives the privileged preload API. */
function rendererUrl(file, devUrl) {
  if (!devUrl) return pathToFileURL(file).href;
  const url = new URL(devUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('The development server must be a local HTTP URL');
  }
  return url.href;
}

function sameDocument(actual, expected) {
  try {
    const a = new URL(actual), b = new URL(expected);
    a.hash = ''; b.hash = '';
    return a.href === b.href;
  } catch { return false; }
}

function trustedSender(event, window, expected) {
  if (!window || window.isDestroyed()) return false;
  const contents = window.webContents;
  return event.sender === contents && event.senderFrame === contents.mainFrame && sameDocument(event.senderFrame?.url, expected);
}

/**
 * True for Windows UNC and device-namespace paths (`\\host\share`, `//host`, `\\?\UNC\...`). Opening one makes Windows
 * authenticate to a remote host (NTLM leak), so the main process never touches them. Checked on every platform.
 */
function isRemotePath(file) {
  return typeof file === 'string' && /^[\\/]{2}/.test(file);
}

/** Throws for a path the renderer must not make the main process open. */
function assertLocalPath(file) {
  if (isRemotePath(file)) throw new Error('Network paths are not supported');
  return file;
}

module.exports = { isRemotePath, assertLocalPath, rendererUrl, sameDocument, trustedSender };
