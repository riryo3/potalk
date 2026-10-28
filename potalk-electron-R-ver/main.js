'use strict'
const { app, BrowserWindow, ipcMain, net, session, shell, screen, dialog, Notification, Menu, clipboard } = require('electron')
const fs = require('fs')
const path = require('path')
const patcher = require('./engine/patcher')

const HOME = 'https://potalk.app/'
let engineWin = null
const state = { lobby: null, profile: null, room: null, eq: '', ready: false, patched: null, log: [], chat: [], devices: [], banned: [] }

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

const cmd = c => engineWin ? engineWin.webContents.executeJavaScript('window.__pm && window.__pm.cmd(' + JSON.stringify(c) + ')').catch(() => {}) : undefined

// ---- 設定（表示のしかた・表示サイズ）。次に起動したときも、そのまま ----
const prefs = { mode: 'single', scale: 100, pos: {}, muteOnCreate: true, muteOnJoin: true, notifyRooms: true, mic: '', thanksShown: false }       // mode: 'single'（ひとつの窓）／'split'（分けた窓）。pos: 窓の種類ごとの、前回の位置と大きさ
const SCALES = [50, 60, 70, 80, 90, 100]
const prefsFile = () => path.join(app.getPath('userData'), 'settings.json')
function loadPrefs() {
  try {
    const j = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'))
    if (j.mode === 'single' || j.mode === 'split') prefs.mode = j.mode
    if (SCALES.includes(j.scale)) prefs.scale = j.scale
    if (j.pos && typeof j.pos === 'object') prefs.pos = j.pos
    for (const k of ['muteOnCreate', 'muteOnJoin', 'notifyRooms', 'thanksShown']) if (typeof j[k] === 'boolean') prefs[k] = j[k]
    if (typeof j.mic === 'string') prefs.mic = j.mic.slice(0, 200)
  } catch {}
}
const savePrefs = () => { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)) } catch {} }

// ---- 窓 ----
// single：1つの窓にまとめる／ lobby・room・chat・mail・settings：分けた窓（どれも同じ画面のコードを、?w=種類 で出し分ける）
const BASE = {      // 表示サイズ 100% のときの大きさ（w, h）と、縮められる限度（mw, mh）
  single: { w: 420, h: 760, mw: 340, mh: 520 },
  lobby: { w: 420, h: 760, mw: 340, mh: 420 },
  room: { w: 360, h: 600, mw: 320, mh: 460 },
  chat: { w: 340, h: 420, mw: 280, mh: 240 },
  mail: { w: 360, h: 460, mw: 300, mh: 280 },
  settings: { w: 340, h: 420, mw: 300, mh: 260 },
  cardedit: { w: 500, h: 740, mw: 460, mh: 520 },
  cardauth: { w: 460, h: 520, mw: 440, mh: 420 },
}
const TITLE = { single: 'Potalker', lobby: 'Potalker', room: '部屋', chat: 'ひとこと', mail: 'おたより', settings: '設定', cardedit: '名刺の設定', cardauth: '本人確認' }
const wins = {}
let pinned = false         // 最前面
let drawerSideNow = 'left', drawerShift = 0     // 部屋一覧のドロワーを出す側／左に余地がなくて、本体を右にずらしたぶん
let spkMuted = false       // スピーカーのミュート（橋の spk 命令。部屋を出ても、そのまま）
let quitting = false
const mainKind = () => prefs.mode === 'split' ? 'lobby' : 'single'
const sc = () => prefs.scale / 100
const allWins = () => Object.values(wins).filter(w => w && !w.isDestroyed())
const send = (t, d) => { for (const w of allWins()) w.webContents.send('state', { t, d }) }
const winsState = () => ({ prefs: { muteOnCreate: prefs.muteOnCreate, muteOnJoin: prefs.muteOnJoin, notifyRooms: prefs.notifyRooms, mic: prefs.mic }, mode: prefs.mode, scale: prefs.scale, pinned, spk: spkMuted, drawer: !!wins.drawer, drawerSide: drawerSideNow, chat: !!wins.chat, mail: !!wins.mail, settings: !!wins.settings })
const sendWins = () => send('wins', winsState())
const isJoined = () => !!(state.room && state.room.joined)

function createWin(kind, pos) {
  const b = BASE[kind], s = sc(), rec = savedBounds(kind)
  const minW = Math.round(b.mw * s), minH = Math.round(b.mh * s)
  const w = new BrowserWindow({
    width: Math.max(minW, rec && rec.width ? rec.width : Math.round(b.w * s)), height: Math.max(minH, rec && rec.height ? rec.height : Math.round(b.h * s)), minWidth: minW, minHeight: minH,
    title: TITLE[kind], alwaysOnTop: pinned, icon: path.join(__dirname, 'build', 'icon.png'), ...(pos || (rec ? { x: rec.x, y: rec.y } : {})),
    autoHideMenuBar: kind !== 'lobby' && kind !== 'single',      // 補助の窓は、メニューを隠す（Alt で出る。Windows・Linux のみ。Mac は、上のメニューバー）
    webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true },
  })
  w._kind = kind; wins[kind] = w
  if (kind !== 'lobby' && kind !== 'single') w.removeMenu()       // 補助の窓には、メニューを付けない（autoHideMenuBar は、GNOME の Ubuntu で隠れなかった。Mac は、窓にメニューを持たないので、変わらない）
  w.on('page-title-updated', e => e.preventDefault())
  w.webContents.on('did-finish-load', () => { if (!w.isDestroyed()) w.webContents.setZoomFactor(sc()) })
  w.loadFile(path.join(__dirname, 'ui', 'index.html'), { query: { w: kind } })
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
  w.on('move', () => { scheduleSnap(w); schedulePos(w); if (kind === 'single') syncDrawer() })
  w.on('resize', () => { schedulePos(w); if (kind === 'single') syncDrawer() })
  w.on('close', e => onClose(e, w))
  w.on('closed', () => {
    if (wins[kind] !== w) return            // 切り替えで、すでに外した窓
    delete wins[kind]
    if (quitting) return
    // 名刺の設定・本人確認の窓を、×で閉じたら、ページ側の窓も閉じる
    if (kind === 'cardedit' && state.cards && state.cards.edit) cmd({ type: 'ceClose' })
    if (kind === 'cardauth' && state.cards && state.cards.auth) cmd({ type: 'caCancel' })
    if (kind === mainKind()) app.quit(); else sendWins()
  })
  return w
}

// 通話中に、部屋の窓や本体の窓を閉じようとしたら、確かめる（部屋の窓は、退出。本体は、終了）
function onClose(e, w) {
  if (quitting || !isJoined() || (w._kind !== 'room' && w._kind !== mainKind())) return
  e.preventDefault()
  if (w._asking) return
  w._asking = true
  const leaving = w._kind === 'room'
  dialog.showMessageBox(w, { type: 'question', buttons: [leaving ? '退出する' : '終了する', 'キャンセル'], defaultId: 1, cancelId: 1, message: leaving ? '部屋から退出しますか？' : '通話中です。終了しますか？' }).then(r => {
    w._asking = false
    if (r.response !== 0) return
    if (leaving) cmd({ type: 'leave' }); else { quitting = true; app.quit() }
  })
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)))

// ---- 窓の位置と大きさの記憶（種類ごと）。画面の外に出てしまう位置は、使わない ----
function savedBounds(kind) {
  const r = prefs.pos[kind]
  if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y)) return null
  const ok = screen.getAllDisplays().some(d => { const a = d.workArea; return r.x + 80 < a.x + a.width && r.x + (r.width || 200) - 80 > a.x && r.y >= a.y - 10 && r.y < a.y + a.height - 40 })
  return ok ? r : null
}
function schedulePos(w) {
  clearTimeout(w._posTimer)
  w._posTimer = setTimeout(() => {
    if (w.isDestroyed() || wins[w._kind] !== w) return
    const b = w.getBounds(), rec = { x: b.x, y: b.y, width: b.width, height: b.height }
    if (w._kind === 'single') delete rec.height        // ひとことのドロワーで伸びた高さは、覚えない
    prefs.pos[w._kind] = rec; savePrefs()
  }, 500)
}

// 分けた窓を開く。いちばん右の窓の右隣へ（入らなければ、いちばん左の窓の左隣へ）、上の高さをそろえて
function openAux(kind) {
  if (prefs.mode !== 'split' || !BASE[kind] || kind === 'lobby') return
  if (wins[kind]) { wins[kind].show(); wins[kind].focus(); return wins[kind] }
  const b = BASE[kind], s = sc(), W = Math.round(b.w * s), H = Math.round(b.h * s)
  const others = allWins()
  const rec = savedBounds(kind)
  let pos = rec ? { x: rec.x, y: rec.y } : undefined
  if (!pos && others.length) {
    const bs = others.map(o => o.getBounds()), wa = screen.getDisplayMatching(bs[0]).workArea
    const right = bs.reduce((a, r) => r.x + r.width > a.x + a.width ? r : a), left = bs.reduce((a, r) => r.x < a.x ? r : a)
    if (right.x + right.width + W <= wa.x + wa.width) pos = { x: right.x + right.width, y: right.y }
    else if (left.x - W >= wa.x) pos = { x: left.x - W, y: left.y }
    if (pos) pos.y = clamp(pos.y, wa.y, wa.y + wa.height - H)
  }
  const w = createWin(kind, pos)
  sendWins()
  return w
}
function closeAux(kinds) {
  for (const k of kinds) { const w = wins[k]; if (!w) continue; delete wins[k]; if (!w.isDestroyed()) w.destroy() }
  sendWins()
}
const toggleAux = kind => { if (wins[kind]) closeAux([kind]); else openAux(kind) }

// ひとつの窓／分けた窓の切り替え。新しい窓を先に作ってから、古い窓を外す（窓がなくなって終了、とならないように）
function setMode(mode) {
  if (mode === prefs.mode || (mode !== 'single' && mode !== 'split')) return
  closeDrawer()
  const old = allWins(), ob = (old.find(w => w._kind === mainKind()) || old[0] || { getBounds: () => null }).getBounds()
  prefs.mode = mode; savePrefs()
  createWin(mainKind(), ob ? { x: ob.x, y: ob.y } : undefined)
  for (const w of old) { if (wins[w._kind] === w) delete wins[w._kind]; if (!w.isDestroyed()) w.destroy() }
  if (mode === 'split' && isJoined()) openAux('room')
  onCards()
  sendWins(); buildMenu()
}

// 表示サイズ：全部の窓の大きさと、中身の拡大率を、そろえて変える
function applyScale(pct) {
  if (!SCALES.includes(pct) || pct === prefs.scale) return
  closeDrawer()
  const old = sc(); prefs.scale = pct; savePrefs()
  const s = sc(), r = s / old
  // 並べていた窓が離れないように、本体の左上を基準に、位置も同じ比率で動かす
  const mw = wins[mainKind()], o = mw ? mw.getBounds() : null
  for (const w of allWins()) {
    const b = w.getBounds(), base = BASE[w._kind]
    const x = o && w !== mw ? Math.round(o.x + (b.x - o.x) * r) : b.x, y = o && w !== mw ? Math.round(o.y + (b.y - o.y) * r) : b.y
    w.setMinimumSize(Math.round(base.mw * s), Math.round(base.mh * s))
    w.setBounds({ x, y, width: Math.round(b.width * r), height: Math.round(b.height * r) })
    w.webContents.setZoomFactor(s)
  }
  sendWins(); buildMenu()
}

function toggleSpk() {
  spkMuted = !spkMuted
  cmd({ type: 'spk', on: spkMuted })                           // 相手の声
  if (engineWin) engineWin.webContents.setAudioMuted(spkMuted)  // 効果音・BGM も含めて、ページの音ぜんぶ
  sendWins(); buildMenu()
}

// ---- 部屋一覧のドロワー（ひとつの窓の、取っ手から開く）：本体の窓の横に、別の窓として開く。本体の大きさは変えない ----
const DRAWER_W = () => Math.round(360 * sc())
const drawerRectFor = (b, side) => ({ x: side === 'left' ? b.x - DRAWER_W() : b.x + b.width, y: b.y, width: DRAWER_W(), height: b.height })
const drawerFits = (b, side, wa) => { const r = drawerRectFor(b, side); return r.x >= wa.x - 1 && r.x + r.width <= wa.x + wa.width + 1 }
// 左に出せる、または、右にも出せないなら、左。そうでなければ、右
const chooseSide = (b, wa) => (b.x - wa.x >= DRAWER_W() || wa.x + wa.width - (b.x + b.width) < DRAWER_W()) ? 'left' : 'right'
function updateDrawerSide() {
  const mw = wins.single
  if (!mw || wins.drawer) return
  const b = mw.getBounds(), side = chooseSide(b, screen.getDisplayMatching(b).workArea)
  if (side !== drawerSideNow) { drawerSideNow = side; sendWins() }
}
function syncDrawer() {
  const mw = wins.single, d = wins.drawer
  if (!mw) return
  if (!d || d.isDestroyed()) return updateDrawerSide()
  const b = mw.getBounds(), wa = screen.getDisplayMatching(b).workArea
  if (!drawerFits(b, drawerSideNow, wa)) { const other = drawerSideNow === 'left' ? 'right' : 'left'; if (drawerFits(b, other, wa)) { drawerSideNow = other; sendWins() } }
  d.setBounds(drawerRectFor(b, drawerSideNow))
}
function openDrawer() {
  const mw = wins.single
  if (prefs.mode !== 'single' || !mw || !isJoined() || wins.drawer) return
  updateDrawerSide()
  let b = mw.getBounds(); const wa = screen.getDisplayMatching(b).workArea
  // 左にも右にも出す余地がないときだけ、本体を右にずらして、左に出す
  if (drawerSideNow === 'left') {
    const deficit = Math.max(0, wa.x - (b.x - DRAWER_W()))
    drawerShift = Math.min(deficit, Math.max(0, wa.x + wa.width - (b.x + b.width)))
    if (drawerShift > 0) { mw.setBounds({ ...b, x: b.x + drawerShift }); b = mw.getBounds() }
  }
  const d = new BrowserWindow({
    ...drawerRectFor(b, drawerSideNow), frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    parent: mw, alwaysOnTop: pinned, title: '部屋一覧', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true },
  })
  d._kind = 'drawer'; wins.drawer = d
  d.webContents.on('did-finish-load', () => { if (!d.isDestroyed()) d.webContents.setZoomFactor(sc()) })
  d.loadFile(path.join(__dirname, 'ui', 'index.html'), { query: { w: 'drawer' } })
  d.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
  d.on('closed', () => { if (wins.drawer === d) { delete wins.drawer; sendWins() } })
  sendWins()
}
function closeDrawer() {
  const d = wins.drawer, shift = drawerShift
  drawerShift = 0
  if (!d) return
  delete wins.drawer
  if (!d.isDestroyed()) d.destroy()
  const mw = wins.single
  if (shift > 0 && mw) { const b = mw.getBounds(); mw.setBounds({ ...b, x: b.x - shift }) }
  sendWins()
}
const toggleDrawer = () => { if (wins.drawer) closeDrawer(); else openDrawer() }
ipcMain.handle('toggleDrawer', () => toggleDrawer())
// ドロワーで選んだ部屋に移るかの確認は、本体の窓に出す
ipcMain.handle('askJoin', (_e, room) => { if (room && typeof room.id === 'string') uiTo(wins.single, 'join', { id: room.id, name: String(room.name || ''), bc: !!room.bc }) })
ipcMain.handle('joinRoom', (_e, id, asListener) => {
  if (typeof id !== 'string') return
  if (isJoined()) { state.chat = []; send('chatClear', null) }
  closeDrawer(); quiet(6); armMute(prefs.muteOnJoin)
  cmd({ type: 'join', id, quiet: !!asListener })
})

function togglePin() {
  pinned = !pinned
  for (const w of allWins()) w.setAlwaysOnTop(pinned)
  sendWins()
}

// ---- 吸着：画面の端・ほかの窓の端に、近づけて離したとき（止まったとき）に、ぴったり合わせる ----
const SNAP = 14
let snapTimer = null, snapQuiet = 0
function scheduleSnap(w) {
  if (Date.now() < snapQuiet || w._kind === 'lobby') return      // 本体（ロビー）は、動かされる側にならない
  clearTimeout(snapTimer); snapTimer = setTimeout(() => snapWin(w), 140)
}
function snapWin(w) {
  if (!w || w.isDestroyed() || w._kind === 'lobby') return
  const f = w.getBounds(), wa = screen.getDisplayMatching(f).workArea, T = SNAP
  const xs = [wa.x - f.x, wa.x + wa.width - (f.x + f.width)], ys = [wa.y - f.y, wa.y + wa.height - (f.y + f.height)], tops = []
  for (const o of allWins()) {
    if (o === w || o._kind === 'drawer' || !o.isVisible()) continue
    const g = o.getBounds()
    // 縦に重なっているときだけ、横の吸着（隣・端そろえ）を考える。横も同じ
    if (g.y + g.height > f.y - T && g.y < f.y + f.height + T) xs.push(g.x + g.width - f.x, g.x - (f.x + f.width), g.x - f.x, g.x + g.width - (f.x + f.width))
    if (g.x + g.width > f.x - T && g.x < f.x + f.width + T) ys.push(g.y + g.height - f.y, g.y - (f.y + f.height), g.y - f.y, g.y + g.height - (f.y + f.height))
    // 横に並んでいる（隙間が小さい）ときは、上の高さを、少し離れていても、そろえる
    const gl = f.x - (g.x + g.width), gr = g.x - (f.x + f.width)
    if (((gl >= 0 && gl <= T) || (gr >= 0 && gr <= T)) && g.y + g.height > f.y && g.y < f.y + f.height) tops.push(g.y - f.y)
  }
  const near = (a, lim) => a.filter(v => Math.abs(v) <= lim).sort((p, q) => Math.abs(p) - Math.abs(q))[0]
  const dx = near(xs, T), dy = near(ys, T) ?? near(tops, 80)
  if (dx === undefined && dy === undefined) return
  snapQuiet = Date.now() + 300
  w.setBounds({ x: f.x + (dx || 0), y: f.y + (dy || 0), width: f.width, height: f.height })
}

// ---- engine 窓からの知らせ（ロビー・プロフィール・部屋・音の波形・ひとこと など）----
// ---- ミュートで始める：作成・入室の直後だけ、設定の状態（ミュート／解除）にそろえる（つなぎ直しでは触らない）----
let pendingMute = null
const armMute = target => { pendingMute = { at: Date.now(), target } }
function checkPendingMute(r) {
  if (!pendingMute) return
  if (Date.now() - pendingMute.at > 15000) { pendingMute = null; return }
  if (r && r.joined && r.canMute) { const p = pendingMute; pendingMute = null; if (process.env.POTALK_STEPS) console.log('[mute]', 'muted=' + r.muted, 'target=' + p.target); if (!!r.muted !== p.target) cmd({ type: 'mute' }) }
}

// ---- 新しい部屋の通知（自衛ワードを含む部屋は除く）。作成・入室・更新・読み込み直しのあとは、一覧が入れ替わるので、しばらく止める ----
const seenRooms = new Set()
let armed = false, quietGen = 0
function quiet(sec) {
  armed = false; quietGen++
  if (!sec) return
  const g = quietGen
  setTimeout(() => { if (g === quietGen) armed = true }, sec * 1000)
}
const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
const roomBanned = r => { const hay = [r.name, r.sub, r.subBy, ...((r.people || []).map(p => p.name))].map(fold); return state.banned.some(w => { const q = fold(w); return q && hay.some(h => h.includes(q)) }) }
const isFresh = dur => { if (/時間|日/.test(dur || '')) return false; const n = parseInt(String(dur || '').replace(/\D/g, ''), 10); return Number.isNaN(n) ? true : n <= 3 }
let lobbyArmedOnce = false
function lobbyChanged(l) {
  if (!l || !Array.isArray(l.rooms)) return
  if (!lobbyArmedOnce) { lobbyArmedOnce = true; quiet(6) }
  for (const r of l.rooms) {
    const key = r.id || r.name
    if (seenRooms.has(key)) continue
    seenRooms.add(key)
    if (armed && prefs.notifyRooms && isFresh(r.dur) && !roomBanned(r) && Notification.isSupported()) {
      if (process.env.POTALK_STEPS) console.log('[notify]', r.name)
      const n = new Notification({ title: '新しい部屋ができました', body: String(r.name || '') })
      n.on('click', () => showMain())
      n.show()
    }
  }
}

// ---- 部屋のリンク（#room=…）で入る。入れなかったときは、理由を画面へ知らせる ----
let linking = false
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function openRoomLink(text) {
  const m = String(text || '').match(/#room=[^\s]*/)
  if (!m || linking) return
  linking = true; quiet(6); armMute(prefs.muteOnJoin)
  const fin = r => { linking = false; if (r !== 'joined') pendingMute = null; send('linkResult', { r }) }
  const probe = "JSON.stringify({t: (document.getElementById('entryText')||{}).textContent||'', n: !!(document.getElementById('entryNote')&&!document.getElementById('entryNote').hidden), name: (document.getElementById('room')||{}).value||''})"
  loadEngine(m[0])
  let asleep = 0, idle = 0, noEntry = 0
  for (let i = 0; i < 80; i++) {      // 最大 40 秒
    await sleep(500)
    if (isJoined()) return fin('joined')
    if (!state.ready || !engineWin) continue
    let o; try { o = JSON.parse(await engineWin.webContents.executeJavaScript(probe)) } catch { continue }
    const t = o.t || '', name = o.name || ''
    if (t.includes('いま開いています') && name) {
      cmd({ type: 'entryJoin' })
      for (let j = 0; j < 40; j++) { await sleep(500); if (isJoined()) return fin('joined') }
      return fin('timeout')
    }
    if (t.includes('同じ名前の部屋')) return fin('choose')
    if (!t) { noEntry++; if (noEntry > 24) return fin('invalid') } else noEntry = 0      // 12 秒たっても、入口の案内が出ないときは、見つからないものとして知らせる
    if (t.includes('😴')) { asleep++; if (asleep > 2) return fin('asleep') } else asleep = 0
    if (!o.n && !t && !name) { idle++; if (idle > 10) return fin('invalid') } else idle = 0
  }
  fin('timeout')
}

let wasJoined = false
function onRoom() {
  const j = isJoined()
  if (j === wasJoined) return
  wasJoined = j
  buildMenu()
  if (!j) { state.chat = []; closeDrawer(); if (prefs.mode === 'split') closeAux(['room', 'chat', 'mail', 'settings']) }
  else if (prefs.mode === 'split') openAux('room')
}
// 名刺の設定・本人確認：ページ側の窓が開いたら、こちらの窓を開き、閉じたら閉じる
function onCards() {
  const c = state.cards || {}
  for (const [on, kind] of [[!!c.edit, 'cardedit'], [!!c.auth, 'cardauth']]) {
    if (on && !wins[kind]) { const w = createWin(kind, savedBounds(kind) ? undefined : { center: true }); if (kind === 'cardauth') w.setAlwaysOnTop(true); sendWins() }
    else if (!on && wins[kind]) closeAux([kind])
  }
}
function handlePm(m) {
  if (!m || typeof m.t !== 'string') return
  if (['lobby', 'profile', 'room', 'eq', 'cards'].includes(m.t)) state[m.t] = m.d
  else if (m.t === 'ready') { state.ready = true; onEngineReady() }
  else if (m.t === 'chat' && m.d) { state.chat.push(m.d); if (state.chat.length > 300) state.chat.shift() }
  if (m.t === 'room') { checkPendingMute(m.d); onRoom() }
  if (m.t === 'lobby') lobbyChanged(m.d)
  if (m.t === 'devices') { state.devices = (Array.isArray(m.d) ? m.d : []).filter(d => d && d.id && d.id !== 'default' && d.id !== 'communications'); send('devices', state.devices); return }
  if (m.t === 'cards') onCards()
  send(m.t, m.d)
}
ipcMain.on('pm', (_e, m) => handlePm(m))

// 画面からの指示は、ページの橋（window.__pm.cmd）へ流す
function onEngineReady() {
  cmd({ type: 'sndRoom', on: false })                      // 新しい部屋の通知は、こちらで一本化する（ページの音は使わない）
  cmd({ type: 'setMicLabel', label: prefs.mic })
  cmd({ type: 'devices' })
}
ipcMain.handle('cmd', (_e, c) => {
  if (typeof c !== 'object' || c === null) return
  if (c.type === 'create') { quiet(6); armMute(prefs.muteOnCreate); if (isJoined()) { state.chat = []; send('chatClear', null) } }
  else if (c.type === 'join') { quiet(6); armMute(prefs.muteOnJoin) }
  else if (c.type === 'refreshLobby') quiet(6)
  return cmd(c)
})
ipcMain.handle('setPref', (_e, k, v) => {
  if (['muteOnCreate', 'muteOnJoin', 'notifyRooms', 'thanksShown'].includes(k) && typeof v === 'boolean') prefs[k] = v
  else if (k === 'mic' && typeof v === 'string') { prefs.mic = v.slice(0, 200); cmd({ type: 'setMicLabel', label: prefs.mic }) }
  else return
  savePrefs(); sendWins()
})
ipcMain.handle('refreshMics', (_e, probe) => cmd({ type: probe ? 'probeMic' : 'devices' }))
ipcMain.handle('setBanned', (_e, words) => { state.banned = (Array.isArray(words) ? words : []).filter(w => typeof w === 'string').slice(0, 5000).map(w => w.slice(0, 200)) })
ipcMain.handle('openLink', (_e, text) => openRoomLink(text))
ipcMain.handle('reload', () => loadEngine())
ipcMain.handle('toggleWin', (_e, kind) => { if (['chat', 'mail', 'settings'].includes(kind)) toggleAux(kind) })
ipcMain.handle('togglePin', () => togglePin())
ipcMain.handle('toggleSpk', () => toggleSpk())

// ひとこと用ドロワーの開閉で、窓を、その高さのぶんだけ伸び縮みさせる（上の端は動かさない。下に余地がなければ、窓を上にずらす）
ipcMain.handle('growBy', (e, dh) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || typeof dh !== 'number') return
  dh = Math.round(dh * sc())
  // 縮めるときは、ひとこと分を含んだ最小の高さも、先に、同じだけ下げる（そうしないと、窓が縮まない）
  if (dh < 0 && BASE[w._kind]) { const [mw, mh] = w.getMinimumSize(); w.setMinimumSize(mw, Math.max(Math.round(BASE[w._kind].mh * sc()), mh + dh)) }
  const b = w.getBounds(), wa = screen.getDisplayMatching(b).workArea
  const h = Math.min(Math.max(b.height + dh, 200), wa.height)
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - h))
  w.setBounds({ x: b.x, y, width: b.width, height: h })
})
// 名刺のリンクなど：http(s) だけ、確認してから、既定のブラウザで開く
ipcMain.handle('openExternal', async (e, url) => {
  const u = String(url || '')
  if (!/^https?:\/\//i.test(u)) return
  const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), { type: 'question', buttons: ['開く', 'キャンセル'], defaultId: 1, cancelId: 1, message: 'このリンクを開きますか？', detail: u.length > 300 ? u.slice(0, 300) + '…' : u })
  if (r.response === 0) shell.openExternal(u)
})
ipcMain.handle('copyText', (_e, t) => { if (typeof t === 'string' && t.length < 2000) clipboard.writeText(t) })
// ひとことのハンドルのドラッグ：ひとこと欄の大きさは変えず、窓の高さを変える（ハンドルは、ひとこと欄と一緒に動く）。上の端は動かさない
const drags = new Map()
ipcMain.handle('dragStart', (e, slack) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && Number.isFinite(slack)) drags.set(w.id, { startH: w.getBounds().height, slack }) })
ipcMain.handle('dragMove', (e, dy) => {
  const w = BrowserWindow.fromWebContents(e.sender), d = w && drags.get(w.id)
  if (!d || typeof dy !== 'number') return
  const b = w.getBounds(), wa = screen.getDisplayMatching(b).workArea
  // slack：メンバー一覧に、4 人分より余っている高さ。それより縮めない（枠の高さに頼らない）
  const h = Math.round(Math.min(wa.height, Math.max(w.getMinimumSize()[1], d.startH + Math.max(dy, -d.slack))))
  w.setBounds({ x: b.x, y: Math.max(wa.y, Math.min(b.y, wa.y + wa.height - h)), width: b.width, height: h })
})
// 窓の最小の高さ：メンバーが 4 人分は見える高さ（ひとことを開いているときは、その分も入る）。
// 画面が測った「一覧の、4 人分に対する余裕（足りないときは、負）」から、いまの窓の高さを元に、最小を決める。足りないときは、その分だけ、窓を広げる
ipcMain.handle('setMinHeight', (e, slack) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || !Number.isFinite(slack)) return
  const base = BASE[w._kind]; if (!base) return
  const b = w.getBounds(), minH = Math.max(Math.round(base.mh * sc()), Math.ceil(b.height - slack))
  const [mw] = w.getMinimumSize()
  w.setMinimumSize(mw, minH)
  if (b.height < minH) { const wa = screen.getDisplayMatching(b).workArea, h = Math.min(minH, wa.height); w.setBounds({ x: b.x, y: Math.max(wa.y, Math.min(b.y, wa.y + wa.height - h)), width: b.width, height: h }) }
})
// 窓の最小の幅：ロビーの各行が、折り返さずに並ぶ幅。画面が測った「余裕（足りないときは、負）」から、いまの窓の幅を元に決める。足りないときは、広げる
ipcMain.handle('setMinWidth', (e, slack) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || !Number.isFinite(slack)) return
  const base = BASE[w._kind]; if (!base) return
  const b = w.getBounds(), minW = Math.max(Math.round(base.mw * sc()), Math.ceil(b.width - slack))
  const [, mh] = w.getMinimumSize()
  w.setMinimumSize(minW, mh)
  if (b.width < minW) { const wa = screen.getDisplayMatching(b).workArea, nw = Math.min(minW, wa.width); w.setBounds({ x: Math.max(wa.x, Math.min(b.x, wa.x + wa.width - nw)), y: b.y, width: nw, height: b.height }) }
})
ipcMain.handle('notify', (_e, title, body) => { if (Notification.isSupported()) new Notification({ title: String(title), body: String(body) }).show() })

// 自衛ワードの書き出し・読み込み（UTF-8・BOM なし・LF・1行に1ワード・先頭が最新。ファイル名は日付つき）
const bannedFileName = () => { const d = new Date(), p2 = n => String(n).padStart(2, '0'); return `jiei-words-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.txt` }
ipcMain.handle('bannedExport', async (e, words) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: bannedFileName(), filters: [{ name: 'テキスト', extensions: ['txt'] }] })
  if (r.canceled || !r.filePath) return null
  fs.writeFileSync(r.filePath, (words.length ? words.join('\n') + '\n' : ''), 'utf8')
  return words.length
})
ipcMain.handle('bannedImport', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: [{ name: 'テキスト', extensions: ['txt'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  let text = fs.readFileSync(r.filePaths[0], 'utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(x => x.trim()).filter(Boolean)
})
ipcMain.handle('snapshot', () => ({ lobby: state.lobby, profile: state.profile, room: state.room, eq: state.eq, cards: state.cards, chat: state.chat, devices: state.devices, wins: winsState(), ready: state.ready, patched: state.patched }))

// ---- メニュー・ショートカットの動作 ----
const uiTo = (w, a, v) => { if (w && !w.isDestroyed()) { w.show(); w.focus(); w.webContents.send('state', { t: 'ui', d: { a, v } }) } }
const showMain = () => { const w = wins[mainKind()]; if (w) { w.show(); w.focus() } }
const showRoom = () => prefs.mode === 'split' ? openAux('room') : uiTo(wins.single, 'tab', 'room')
const showChat = () => prefs.mode === 'split' ? openAux('chat') : uiTo(wins.single, 'chat')
const showMail = () => prefs.mode === 'split' ? openAux('mail') : uiTo(wins.single, 'tab', 'mail')
const showSettings = () => prefs.mode === 'split' ? openAux('settings') : uiTo(wins.single, 'tab', 'settings')
const showBanned = () => uiTo(wins[mainKind()], 'banned')
const showProfile = () => uiTo(wins[mainKind()], 'profile')
const showHelp = () => uiTo(wins[mainKind()], 'help')
// 窓の並び・大きさを、初期の状態に戻す（開いていた補助の窓は、開き直す）
function resetLayout() {
  prefs.pos = {}; savePrefs()
  const open = ['room', 'chat', 'mail', 'settings'].filter(k => wins[k])
  closeAux(open)
  const mw = wins[mainKind()]; if (!mw) return
  const b = BASE[mainKind()], s = sc(), wa = screen.getDisplayMatching(mw.getBounds()).workArea
  const W = Math.round(b.w * s), H = Math.min(Math.round(b.h * s), wa.height)
  mw.setBounds({ x: wa.x + Math.round((wa.width - W) / 2), y: wa.y + Math.round((wa.height - H) / 2), width: W, height: H })
  for (const k of open) openAux(k)
}

// 日本語のメニュー（Mac では上のメニューバー、Windows・Linux では窓の上）
function buildMenu() {
  const mac = process.platform === 'darwin'
  const t = [
    ...(mac ? [{ label: 'Potalker', submenu: [{ role: 'about', label: 'Potalker について' }, { type: 'separator' }, { role: 'hide', label: 'Potalker を隠す' }, { role: 'hideOthers', label: 'ほかを隠す' }, { role: 'unhide', label: 'すべて表示' }, { type: 'separator' }, { role: 'quit', label: 'Potalker を終了' }] }] : [{ label: 'ファイル', submenu: [{ role: 'quit', label: '終了' }] }]),
    { label: '編集', submenu: [{ role: 'undo', label: '取り消す' }, { role: 'redo', label: 'やり直す' }, { type: 'separator' }, { role: 'cut', label: '切り取り' }, { role: 'copy', label: 'コピー' }, { role: 'paste', label: '貼り付け' }, { role: 'selectAll', label: 'すべてを選択' }] },
    {
      label: '表示', submenu: [
        { label: 'ひとつの窓', type: 'radio', checked: prefs.mode === 'single', click: () => setMode('single') },
        { label: '分けた窓', type: 'radio', checked: prefs.mode === 'split', click: () => setMode('split') },
        { type: 'separator' },
        { label: '表示サイズ', submenu: SCALES.map(n => ({ label: n + '%', type: 'radio', checked: prefs.scale === n, click: () => applyScale(n) })) },
        { label: '最前面に表示', type: 'checkbox', checked: pinned, click: () => togglePin() },
        { type: 'separator' },
        { label: '接続し直す', accelerator: 'CmdOrCtrl+R', click: () => loadEngine() },
        { role: 'togglefullscreen', label: 'フルスクリーン' },
      ]
    },
    {
      label: '通話', submenu: [
        { label: 'マイクのミュート', accelerator: 'CmdOrCtrl+Shift+M', enabled: isJoined(), click: () => cmd({ type: 'mute' }) },
        { label: 'スピーカーのミュート', type: 'checkbox', checked: spkMuted, accelerator: 'CmdOrCtrl+Shift+S', enabled: isJoined(), click: () => toggleSpk() },
      ]
    },
    {
      label: 'ウインドウ', submenu: [
        { label: 'メインウインドウ', accelerator: 'CmdOrCtrl+1', click: showMain },
        { label: prefs.mode === 'split' ? 'ひとつの窓で表示' : '分けた窓で表示', accelerator: 'CmdOrCtrl+Shift+P', click: () => setMode(prefs.mode === 'split' ? 'single' : 'split') },
        { type: 'separator' },
        { label: '部屋', accelerator: 'CmdOrCtrl+2', enabled: isJoined(), click: showRoom },
        { label: 'ひとこと', accelerator: 'CmdOrCtrl+3', enabled: isJoined(), click: showChat },
        { label: 'おたより', accelerator: 'CmdOrCtrl+4', enabled: isJoined() && !!(state.room && state.room.bcast), click: showMail },
        { label: '部屋の設定', accelerator: 'CmdOrCtrl+5', enabled: isJoined(), click: showSettings },
        { type: 'separator' },
        { label: '部屋一覧を開く／閉じる', accelerator: 'CmdOrCtrl+L', enabled: prefs.mode === 'single' && isJoined(), click: toggleDrawer },
        { label: '次のタブ', accelerator: 'CmdOrCtrl+]', enabled: prefs.mode === 'single' && isJoined(), click: () => uiTo(wins.single, 'cycle', 1) },
        { label: '前のタブ', accelerator: 'CmdOrCtrl+[', enabled: prefs.mode === 'single' && isJoined(), click: () => uiTo(wins.single, 'cycle', -1) },
        { type: 'separator' },
        { label: 'プロフィール（名前・アバター・名刺）…', click: showProfile },
        { label: '自衛ワードの登録…', click: showBanned },
        { type: 'separator' },
        { role: 'minimize', label: 'しまう' },
        ...(mac ? [{ role: 'zoom', label: '拡大／縮小' }] : []),
        { role: 'close', label: '閉じる' },
        { type: 'separator' },
        { label: 'ウインドウのレイアウトを初期化', click: resetLayout },
      ]
    },
    { label: 'ヘルプ', submenu: [{ label: 'これはなに？（Potalker について）', click: showHelp }, { type: 'separator' }, { label: '公式サイト（potalk.app）を開く', click: () => shell.openExternal('https://potalk.app/') }, { label: 'GitHub（riryo3/potalk）を開く', click: () => shell.openExternal('https://github.com/riryo3/potalk') }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(t))
}

app.whenReady().then(() => {
  loadPrefs()
  buildMenu()
  const ses = session.defaultSession
  installPagePatcher(ses)
  // マイクは、potalk.app にだけ許す
  const ok = (wc, perm) => ['media', 'audioCapture'].includes(perm) && /^https:\/\/potalk\.app/.test(wc ? wc.getURL() : '')
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(ok(wc, perm)))
  ses.setPermissionCheckHandler((wc, perm) => ok(wc, perm))
  createEngine()
  createWin(mainKind())
  // 初回の起動：作者（くらもさん）への謝辞のごあいさつ（開発用の自動実行のときは出さない）
  if (!prefs.thanksShown && !process.env.POTALK_STEPS) setTimeout(() => uiTo(wins[mainKind()], 'thanks'), 2500)
  // 開発用：POTALK_STEPS='[{"at":ミリ秒, ...}, ...]' を付けて起動すると、順に実行する。使えるもの：
  //   ui:"JS"（窓の画面で実行。win:"room" などで窓を選ぶ）／ eng:"JS"（engine 窓で実行）／ shot:"画像のパス"（窓の画像。win で窓を選ぶ）
  //   audible:"ラベル"（engine 窓が、いま音を出しているかを出力）／ pm:{t,d}（engine からの知らせを装う）／ mode:"split"|"single" ／ scale:70 ／ open:"chat" ／ move:{win,x,y} ／ size:{win,w,h}（窓の大きさを変える）／ bounds:1（全部の窓の位置と大きさを出す）／ quit:1
  if (process.env.POTALK_STEPS) {
    for (const st of JSON.parse(process.env.POTALK_STEPS)) {
      setTimeout(async () => {
        try {
          const tw = () => wins[st.win || mainKind()]
          if (st.mode) setMode(st.mode)
          if (st.scale) applyScale(st.scale)
          if (st.pm) handlePm(st.pm)
          if (st.fn) ({ showRoom, showChat, showMail, showSettings, showBanned, showProfile, showMain, resetLayout, toggleSpk, toggleDrawer })[st.fn]()
          if (st.open) openAux(st.open)
          if (st.move) wins[st.move.win].setPosition(st.move.x, st.move.y)
          if (st.size) wins[st.size.win || mainKind()].setSize(st.size.w, st.size.h)
          if (st.ui) { const r = await tw().webContents.executeJavaScript(st.ui); if (r !== undefined) console.log('[ui]', JSON.stringify(r)) }
          if (st.eng) { const r = await engineWin.webContents.executeJavaScript(st.eng); if (r !== undefined) console.log('[eng]', JSON.stringify(r)) }
          if (st.audible) console.log('[audible]', st.audible, engineWin.webContents.isCurrentlyAudible(), 'muted=' + engineWin.webContents.isAudioMuted())
          if (st.shot) fs.writeFileSync(st.shot, (await tw().webContents.capturePage()).toPNG())
          if (st.bounds) console.log('[bounds]', JSON.stringify(Object.fromEntries(Object.entries(wins).map(([k, w]) => [k, w.getBounds()]))))
        } catch (e) { console.error('[step]', e.message) }
        if (st.quit) { quitting = true; app.quit() }
      }, st.at)
    }
  }
})
app.on('window-all-closed', () => app.quit())
