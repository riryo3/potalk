'use strict'
const { app, BrowserWindow, ipcMain, net, session, shell } = require('electron')
const path = require('path')
const patcher = require('./engine/patcher')

const HOME = 'https://potalk.app/'
let engineWin = null
let uiWin = null
const state = { lobby: null, profile: null, room: null, eq: '', ready: false, patched: null, log: [] }

const log = s => { state.log.push(s); console.error('[engine]', s) }

/** potalk.app の本体ページだけ、取りに行って差し込みを当てて返す（ほかの通信は、そのまま通す） */
function installPagePatcher(ses) {
  ses.protocol.handle('https', async req => {
    const u = new URL(req.url)
    const passthrough = () => net.fetch(req, { bypassCustomProtocolHandlers: true })
    if (u.hostname !== 'potalk.app' || !(u.pathname === '/' || u.pathname === '/index.html') || req.method !== 'GET') return passthrough()
    try {
      const res = await net.fetch(req, { bypassCustomProtocolHandlers: true, headers: { 'Cache-Control': 'no-cache' } })
      const html = await res.text()
      const { html: out, ok, missing } = patcher.apply(html)
      state.patched = ok
      if (!ok) log('差し込み位置が見つかりません。元のページを使います: ' + missing)
      return new Response(out, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    } catch (e) {
      log('ページの取得に失敗: ' + e.message)
      return passthrough()
    }
  })
}

function createEngine() {
  engineWin = new BrowserWindow({
    show: false, width: 900, height: 700,
    webPreferences: { preload: path.join(__dirname, 'engine', 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  })
  engineWin.webContents.setAudioMuted(false)
  engineWin.loadURL(HOME)
}

function loadEngine(hash = '') {
  state.ready = false
  engineWin.loadURL(HOME + hash)
}

function createUi() {
  uiWin = new BrowserWindow({
    width: 420, height: 760, minWidth: 340, minHeight: 520, title: 'Potalker',
    webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true },
  })
  uiWin.loadFile(path.join(__dirname, 'ui', 'index.html'))
  uiWin.on('closed', () => { uiWin = null; app.quit() })
  uiWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
}

const send = (t, d) => { if (uiWin && !uiWin.isDestroyed()) uiWin.webContents.send('state', { t, d }) }

// engine 窓からの知らせ（ロビー・プロフィール・部屋・音の波形・ひとこと など）
ipcMain.on('pm', (_e, m) => {
  if (!m || typeof m.t !== 'string') return
  if (['lobby', 'profile', 'room', 'eq', 'cards'].includes(m.t)) state[m.t] = m.d
  else if (m.t === 'ready') state.ready = true
  send(m.t, m.d)
})

// 画面からの指示は、ページの橋（window.__pm.cmd）へ流す
ipcMain.handle('cmd', (_e, c) => {
  if (!engineWin || typeof c !== 'object' || c === null) return
  return engineWin.webContents.executeJavaScript('window.__pm && window.__pm.cmd(' + JSON.stringify(c) + ')').catch(() => {})
})
ipcMain.handle('reload', () => loadEngine())
ipcMain.handle('snapshot', () => ({ lobby: state.lobby, profile: state.profile, room: state.room, eq: state.eq, ready: state.ready, patched: state.patched }))

app.whenReady().then(() => {
  const ses = session.defaultSession
  installPagePatcher(ses)
  // マイクは、potalk.app にだけ許す
  const ok = (wc, perm) => ['media', 'audioCapture'].includes(perm) && /^https:\/\/potalk\.app/.test(wc ? wc.getURL() : '')
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(ok(wc, perm)))
  ses.setPermissionCheckHandler((wc, perm) => ok(wc, perm))
  createEngine()
  createUi()
  // 開発用：POTALK_SNAP=画像のパス を付けて起動すると、数秒後に画面を保存する（POTALK_SNAP_CMD で、その前に命令も1つ送れる）
  if (process.env.POTALK_SNAP) {
    const fs = require('fs')
    const shot = async (file) => { const img = await uiWin.webContents.capturePage(); fs.writeFileSync(file, img.toPNG()) }
    setTimeout(() => shot(process.env.POTALK_SNAP).then(() => { if (!process.env.POTALK_SNAP_CMD) app.quit() }), 12000)
    if (process.env.POTALK_SNAP_CMD) {
      setTimeout(() => engineWin.webContents.executeJavaScript('window.__pm.cmd(' + process.env.POTALK_SNAP_CMD + ')'), 14000)
      setTimeout(() => shot(process.env.POTALK_SNAP.replace('.png', '-2.png')).then(() => { engineWin.webContents.executeJavaScript("window.__pm.cmd({type:'leave'})"); setTimeout(() => app.quit(), 4000) }), 30000)
    }
  }
})
app.on('window-all-closed', () => app.quit())
