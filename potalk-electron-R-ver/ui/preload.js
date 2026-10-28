'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('potalk', {
  cmd: c => ipcRenderer.invoke('cmd', c),
  reload: () => ipcRenderer.invoke('reload'),
  growBy: dh => ipcRenderer.invoke('growBy', dh),
  toggleWin: k => ipcRenderer.invoke('toggleWin', k),
  togglePin: () => ipcRenderer.invoke('togglePin'),
  notify: (t, b) => ipcRenderer.invoke('notify', t, b),
  bannedExport: w => ipcRenderer.invoke('bannedExport', w),
  bannedImport: () => ipcRenderer.invoke('bannedImport'),
  snapshot: () => ipcRenderer.invoke('snapshot'),
  onState: cb => ipcRenderer.on('state', (_e, m) => cb(m)),
})
