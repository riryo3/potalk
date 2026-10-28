const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pm', {
  onTheme: f => ipcRenderer.on('theme', (_e, t) => f(t)),
  onState: f => ipcRenderer.on('state', (_e, s) => f(s)),
  onPin: f => ipcRenderer.on('pin', (_e, v) => f(v)),
  onChat: f => ipcRenderer.on('chat-state', (_e, v) => f(v)),
  onMail: f => ipcRenderer.on('mail-state', (_e, v) => f(v)),
  onEq: f => ipcRenderer.on('eq', (_e, v) => f(v)),
  onUnread: f => ipcRenderer.on('unread', (_e, v) => f(v)),
  onReact: f => ipcRenderer.on('react', (_e, v) => f(v)),
  onCopied: f => ipcRenderer.on('copied', () => f()),
  cmd: c => ipcRenderer.send('potalk:room-cmd', c),
  openSettings: () => ipcRenderer.send('potalk:rset-open'),
  openMail: () => ipcRenderer.send('potalk:mail-open'),
  openLink: u => ipcRenderer.send('potalk:open-link', u),
  copy: () => ipcRenderer.send('potalk:room-copy'),
  chat: () => ipcRenderer.send('potalk:chat-toggle'),
  pin: () => ipcRenderer.send('potalk:room-pin'),
});
