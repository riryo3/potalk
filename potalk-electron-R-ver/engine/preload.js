'use strict'
// 画面に出ない engine 窓（potalk.app を動かす）に、橋の JS を、ページより先に差し込む
const { ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')

window.__pmPost = m => ipcRenderer.send('pm', m)
for (const f of ['mic.js', 'bridge.js']) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), 'utf8'))
}
