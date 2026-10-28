const { app, BrowserWindow, BrowserView, Menu, Notification, clipboard, dialog, ipcMain, net, screen, session, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { applyPatches } = require('./patch-page');

const HOME = 'https://potalk.app/';
const ORIGIN = new URL(HOME).origin;

// ウィンドウモード：unified=左の縦タブで右ペインを切り替える統合ウィンドウ、
// split=本体＋個別の小窓（従来の形）。切り替えはメニューから選び、再起動で適用する。
const RAIL_WIDTH = 56; // アイコンのみのレール（名称は title で出す）
let uiMode = 'split', railFollow = true, railMode = 'fixed', compactOn = false;
let savedBounds = {};
let savedHeights = {}; // 統合モード用：未入室時／入室時のウィンドウの高さ（状態別に記憶）
let compactApplier = null; // createWindow が登録する、コンパクト表示の反映先
const modeFile = () => path.join(app.getPath('userData'), 'ui-mode.json');
function readUiFile() { try { return JSON.parse(fs.readFileSync(modeFile(), 'utf8')) || {}; } catch { return {}; } }
function writeUiFile(patch) { try { fs.writeFileSync(modeFile(), JSON.stringify({ ...readUiFile(), ...patch })); } catch {} }
function loadUiSettings() {
  const m = readUiFile();
  uiMode = m.mode === 'unified' ? 'unified' : 'split';
  railFollow = m.rail !== 'dark';
  railMode = m.railMode === 'drawer' ? 'drawer' : 'fixed';
  compactOn = m.compact === true;
  savedBounds = (m.bounds && typeof m.bounds === 'object') ? m.bounds : {};
  savedHeights = (m.heights && typeof m.heights === 'object') ? m.heights : {};
}
function validSavedBounds(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(n => Number.isFinite(n))) return null;
  if (b.width < 320 || b.height < 300 || b.width > 4000 || b.height > 4000) return null;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const hit = screen.getAllDisplays().some(d => { const a = d.workArea; return cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height; });
  return hit ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
}
function setCompact(on) {
  compactOn = !!on;
  writeUiFile({ compact: compactOn });
  if (compactApplier) compactApplier();
  if (uiMode !== 'unified') buildMenu(); // メニューのチェック状態を合わせる（統合モードではメニューなし）
}
function requestModeChange(mode) {
  if (mode === uiMode) return;
  writeUiFile({ mode });
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  dialog.showMessageBox(w, {
    type: 'question', buttons: ['再起動して適用', 'あとで'], defaultId: 0, cancelId: 1,
    message: 'ウィンドウモードを切り替えますか？',
    detail: '通話中の場合は切断されます。アプリを再起動すると、新しいモードで起動します。',
  }).then(r => { if (r.response === 0) { app.relaunch(); app.exit(0); } });
}
function buildMenu() {
  const modeItem = m => ({
    label: m === 'unified' ? '統合（左タブで切り替え）' : 'バラバラ（個別ウィンドウ）',
    type: 'radio', checked: uiMode === m, click: () => requestModeChange(m),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: '表示',
      submenu: [
        modeItem('unified'), modeItem('split'), { type: 'separator' },
        { label: 'コンパクト表示', type: 'checkbox', checked: compactOn, click: mi => setCompact(mi.checked) }, { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

async function createWindow() {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
  const unified = uiMode === 'unified';
  // win は OS のウィンドウ（split=本体そのもの、unified=タブの器になるシェル）。
  // 本体のページは split では win 自身、unified では pageView が持つ。
  let win, pageView = null, railView = null, stripView = null, handleView = null;
  if (unified) {
    // 起動サイズと位置は画面の作業領域（デスクトップのパネル等を除いた範囲）に収める。
    // center() はディスプレイ全体基準で、パネルの分だけ下にはみ出すことがあるため、作業領域で明示する
    const wa = screen.getPrimaryDisplay().workArea;
    const uw = Math.min(440, wa.width);
    let uh = Math.min(720, wa.height);
    // Linux の一部環境では作業領域にパネルの高さが差し引かれておらず、
    // 画面いっぱいの高さにすると下端がパネルに潜ってしまうため、余白を確保する
    if (process.platform === 'linux' && uh >= wa.height - 4) uh = Math.max(600, wa.height - 48);
    win = new BrowserWindow({
      ...(validSavedBounds(savedBounds.unified) || { width: uw, height: uh, x: Math.round(wa.x + (wa.width - uw) / 2), y: wa.y }),
      minWidth: 400, minHeight: 600,
      backgroundColor: '#0d1526',
      title: 'Potalker（ぽっと通話 非公式クライアント）',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'shell-preload.js') },
    });
    pageView = new BrowserView({
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, additionalArguments: ['--pm-mode=unified'] },
    });
    // 左タブは、コンテンツの上に重ねられるよう専用ビューで持つ（ドロワー化のため）。
    // ウィンドウ自身は土台ページ（base.html）を表示するだけ。
    railView = new BrowserView({
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'shell-preload.js') },
    });
    railView.webContents.loadFile(path.join(__dirname, 'shell.html'));
    // ドロワーを閉じている間の未読サイン（左端の細い帯）
    stripView = new BrowserView({ webPreferences: { contextIsolation: true, sandbox: true } });
    stripView.webContents.loadFile(path.join(__dirname, 'strip.html'));
    // 部屋タブでロビーをのぞくための「部屋一覧」ハンドル（縦書きの細い取っ手）
    handleView = new BrowserView({
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'handle-preload.js') },
    });
    handleView.webContents.loadFile(path.join(__dirname, 'handle.html'));
    win.loadFile(path.join(__dirname, 'base.html'));
  } else {
    win = new BrowserWindow({
      ...(validSavedBounds(savedBounds.split) || { width: 480, height: 740 }),
      minWidth: 320, minHeight: 300,
      backgroundColor: '#0d1526',
      title: 'Potalker（ぽっと通話 非公式クライアント）',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
  }
  // ウィンドウのサイズと位置をモード別に覚えて、次回そのまま復元する
  // 統合モードでは高さを「未入室／入室」で別々に覚える（入室で縦に伸びる挙動の記憶先）
  let inRoomNow = false;
  let boundsTimer = null;
  const saveBounds = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return;
      savedBounds = { ...savedBounds, [uiMode]: win.getBounds() };
      if (unified) {
        savedHeights = { ...savedHeights, [inRoomNow ? 'room' : 'lobby']: win.getBounds().height };
        writeUiFile({ bounds: savedBounds, heights: savedHeights });
      } else writeUiFile({ bounds: savedBounds });
    }, 400);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  // 統合モードは未入室の状態で起動するので、まず未入室用のコンパクトな高さに合わせる。
  // 入室したら animateHeight で入室用の高さへ伸ばし、退出したら戻す（リョータさん提案）
  const clampHeight = h => {
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    return Math.max(460, Math.min(Math.round(h) || 540, wa.height));
  };
  const lobbyHeight = () => clampHeight(savedHeights.lobby || 540);
  const roomHeight = () => Math.max(600, clampHeight(savedHeights.room || 800));
  let heightAnim = null;
  const animateHeight = target => {
    if (!unified || win.isDestroyed()) return;
    const b = win.getBounds(), wa = screen.getDisplayMatching(b).workArea;
    target = clampHeight(target);
    let y = b.y;
    if (y + target > wa.y + wa.height) y = Math.max(wa.y, wa.y + wa.height - target);
    if (Math.abs(b.height - target) < 4 && y === b.y) return;
    if (heightAnim) clearInterval(heightAnim);
    const t0 = Date.now(), dur = 260, h0 = b.height, y0 = b.y;
    heightAnim = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(heightAnim); heightAnim = null; return; }
      const p = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      win.setBounds({ x: b.x, y: Math.round(y0 + (y - y0) * e), width: b.width, height: Math.round(h0 + (target - h0) * e) });
      if (p >= 1) { clearInterval(heightAnim); heightAnim = null; }
    }, 16);
  };
  if (unified) {
    win.setMinimumSize(400, 460);
    const b = win.getBounds(), t = lobbyHeight();
    if (b.height !== t) { const wa = screen.getDisplayMatching(b).workArea; let y = b.y; if (y + t > wa.y + wa.height) y = Math.max(wa.y, wa.y + wa.height - t); win.setBounds({ x: b.x, y, width: b.width, height: t }); }
  }
  const pageWC = () => (pageView ? pageView.webContents : win.webContents);

  let forceRoom = false, askingRoom = false, unreadChat = 0;
  // 本家のテーマ（ページ側から中継される CSS 変数）。衛星パネル類へも配る
  let lastTheme = null;
  const sendThemeToPanels = () => {
    const t = railFollow ? lastTheme : null;
    for (const h of [roomWin, chatWin, mailWin, rsetWin, letterWin, createWin]) {
      const wc = h ? (h.wc || h.webContents) : null;
      if (wc && !wc.isDestroyed()) wc.send('theme', t);
    }
  };
  let chatWin = null, roomWin = null, rsetWin = null, mailWin = null, letterWin = null, letterKey = '', letterDismissed = '', lastSnap = null, lines = [];

  // パネル（部屋・ひとこと・おたより・部屋設定）の受け皿。
  // split では個別ウィンドウ、unified ではシェル内のビューとして作り、同じ顔つきで扱う。
  const views = { page: pageView, room: null, chat: null, mail: null, rset: null, settings: null };
  let currentTab = 'page';
  const CHAT_STRIP = 230; // 部屋タブの下部に出す、ひとこと欄の高さ
  const attachView = v => { if (v && !win.isDestroyed() && !win.getBrowserViews().includes(v)) win.addBrowserView(v); };
  const detachView = v => { if (v && !win.isDestroyed() && win.getBrowserViews().includes(v)) win.removeBrowserView(v); };
  // 部屋一覧ドロワー：部屋タブ（通話中）にいるとき、コンテンツ左端の帯にカーソルを置くと
  // ロビー（ページ）が左からにゅっと重なって出る。ボタンは置かず、気配だけの細い線を出す。
  // カーソルが一覧から離れたら（右へ動かす＝下の画面のスクロールへ行く動きで）自動で引っ込む。
  const PEEK_W_MAX = 360, PEEK_HANDLE_H = 120, PEEK_ZONE_W = 12, PEEK_EDGE_W = 12;
  let peekOpen = false, peekX = 0, peekTimer = null, peekHoverSince = 0, peekGraceUntil = 0;
  const handleShown = () => currentTab === 'room' && !!roomWin;
  const peekWidth = () => Math.min(PEEK_W_MAX, Math.max(0, win.getContentBounds().width - contentX()));
  function applyPeekLayout() {
    if (!unified || win.isDestroyed() || !handleView) return;
    const b = win.getContentBounds(), X = contentX();
    if (!handleShown()) {
      if (peekTimer) { clearInterval(peekTimer); peekTimer = null; }
      if (peekOpen && currentTab !== 'page') detachView(pageView);
      peekOpen = false;
      detachView(handleView);
      return;
    }
    if (peekOpen) {
      if (!peekTimer) peekX = X; // 開き切っているときは、左端の変化（レールの出し方切り替え等）に追従する
      detachView(pageView); attachView(pageView);
      pageView.setBounds({ x: Math.round(peekX), y: 0, width: peekWidth(), height: b.height });
    } else if (currentTab === 'room') detachView(pageView);
    detachView(handleView); attachView(handleView);
    handleView.setBounds({ x: X, y: Math.max(0, Math.round(b.height / 2 - PEEK_HANDLE_H / 2)), width: PEEK_EDGE_W, height: PEEK_HANDLE_H });
  }
  function animatePeekTo(target, done) {
    if (peekTimer) clearInterval(peekTimer);
    peekTimer = setInterval(() => {
      const step = 24;
      peekX += Math.sign(target - peekX) * Math.min(step, Math.abs(target - peekX));
      applyPeekLayout();
      if (peekX === target) { clearInterval(peekTimer); peekTimer = null; if (done) done(); }
    }, 16);
  }
  function setPeek(open) {
    if (!handleShown() || open === peekOpen) return;
    const X = contentX();
    if (open) { peekOpen = true; peekX = X - peekWidth(); applyPeekLayout(); animatePeekTo(X); }
    else animatePeekTo(X - peekWidth(), () => { peekOpen = false; applyPeekLayout(); });
  }
  const closePeekNow = () => {
    if (peekTimer) { clearInterval(peekTimer); peekTimer = null; }
    peekOpen = false; peekHoverSince = 0;
    applyPeekLayout();
  };
  const railWC = () => (railView && !railView.webContents.isDestroyed() ? railView.webContents : null);
  // 左タブの出し方：fixed=常時表示、drawer=左端ホバーで重なって出る。
  // ドロワー時はコンテンツが全幅になり、レールは最前面のビューとして出し入れする。
  let drawerShown = false, drawerX = -RAIL_WIDTH, drawerTimer = null, selectOpen = false, drawerGraceUntil = 0;
  const contentX = () => (railMode === 'drawer' ? 0 : RAIL_WIDTH);
  function applyRailLayout() {
    if (!unified || win.isDestroyed() || !railView) return;
    const b = win.getContentBounds();
    // コンテンツのビューを並べ直したあとでも最前面に来るよう、いったん外して付け直す
    if (railMode === 'fixed') {
      detachView(stripView); detachView(railView);
      attachView(railView); railView.setBounds({ x: 0, y: 0, width: RAIL_WIDTH, height: b.height });
    } else if (drawerShown) {
      detachView(stripView); detachView(railView);
      attachView(railView); railView.setBounds({ x: Math.round(drawerX), y: 0, width: RAIL_WIDTH, height: b.height });
    } else {
      detachView(railView);
      if (unreadChat > 0) { detachView(stripView); attachView(stripView); stripView.setBounds({ x: 0, y: 0, width: 4, height: b.height }); }
      else detachView(stripView);
    }
  }
  function animateDrawerTo(target) {
    if (drawerTimer) clearInterval(drawerTimer);
    drawerTimer = setInterval(() => {
      const step = 16;
      drawerX += Math.sign(target - drawerX) * Math.min(step, Math.abs(target - drawerX));
      if (drawerX === target) {
        clearInterval(drawerTimer); drawerTimer = null;
        if (target < 0) drawerShown = false;
      }
      applyRailLayout();
    }, 16);
  }
  function setDrawer(shown) {
    if (railMode !== 'drawer' || shown === drawerShown) return;
    if (shown) { drawerShown = true; drawerGraceUntil = Date.now() + 500; applyRailLayout(); animateDrawerTo(0); }
    else animateDrawerTo(-RAIL_WIDTH);
  }
  if (unified) {
    // カーソルの位置を定期的に見て、レールドロワーと部屋一覧ピークを出し入れする
    setInterval(() => {
      if (win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
      const b = win.getContentBounds(), pt = screen.getCursorScreenPoint();
      const rx = pt.x - b.x, ry = pt.y - b.y;
      const inside = ry >= 0 && ry <= b.height && rx >= -4 && rx <= b.width;
      // 部屋一覧ピーク：左端の帯（縦は中央の範囲）に少し置いたら開き、一覧から離れたら閉じる
      if (handleShown()) {
        const X = contentX();
        const inZone = inside && rx >= X - 2 && rx <= X + PEEK_ZONE_W && Math.abs(ry - b.height / 2) <= PEEK_HANDLE_H / 2 + 10;
        if (!peekOpen) {
          if (inZone) {
            if (!peekHoverSince) peekHoverSince = Date.now();
            else if (Date.now() - peekHoverSince >= 150) { peekHoverSince = 0; peekGraceUntil = Date.now() + 600; setPeek(true); }
          } else peekHoverSince = 0;
        } else if (Date.now() > peekGraceUntil) {
          const overPeek = inside && rx >= X - 4 && rx <= X + peekWidth() + 24;
          if (!overPeek) setPeek(false);
        }
      } else if (peekOpen) closePeekNow();
      // レールドロワー：左端ホバーで出し、外れたら引っ込める。
      // 部屋一覧の帯が出ている高さでは、レールよりピークを優先する
      if (railMode === 'drawer') {
        const handleZone = handleShown() && contentX() === 0 && rx <= PEEK_ZONE_W + 4 && Math.abs(ry - b.height / 2) <= PEEK_HANDLE_H / 2 + 4;
        if (!drawerShown) { if (inside && rx <= 6 && !handleZone) setDrawer(true); }
        else if (!selectOpen && Date.now() > drawerGraceUntil && (!inside || rx > RAIL_WIDTH + 28)) setDrawer(false);
      }
    }, 100);
  }
  const sendShellState = () => {
    if (!unified || win.isDestroyed()) return;
    const wc = railWC();
    if (wc) wc.send('shell:state', { tab: currentTab, unread: unreadChat, inRoom: !!roomWin, canCreate: !(lastSnap && lastSnap.joined), railFollow, railMode, compact: compactOn });
    applyRailLayout();
  };
  compactApplier = () => {
    const pw = pageWC();
    if (!pw.isDestroyed()) pw.send('potalk:compact', compactOn);
    sendShellState();
  };
  // 現在のタブに合わせて、右ペインにビューを並べる。
  // 部屋タブでは、部屋（上）＋ひとこと（下）の2段にする。
  function layoutViews() {
    if (!unified || win.isDestroyed()) return;
    const b = win.getContentBounds();
    const X = contentX();
    const W = Math.max(0, b.width - X), H = b.height;
    const pane = (y, h) => ({ x: X, y, width: W, height: Math.max(0, h) });
    for (const v of Object.values(views)) if (v) detachView(v);
    const show = (v, bounds) => { attachView(v); v.setBounds(bounds); };
    const clearUnread = () => { if (unreadChat) { unreadChat = 0; if (roomWin) roomWin.wc.send('unread', 0); } };
    if (currentTab === 'room' && views.room) {
      if (views.chat) { show(views.room, pane(0, H - CHAT_STRIP)); show(views.chat, pane(H - CHAT_STRIP, CHAT_STRIP)); clearUnread(); }
      else show(views.room, pane(0, H));
    } else if (currentTab === 'chat' && views.chat) { show(views.chat, pane(0, H)); clearUnread(); }
    else if (currentTab === 'mail' && views.mail) show(views.mail, pane(0, H));
    else if (currentTab === 'rset' && views.rset) show(views.rset, pane(0, H));
    else if (currentTab === 'settings' && views.settings) show(views.settings, pane(0, H));
    else { currentTab = 'page'; show(pageView, pane(0, H)); }
    applyPeekLayout();
    sendShellState();
  }
  function selectTab(tab) {
    if (!unified) return;
    const prev = currentTab;
    if ((tab === 'room' && !roomWin) || (tab === 'mail' && !mailWin) || (tab === 'rset' && !rsetWin) || (tab === 'settings' && !views.settings)) tab = 'page';
    currentTab = tab;
    // 設定ペインから離れたら、本体へ「プロフィールが変わったかも」を知らせる（設定ウィンドウを閉じたときと同じ）
    if (prev === 'settings' && tab !== 'settings') { const pw = pageWC(); if (!pw.isDestroyed()) pw.send('potalk:profile-changed'); }
    layoutViews();
  }
  function destroyView(tab) {
    const v = views[tab];
    if (!v) return;
    views[tab] = null;
    detachView(v);
    if (currentTab === tab) currentTab = 'page';
    if (!v.webContents.isDestroyed()) v.webContents.destroy();
    layoutViews();
  }
  const viewHost = (tab, file, preload) => {
    const view = new BrowserView({
      webPreferences: { contextIsolation: true, sandbox: true, preload, backgroundThrottling: false },
    });
    views[tab] = view;
    view.webContents.loadFile(file);
    return {
      wc: view.webContents, view, win: null,
      show() { selectTab(tab); }, showInactive() { selectTab(tab); }, focus() { selectTab(tab); },
      close() { destroyView(tab); },
      onClosed(f) { view.webContents.once('destroyed', f); },
      loadFile(f) { view.webContents.loadFile(f); },
    };
  };
  const windowHost = w => ({
    wc: w.webContents, win: w, view: null,
    show() { if (!w.isDestroyed()) w.show(); },
    showInactive() { if (!w.isDestroyed()) w.showInactive(); },
    focus() { if (!w.isDestroyed()) w.focus(); },
    close() { if (!w.isDestroyed()) w.close(); },
    onClosed(f) { w.on('closed', f); },
    loadFile(f) { w.loadFile(f); },
  });

  const sendState = () => { if (roomWin) { roomWin.wc.send('chat-state', !!chatWin); roomWin.wc.send('mail-state', !!mailWin); } };
  // 統合モード用：ひとことビューを作る（選択はしない。部屋タブの下段にも出すため）
  const createChatPanel = () => {
    chatWin = viewHost('chat', path.join(__dirname, 'chat.html'), path.join(__dirname, 'chat-preload.js'));
    chatWin.wc.on('did-finish-load', () => { if (chatWin) { chatWin.wc.send('lines', lines); sendThemeToPanels(); } });
    chatWin.onClosed(() => { chatWin = null; if (!win.isDestroyed()) sendState(); sendShellState(); });
    sendState();
  };
  const openChat = () => {
    unreadChat = 0; if (roomWin) roomWin.wc.send('unread', 0);
    if (chatWin) { chatWin.showInactive(); return; }
    if (unified) {
      createChatPanel();
      selectTab('chat');
      return;
    }
    {
      // 本体に重ならないよう、本体の右隣（入りきらなければ画面右端）に置く
      const mb = (roomWin ? roomWin.win : win).getBounds(), wa = screen.getDisplayMatching(mb).workArea, w = 340, h = 460;
      const x = Math.min(mb.x + mb.width + 8, wa.x + wa.width - w);
      const y = Math.min(Math.max(mb.y, wa.y), wa.y + wa.height - h);
      const cw = new BrowserWindow({
        x, y, show: false, width: w, height: h, minWidth: 260, minHeight: 240, alwaysOnTop: true,
        backgroundColor: '#0d1526', title: 'ひとこと',
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'chat-preload.js') },
      });
      cw.once('ready-to-show', () => chatWin && chatWin.showInactive());
      chatWin = windowHost(cw);
      chatWin.loadFile(path.join(__dirname, 'chat.html'));
    }
    chatWin.wc.on('did-finish-load', () => { if (chatWin) { chatWin.wc.send('lines', lines); sendThemeToPanels(); } });
    chatWin.onClosed(() => { chatWin = null; if (!win.isDestroyed()) sendState(); sendShellState(); });
    sendState();
  };
  const mine = e => e.sender === pageWC();
  ipcMain.on('potalk:chat-toggle', e => { if (!(roomWin && e.sender === roomWin.wc)) return; if (unified) { currentTab === 'chat' ? selectTab('room') : openChat(); } else { chatWin ? chatWin.close() : openChat(); } });
  ipcMain.on('potalk:chat-open', e => { if (mine(e)) openChat(); });
  ipcMain.on('potalk:chat-close', e => { if (!mine(e)) return; lines = []; unreadChat = 0; if (chatWin) chatWin.close(); });
  ipcMain.on('potalk:chat-line', (e, l) => {
    if (!mine(e)) return;
    lines.push(l); if (lines.length > 100) lines.shift();
    chatWin && chatWin.wc.send('line', l);
    // ひとこと窓を閉じている間に届いた（自分以外の）ひとこと＝新着。小窓のボタンを目立たせる
    if (!chatWin && !l.hist && !l.sys && !/（あなた）/.test(l.who || '')) { unreadChat++; roomWin && roomWin.wc.send('unread', unreadChat); sendShellState(); }
  });
  // ひとこと内のリンク：見知らぬ相手が貼ったものなので、開く前に行き先を確認する
  ipcMain.on('potalk:open-link', (e, u) => {
    const okSender = (chatWin && e.sender === chatWin.wc) || (roomWin && e.sender === roomWin.wc);
    if (!okSender || typeof u !== 'string') return;
    let url; try { url = new URL(u); } catch { return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    dialog.showMessageBox(unified ? win : ((roomWin && e.sender === roomWin.wc) ? roomWin.win : chatWin.win), {
      type: 'question', buttons: ['ブラウザで開く', 'キャンセル'], defaultId: 1, cancelId: 1,
      message: 'このリンクを開きますか？', detail: url.href.slice(0, 300),
    }).then(r => { if (r.response === 0) shell.openExternal(url.href); });
  });
  ipcMain.on('potalk:chat-send', (e, text) => {
    if (chatWin && e.sender === chatWin.wc && typeof text === 'string') pageWC().send('potalk:send', text);
  });
  win.on('closed', () => { if (chatWin) chatWin.close(); if (letterWin) letterWin.close(); closeRoom(); });
  // 部屋の小窓。本体は一覧のまま、入室中の部屋の様子と操作（ミュート・リアクション・リンク・退出）をここに出す
  app.on('before-quit', () => { forceRoom = true; });
  // 公開されたお便り：別の最前面ウィンドウに大きく出す（公開が終わる・部屋を出ると閉じる。×で閉じたら次のお便りまで出さない）
  const openLetter = () => {
    const wa = screen.getDisplayMatching(win.getBounds()).workArea, w = 440, h = 250;
    letterWin = new BrowserWindow({
      x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + 60, width: w, height: h, minWidth: 300, minHeight: 160,
      show: false, alwaysOnTop: true, backgroundColor: '#0d1526', title: '公開中のお便り',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
    });
    letterWin.setAlwaysOnTop(true, 'floating');
    letterWin.once('ready-to-show', () => letterWin && letterWin.showInactive());
    letterWin.loadFile(path.join(__dirname, 'letter.html'));
    letterWin.webContents.on('did-finish-load', () => { if (letterWin && lastSnap) letterWin.webContents.send('state', lastSnap); sendThemeToPanels(); });
    letterWin.on('closed', () => { if (letterKey) letterDismissed = letterKey; letterWin = null; });
  };
  const syncLetter = s => {
    const n = s && s.mailNow, key = n ? JSON.stringify(n) : '';
    if (!key) { letterKey = ''; letterDismissed = ''; if (letterWin) letterWin.close(); return; }
    letterKey = key;
    if (key !== letterDismissed && !letterWin) openLetter();
  };
  const closeRoom = () => { if (roomWin) { forceRoom = true; roomWin.close(); } };
  const openRoom = () => {
    if (roomWin) { roomWin.show(); return; }
    if (unified) {
      roomWin = viewHost('room', path.join(__dirname, 'room.html'), path.join(__dirname, 'room-preload.js'));
      if (!chatWin) createChatPanel(); // 部屋タブの下段に出すため、ひとことも用意しておく
    } else {
      const mb = win.getBounds(), wa = screen.getDisplayMatching(mb).workArea, w = 360, h = Math.min(700, wa.height);
      const rw = new BrowserWindow({
        x: Math.min(mb.x + mb.width + 8, wa.x + wa.width - w), y: Math.min(Math.max(mb.y, wa.y), wa.y + wa.height - h),
        width: w, height: h, minWidth: 300, minHeight: 640, alwaysOnTop: true, show: false,
        backgroundColor: '#0d1526', title: '部屋',
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
      });
      rw.setAlwaysOnTop(true, 'floating');
      rw.once('ready-to-show', () => roomWin && roomWin.showInactive());
      roomWin = windowHost(rw);
      roomWin.loadFile(path.join(__dirname, 'room.html'));
      // 小窓を閉じる＝部屋を退出。確認してから退出し、閉じる
      rw.on('close', e => {
        if (forceRoom) return;
        e.preventDefault();
        if (askingRoom) return;
        askingRoom = true;
        dialog.showMessageBox(rw, {
          type: 'question', buttons: ['退出して閉じる', 'キャンセル'], defaultId: 1, cancelId: 1,
          message: 'この部屋を退出しますか？', detail: '小窓を閉じると、部屋から退出します。',
        }).then(r => {
          askingRoom = false;
          if (r.response === 0 && roomWin) { pageWC().send('potalk:room-cmd', { type: 'leave' }); closeRoom(); }
        });
      });
    }
    roomWin.wc.on('did-finish-load', () => {
      if (!roomWin) return;
      if (lastSnap) roomWin.wc.send('state', lastSnap);
      roomWin.wc.send('pin', unified ? true : roomWin.win.isAlwaysOnTop());
      sendThemeToPanels();
      sendState();
    });
    roomWin.onClosed(() => { roomWin = null; forceRoom = false; if (letterWin) letterWin.close(); letterDismissed = ''; if (chatWin) chatWin.close(); if (rsetWin) rsetWin.close(); if (mailWin) mailWin.close(); sendShellState(); });
    if (unified) selectTab('room');
    sendShellState();
  };
  const fromRoom = e => (roomWin && e.sender === roomWin.wc) || (rsetWin && e.sender === rsetWin.wc) || (mailWin && e.sender === mailWin.wc);
  ipcMain.on('potalk:room-open', e => { if (mine(e)) { closePeekNow(); openRoom(); } });
  ipcMain.on('potalk:room-close', e => { if (mine(e)) closeRoom(); });
  // 部屋一覧ハンドルのクリックでドロワーを開閉する

  // 新しい部屋ができたとき（通知ボタンがオンのとき）：Mac の通知。通知を押すと本体を前に出す
  ipcMain.on('potalk:new-room', (e, name) => {
    if (!mine(e) || typeof name !== 'string' || !Notification.isSupported()) return;
    const n = new Notification({ title: '新しい部屋ができました', body: name || '部屋', silent: false });
    n.on('click', () => { win.show(); win.focus(); });
    n.show();
  });
  // 配信者側：聞き役が手を挙げたら（メンバーの印 🙋 が増えたら）通知音を鳴らす
  let lastHands = 0, lastDing = 0;
  const handsOf = s => ((s && s.members) || []).filter(x => x.mark === '🙋').length;
  const ding = () => {
    if (Date.now() - lastDing < 1000) return;
    lastDing = Date.now();
    if (process.platform === 'darwin') execFile('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff'], err => { if (err) shell.beep(); });
    else shell.beep();
  };
  ipcMain.on('potalk:room-state', (e, s) => { if (!mine(e)) return;
    const hands = s && s.joined ? handsOf(s) : 0;
    if (hands > lastHands) ding();
    lastHands = hands;
    // 統合モード：入室したら縦に伸ばし、退出したらコンパクトな高さに戻す
    const nowInRoom = !!(s && s.joined);
    if (unified && nowInRoom !== inRoomNow) {
      inRoomNow = nowInRoom;
      win.setMinimumSize(400, nowInRoom ? 600 : 460);
      animateHeight(nowInRoom ? roomHeight() : lobbyHeight());
    }
    lastSnap = s; roomWin && roomWin.wc.send('state', s); rsetWin && rsetWin.wc.send('state', s); mailWin && mailWin.wc.send('state', s); letterWin && letterWin.webContents.send('state', s); syncLetter(s); sendShellState(); });
  ipcMain.on('potalk:room-eq', (e, s) => { if (mine(e) && roomWin && typeof s === 'string') roomWin.wc.send('eq', s.slice(0, 80)); });
  ipcMain.on('potalk:room-react', (e, r) => { if (mine(e) && roomWin && r && typeof r.e === 'string') roomWin.wc.send('react', { u: String(r.u), e: r.e.slice(0, 8), n: String(r.n || '').slice(0, 40) }); });
  ipcMain.on('potalk:room-cmd', (e, c) => { if (fromRoom(e) && c && typeof c.type === 'string') pageWC().send('potalk:room-cmd', c); });
  ipcMain.on('potalk:room-copy', e => {
    if (!fromRoom(e) || !lastSnap || !lastSnap.share) return;
    clipboard.writeText(String(lastSnap.share)); roomWin.wc.send('copied');
  });
  // 部屋の設定（音量・BGMなど）。本体は変えず、パネルに同じ項目を出して、操作は本体のページに流す
  const openRset = () => {
    if (rsetWin) { rsetWin.show(); rsetWin.focus(); return; }
    if (unified) {
      rsetWin = viewHost('rset', path.join(__dirname, 'rset.html'), path.join(__dirname, 'room-preload.js'));
    } else {
      const rb = roomWin.win.getBounds(), wa = screen.getDisplayMatching(rb).workArea, w = 340, h = 460;
      const sw = new BrowserWindow({
        x: Math.max(wa.x, Math.min(rb.x - w - 8, wa.x + wa.width - w)), y: Math.min(Math.max(rb.y, wa.y), wa.y + wa.height - h),
        width: w, height: h, minWidth: 280, minHeight: 240, alwaysOnTop: true, backgroundColor: '#0d1526', title: '部屋の設定',
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
      });
      sw.setAlwaysOnTop(true, 'floating');
      rsetWin = windowHost(sw);
      rsetWin.loadFile(path.join(__dirname, 'rset.html'));
    }
    rsetWin.wc.on('did-finish-load', () => { if (rsetWin && lastSnap) rsetWin.wc.send('state', lastSnap); sendThemeToPanels(); });
    rsetWin.onClosed(() => { rsetWin = null; sendShellState(); });
    if (unified) selectTab('rset');
    sendShellState();
  };
  ipcMain.on('potalk:rset-open', e => {
    if (!roomWin || e.sender !== roomWin.wc) return;
    openRset();
  });
  // おたより。設定とは別のパネル（配信部屋のときだけ小窓にボタンが出る）
  const openMail = () => {
    if (mailWin) { mailWin.show(); mailWin.focus(); return; }
    if (unified) {
      mailWin = viewHost('mail', path.join(__dirname, 'mail.html'), path.join(__dirname, 'room-preload.js'));
    } else {
      const rb = roomWin.win.getBounds(), wa = screen.getDisplayMatching(rb).workArea, w = 360, h = 480;
      const mw = new BrowserWindow({
        x: Math.min(rb.x + rb.width + 8, wa.x + wa.width - w), y: Math.min(Math.max(rb.y + 40, wa.y), wa.y + wa.height - h),
        width: w, height: h, minWidth: 300, minHeight: 280, alwaysOnTop: true, backgroundColor: '#0d1526', title: 'おたより',
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
      });
      mw.setAlwaysOnTop(true, 'floating');
      mailWin = windowHost(mw);
      mailWin.loadFile(path.join(__dirname, 'mail.html'));
    }
    mailWin.wc.on('did-finish-load', () => { if (mailWin && lastSnap) mailWin.wc.send('state', lastSnap); sendThemeToPanels(); });
    mailWin.onClosed(() => { mailWin = null; sendState(); sendShellState(); });
    if (unified) selectTab('mail');
    sendState();
    sendShellState();
  };
  ipcMain.on('potalk:mail-open', e => {
    if (!roomWin || e.sender !== roomWin.wc) return;
    openMail();
  });
  ipcMain.on('potalk:room-pin', e => {
    if (!fromRoom(e)) return;
    if (unified) return; // 統合モードでは「最前面」はシェル側の概念がないため何もしない
    roomWin.win.setAlwaysOnTop(!roomWin.win.isAlwaysOnTop(), 'floating');
    roomWin.wc.send('pin', roomWin.win.isAlwaysOnTop());
  });
  // 統合モードの左タブからの操作
  const fromRail = e => unified && railView && e.sender === railView.webContents;
  ipcMain.on('shell:select', (e, tab) => {
    if (!fromRail(e)) return;
    if (tab === 'chat') { openChat(); return; }
    if (tab === 'mail') { if (roomWin) openMail(); return; }
    if (tab === 'rset') { if (roomWin) openRset(); return; }
    selectTab(tab);
  });
  ipcMain.on('shell:mode', e => { if (fromRail(e)) requestModeChange('split'); });
  ipcMain.on('shell:quit', e => { if (fromRail(e)) app.quit(); });
  // 統合モードでは、ページ側のバーにあった操作（設定・部屋作り・ヘルプ）を左タブへ移す。
  // 実処理はページ側の既存ボタンをそのまま押すことで流用する。
  ipcMain.on('shell:click', (e, name) => {
    if (!fromRail(e)) return;
    if (name === 'profile') { openSettingsPane(); return; }
    const id = { create: 'pmNew', help: 'pmHelp' }[name];
    if (id) pageWC().send('potalk:ui-click', id);
  });
  // プロフィール（絵文字・名前）とマイク一覧はページ側が持っているので、左タブへ中継する
  ipcMain.on('potalk:profile-info', (e, p) => {
    if (!mine(e) || !p) return;
    const wc = railWC(); if (wc) wc.send('shell:profile', { emoji: String(p.emoji || '🧑').slice(0, 8), name: String(p.name || '').slice(0, 40) });
  });
  ipcMain.on('potalk:mic-list', (e, m) => {
    if (!mine(e) || !m || !Array.isArray(m.options)) return;
    const wc = railWC(); if (wc) wc.send('shell:mic-list', m);
  });
  ipcMain.on('shell:mic-select', (e, v) => {
    if (!fromRail(e) || typeof v !== 'string') return;
    pageWC().send('potalk:mic-set', v.slice(0, 200));
  });
  // 本家のテーマ変数を、ページ側から左タブへ中継する
  ipcMain.on('potalk:theme', (e, t) => {
    if (!mine(e) || !t || typeof t !== 'object') return;
    lastTheme = t;
    const wc = railWC(); if (wc) wc.send('shell:theme', t);
    if (handleView && !handleView.webContents.isDestroyed()) handleView.webContents.send('handle:theme', t);
    sendThemeToPanels();
  });
  // 左タブのテーマ追随オン／オフ（設定は ui-mode.json に一緒に保存）
  ipcMain.on('shell:rail-theme', e => {
    if (!fromRail(e)) return;
    railFollow = !railFollow;
    writeUiFile({ rail: railFollow ? 'follow' : 'dark' });
    sendShellState();
    sendThemeToPanels();
  });
  // 左タブの固定表示／ドロワー切り替え（設定は ui-mode.json に一緒に保存）
  ipcMain.on('shell:rail-mode', e => {
    if (!fromRail(e)) return;
    railMode = railMode === 'drawer' ? 'fixed' : 'drawer';
    writeUiFile({ railMode });
    if (drawerTimer) { clearInterval(drawerTimer); drawerTimer = null; }
    drawerShown = false; drawerX = -RAIL_WIDTH;
    layoutViews();
  });
  // マイク選択を開いている間はドロワーを引っ込めない
  ipcMain.on('shell:select-open', e => { if (fromRail(e)) selectOpen = true; });
  ipcMain.on('shell:select-close', e => { if (fromRail(e)) { selectOpen = false; drawerGraceUntil = Date.now() + 600; } });
  // コンパクト表示の切り替え（左タブから）。ページ側からの状態問い合わせにも答える
  ipcMain.on('shell:compact', e => { if (fromRail(e)) setCompact(!compactOn); });
  ipcMain.on('potalk:compact-get', e => { if (mine(e)) e.sender.send('potalk:compact', compactOn); });
  // 初期設定（名前・アバター・見た目）。同じページを設定だけの表示で開く。保存先(localStorage)は本体と共通
  // 統合モードでは別ウィンドウにせず、右ペインに設定ビューを出す
  const openSettingsPane = () => {
    if (!views.settings) {
      const v = new BrowserView({
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), additionalArguments: ['--pm-role=settings'] },
      });
      views.settings = v;
      v.webContents.loadURL(HOME);
    }
    selectTab('settings');
  };
  let settingsWin = null;
  const openSettings = () => {
    if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
    settingsWin = new BrowserWindow({
      width: 480, height: 680, minWidth: 360, minHeight: 400, title: 'ぽっと通話：初期設定',
      backgroundColor: '#0d1526', parent: win,
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), additionalArguments: ['--pm-role=settings'] },
    });
    settingsWin.loadURL(HOME);
    settingsWin.on('closed', () => { settingsWin = null; const pw = pageWC(); if (!pw.isDestroyed()) pw.send('potalk:profile-changed'); });
  };
  ipcMain.on('potalk:settings-open', e => { if (mine(e)) { if (unified) openSettingsPane(); else openSettings(); } });
  win.on('closed', () => { if (settingsWin) settingsWin.close(); });
  // 部屋づくりの小窓。入力だけをここで受け取り、本体のページに流し込んで「部屋を作る」を押す
  let createWin = null;
  ipcMain.on('potalk:create-open', (e, def) => {
    if (!mine(e)) return;
    if (createWin) { createWin.show(); createWin.focus(); return; }
    createWin = new BrowserWindow({
      width: 400, height: 340, resizable: false, parent: win, title: '部屋を作る', backgroundColor: '#0d1526',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'chat-preload.js') },
    });
    createWin.loadFile(path.join(__dirname, 'create.html'));
    createWin.webContents.on('did-finish-load', () => { if (createWin) createWin.webContents.send('default', String(def || '').slice(0, 30)); sendThemeToPanels(); });
    createWin.on('closed', () => { createWin = null; });
  });
  ipcMain.on('potalk:create-submit', (e, v) => {
    if (!createWin || e.sender !== createWin.webContents || !v || typeof v.name !== 'string' || !v.name.trim()) return;
    pageWC().send('potalk:create', { name: v.name.trim().slice(0, 30), kind: v.kind === 'bc' ? 'bc' : 'chat' });
    createWin.close();
  });
  ipcMain.on('potalk:create-close', e => { if (mine(e) && createWin) createWin.close(); });
  win.on('closed', () => { if (createWin) createWin.close(); });
  // 「これはなに？」の説明。同じページの説明ダイアログだけを別ウィンドウに出す（リンクは既定のブラウザで開く）
  let helpWin = null;
  ipcMain.on('potalk:help-open', e => {
    if (!mine(e)) return;
    if (helpWin) { helpWin.show(); helpWin.focus(); return; }
    helpWin = new BrowserWindow({
      width: 440, height: 720, minWidth: 320, minHeight: 360, title: 'ぽっと通話：これはなに？',
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), additionalArguments: ['--pm-role=help'] },
    });
    helpWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    helpWin.loadURL(HOME);
    helpWin.on('closed', () => { helpWin = null; });
  });
  ipcMain.on('potalk:help-closed', e => { if (helpWin && e.sender === helpWin.webContents) helpWin.close(); });
  win.on('closed', () => { if (helpWin) helpWin.close(); });
  // 読み込めない・描画プロセスが落ちたときに真っ暗なままにしない
  const OFFLINE = path.join(__dirname, 'offline.html');
  const pwc = pageWC();
  pwc.on('did-fail-load', (_e, code, _d, url, isMain) => { if (isMain && code !== -3) pwc.loadFile(OFFLINE); });
  pwc.on('render-process-gone', () => pwc.loadURL(HOME));
  pwc.loadURL(HOME);
  const marker = path.join(app.getPath('userData'), 'settings-shown');
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); pwc.once('did-finish-load', openSettings); }
  pwc.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === ORIGIN) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  pwc.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== ORIGIN) { e.preventDefault(); shell.openExternal(url); }
  });
  if (unified) {
    win.on('resize', () => layoutViews());
    selectTab('page');
  }
}

app.whenReady().then(() => {
  // potalk.app のトップページだけ取得して差し込みを当てる（保存先 localStorage の origin はそのまま）。
  // 差し込み位置が見つからない／取得に失敗したときは、元のページをそのまま渡す。
  session.defaultSession.protocol.handle('https', async req => {
    const u = new URL(req.url);
    const passthrough = () => net.fetch(req, { bypassCustomProtocolHandlers: true });
    if (u.hostname !== ORIGIN.replace('https://', '') || req.method !== 'GET' || !(u.pathname === '/' || u.pathname === '/index.html')) return passthrough();
    try {
      const res = await net.fetch(req, { bypassCustomProtocolHandlers: true });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res;
      const r = applyPatches(await res.text());
      if (!r.applied) console.error('[potalk-mac] 差し込み位置が見つかりません。元のページを使います:', r.missing);
      const headers = new Headers(res.headers); headers.delete('content-length'); headers.delete('content-encoding');
      return new Response(r.html, { status: res.status, headers });
    } catch { return passthrough(); }
  });
  const allowed = ['media', 'audioCapture', 'clipboard-sanitized-write', 'fullscreen'];
  const ok = (wc, perm, origin) => allowed.includes(perm) && new URL(origin || wc.getURL()).origin === ORIGIN;
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d) => cb(ok(wc, perm, d.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => ok(wc, perm, origin));
  loadUiSettings();
  // 統合モードでは上のメニューバーを出さない（モード切替と終了は左タブにある）。
  // バラバラモードでは、統合へ戻る入口と終了のためにメニューを残す。
  if (uiMode === 'unified') Menu.setApplicationMenu(null);
  else buildMenu();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});
app.on('window-all-closed', () => app.quit());
