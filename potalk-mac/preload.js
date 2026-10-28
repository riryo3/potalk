const { webFrame, ipcRenderer } = require('electron');

// ---- ページ側(メインワールド)：選んだマイクを getUserMedia に差し込む ----
webFrame.executeJavaScript(`(() => {
  const md = navigator.mediaDevices; if (!md || md.__potalkMac) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    let id = null; try { id = localStorage.getItem('potalkMicId'); } catch {}
    if (!id || !c || !c.audio) return orig(c);
    const a = c.audio === true ? {} : c.audio;
    try { return await orig({ ...c, audio: { ...a, deviceId: { exact: id } } }); }
    catch (e) { if (e && e.name === 'OverconstrainedError') return orig(c); throw e; }
  };
  md.__potalkMac = true;
})()`);

const CSS = `
#pmBar{position:fixed;top:0;left:0;right:0;min-height:44px;z-index:99999;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:0 8px;align-items:center;
  padding:4px 12px;background:var(--panel,#0d1526);border-bottom:1px solid var(--border,rgba(255,255,255,.14));font:13px -apple-system,sans-serif;color:var(--text,#fff);
  -webkit-app-region:drag}
#pmBar>*{-webkit-app-region:no-drag;flex:none!important;width:auto!important;margin:2px 0!important;white-space:nowrap}
#pmBar .pm-br{margin:0!important}
#pmBar .pm-sp{flex:1!important;width:auto!important;min-width:0}
#pmBar button{min-width:0!important;line-height:1.3!important}
#pmBar select{width:200px!important;min-width:0!important;margin:0!important}
#pmBar label{font-size:13px!important;margin:0!important}
#pmBar .pm-brand{font-weight:700;margin-right:4px;-webkit-app-region:drag}
#pmBar label{display:flex;align-items:center;gap:6px;color:var(--sub,rgba(255,255,255,.7))}
#pmBar select,#pmBar button{font:inherit;color:var(--text,#fff);background:var(--chip,rgba(255,255,255,.12));border:1px solid var(--border,rgba(255,255,255,.16));border-radius:8px;padding:3px 10px;cursor:pointer}
#pmBar select{max-width:260px}
#pmBar option{color:var(--text,#000);background:var(--panel,#fff)}
#pmBar .pm-sp{flex:1;-webkit-app-region:drag;align-self:stretch}
#pmBar button:hover:not(:disabled){background:var(--chip-hover,rgba(255,255,255,.22))}
#pmBar button.on{background:#3b82f6;border-color:#3b82f6}
#pmBar button:disabled{opacity:.35;cursor:not-allowed}
#pmBar #pmSet{flex:0 1 auto!important;min-width:0;max-width:calc(100% - 120px);overflow:hidden;text-overflow:ellipsis}
#pmBar .pm-br{flex-basis:100%!important;height:0}
#pmBar .pm-mic{position:relative;display:inline-block}
#pmBar .pm-mic select{position:absolute!important;inset:0;width:100%!important;max-width:none!important;height:100%;opacity:0;cursor:pointer}
#pmBar #lobbyRefresh{font:inherit!important;color:var(--text,#fff)!important;background:var(--chip,rgba(255,255,255,.12))!important;border:1px solid var(--border,rgba(255,255,255,.16))!important;border-radius:8px!important;padding:3px 10px!important;cursor:pointer}
body{padding-top:var(--pm-top,52px)!important;padding-bottom:var(--pm-bot,50px)!important}
#pmFoot{position:fixed;left:0;right:0;bottom:0;min-height:40px;z-index:99999;box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:6px 14px;
  background:var(--panel,#0d1526);border-top:1px solid var(--border,rgba(255,255,255,.14));font:13px -apple-system,sans-serif;color:var(--text,#fff);}
#pmFoot>*{flex:none!important;width:auto!important;margin:0!important;white-space:nowrap}
#pmFoot .snd-opt{display:none!important;align-items:center;gap:6px;cursor:pointer;padding:4px 11px;border-radius:8px;
  background:var(--chip,rgba(255,255,255,.12));border:1px solid var(--border,rgba(255,255,255,.16));color:var(--text,#fff)!important;font-size:13px!important}
#pmFoot #pmNotify{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:8px;font:inherit;font-size:13px;color:var(--text,#fff);background:var(--chip,rgba(255,255,255,.12));border:1px solid var(--border,rgba(255,255,255,.16));cursor:pointer}
#pmFoot #pmNotify:hover{background:var(--chip-hover,rgba(255,255,255,.22))}#pmFoot #pmNotify.on{background:#3b82f6;border-color:#3b82f6}
#pmFoot .snd-opt:hover{background:var(--chip-hover,rgba(255,255,255,.22))}
#pmFoot .snd-opt:has(input:checked){background:#3b82f6;border-color:#3b82f6}
#pmFoot .snd-opt[hidden]{display:none!important}
#pmFoot .snd-opt input{position:absolute;opacity:0;pointer-events:none}
#pmFoot .ntf-note{display:none}
#pmFoot .lobby-viewers{margin-left:auto!important;color:var(--sub,rgba(255,255,255,.75))!important;font-size:13px!important;padding:0!important}
`;

const ROLE = (process.argv.find(a => a.startsWith('--pm-role=')) || '').slice(10) || 'main';
// 統合モード（左タブのシェルに本体が埋め込まれている）かどうか。メインプロセスが引数で知らせる
const UNIFIED = process.argv.includes('--pm-mode=unified');

const SETTINGS_CSS = `
.wrap>.lobby,.banner,.sub,#createBox,#statusCard,#help,#pmBar,#pmFoot{display:none!important}
body{padding-top:12px!important}
.wrap{display:block!important}.card{max-width:none!important;margin:0 auto}
`;
const MAIN_CSS = `#profileBox,.ver-row,#cardDlg,#ignoreDlg{display:none!important}
/* 部屋づくりは別ウィンドウへ。共有リンクで来た人の入口案内(#entryNote)が出ている間だけ、元の欄を残す */
/* 本体は常に一覧だけ（入室しても変えない）。部屋の画面は小窓、ページ内の同じ機能は隠す */
.card:not(:has(#entryNote:not([hidden]))){display:none!important}
.wrap{justify-content:center!important}
.lobby{max-width:560px!important}
#pmRoom{display:none!important}
body{justify-content:flex-start!important}
/* ロビー下の説明文は出さない */
.lobby-note{display:none!important}
.lobby-head h2{display:none!important}
#pmBar #pmSearch{flex:1 1 0!important;width:auto!important;min-width:0;font:inherit;font-size:13px;padding:3px 10px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.16));background:var(--chip,rgba(255,255,255,.12));color:var(--text,#fff);outline:none;margin:2px 0!important}
#pmBar #pmSearch::placeholder{color:var(--placeholder,rgba(255,255,255,.55))}
#pmBar #pmSearch:focus{border-color:var(--accent,#00e5cc)}
#pmNoHit{display:none;padding:14px 4px;font-size:13px;color:var(--sub);line-height:1.7}
#pmNoHit button{margin-top:8px;font:inherit;font-size:13px;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--chip);color:var(--text);cursor:pointer}
#createBox:not(:has(#entryNote:not([hidden]))){display:none!important}
/* ロビーの「参加しますか？」を画面中央のモーダルにする（背景の暗幕は ::before。押すと「やめる」） */
#roomAsk{position:fixed!important;inset:0!important;height:fit-content!important;z-index:100000!important;
  width:min(420px,90vw)!important;max-width:none!important;box-sizing:border-box;margin:auto!important;padding:22px!important;
  display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:14px!important;
  background:none!important;color:var(--text,#eef2f8)!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
#roomAsk::before{content:'';position:fixed;inset:0;background:rgba(5,10,25,.6);z-index:-2}
#roomAsk::after{content:'';position:absolute;inset:0;z-index:-1;background:var(--dialog,#111a2e);border:1px solid var(--border);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.55)}
#roomAsk #roomAskText{font-size:15px;line-height:1.7;color:var(--text)!important}
#roomAsk .room-quiet,#roomAsk label{color:var(--text)!important;opacity:1!important;font-size:14px!important}
#roomAsk #roomAskYes,#roomAsk #roomAskNo{width:100%!important;padding:11px!important;font-size:15px!important;margin:0!important}`;

// 統合モード：設定・マイク・ヘルプ・部屋作りは左タブへ移すので、ページ側のバーでは隠す。
// 右ペインの上部に残るのは、検索欄と「更新」だけ。
const UNIFIED_CSS = `
#pmBar #pmSet,#pmBar .pm-mic,#pmBar #pmHelp,#pmBar #pmNew{display:none!important}
`;

// コンパクト表示：ロビーの部屋カードの余白と文字を詰めて、一覧に多く入るようにする
const COMPACT_CSS = `
#lobbyList{gap:6px!important}
#lobbyList>button{padding:7px 10px!important;border-radius:12px!important;line-height:1.3!important;gap:3px!important}
#lobbyList>button span{font-size:11px!important}
#lobbyList>button .room-name{font-size:14px!important}
`;

const HELP_CSS = `
body>*:not(#helpDialog):not(style):not(script){display:none!important}
#helpDialog[open]{position:fixed!important;inset:0!important;width:100%!important;max-width:none!important;height:100%!important;max-height:none!important;
  margin:0!important;border-radius:0!important;transform:none!important;box-shadow:none!important;overflow:auto}
#helpDialog::backdrop{background:transparent}
#helpX{display:none!important}
`;

// ページを読み込み直した＝入室していない状態。前のページが開けたひとこと窓が取り残されないようにする
if (ROLE === 'main') ipcRenderer.send('potalk:chat-close');

window.addEventListener('DOMContentLoaded', () => {
  const hd = document.getElementById('helpDialog');
  if (ROLE === 'help') {
    const st = document.createElement('style'); st.textContent = HELP_CSS; document.head.appendChild(st);
    if (hd) {
      hd.addEventListener('close', () => ipcRenderer.send('potalk:help-closed'));
      const open = () => { if (!hd.open) hd.showModal(); };
      open(); setTimeout(open, 500);
    }
    return;
  }
  // 「これはなに？」は本体の上に重ねず、別ウィンドウで開く（設定ウィンドウでは出さない）
  const moveHelp = () => {
    if (!hd || !hd.open) return;
    hd.close();
    if (ROLE === 'main') ipcRenderer.send('potalk:help-open');
  };
  if (hd) { new MutationObserver(moveHelp).observe(hd, { attributes: true, attributeFilter: ['open'] }); moveHelp(); }
  // アクセス測定の注記（footer.legal）はロビーの下に常時出さず、設定（プロフィール欄）の中へ移す。
  // ロビーがその分コンパクトになり、注記自体は設定を開けば読める。
  const legal = document.querySelector('footer.legal'), profileBoxEl = document.getElementById('profileBox');
  if (legal && profileBoxEl) profileBoxEl.appendChild(legal);
  if (ROLE === 'settings') {
    const st = document.createElement('style'); st.textContent = SETTINGS_CSS; document.head.appendChild(st);
    const pb = document.getElementById('profileBox'); if (pb) pb.open = true;
    return;
  }
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const st2 = document.createElement('style'); st2.textContent = MAIN_CSS; document.head.appendChild(st2);
  if (UNIFIED) { const stu = document.createElement('style'); stu.textContent = UNIFIED_CSS; document.head.appendChild(stu); }
  const stc = document.createElement('style'); stc.id = 'pmCompact'; document.head.appendChild(stc);
  ipcRenderer.on('potalk:compact', (_e, on) => { stc.textContent = on ? COMPACT_CSS : ''; });
  ipcRenderer.send('potalk:compact-get');
  const bar = document.createElement('div'); bar.id = 'pmBar';
  bar.innerHTML = `<button id="pmSet" title="名前・アバター・見た目などの初期設定">🧑 設定</button>
    <span class="pm-sp"></span>
    <span class="pm-mic"><button type="button" tabindex="-1">🎤 入力設定</button><select id="pmMic" aria-label="入力設定（マイク）"></select></span>
    <span class="pm-br"></span>
    <button id="pmHelp" title="これはなに？">？ これはなに？</button>
    <button id="pmNew" title="部屋を作る（別ウィンドウ）">🏠 部屋を作る</button>
    <button id="pmRoom" title="いまの部屋の小窓を開く">🪟 部屋の小窓</button>`;
  document.body.appendChild(bar);
  // 「通話中の部屋」の見出しの代わりに、部屋の検索欄（名前・メンバー名で絞り込み／部屋のURLを貼ってその部屋を表示）
  {
    const head = document.querySelector('.lobby-head'), list = document.getElementById('lobbyList');
    if (head && list) {
      const inp = document.createElement('input'); inp.id = 'pmSearch'; inp.type = 'search'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.placeholder = '部屋を検索／部屋のURLを貼る';
      const br = document.createElement('span'); br.className = 'pm-br'; bar.insertBefore(br, document.getElementById('pmRoom'));
      bar.insertBefore(inp, document.getElementById('pmRoom'));
      const rf = document.getElementById('lobbyRefresh'); if (rf) bar.insertBefore(rf, document.getElementById('pmRoom'));   // 上のボタン類と同じ固定バーの中（スクロールで消えない）
      head.style.display = 'none';
      const nohit = document.createElement('div'); nohit.id = 'pmNoHit'; list.after(nohit);
      const roomOf = v => { const m = v.match(/#room=([^&\s]+)(?:&name=([^&\s]*))?/); if (!m) return null; let id = m[1], nm = ''; try { id = decodeURIComponent(id); nm = decodeURIComponent(m[2] || ''); } catch {} return { id, nm }; };
      const apply = () => {
        const v = inp.value.trim(), link = roomOf(v), q = v.toLowerCase();
        const btns = [...list.children].filter(e => e.tagName === 'BUTTON');
        let hits = 0;
        btns.forEach(b => {
          const ok = !v ? true : link ? (b.dataset.room ? b.dataset.room === link.id : (link.nm && b.textContent.includes(link.nm))) : b.textContent.toLowerCase().includes(q);
          b.style.display = ok ? '' : 'none'; if (ok) hits++;
        });
        [...list.children].filter(e => e.tagName !== 'BUTTON').forEach(e => { e.style.display = v ? 'none' : ''; });
        if (v && !hits) {
          nohit.style.display = 'block';
          nohit.textContent = link ? 'このリンクの部屋は、いま通話中の一覧にありません（お休み中かもしれません）。' : '「' + v + '」に合う部屋は見つかりません。';
          if (link) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'このリンクの部屋に入ってみる'; b.onclick = () => { location.href = v.slice(v.indexOf('http') >= 0 ? v.indexOf('http') : 0); }; nohit.append(document.createElement('br'), b); }
        } else nohit.style.display = 'none';
      };
      inp.addEventListener('input', apply);
      inp.addEventListener('keydown', e => { if (e.key === 'Escape') { inp.value = ''; apply(); } });
      new MutationObserver(apply).observe(list, { childList: true });
    }
  }
  // 新しい部屋の検知：一覧に新しく現れた部屋を、アプリの通知（Mac）に流す。最初の一覧の読み込み中は知らせない
  {
    const list = document.getElementById('lobbyList'), seen = new Set(); let armed = false;
    const keyOf = b => b.dataset.room || (b.textContent || '').slice(0, 40);
    const scan = () => {
      for (const b of [...list.children].filter(e => e.tagName === 'BUTTON')) {
        const k = keyOf(b);
        if (!seen.has(k)) {
          seen.add(k);
          if (armed && document.getElementById('sndRoom')?.checked) {
            const t = b.querySelector('.room-name')?.textContent || (b.textContent || '').trim().split('\n')[0];
            ipcRenderer.send('potalk:new-room', String(t).slice(0, 60));
          }
        }
      }
    };
    if (list) { new MutationObserver(scan).observe(list, { childList: true }); scan(); setTimeout(() => { armed = true; scan(); }, 5000); }
  }
  // ロビー下のオプション3つを、画面下の1行へ移す（要素ごと移すので既存の動作はそのまま）
  const foot = document.createElement('div'); foot.id = 'pmFoot';
  for (const id of ['sndRoom', 'ntfRoomOpt', 'lobbyViewers']) {
    const el = document.getElementById(id); if (!el) continue;
    foot.appendChild(el.closest('label') || el);
  }
  // 文言を1行に収まる短さにする（中身の動作はそのまま）
  const shorten = (id, text) => {
    const el = foot.querySelector('#' + id), lab = el && el.closest('label'); if (!lab) return;
    [...lab.childNodes].filter(n => n.nodeType === 3).forEach(n => n.remove());
    lab.appendChild(document.createTextNode(text));
  };
  // 通知ボタンは1つ：新しい部屋ができたら、音（ページの設定）と Mac の通知でまとめて知らせる
  const sndBox = foot.querySelector('#sndRoom'), nb = document.createElement('button');
  nb.id = 'pmNotify'; nb.type = 'button'; nb.title = '新しい部屋ができたら Mac の通知と音で知らせる';
  const syncNb = () => { const on = !!(sndBox && sndBox.checked); nb.classList.toggle('on', on); nb.textContent = on ? '🔔 部屋の通知：オン' : '🔕 部屋の通知：オフ'; };
  if (sndBox) { nb.onclick = () => { sndBox.click(); syncNb(); }; sndBox.addEventListener('change', syncNb); setInterval(syncNb, 1000); }
  foot.insertBefore(nb, foot.firstChild); syncNb();
  document.body.appendChild(foot);
  const fit = () => {
    document.documentElement.style.setProperty('--pm-top', bar.offsetHeight + 8 + 'px');
    document.documentElement.style.setProperty('--pm-bot', foot.offsetHeight + 8 + 'px');
  };
  new ResizeObserver(fit).observe(bar); new ResizeObserver(fit).observe(foot); fit();
  const $ = id => document.getElementById(id);

  const sel = $('pmMic');
  async function fillMics() {
    let devs = []; try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch {}
    const cur = localStorage.getItem('potalkMicId') || '';
    sel.innerHTML = '<option value="">既定のマイク</option>' +
      devs.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .map(d => `<option value="${d.deviceId}">${(d.label || 'マイク').replace(/</g, '')}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
  }
  sel.onchange = () => { try { localStorage.setItem('potalkMicId', sel.value); } catch {} sel.title = '入力：' + (sel.selectedOptions[0]?.textContent || ''); };
  navigator.mediaDevices.addEventListener('devicechange', fillMics);
  sel.addEventListener('focus', fillMics);
  fillMics(); setTimeout(fillMics, 3000);
  if (UNIFIED) {
    // 左タブのマイク選択へ中継する（デバイスの実データと保存先 localStorage はページ側にある）
    const sendMics = () => ipcRenderer.send('potalk:mic-list', {
      options: [...sel.options].map(o => ({ value: o.value, label: o.textContent })),
      value: sel.value,
    });
    setInterval(sendMics, 2000); setTimeout(sendMics, 3600);
    ipcRenderer.on('potalk:mic-set', (_e, v) => {
      try { localStorage.setItem('potalkMicId', String(v)); } catch {}
      if ([...sel.options].some(o => o.value === String(v))) sel.value = String(v);
      sel.title = '入力：' + (sel.selectedOptions[0]?.textContent || '');
    });
    // 左タブのボタン（設定・部屋作り・ヘルプ）は、ページ側の既存ボタンを押すことで処理する
    ipcRenderer.on('potalk:ui-click', (_e, id) => { if (['pmSet', 'pmNew', 'pmHelp'].includes(id)) $(id)?.click(); });
    // 左タブ（シェル）へ本家のテーマ変数を中継する（シェルは別の webContents で、変数を直接読めないため）
    const THEME_KEYS = ['--panel', '--text', '--sub', '--border', '--chip', '--chip-hover', '--accent'];
    let lastTheme = '';
    const sendTheme = () => {
      const cs = getComputedStyle(document.documentElement), t = {};
      for (const k of THEME_KEYS) t[k.slice(2)] = cs.getPropertyValue(k).trim();
      const s = JSON.stringify(t);
      if (s !== lastTheme) { lastTheme = s; ipcRenderer.send('potalk:theme', t); }
    };
    setInterval(sendTheme, 3000); setTimeout(sendTheme, 800);
  }

  let joined = false, lastProfile = '';
  $('pmRoom').onclick = () => ipcRenderer.send('potalk:room-open');
  $('pmNew').onclick = () => {
    const nm = ($('pfName')?.textContent || '').trim();
    ipcRenderer.send('potalk:create-open', nm && !nm.includes('設定') ? nm + 'の部屋' : '');
  };
  ipcRenderer.on('potalk:create', (_e, { name, kind }) => {
    const room = $('room'), join = $('join'); if (!room || !join) return;
    room.value = String(name).slice(0, 30);
    room.dispatchEvent(new Event('input', { bubbles: true }));
    const k = $(kind === 'bc' ? 'kindBc' : 'kindChat');
    if (k) { k.checked = true; k.dispatchEvent(new Event('change', { bubbles: true })); k.click(); }
    if (kind !== 'bc') { join.click(); return; }
    // 配信部屋は選んだ瞬間に鍵を作って共有リンクを確定する（非同期）。確定を待ってから入る
    const t0 = Date.now();
    const wait = () => {
      if (($('share')?.textContent || '').includes('~pk~')) { join.click(); return; }
      if (Date.now() - t0 < 6000) setTimeout(wait, 100);
    };
    wait();
  });
  $('pmSet').onclick = () => ipcRenderer.send('potalk:settings-open');
  $('pmHelp').onclick = () => $('help')?.click();

  // 入室中かどうか：通話中のタブ列が出ている間だけ
  let pendingReload = false;
  ipcRenderer.on('potalk:profile-changed', () => { if (joined) pendingReload = true; else location.reload(); });
  setInterval(() => {
    const em = $('pfEmoji')?.textContent || '🧑', nm = $('pfName')?.textContent || '';
    const label = nm && !nm.includes('設定') ? `${em} ${nm}` : '🧑 設定';
    if ($('pmSet').textContent !== label) $('pmSet').textContent = label;
    if (UNIFIED) { const pk = em + '|' + nm; if (pk !== lastProfile) { lastProfile = pk; ipcRenderer.send('potalk:profile-info', { emoji: em, name: nm }); } }
    const j = !!$('tabs') && !$('tabs').hidden;
    if (j === joined) return;
    joined = j;
    if (j) document.documentElement.dataset.joined = '1'; else delete document.documentElement.dataset.joined;
    $('pmNew').disabled = j;
    $('pmNew').title = j ? '退出してから作れます' : '部屋を作る（別ウィンドウ）';
    if (j) ipcRenderer.send('potalk:create-close');
    if (!j && pendingReload) { pendingReload = false; location.reload(); return; }
    if (!j) { ipcRenderer.send('potalk:chat-close'); ipcRenderer.send('potalk:room-close'); }
    else ipcRenderer.send('potalk:room-open');   // 入室したら部屋の小窓を開く（本体は一覧のまま）
  }, 400);

  // 部屋の小窓へ：いまの部屋の様子（メンバー・ミュート・リンク）を送り、小窓からの操作をページ内の同じボタンに流す
  let lastSnap = '';
  setInterval(() => {
    const j = !!$('tabs') && !$('tabs').hidden;
    const snap = {
      joined: j,
      state: $('state')?.textContent || '',
      count: $('count')?.textContent || '0',
      members: [...document.querySelectorAll('#members .member')].map(r => ({
        em: r.querySelector('.m-emoji')?.textContent || '',
        name: r.querySelector('.m-name')?.textContent || '',
        mark: r.querySelector('.m-bc')?.textContent || '',
        muted: r.classList.contains('muted'),
        speaking: r.classList.contains('speaking'),
        you: !!r.querySelector('.you'),
        stage: r.querySelector('.m-stage')?.textContent || '',
        tap: !!r.querySelector('.m-emoji.m-tap'),
        ig: (() => { const b = r.querySelector('.m-ig'); return b && b.style.visibility !== 'hidden' ? { off: b.classList.contains('off'), title: b.title || '' } : null; })(),
        conn: (() => { const c = r.querySelector('.m-conn'); return c ? (c.classList.contains('relay') ? 'relay' : c.classList.contains('direct') ? 'direct' : 'unknown') : ''; })(),
        grant: (() => { const g = r.querySelector('.m-mic'); return g && g.style.visibility !== 'hidden' ? { on: g.classList.contains('on'), title: g.title || '' } : null; })(),
      })),
      mailNow: $('mailNow') && !$('mailNow').hidden ? { cap: $('mailNow').querySelector('.mn-cap')?.textContent || '', who: $('mailNow').querySelector('.mn-who')?.textContent || '', text: [...$('mailNow').children].pop()?.textContent || '' } : null,
      card: (() => {
        const d = $('cardDlg'); if (!d || !d.open) return null;
        const av = $('cdAvatar'), ig = $('cdIgnore');
        return {
          emoji: $('cdEmoji')?.textContent || '', img: av && !av.hidden ? av.src : '', sub: $('cdSubEmoji') && !$('cdSubEmoji').hidden ? $('cdSubEmoji').textContent : '',
          name: $('cdName')?.textContent || '', state: $('cdState')?.textContent || '', bio: $('cdBio')?.textContent || '',
          foot: d.querySelector('.cd-foot-note')?.textContent || '',
          ignore: ig && !ig.hidden ? { text: ig.textContent.trim(), disabled: !!ig.disabled } : null,
          socials: [...d.querySelectorAll('#cdSocials a')].map(a => ({ t: a.textContent.trim(), u: a.href })),
        };
      })(),
      ignoreAsk: (() => { const d = $('ignoreDlg'); return d && d.open ? { title: $('ignoreTitle')?.textContent || '', items: [...d.querySelectorAll('li')].map(l => l.textContent), yes: $('ignoreYes')?.textContent || '', no: $('ignoreNo')?.textContent || '' } : null; })(),
      more: $('membersMore')?.textContent?.trim() || '',
      mailOpen: ($('mailHead')?.textContent || '').includes('📮'),
      bcast: !!$('tabMail') && !$('tabMail').hidden,
      tag: { show: !!$('tagRow') && !$('tagRow').hidden, text: $('tagText')?.textContent || '', btn: $('tagEdit')?.textContent || '' },
      speak: { show: !!$('speak') && $('speak').style.display !== 'none', label: $('speak')?.textContent?.trim() || '', disabled: !!$('speak')?.disabled },
      raise: { show: !!$('raise') && !$('raise').hidden && $('raise').style.display !== 'none', label: $('raise')?.textContent?.trim() || '' },
      mail: (() => {
        const btns = [...$('mailHead').querySelectorAll('button'), ...$('mailBody').querySelectorAll('button')];
        const bi = b => ({ i: btns.indexOf(b), label: b.textContent, on: b.classList.contains('on') });
        return {
          head: [...$('mailHead').children].map(d => d.tagName === 'BUTTON' ? { text: '', btns: [bi(d)] } : ({ text: [...d.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() || (d.querySelector('button') ? '' : d.textContent.trim()), btns: [...d.querySelectorAll('button')].map(bi) })),
          body: [...$('mailBody').children].map(d => d.classList.contains('mail-item') && d.querySelector('.mail-text')
            ? { item: true, em: d.querySelector('.mail-em')?.textContent || '', who: d.querySelector('.mail-who')?.textContent || '', text: d.querySelector('.mail-text').textContent, shown: d.classList.contains('shown'), btns: [...d.querySelectorAll('button')].map(bi) }
            : { text: d.textContent.trim(), btns: [] }),
          form: $('mailForm') && !$('mailForm').hidden ? { ph: $('mailText').placeholder, btn: $('mailSend').textContent, max: $('mailText').maxLength } : null,
        };
      })(),
      reactions: [...document.querySelectorAll('#reactions button')].map(b => b.textContent),
      canMute: !!$('mute') && $('mute').style.display !== 'none',
      muted: !!$('mute')?.classList.contains('muted'),
      share: $('share')?.textContent?.trim() || '',
      settings: (() => {
        const out = [], hid = e => { for (; e && e.id !== 'panSettings'; e = e.parentElement) if (e.hidden || e.style.display === 'none') return true; return false; };
        for (const e of $('panSettings')?.children || []) {
          if (hid(e)) continue;
          const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
          const inp = e.querySelector?.('input');
          if (e.classList.contains('vol-opt') && inp?.type === 'range')
            out.push({ k: 'range', id: inp.id, label: e.querySelector('.vol-lbl')?.textContent || '', value: inp.value, min: inp.min, max: inp.max, step: inp.step });
          else if (e.classList.contains('bgm-row') || e.getAttribute('role') === 'radiogroup')
            out.push({ k: 'radios', items: [...e.querySelectorAll('input[type=radio]')].map(r => ({ id: r.id, label: r.closest('label')?.textContent.trim() || '', checked: r.checked })) });
          else if (e.classList.contains('snd-opt') && inp?.type === 'checkbox')
            out.push({ k: 'check', id: inp.id, label: t, checked: inp.checked });
          else if (e.classList.contains('vol-note') && t) out.push({ k: 'note', text: t });
        }
        return out;
      })(),
    };
    const s = JSON.stringify(snap);
    if (s !== lastSnap) { lastSnap = s; ipcRenderer.send('potalk:room-state', snap); }
  }, 250);
  // イコライザー（点字の波）：ページが描いた文字列を、小窓へそのまま流す
  let lastEq = null;
  setInterval(() => {
    const s = $('eq')?.textContent || '';
    if (s !== lastEq) { lastEq = s; ipcRenderer.send('potalk:room-eq', s); }
  }, 80);
  window.addEventListener('pm-react', e => { try { ipcRenderer.send('potalk:room-react', JSON.parse(e.detail)); } catch {} });
  ipcRenderer.on('potalk:room-cmd', (_e, c) => {
    if (c.type === 'mute') $('mute')?.click();
    else if (c.type === 'react') document.querySelectorAll('#reactions button')[c.i | 0]?.click();
    else if (c.type === 'set') {
      const el = $(String(c.id));
      if (!el || !el.closest('#panSettings')) return;
      if (el.type === 'range') { el.value = String(c.value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== !!c.value || el.type === 'radio') el.click(); }
    }
    else if (c.type === 'grant') document.querySelectorAll('#members .member')[c.i | 0]?.querySelector('.m-mic')?.click();
    else if (c.type === 'card') document.querySelectorAll('#members .member')[c.i | 0]?.querySelector('.m-emoji')?.click();
    else if (c.type === 'cardClose') { try { $('cardDlg').close(); } catch {} }
    else if (c.type === 'cardIgnore') $('cdIgnore')?.click();
    else if (c.type === 'ignoreRow') document.querySelectorAll('#members .member')[c.i | 0]?.querySelector('.m-ig')?.click();
    else if (c.type === 'ignoreYes') $('ignoreYes')?.click();
    else if (c.type === 'ignoreNo') $('ignoreNo')?.click();
    else if (c.type === 'speak') $('speak')?.click();
    else if (c.type === 'raise') $('raise')?.click();
    else if (c.type === 'tag') { $('tagInput').value = String(c.text).slice(0, 30); $('tagSend').onclick(); }
    else if (c.type === 'mailbtn') [...$('mailHead').querySelectorAll('button'), ...$('mailBody').querySelectorAll('button')][c.i | 0]?.click();
    else if (c.type === 'mailsend') { $('mailText').value = String(c.text); $('mailSend').click(); }
    else if (c.type === 'leave') { $('leave')?.click(); setTimeout(() => $('leaveYes')?.click(), 80); }
  });

  // ひとこと窓へ：ログに増えた行を転送し、窓からの送信を入力欄に流し込む
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!n.classList || !n.classList.contains('cl-row')) continue;
      ipcRenderer.send('potalk:chat-line', {
        sys: n.classList.contains('cl-sys'),
        hist: n.classList.contains('cl-hist'),
        em: n.querySelector('.cl-em')?.textContent || '',
        who: n.querySelector('.cl-who')?.textContent || '',
        text: n.querySelector('.cl-text')?.textContent || '',
      });
    }
  }).observe($('chatLog'), { childList: true });
  ipcRenderer.on('potalk:send', (_e, text) => {
    const input = $('chatText'), btn = $('chatSend'); if (!input || !btn) return;
    input.value = String(text).slice(0, 60);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
  });
  document.addEventListener('click', e => { if (e.target && e.target.id === 'roomAsk') $('roomAskNo')?.click(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('roomAskNo')?.click(); });
});
