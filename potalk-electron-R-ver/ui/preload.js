'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('potalk', {
  cmd: c => ipcRenderer.invoke('cmd', c),
  reload: () => ipcRenderer.invoke('reload'),
  snapshot: () => ipcRenderer.invoke('snapshot'),
  onState: cb => ipcRenderer.on('state', (_e, m) => cb(m)),
})
