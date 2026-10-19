const fs = require('node:fs');
const path = require('node:path');

function isPackaged() {
  // Outside Electron (unit tests, scripts) require('electron') only resolves the binary path, and in
  // Electron 44 that triggers a lazy download, so don't touch it unless we're inside Electron.
  if (!process.versions.electron) return false;
  try {
    return require('electron').app?.isPackaged === true;
  } catch {
    return false;
  }
}

function ffmpegPath() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (isPackaged()) return path.join(process.resourcesPath, 'ffmpeg', exe);
  try {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // fall through to PATH
  }
  return exe;
}

module.exports = { ffmpegPath };
