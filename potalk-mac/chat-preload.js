const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pm', {
  onTheme: f => ipcRenderer.on('theme', (_e, t) => f(t)),
  openLink: u => ipcRenderer.send('potalk:open-link', u),
  send: t => ipcRenderer.send('potalk:chat-send', t),
  onLine: f => ipcRenderer.on('line', (_e, l) => f(l)),
  create: v => ipcRenderer.send('potalk:create-submit', v),
  onDefault: f => ipcRenderer.on('default', (_e, s) => f(s)),
  onLines: f => ipcRenderer.on('lines', (_e, ls) => f(ls)),
});
