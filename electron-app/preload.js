// preload: 最小暴露
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wb', {
  status: () => ipcRenderer.invoke('status'),
  start: key => ipcRenderer.invoke('start', key),
  stop: key => ipcRenderer.invoke('stop', key),
  credits: () => ipcRenderer.invoke('credits'),
  models: () => ipcRenderer.invoke('models'),
  usage: range => ipcRenderer.invoke('usage', range),
  daily: range => ipcRenderer.invoke('daily', range),
  getActive: () => ipcRenderer.invoke('getActive'),
  setActive: (variant, id) => ipcRenderer.invoke('setActive', variant, id),
  limits: () => ipcRenderer.invoke('limits'),
  probeLimits: variant => ipcRenderer.invoke('probeLimits', variant),
  ranking: () => ipcRenderer.invoke('ranking'),
  log: flavor => ipcRenderer.invoke('log', flavor),
  onStatus: fn => ipcRenderer.on('status', (e, s) => fn(s)),
});
