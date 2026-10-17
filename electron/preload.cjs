const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file),
  openImages: () => invoke('dialog:openImages'),
  openAudio: () => invoke('dialog:openAudio'),
  chooseFolder: () => invoke('dialog:chooseFolder'),
  readFile: (path) => invoke('file:read', path),
  saveFile: (opts) => invoke('file:save', opts),
  writeFile: (path, data, options) => invoke('file:write', path, data, options),
  exists: (path) => invoke('file:exists', path),
  revealInFolder: (path) => ipcRenderer.send('file:reveal', path),
  saveProject: (json, suggestedName) => invoke('project:save', json, suggestedName),
  openProject: () => invoke('project:open'),
  makeVideo: (job) => invoke('video:make', job),
  onVideoProgress: (cb) => {
    const handler = (_event, fraction) => cb(fraction);
    ipcRenderer.on('video:progress', handler);
    return () => ipcRenderer.removeListener('video:progress', handler);
  },
  cancelVideo: () => invoke('video:cancel'),
});
