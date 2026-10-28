const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shellPm', {
  select: t => ipcRenderer.send('shell:select', t),
  click: name => ipcRenderer.send('shell:click', name),
  mode: () => ipcRenderer.send('shell:mode'),
  quit: () => ipcRenderer.send('shell:quit'),
  railTheme: () => ipcRenderer.send('shell:rail-theme'),
  railMode: () => ipcRenderer.send('shell:rail-mode'),
  compact: () => ipcRenderer.send('shell:compact'),
  selectOpen: () => ipcRenderer.send('shell:select-open'),
  selectClose: () => ipcRenderer.send('shell:select-close'),
  onTheme: f => ipcRenderer.on('shell:theme', (_e, t) => f(t)),
  micSelect: v => ipcRenderer.send('shell:mic-select', v),
  onState: f => ipcRenderer.on('shell:state', (_e, s) => f(s)),
  onProfile: f => ipcRenderer.on('shell:profile', (_e, p) => f(p)),
  onMics: f => ipcRenderer.on('shell:mic-list', (_e, m) => f(m)),
});
