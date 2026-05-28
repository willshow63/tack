const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todo', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.send('data:save', data),
  hide: () => ipcRenderer.send('window:hide'),
  pin: (p) => ipcRenderer.send('window:pin', p),
  roll: (r, h) => ipcRenderer.send('window:roll', r, h),
  ignoreMouse: (ignore) => ipcRenderer.send('window:ignoreMouse', ignore),
  themeCurrent: (t) => ipcRenderer.send('theme:current', t),
  onFocusInput: (cb) => ipcRenderer.on('focus-input', () => cb()),
  onPinnedChanged: (cb) => ipcRenderer.on('pinned-changed', (_, p) => cb(p)),
  onThemeSet: (cb) => ipcRenderer.on('theme-set', (_, t) => cb(t)),
});
