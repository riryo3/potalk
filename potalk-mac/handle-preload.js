const { contextBridge, ipcRenderer } = require('electron');

// 部屋一覧ピークの「気配」（細い線）にテーマ変数を届けるだけの preload。
// 開閉はメイン側のカーソル監視が担うため、クリック等の操作は持たない。
contextBridge.exposeInMainWorld('peekPm', {
  onTheme: f => ipcRenderer.on('handle:theme', (_e, t) => f(t)),
});
