const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file),
  openImages: () => invoke('dialog:openImages'),
  openAudio: () => invoke('dialog:openAudio'),
  analyzeAudio: (path, soft) => invoke('audio:analyze', path, soft === true),
  chooseFolder: () => invoke('dialog:chooseFolder'),
  readFile: (path) => invoke('file:read', path),
  saveFile: (opts) => invoke('file:save', opts),
  writeFile: (path, data, options) => invoke('file:write', path, data, options),
  exists: (path) => invoke('file:exists', path),
  revealInFolder: (path) => ipcRenderer.send('file:reveal', path),
  saveProject: (json, suggestedName, sidecar) => invoke('project:save', json, suggestedName, sidecar),
  setDirty: (dirty) => ipcRenderer.send('app:set-dirty', dirty === true),
  openProject: () => invoke('project:open'),
  getRecentStories: () => invoke('recent:list'),
  removeRecentStory: (path) => invoke('recent:remove', path),
  openRecentStory: (path) => invoke('recent:open', path),
  onOpenRecent: (cb) => {
    const handler = (_event, file) => cb(file);
    ipcRenderer.on('project:open-recent', handler);
    return () => ipcRenderer.removeListener('project:open-recent', handler);
  },
  autosaveWrite: (json, sidecar, meta) => invoke('autosave:write', json, sidecar, meta),
  autosaveRead: () => invoke('autosave:read'),
  autosaveClear: () => invoke('autosave:clear'),
  onAutosaveFlush: (cb) => {
    const handler = () => { Promise.resolve(cb()).then((ok) => ipcRenderer.send('autosave:flushed', ok === true), () => ipcRenderer.send('autosave:flushed', false)); };
    ipcRenderer.on('autosave:flush', handler);
    return () => ipcRenderer.removeListener('autosave:flush', handler);
  },
  onMenuCommand: (cb) => {
    const undo = () => cb('undo');
    const redo = () => cb('redo');
    ipcRenderer.on('menu:undo', undo);
    ipcRenderer.on('menu:redo', redo);
    return () => { ipcRenderer.removeListener('menu:undo', undo); ipcRenderer.removeListener('menu:redo', redo); };
  },
  videoCacheLookup: (spec) => invoke('video:cache-lookup', spec),
  makeVideo: (job) => invoke('video:make', job),
  onVideoProgress: (cb) => {
    const handler = (_event, fraction) => cb(fraction);
    ipcRenderer.on('video:progress', handler);
    return () => ipcRenderer.removeListener('video:progress', handler);
  },
  cancelVideo: () => invoke('video:cancel'),
});
