const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, readImage, exists, writeSidecar } = require('./files.cjs');
const video = require('./video.cjs');
const store = require('./store.cjs');
const { analyzeAudio } = require('./beats.cjs');
const { createVideoCache, computeKey } = require('./video-cache.cjs');

const isMac = process.platform === 'darwin';
const devUrl = process.env.VITE_DEV_SERVER_URL;
// TIFF is converted with sips, so it is only offered on macOS (HEIC stays listed to give a clear message elsewhere).
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', ...(isMac ? ['tif', 'tiff'] : [])];
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg'];

if (process.env.COLLAGE_USER_DATA) app.setPath('userData', process.env.COLLAGE_USER_DATA);

if (process.env.COLLAGE_NO_SANDBOX === '1' || (process.getuid && process.getuid() === 0)) {
  app.commandLine.appendSwitch('no-sandbox');
}

let mainWindow = null;
let dirty = false; // unsaved Story work, reported by the renderer
let discardConfirmed = false; // the user already chose Discard for this close/quit
let quitting = false;
const crashes = [];

const autosave = store.createAutosaveStore(app.getPath('userData'));

/** Ask the renderer to write its autosave now. Resolves true when that worked. */
function requestFlush() {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (!wc) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ipcMain.removeListener('autosave:flushed', done); resolve(false); }, 5000);
    const done = (_e, ok) => { clearTimeout(timer); resolve(ok === true); };
    ipcMain.once('autosave:flushed', done);
    wc.send('autosave:flush');
  });
}

/** Ask before throwing away unsaved work. Returns true when it is fine to go on. */
function confirmDiscard(parent) {
  if (!dirty || discardConfirmed) return true;
  const choice = dialog.showMessageBoxSync(parent ?? undefined, {
    type: 'warning',
    buttons: ['Cancel', 'Discard'],
    defaultId: 0,
    cancelId: 0,
    message: 'You have unsaved changes in Story.',
    detail: 'Closing now will discard them. Cancel and use Save to keep your work.',
  });
  if (choice !== 1) return false;
  discardConfirmed = true;
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Collage',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1117' : '#f5f6f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!dirty || discardConfirmed) return;
    event.preventDefault();
    const w = mainWindow;
    void requestFlush().then((ok) => {
      if (ok) discardConfirmed = true; // autosaved: nothing is lost, so no prompt
      if ((ok || confirmDiscard(w)) && w && !w.isDestroyed()) w.close();
    });
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process gone (${details.reason}, exit code ${details.exitCode})`);
    if (details.reason === 'clean-exit' || !mainWindow) return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
    dirty = false; // the unsaved state died with the renderer
    if (crashes.length > 3) {
      console.error('Renderer keeps crashing; not reloading again.');
      return;
    }
    mainWindow.webContents.reload();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault();
  });
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
}

let recentList = [];
async function refreshRecents(add, remove) {
  const dir = app.getPath('userData');
  let list = await store.loadRecents(dir);
  if (add) list = store.addRecent(list, add);
  if (remove) list = store.removeRecent(list, remove);
  if (add || remove) await store.saveRecents(dir, list).catch(() => {});
  recentList = await store.describeRecents(dir);
  buildMenu();
}

async function openRecent(file) {
  try {
    const json = await fs.readFile(file, 'utf8');
    if (mainWindow) mainWindow.webContents.send('project:open-recent', { path: file, json });
    await refreshRecents(file);
  } catch {
    dialog.showMessageBoxSync(win(), { type: 'error', message: `${path.basename(file)} was not found.` });
    await refreshRecents(null, file);
  }
}

/** Tell the focused window's renderer to undo or redo (it decides between a text field and the app history). */
function sendMenuCommand(command) {
  const w = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (w && !w.isDestroyed()) w.webContents.send(`menu:${command}`);
}

function buildMenu() {
  const dev = !app.isPackaged;
  const recentItems = recentList.length
    ? recentList.map((r) => ({ label: r.exists ? r.name : `${r.name} (Not found)`, enabled: r.exists, click: () => void openRecent(r.path) }))
    : [{ label: 'No recent stories', enabled: false }];
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    { label: 'File', submenu: [{ label: 'Open Recent', submenu: recentItems }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
    {
      label: 'Edit',
      submenu: [
        // Custom items, not the undo/redo roles: the roles own CmdOrCtrl+Z and run the native text undo, so the app's own history never saw the key.
        { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuCommand('undo') },
        { id: 'redo', label: 'Redo', accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Shift+Z', click: () => sendMenuCommand('redo') },
        ...(isMac ? [] : [{ id: 'redo-alt', label: 'Redo', accelerator: 'Ctrl+Y', visible: false, click: () => sendMenuCommand('redo') }]),
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(dev ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []),
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const win = () => BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
const filterFor = (name, extensions) => [{ name, extensions }];

function registerIpc() {
  ipcMain.handle('dialog:openImages', async () => {
    const r = await dialog.showOpenDialog(win(), { properties: ['openFile', 'multiSelections'], filters: filterFor('Images', IMAGE_EXT) });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:openAudio', async () => {
    const r = await dialog.showOpenDialog(win(), { properties: ['openFile'], filters: filterFor('Audio', AUDIO_EXT) });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('audio:analyze', (_e, file) => analyzeAudio(file));
  ipcMain.handle('dialog:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win(), { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('file:read', async (_e, file) => new Uint8Array(await readImage(String(file))));
  ipcMain.handle('file:save', async (_e, opts) => {
    const r = await dialog.showSaveDialog(win(), { defaultPath: opts.defaultName, filters: opts.filters });
    if (r.canceled || !r.filePath) return null;
    await atomicWrite(r.filePath, opts.data);
    return r.filePath;
  });
  ipcMain.handle('file:write', (_e, file, data, options) => atomicWrite(String(file), data, { overwrite: options?.overwrite === true }));
  ipcMain.handle('file:exists', (_e, file) => exists(String(file)));
  ipcMain.on('file:reveal', (_e, file) => shell.showItemInFolder(String(file)));

  ipcMain.handle('project:save', async (_e, json, suggestedName, sidecar) => {
    const r = await dialog.showSaveDialog(win(), { defaultPath: suggestedName, filters: filterFor('Collage project', ['collage', 'json']) });
    if (r.canceled || !r.filePath) return null;
    let text = String(json);
    if (Array.isArray(sidecar) && sidecar.length) text = await writeSidecar(r.filePath, text, sidecar);
    await atomicWrite(r.filePath, Buffer.from(text, 'utf8'));
    await refreshRecents(r.filePath);
    return r.filePath;
  });
  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win(), { properties: ['openFile'], filters: filterFor('Collage project', ['collage', 'json']) });
    if (r.canceled) return null;
    const json = await fs.readFile(r.filePaths[0], 'utf8');
    await refreshRecents(r.filePaths[0]);
    return { path: r.filePaths[0], json };
  });
  ipcMain.handle('recent:list', () => store.describeRecents(app.getPath('userData')));
  ipcMain.handle('recent:remove', async (_e, file) => { await refreshRecents(null, String(file)); });
  ipcMain.handle('recent:open', async (_e, file) => {
    const f = String(file);
    try {
      const json = await fs.readFile(f, 'utf8');
      await refreshRecents(f);
      return { path: f, json };
    } catch {
      await refreshRecents(null, f);
      return null;
    }
  });

  ipcMain.handle('autosave:write', async (_e, json, sidecar, meta) => {
    try {
      await autosave.write(json, sidecar, meta);
      return true;
    } catch (error) {
      console.error('Autosave failed', error);
      return false;
    }
  });
  ipcMain.handle('autosave:read', () => autosave.read());
  ipcMain.handle('autosave:clear', () => autosave.clear());

  let videoCache = null;
  const getVideoCache = () => (videoCache ??= createVideoCache(path.join(app.getPath('userData'), 'video-cache')));

  // { key, hit }: key is null when the job cannot be cached.
  ipcMain.handle('video:cache-lookup', async (_event, spec) => {
    const key = await computeKey(spec, await video.pickEncoder());
    return { key, hit: key ? !!(await getVideoCache().find(key)) : false };
  });

  // Returns the output path, or '' when the user cancels the save dialog.
  ipcMain.handle('video:make', async (event, job) => {
    const cacheKey = typeof job.cacheKey === 'string' ? job.cacheKey : null;
    const cached = cacheKey ? await getVideoCache().find(cacheKey) : null;
    if (cacheKey && !cached && !(Array.isArray(job.frames) && job.frames.length)) throw new Error('VIDEO_CACHE_MISS');
    let output = job.output;
    if (!output) {
      const r = await dialog.showSaveDialog(win(), { defaultPath: typeof job.suggestedName === 'string' && job.suggestedName ? path.basename(job.suggestedName) : 'story.mp4', filters: filterFor('MP4 video', ['mp4']) });
      if (r.canceled || !r.filePath) return '';
      output = r.filePath;
    }
    if (cached) {
      await getVideoCache().copyTo(cached, output);
      return output;
    }
    const sender = event.sender;
    const made = await video.makeVideo({ ...job, output }, (fraction) => {
      if (!sender.isDestroyed()) sender.send('video:progress', fraction);
    });
    if (cacheKey) await getVideoCache().store(cacheKey, made).catch(() => {});
    return made;
  });
  ipcMain.handle('video:cancel', () => video.cancel());
  ipcMain.on('app:set-dirty', (_e, value) => { dirty = value === true; if (!dirty) discardConfirmed = false; });
}

app.whenReady().then(() => {
  registerIpc();
  buildMenu();
  void refreshRecents();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });

app.on('before-quit', (event) => {
  if (quitting) {
    event.preventDefault(); // already cancelling the video; app.quit() runs again when it is done
    return;
  }
  if (dirty && !discardConfirmed) {
    event.preventDefault();
    void requestFlush().then((ok) => {
      if (ok) discardConfirmed = true;
      if (ok || confirmDiscard(mainWindow)) app.quit();
    });
    return;
  }
  if (video.isRunning()) {
    event.preventDefault();
    quitting = true;
    video.cancel().catch(() => {}).finally(() => {
      quitting = false;
      app.quit();
    });
  }
});
