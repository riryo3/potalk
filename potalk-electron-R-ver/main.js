'use strict'
const { app, BrowserWindow, ipcMain, net, session, shell, screen, dialog, Notification } = require('electron')
const fs = require('fs')
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

// ひとこと用ドロワーの開閉で、窓を、その高さのぶんだけ伸び縮みさせる（上の端は動かさない。下に余地がなければ、窓を上にずらす）
ipcMain.handle('growBy', (_e, dh) => {
  if (!uiWin || typeof dh !== 'number') return
  const b = uiWin.getBounds(), wa = screen.getDisplayMatching(b).workArea
  const h = Math.min(Math.max(b.height + dh, 200), wa.height)
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - h))
  uiWin.setBounds({ x: b.x, y, width: b.width, height: h })
})
ipcMain.handle('notify', (_e, title, body) => { if (Notification.isSupported()) new Notification({ title: String(title), body: String(body) }).show() })

// 自衛ワードの書き出し・読み込み（UTF-8・BOM なし・LF・1行に1ワード・先頭が最新。ファイル名は日付つき）
const bannedFileName = () => { const d = new Date(), p2 = n => String(n).padStart(2, '0'); return `jiei-words-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.txt` }
ipcMain.handle('bannedExport', async (_e, words) => {
  const r = await dialog.showSaveDialog(uiWin, { defaultPath: bannedFileName(), filters: [{ name: 'テキスト', extensions: ['txt'] }] })
  if (r.canceled || !r.filePath) return null
  fs.writeFileSync(r.filePath, (words.length ? words.join('\n') + '\n' : ''), 'utf8')
  return words.length
})
ipcMain.handle('bannedImport', async () => {
  const r = await dialog.showOpenDialog(uiWin, { properties: ['openFile'], filters: [{ name: 'テキスト', extensions: ['txt'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  let text = fs.readFileSync(r.filePaths[0], 'utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(x => x.trim()).filter(Boolean)
})
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
  // 開発用：POTALK_STEPS='[{"at":ミリ秒,"ui":"JS"|"eng":"JS"|"shot":"画像のパス"|"quit":1}, ...]' を付けて起動すると、順に実行する
  if (process.env.POTALK_STEPS) {
    for (const st of JSON.parse(process.env.POTALK_STEPS)) {
      setTimeout(async () => {
        try {
          if (st.ui) await uiWin.webContents.executeJavaScript(st.ui)
          if (st.eng) await engineWin.webContents.executeJavaScript(st.eng)
          if (st.shot) fs.writeFileSync(st.shot, (await uiWin.webContents.capturePage()).toPNG())
        } catch (e) { console.error('[step]', e.message) }
        if (st.quit) app.quit()
      }, st.at)
    }
  }
})
app.on('window-all-closed', () => app.quit())
