const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, readImage, exists } = require('./files.cjs');
const video = require('./video.cjs');

const isMac = process.platform === 'darwin';
const devUrl = process.env.VITE_DEV_SERVER_URL;
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif'];
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg'];

if (process.env.COLLAGE_NO_SANDBOX === '1' || (process.getuid && process.getuid() === 0)) {
  app.commandLine.appendSwitch('no-sandbox');
}

let mainWindow = null;

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
  mainWindow.on('closed', () => { mainWindow = null; });
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

function buildMenu() {
  const dev = !app.isPackaged;
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
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
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

  ipcMain.handle('project:save', async (_e, json, suggestedName) => {
    const r = await dialog.showSaveDialog(win(), { defaultPath: suggestedName, filters: filterFor('Collage project', ['collage', 'json']) });
    if (r.canceled || !r.filePath) return null;
    await atomicWrite(r.filePath, Buffer.from(String(json), 'utf8'));
    return r.filePath;
  });
  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win(), { properties: ['openFile'], filters: filterFor('Collage project', ['collage', 'json']) });
    if (r.canceled) return null;
    return { path: r.filePaths[0], json: await fs.readFile(r.filePaths[0], 'utf8') };
  });

  // Returns the output path, or '' when the user cancels the save dialog.
  ipcMain.handle('video:make', async (event, job) => {
    let output = job.output;
    if (!output) {
      const r = await dialog.showSaveDialog(win(), { defaultPath: 'story.mp4', filters: filterFor('MP4 video', ['mp4']) });
      if (r.canceled || !r.filePath) return '';
      output = r.filePath;
    }
    const sender = event.sender;
    return video.makeVideo({ ...job, output }, (fraction) => {
      if (!sender.isDestroyed()) sender.send('video:progress', fraction);
    });
  });
  ipcMain.handle('video:cancel', () => video.cancel());
}

app.whenReady().then(() => {
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
