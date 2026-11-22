const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('cp', {
  pick: kind => ipcRenderer.invoke('pick', kind),
  pathOf: f => webUtils.getPathForFile(f),
  probe: p => ipcRenderer.invoke('probe', p),
  connect: (h, p) => ipcRenderer.invoke('connect', h, p),
  cast: o => ipcRenderer.invoke('cast', o),
  cmd: o => ipcRenderer.send('cmd', o),
  disconnect: () => ipcRenderer.send('disconnect'),
  onTvs: cb => ipcRenderer.on('tvs', (_, v) => cb(v)),
  onState: cb => ipcRenderer.on('state', (_, v) => cb(v)),
  onClosed: cb => ipcRenderer.on('closed', () => cb())
});
