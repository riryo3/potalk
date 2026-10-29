'use strict'
const $ = id => document.getElementById(id)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
// 窓の種類：single（ひとつの窓）／ lobby・room・chat・mail・settings（分けた窓）。main.js が ?w= で教える
const KIND = new URLSearchParams(location.search).get('w') || 'single'
document.body.dataset.w = KIND
// ひとこと用ドロワーの高さ（固定）。開くと、窓は、この高さ（+ 区切り 1）のぶん伸びる。ハンドルのドラッグでは、窓の高さのほうを変える
const CHAT_H = 220
let chatH = CHAT_H, chatGrown = 0, growing = false
document.documentElement.style.setProperty('--chat-h', chatH + 'px')
const S = { lobby: null, profile: null, room: null, eq: '', dismissed: '', tab: { mail: 'mail', settings: 'settings' }[KIND] || 'room', chat: [], wins: {}, cards: null, devices: [], unread: 0, chatOpen: false, wasJoined: false, warned: new Set(), sliding: false }

// ---- 自衛ワード（含む部屋・人を、一覧に出さない。全角半角・大文字小文字・ひらがなカタカナは区別しない）----
const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
const loadBanned = () => { try { const a = JSON.parse(localStorage.getItem('bannedWords') || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }
let banned = loadBanned()                       // 新しく登録したものが先頭
const saveBanned = () => { try { localStorage.setItem('bannedWords', JSON.stringify(banned)) } catch {}; window.potalk.setBanned(banned) }
const matchWord = strs => { const hay = strs.map(fold); return banned.find(w => { const q = fold(w); return q && hay.some(h => h.includes(q)) }) || null }
const roomWord = r => banned.length ? matchWord([r.name, r.sub, r.subBy, ...(r.people || []).map(p => p.name)]) : null
function addBanned(w) {
  const t = String(w || '').trim()
  if (!t || banned.some(x => fold(x) === fold(t))) return false
  banned.unshift(t); saveBanned(); return true
}

// 回線の印：輪郭だけの雲（中継）と、左右の矢印（直接）
function connIcon(kind) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 20 16'); svg.setAttribute('class', 'conn-ic ' + kind)
  const ds = kind === 'relay' ? ['M5.5 13a3.3 3.3 0 0 1-.4-6.5A4.6 4.6 0 0 1 14 5.6 3.7 3.7 0 0 1 14.5 13z'] : ['M3 5.5h13', 'M13 2.5l3 3-3 3', 'M17 10.5H4', 'M7 7.5l-3 3 3 3']
  for (const d of ds) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p) }
  return svg
}

// 赤い丸に斜線入りのマイク（ミュート中の印）
function micOff() {
  const NS = 'http://www.w3.org/2000/svg'
  const wrap = el('span', 'mic-off'), svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 16 16')
  for (const d of ['M6 3.5a2 2 0 0 1 4 0v3a2 2 0 0 1-4 0z', 'M3.5 7a4.5 4.5 0 0 0 9 0', 'M8 11.5V14', 'M2.5 2.5l11 11']) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p) }
  wrap.append(svg); return wrap
}

// ---- ロビー ----
function renderLobby() {
  const l = S.lobby, p = S.profile
  $('me').textContent = p ? `${p.emoji || ''} ${p.name || 'ゲスト'}` : ''
  $('viewers').textContent = l ? l.viewers : ''
  const nf = (S.wins.prefs || {}).notifyRooms !== false, nb = $('btnNotify')
  nb.textContent = nf ? (KIND === 'drawer' ? '🔔 通知：オン' : '🔔 部屋の通知：オン') : (KIND === 'drawer' ? '🔕 通知：オフ' : '🔕 部屋の通知：オフ'); nb.classList.toggle('on', nf)
  const raw = $('search').value.trim(), q = fold(raw)
  const lm = raw.match(/#room=([^&\s]*)/); let linkId = null
  if (lm) { try { linkId = decodeURIComponent(lm[1]) } catch { linkId = lm[1] } }
  const box = $('rooms'); box.replaceChildren()
  // 部屋のURLを貼ったときは、自衛ワードがあっても出す
  const rooms = linkId ? (l ? l.rooms : []).filter(r => r.id === linkId)
    : (l ? l.rooms : []).filter(r => !roomWord(r)).filter(r => !q || [r.name, r.sub, r.subBy, ...(r.people || []).map(m => m.name)].some(x => fold(x).includes(q)))
  for (const r of rooms) {
    const card = el('button', 'room-card')
    const top = el('div', 'room-top')
    top.append(el('span', 'room-name emoji-line', (/^[🏠📣]/u.test(r.name) ? '' : r.bc ? '📣 ' : '🏠 ') + r.name), el('span', 'room-count', r.count))
    card.append(top)
    if (r.sub) { const s = el('div', 'room-sub'); s.append('🏷 ', el('b', '', r.sub)); if (r.subBy) s.append(' ' + r.subBy); card.append(s) }
    if (r.dur) card.append(el('div', 'room-dur', '⏱ ' + r.dur.replace(/^⏱\s*/, '')))
    const people = el('div', 'people')
    for (const m of (r.people || [])) { const p = el('span', 'person'); p.append(el('span', 'emoji', m.em), m.name); if (m.muted) p.append(micOff()); people.append(p) }
    card.append(people)
    card.onclick = () => { if (!r.id) return; if (KIND === 'drawer') window.potalk.askJoin({ id: r.id, name: r.name, bc: !!r.bc }); else window.potalk.cmd({ type: 'join', id: r.id, quiet: false }) }
    box.append(card)
  }
  if (!rooms.length) {
    if (raw && linkId) {
      const nh = el('div', 'empty'); nh.append(el('div', '', 'このリンクの部屋は、いま通話中の一覧にありません（お休み中かもしれません）。'))
      const b = el('button', 'chip-btn', 'このリンクの部屋に入ってみる'); b.style.marginTop = '10px'; b.onclick = () => { const t = $('search').value; $('search').value = ''; renderLobby(); window.potalk.openLink(t) }
      nh.append(b); box.append(nh)
    } else if (raw) box.append(el('div', 'empty', `「${raw}」に合う部屋は見つかりません。`))
    else box.append(el('div', 'empty', l && l.rooms.length ? '表示できる部屋は、ありません' : '通話中の部屋は、まだありません'))
  }
  syncMinWidth()
}

// ---- マイク（入力設定）。選んだマイクは、次に入室するときから使われる ----
function chooseMic(name) {
  const cur = (S.wins.prefs || {}).mic || ''
  closeMicMenu()
  if (name === cur) return
  window.potalk.setPref('mic', name)
  if (S.room && S.room.joined && confirm(`マイクを切り替えるには、入り直します。\n「${name || '既定のマイク'}」に切り替えます。同じ部屋に入り直しますか？（数秒、声が途切れます）`)) window.potalk.cmd({ type: 'reconnect' })
}
function closeMicMenu() { $('micMenu').hidden = true }
function renderMicMenu() {
  const m = $('micMenu'), cur = (S.wins.prefs || {}).mic || ''; m.replaceChildren()
  const item = (label, on, fn) => { const b = el('button', 'pm-item' + (on ? ' on' : ''), (on ? '✓ ' : '') + label); b.onclick = fn; m.append(b) }
  item('既定のマイク', cur === '', () => chooseMic(''))
  const named = S.devices.filter(d => d.label)
  for (const d of named) item(d.label, cur === d.label, () => chooseMic(d.label))
  if (!named.length) m.append(el('div', 'pm-note', S.devices.length ? 'マイクの名前を出すには、許可が必要です。「一覧を更新」を押してください。' : 'マイクが見つかりません。'))
  m.append(el('hr', 'card-hr')); item('マイクの一覧を更新', false, () => { window.potalk.refreshMics(true) })
}
function openMicMenu(btn) {
  const m = $('micMenu'); if (!m.hidden) return closeMicMenu()
  window.potalk.refreshMics(false); renderMicMenu(); m.hidden = false
  const r = btn.getBoundingClientRect(); m.style.top = (r.bottom + 4) + 'px'; m.style.right = Math.max(6, innerWidth - r.right) + 'px'
}
document.addEventListener('pointerdown', e => { const m = $('micMenu'); if (!m.hidden && !m.contains(e.target) && !e.target.closest('#micBtn, #btnMic2')) closeMicMenu() })

// ---- 話題タグの編集 ----
function openTagEdit(cur) {
  const ov = $('tagOv'); ov.replaceChildren(); ov.hidden = false
  const box = el('div', 'card-box'), inp = el('input'), n = el('span', 'muted small', ''), bt = el('div', 'ask-btns')
  inp.maxLength = 30; inp.placeholder = '今日の話題（最大30文字）'; inp.value = cur || ''
  const upd = () => { n.textContent = `${[...inp.value].length} / 30` }; inp.oninput = upd; upd()
  const done = ok => { ov.hidden = true; ov.replaceChildren(); if (ok) window.potalk.cmd({ type: 'tag', text: inp.value.trim().slice(0, 30) }) }
  const yes = el('button', 'yes-blue', '確定'), no = el('button', '', 'やめる'); yes.onclick = () => done(true); no.onclick = () => done(false)
  inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) done(true); else if (e.key === 'Escape') done(false) }
  const row = el('div', 'row2'); row.append(el('span', 'muted small', '話題タグ'), el('span', 'grow'), n)
  bt.append(no, yes); box.append(el('div', 'card-name', '🏷 話題タグ'), row, inp, bt); ov.append(box); inp.focus()
}

// ---- これはなに？／初回のごあいさつ ----
function ext(url, label) { const a = el('a', '', label); a.href = url; a.onclick = e => { e.preventDefault(); window.potalk.openExternal(url) }; return a }
function openHelp() {
  const ov = $('helpOv'); ov.replaceChildren(); ov.hidden = false
  const box = el('div', 'card-box help-box')
  const warn = el('div', 'help-warn', '⚠️ Potalker は、ぽっと通話（potalk.app）の「非公式」クライアントです。サイトの作者とは関係がありません。')
  const links = el('div', 'help-links'); for (const [u, t] of [['https://potalk.app/start/', 'はじめに（初めての方へ）'], ['https://potalk.app/manual/', '使い方（画面の順に説明）'], ['https://potalk.app/tech/', 'しくみ（サーバなしで動く理由）'], ['https://potalk.app/about/', '運営（制作者と方針）'], ['https://github.com/po-talk/po-talk.github.io', 'ソース（po-talk/po-talk.github.io）']]) links.append(ext(u, t))
  const x = el('button', 'card-x', '✕'); x.onclick = () => { ov.hidden = true }
  const head = el('div', 'card-head'); head.append(el('div', 'card-name', '🫖 ぽっと通話とは'), x)
  box.append(warn, head, el('div', 'small', '登録なし・インストールなしで、居合わせた人と声だけで話せる小さなお茶の席です。同じ部屋を開いた人どうしが、そのまま話せます。'), el('div', 'warn small', '⚠️ 実験中です。ご利用は自己責任で！'), links, el('div', 'small', '🙏 ぽっと通話を作ってくださった くらもさん に、感謝しています。通話の仕組みは、くらもさんのサイトをそのまま使わせてもらっています。'), el('hr', 'card-hr'), el('div', 'muted small', 'Potalker は、通話の仕組みに potalk.app をそのまま使い、画面だけを作り直した非公式のアプリです。'))
  ov.append(box)
}
function openThanks() {
  const ov = $('thanksOv'); ov.replaceChildren(); ov.hidden = false
  const box = el('div', 'card-box'), lab = el('label', 'set-row'), c = el('input'); c.type = 'checkbox'; c.checked = true
  lab.append(c, el('span', 'small', '次から表示しない'))
  const go = el('button', 'primary', 'はじめる'); go.onclick = () => { ov.hidden = true; if (c.checked) window.potalk.setPref('thanksShown', true) }
  const links = el('div', 'help-links'); links.append(ext('https://potalk.app/', 'ぽっと通話（Web アプリ）　potalk.app'), ext('https://github.com/po-talk/po-talk.github.io', 'ソース（GitHub）　po-talk/po-talk.github.io'))
  box.append(el('div', 'card-name', 'くらもさんへ、ありがとうございます'), el('div', 'small', 'Potalker は、くらもさんが作った「ぽっと通話」の、非公式クライアントです。通話の仕組みは、くらもさんのサイトをそのまま使わせてもらっています。'), el('div', 'small', 'こんなに気軽に話せる、すてきな場所を公開してくださって、ありがとうございます。「これはなに？」からも、読み返せます。'), links, lab, go)
  ov.append(box)
}


// ---- 部屋 ----
function splitState(t) {
  t = t || '未参加'
  for (const sep of ['：', '｜']) {
    const i = t.indexOf(sep)
    if (i > 0 && i < t.length - 1) return { status: t.slice(0, i).trim(), title: t.slice(i + 1).trim() }
  }
  return { status: '', title: t }
}
const isBad = t => /失敗|切断|エラー|できません/.test(t || '')

function renderRoom() {
  const r = S.room
  const { status, title } = splitState(r.state)
  $('roomTitle').textContent = title
  const b = $('roomStatus'); b.textContent = status; b.hidden = !status
  b.className = 'badge ' + (isBad(r.state) ? 'bad' : r.state.includes('通話中') ? 'ok' : 'busy')
  $('roomCount').textContent = `${r.members.length}人`
  const tag = $('tagRow'); tag.hidden = !r.tag.show; tag.replaceChildren(el('span', 'tagtext', '🏷 ' + (r.tag.text || '話題はまだありません')))
  if (r.tag.show && r.tag.btn) { const tb = el('button', 'chip-btn', r.tag.btn); tb.onclick = () => openTagEdit(r.tag.btn === '変える' ? r.tag.text : ''); tag.append(tb) }
  $('tabMail').hidden = !r.bcast
  if (KIND === 'single' && !r.bcast && S.tab === 'mail') S.tab = 'room'

  // 自衛ワードを含む名前の人が入ったら、1人につき1回、通知する（部屋を出るまで）
  const hits = []
  for (const m of r.members) {
    if (m.you) continue
    const w = banned.length ? matchWord([m.name]) : null
    if (!w) continue
    hits.push({ name: m.name, w })
    if (!S.warned.has(m.name) && (KIND === 'single' || KIND === 'room')) { S.warned.add(m.name); window.potalk.notify('自衛ワードを含む名前の人がいます', `${m.name}（登録ワード：${w}）`) }
  }
  // エラー・お知らせの帯（状態の文言のエラー、ページの #peerNotice・#audioWarn、自衛ワード）
  const msgs = []
  if (isBad(r.state)) msgs.push({ t: r.state, cls: 'bad' })
  if (r.notice && r.notice !== S.dismissed) msgs.push({ t: r.notice, cls: /^🔌|失敗|できません/.test(r.notice) ? 'bad' : 'warn', dismiss: true })
  if (r.audioWarn) msgs.push({ t: r.audioWarn, cls: 'warn' })
  for (const h of hits) msgs.push({ t: `🛡 自衛ワード「${h.w}」を含む名前の人がいます：${h.name}`, cls: 'warn' })
  const ban = $('banner'); ban.replaceChildren(); ban.hidden = !msgs.length
  for (const m of msgs) {
    const d = el('div', 'banner-item ' + m.cls, m.t)
    if (m.dismiss) d.onclick = () => { S.dismissed = r.notice; renderRoom() }
    ban.append(d)
  }
  if (!r.notice) S.dismissed = ''

  const box = $('members'); box.replaceChildren()
  r.members.forEach((m, idx) => {
    const row = el('div', 'member' + (m.speaking ? ' speaking' : '') + (m.you ? ' you' : ''))
    const mic = el('span', 'mic'); if (m.muted) mic.append(micOff())
    const em = el('span', 'em', m.em)
    row.append(em, mic,
      (() => { const c = el('span', 'conn'); if (m.conn === 'relay' || m.conn === 'direct') c.append(connIcon(m.conn)); return c })(),
      el('span', 'name', (m.mark ? m.mark + ' ' : '') + m.name + (m.you ? '（あなた）' : '')))
    if (m.stage) row.append(el('span', 'stage', m.stage))
    if (m.grant) { const g = el('button', 'chip-btn grant' + (m.grant.on ? ' on' : ''), m.grant.on ? '🎙 登壇中' : '🎙 登壇'); g.title = m.grant.title || ''; g.onclick = e => { e.stopPropagation(); window.potalk.cmd({ type: 'grant', i: idx }) }; row.append(g) }
    if (m.ig) { const h = el('button', 'heart' + (m.ig.off ? ' off' : ''), m.ig.off ? '♡' : '♥'); h.title = m.ig.title || ''; h.onclick = e => { e.stopPropagation(); window.potalk.cmd({ type: 'ignoreRow', i: idx }) }; row.append(h) }
    else row.append(el('span', 'heart-ph'))
    // 行のどこを押しても、名刺が開く（♥・登壇のボタンは別）
    if (m.tap) { row.classList.add('tap'); row.title = '名刺を見る'; row.onclick = () => window.potalk.cmd({ type: 'card', i: idx }) }
    box.append(row)
  })
  renderLegend()
  if (r.more) box.append(el('div', 'muted small', r.more))
  const rx = $('reactions'); rx.replaceChildren()
  r.reactions.forEach((e, i) => { const x = el('button', 'react', e); x.onclick = () => window.potalk.cmd({ type: 'react', i }); rx.append(x) })
  const mute = $('btnMute'); mute.disabled = false
  if (r.raise && r.raise.show) { mute.hidden = false; mute.dataset.act = 'raise'; mute.textContent = '🙋 ' + (r.raise.label || '通話希望'); mute.className = 'wide' }
  else if (r.speak && r.speak.show) { mute.hidden = false; mute.dataset.act = 'speak'; mute.textContent = '🎙 ' + (r.speak.label || 'マイクを使う'); mute.disabled = !!r.speak.disabled; mute.className = 'wide' }
  else { mute.hidden = false; mute.disabled = !r.canMute; mute.dataset.act = 'mute'; mute.textContent = r.muted ? '🎤 ミュート解除' : '🎤 ミュート'; mute.className = 'wide' + (r.muted ? ' muted' : '') }
  $('btnShare').disabled = !r.share
  renderOverlays()
  if (KIND === 'single') { renderTabs(); renderSettings(); renderMail() }
  renderWinBtns()
  if (KIND === 'single' || KIND === 'room') syncMinHeight()
}

// 回線の見分け方（Mac 版と同じ：押すと意味が開く）
let legendOpen = false
function renderLegend() {
  const box = $('legend'); box.replaceChildren()
  if (legendOpen) {
    const open = el('div', 'legend-open')
    const a = el('div'); a.append(connIcon('relay'), ' 中継 ＝ その人のIPアドレスは隠れています')
    const b = el('div'); b.append(connIcon('direct'), ' 直接 ＝ その人のIPアドレスが見えています')
    open.append(a, b); open.onclick = () => { legendOpen = false; renderLegend() }
    box.append(open); box.style.display = 'block'
  } else {
    box.style.display = ''
    const btn = el('button')
    btn.append(connIcon('relay'), ' 中継 ', el('span', 'muted', '／ '), connIcon('direct'), ' 直接 ', el('span', 'muted', '詳細…'))
    btn.onclick = () => { legendOpen = true; renderLegend() }
    box.append(btn)
  }
}

// 音量バー（文字 1 つずつを、等間隔に並べる）
function renderEq(t) {
  const box = $('eq'); box.replaceChildren()
  for (const c of String(t || '')) box.append(el('span', '', c))
}

// 本文の URL を、押せるリンクにする（開く前に、確認が出る）
function linkify(text) {
  const f = document.createDocumentFragment(), re = /https?:\/\/[^\s<>"'）)」』]+/g
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) f.append(text.slice(last, m.index))
    f.append(linkEl(m[0], m[0])); last = m.index + m[0].length
  }
  if (last < text.length) f.append(text.slice(last))
  return f
}
function linkEl(url, label) { const a = el('a', '', label); a.href = url; a.onclick = e => { e.preventDefault(); window.potalk.openExternal(url) }; return a }

// 名刺（メンバーの絵文字を押すと開く）と、無視の確認。ページの窓の状態を、そのまま写す
function renderOverlays() {
  if (KIND !== 'single' && KIND !== 'room') return
  const r = S.room, cv = $('cardOv'), iv = $('ignoreOv'), c = r.card, a = r.ignoreAsk
  if ((c || a) && KIND === 'single' && S.tab !== 'room') { S.tab = 'room'; renderTabs() }
  cv.hidden = !c; cv.replaceChildren()
  if (c) {
    const box = el('div', 'card-box'), head = el('div', 'card-head'), av = el('div', 'card-av')
    if (c.img) { const im = el('img'); im.src = c.img; im.alt = ''; im.onerror = () => { av.replaceChildren(c.emoji) }; av.append(im) } else av.textContent = c.emoji
    const nm = el('div'); nm.append(el('div', 'card-name', c.name), el('div', 'card-state', c.state))
    const x = el('button', 'card-x', '✕'); x.onclick = () => window.potalk.cmd({ type: 'cardClose' })
    head.append(av, nm, x); box.append(head, el('hr', 'card-hr'))
    if (c.bio) { const b = el('div', 'card-bio'); b.append(linkify(c.bio)); box.append(b) }
    if (c.socials && c.socials.length) { const s = el('div', 'card-soc'); for (const so of c.socials) s.append(linkEl(so.u, so.t || so.u)); box.append(s) }
    box.append(el('hr', 'card-hr'), el('div', 'card-foot', c.foot || ''))
    if (c.edit) { const e = el('button', 'chip-btn wide-btn', '✏️ 自分の名刺を編集する'); e.onclick = () => window.potalk.cmd({ type: 'cardEditFromCard' }); box.append(e) }
    if (c.ignore) { const g = el('button', 'card-ig', '♥ ' + c.ignore.text); g.disabled = !!c.ignore.disabled; g.onclick = () => window.potalk.cmd({ type: 'cardIgnore' }); box.append(g) }
    cv.append(box)
  }
  iv.hidden = !a; iv.replaceChildren()
  if (a) {
    const box = el('div', 'card-box'), ul = el('ul', 'ask-list'), bt = el('div', 'ask-btns')
    for (const t of a.items) ul.append(el('li', '', t))
    const yes = el('button', 'yes', a.yes), no = el('button', '', a.no)
    yes.onclick = () => window.potalk.cmd({ type: 'ignoreYes' }); no.onclick = () => window.potalk.cmd({ type: 'ignoreNo' })
    bt.append(yes, no); box.append(el('div', 'card-name', a.title), ul, bt); iv.append(box)
  }
}
$('cardOv').onclick = e => { if (e.target === $('cardOv')) window.potalk.cmd({ type: 'cardClose' }) }

// 部屋の窓：ひとこと・おたより・設定の窓を開くボタン（新着があると色がつく）
function chatVisible() { return KIND === 'single' ? S.chatOpen : KIND === 'chat' ? true : !!S.wins.chat }
function renderWinBtns() {
  if (KIND !== 'room' || !S.room) return
  const c = $('btnChatWin'), hot = S.unread > 0 && !S.wins.chat
  c.replaceChildren(el('span', 'emoji', '💬'), ' ' + (hot ? `ひとこと 新着 ${S.unread}` : 'ひとこと')); c.classList.toggle('hot', hot); c.classList.toggle('on', !!S.wins.chat)
  const m = $('btnMailWin'), mh = !!S.room.mailOpen && !S.wins.mail
  m.hidden = !S.room.bcast; m.classList.toggle('hot-orange', mh); m.classList.toggle('on', !!S.wins.mail)
  $('btnSetWin').classList.toggle('on', !!S.wins.settings)
}
function renderSpk() { const b = $('btnSpk'), on = !!S.wins.spk; b.className = 'wide' + (on ? ' muted' : ''); b.replaceChildren(el('span', 'emoji', '🔈'), ' ' + (on ? 'ミュート解除' : 'ミュート')) }
// メニュー・ショートカットからの操作（ひとつの窓のタブ・ひとこと、自衛ワードの登録）
function uiAction({ a, v }) {
  if (a === 'banned') return openBanned()
  if (a === 'profile') return openProfile()
  if (a === 'help') return openHelp()
  if (a === 'thanks') return openThanks()
  if (a === 'join' && KIND === 'single') { S.joinAsk = v; return renderJoin() }
  if (KIND !== 'single' || !S.room || !S.room.joined) return
  if (a === 'tab') { if (v === 'mail' && !S.room.bcast) return; S.tab = v; renderTabs() }
  else if (a === 'chat') setChatOpen(!S.chatOpen)
  else if (a === 'cycle') { const tabs = ['room', ...(S.room.bcast ? ['mail'] : []), 'settings']; const i = Math.max(0, tabs.indexOf(S.tab)); S.tab = tabs[(i + v + tabs.length) % tabs.length]; renderTabs() }
}
// 取っ手（部屋の画面の端。押すと、部屋一覧の窓が、横に開く）
function renderHandle() {
  const h = $('handle'); if (!h) return
  const side = S.wins.drawerSide || 'left', open = !!S.wins.drawer
  document.querySelector('.mainrow').classList.toggle('right', side === 'right')
  h.replaceChildren(el('span', 'chev', open === (side === 'left') ? '›' : '‹'), el('span', 'htxt', '部屋一覧'))
  h.classList.toggle('on', open)
  h.hidden = KIND !== 'single'
}
// ドロワーで選んだ部屋に、移るかの確認（本体の窓に出る）
function renderJoin() {
  const a = S.joinAsk, ov = $('joinOv'); ov.hidden = !a; ov.replaceChildren()
  if (!a) return
  let quiet = false
  const box = el('div', 'card-box'), bt = el('div', 'ask-btns')
  box.append(el('div', 'card-name', `「${/^[🏠📣]/u.test(a.name) ? '' : a.bc ? '📣 ' : ''}${a.name}」に移りますか？`), el('div', 'card-state', '今の部屋を退出します。' + (a.bc ? '聞き役で入室します（マイクは使いません）。' : 'ミュート状態で入室します。')))
  if (a.bc) { const lab = el('label', 'set-row'), c = el('input'); c.type = 'checkbox'; c.onchange = () => { quiet = c.checked }; lab.append(c, el('span', '', '🤫 静かに入る（名前を出さずに聞きます）')); box.append(lab) }
  const yes = el('button', 'yes-blue', '移る'), no = el('button', '', 'やめる')
  yes.onclick = () => { S.joinAsk = null; renderJoin(); window.potalk.joinRoom(a.id, quiet) }
  no.onclick = () => { S.joinAsk = null; renderJoin() }
  bt.append(no, yes); box.append(bt); ov.append(box)
}
function renderPin() { for (const id of ['btnPin', 'btnPin2', 'btnPin3']) $(id).classList.toggle('on', !!S.wins.pinned) }

function renderTabs() {
  for (const b of document.querySelectorAll('#tabs button[data-tab]')) b.classList.toggle('on', b.dataset.tab === S.tab)
  $('paneRoom').hidden = S.tab !== 'room'; $('paneMail').hidden = S.tab !== 'mail'; $('paneSettings').hidden = S.tab !== 'settings'
}

// ---- 設定（ページの設定欄をそのまま写す：音量・BGM・音のスイッチ）----
function renderSettings() {
  const pane = $('paneSettings'); pane.className = 'pane scroll'
  if (S.sliding) return
  pane.replaceChildren()
  const items = S.room.settings || []
  if (!items.length) pane.append(el('div', 'empty', '部屋に入ると、ここに設定が出ます。'))
  for (const it of items) {
    if (it.k === 'range') {
      const row = el('div', 'set-row'); const v = el('span', 'muted small', it.value + '%')
      const inp = el('input'); inp.type = 'range'; inp.min = it.min; inp.max = it.max; inp.value = it.value
      inp.oninput = () => { v.textContent = inp.value + '%'; window.potalk.cmd({ type: 'set', id: it.id, value: inp.value }) }
      inp.onpointerdown = () => { S.sliding = true }
      inp.onpointerup = () => { S.sliding = false }
      row.append(el('span', '', it.label), inp, v); pane.append(row)
    } else if (it.k === 'radios') {
      for (const r of it.items) { const b = el('button', 'set-radio' + (r.checked ? ' on' : ''), (r.checked ? '◉ ' : '○ ') + r.label); b.onclick = () => window.potalk.cmd({ type: 'set', id: r.id, value: true }); pane.append(b) }
    } else if (it.k === 'check') {
      const lab = el('label', 'set-row'); const c = el('input'); c.type = 'checkbox'; c.checked = it.checked
      c.onchange = () => window.potalk.cmd({ type: 'set', id: it.id, value: c.checked })
      lab.append(c, el('span', '', it.label)); pane.append(lab)
    } else if (it.text) pane.append(el('div', 'muted small', it.text))
  }
  const b = el('button', 'chip-btn', '🛡 自衛ワードを登録…'); b.onclick = openBanned; pane.append(b)
}

// ---- おたより（配信部屋）----
let mailFormMax = -1
function renderMail() {
  const m = S.room.mail, pane = $('paneMail')
  if (!pane.firstChild) {
    const top = el('div', 'pane scroll'); top.id = 'mailTop'
    const form = el('div', 'mail-form'); form.id = 'mailForm'; form.hidden = true
    const inp = el('input'); inp.id = 'mailText'
    const send = el('button', 'primary', '送る')
    const go = () => { const t = inp.value.trim(); if (t) { window.potalk.cmd({ type: 'mailsend', text: t }); inp.value = '' } }
    send.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) go() }
    form.append(inp, send); pane.append(top, form)
  }
  const top = $('mailTop'); top.replaceChildren()
  const btn = b => { const x = el('button', 'chip-btn', b.label); if (b.on) x.style.borderColor = 'var(--accent)'; x.onclick = () => window.potalk.cmd({ type: 'mailbtn', i: b.i }); return x }
  for (const h of m.head) { const row = el('div', 'set-row'); if (h.text) row.append(el('span', '', h.text)); for (const b of h.btns) row.append(btn(b)); top.append(row) }
  for (const b of m.body) {
    if (b.item) {
      const it = el('div', 'mail-item' + (b.shown ? ' shown' : ''))
      const left = el('div'); left.append(el('div', 'muted small', `${b.em || ''} ${b.who || ''}`), el('div', '', b.text))
      const right = el('div', 'set-row'); for (const x of b.btns) right.append(btn(x))
      it.append(left, right); top.append(it)
    } else top.append(el('div', 'muted small', b.text))
  }
  const form = $('mailForm'); form.hidden = !m.form
  if (m.form) { const inp = $('mailText'); inp.placeholder = m.form.ph; if (m.form.max > 0 && m.form.max < 100000) inp.maxLength = m.form.max; form.lastChild.textContent = m.form.btn }
}

// ---- ひとこと ----
function renderChat() {
  const log = $('chatLog'); log.replaceChildren()
  for (const c of S.chat) {
    const row = el('div', c.sys ? 'cl-sys' : 'cl-row')
    if (c.sys) row.textContent = c.text
    else row.append(el('span', '', c.em), el('span', 'cl-who', c.who), el('span', '', c.text))
    log.append(row)
  }
  log.scrollTop = log.scrollHeight
  renderWinBtns()
  const t = $('chatToggle')
  t.textContent = (S.chatOpen ? '▾ ' : '▴ ') + (S.unread > 0 ? `ひとこと 新着 ${S.unread}` : 'ひとこと')
  t.classList.toggle('hot', S.unread > 0)
}
function setChatOpen(open, silent) {
  if (open === S.chatOpen) return
  S.chatOpen = open; if (open) S.unread = 0
  $('chatOpen').hidden = !open; $('chatBox').classList.toggle('open', open)
  // 開いたときに伸ばした量を覚えておき、閉じるときに、同じ量だけ戻す（開いている間に、ハンドルで高さを変えても、窓はずれない）
  // 窓が伸び縮みし終わるまでは、メンバー一覧の余裕を測らない（途中で測ると、足りないと誤って、窓を余計に広げる）
  if (silent) { chatGrown = 0; renderChat(); return }      // 部屋を出るときは、main が、窓の大きさを、ロビー用に決めるので、ここでは縮めない
  growing = true
  const done = () => { growing = false; syncMinHeight() }
  if (open) { chatGrown = chatH + 1; window.potalk.growBy(chatGrown).then(done, done) } else { window.potalk.growBy(-chatGrown).then(done, done); chatGrown = 0 }
  renderChat(); if (open) $('chatText').focus()
}

// ---- 自衛ワードの登録画面 ----
function openBanned() { $('banned').hidden = false; renderBanned() }
function renderBanned(msg) {
  $('bannedMsg').textContent = msg || ''
  const box = $('bannedChips'); box.replaceChildren()
  for (const w of banned) {
    const b = el('button', 'chip-word', w)
    b.onclick = () => { if (confirm('このワードを消しますか？\n' + w)) { banned = banned.filter(x => x !== w); saveBanned(); renderBanned(); render() } }
    box.append(b)
  }
}
$('bannedAdd').onclick = () => { const i = $('bannedInput'); if (addBanned(i.value)) { i.value = ''; renderBanned(); render() } else if (i.value.trim()) renderBanned('すでに登録されています。') }
$('bannedInput').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('bannedAdd').click() }
$('bannedClose').onclick = () => { $('banned').hidden = true }
$('bannedOut').onclick = async () => { const n = await window.potalk.bannedExport(banned); if (n !== null) renderBanned(`${n}件を書き出しました。`) }
$('bannedIn').onclick = async () => {
  const lines = await window.potalk.bannedImport(); if (!lines) return
  let added = 0, skipped = 0
  for (const w of lines.slice().reverse()) { if (addBanned(w)) added++; else skipped++ }      // ファイルの先頭が最新なので、後ろから足して、並びを保つ
  renderBanned(`${added}件を足しました（登録済み・重複 ${skipped}件は飛ばしました）。`); render()
}
$('btnBanned').onclick = openBanned

// ---- 名刺の設定（自分の名刺）。ページの入力欄と同期する ----
// ページ側で値が変わった（切り詰め・IDへの変換など）ときだけ、入力欄に反映する（入力中の文字を、古い値で上書きしない）
function syncInput(inp, remote) {
  remote = remote || ''
  if (inp._prev === undefined) { inp.value = remote; inp._prev = remote; return }
  if (remote !== inp._prev) { inp._prev = remote; if (inp.value !== remote) inp.value = remote }
}
const TIPS = [['none', '提示しない（非表示）', null, ''], ['ofuse', '☕ OFUSE', 'tipOfuse', 'URL または ユーザID'], ['amazon', '📦 ほしい物リスト', 'tipAmazon', 'URL または リストID'], ['zap', '⚡ Nostr Zap', 'tipZap', 'name@domain または npub'], ['kofi', '☕ Ko-fi', 'tipKofi', 'URL または ユーザ名'], ['bmac', '🥐 Buy Me Coffee', 'tipBmac', 'URL または ユーザ名']]
const SNS = [['𝕏 (Twitter)', 'snsX', 'URL または @ID', 'x', 'verX'], ['🐙 GitHub', 'snsGithub', 'URL または ユーザ名', 'github', 'verGithub'], ['📝 note', 'snsNote', 'URL または クリエイター名', null, null], ['📸 Instagram', 'snsInstagram', 'URL または ユーザ名', null, null], ['▶️ YouTube', 'snsYoutube', 'URL または @ハンドル', null, null], ['🟣 Nostr', 'snsNostr', 'URL または npub1...', 'nostr', 'verNostr']]
const CE = { tipRadio: {}, tipInput: {}, snsInput: {}, snsAct: {}, built: false }
function buildCardEdit() {
  CE.built = true
  const tips = $('ceTips'); tips.append(el('div', 'muted small', 'お礼・チップ窓口（提示する1件を選択）'))
  for (const [v, name, field, ph] of TIPS) {
    const row = el('label', 'ce-row'), r = el('input'); r.type = 'radio'; r.name = 'ceTipOpt'; r.value = v
    r.onchange = () => window.potalk.cmd({ type: 'ceTipOpt', v })
    row.append(r, el('span', 'ce-name' + (field ? ' w130' : ''), name)); CE.tipRadio[v] = r
    if (field) { const i = el('input'); i.placeholder = ph; i.oninput = () => window.potalk.cmd({ type: 'ceField', field, value: i.value }); row.append(i); CE.tipInput[field] = i }
    tips.append(row)
  }
  tips.append(el('div', 'muted tiny', '※ Amazonほしい物リストは配送先の本名や住所バレにご注意ください。'))
  const sns = $('ceSns'); sns.append(el('div', 'muted small', 'SNS ID（オプトイン本人確認対応）'))
  for (const [name, field, ph, key] of SNS) {
    const row = el('div', 'ce-row'), i = el('input'), act = el('span', 'ce-act')
    i.placeholder = ph; i.oninput = () => window.potalk.cmd({ type: 'ceField', field, value: i.value })
    row.append(el('span', 'ce-name w110', name), i, act); sns.append(row); CE.snsInput[field] = i; CE.snsAct[field] = act
  }
  sns.append(el('div', 'muted tiny', '※ 各サービスのプロフィールURLを貼ると自動でIDに切り詰めます。「認証」で本人確認すると、相手が「✅ を確かめる」を押したときに確認できます。'))
  $('ceBio').oninput = () => { window.potalk.cmd({ type: 'ceField', field: 'bio', value: $('ceBio').value.slice(0, 60) }); $('ceBioN').textContent = `${[...$('ceBio').value].length}/60` }
  $('ceNoImg').onchange = () => window.potalk.cmd({ type: 'ceNoImg', on: $('ceNoImg').checked })
  $('ceClose').onclick = () => window.potalk.cmd({ type: 'ceClose' })
  $('ceSave').onclick = () => window.potalk.cmd({ type: 'ceSave' })
  $('ceAvClear').onclick = () => window.potalk.cmd({ type: 'ceAvatarClear' })
  $('ceAvPick').onclick = () => $('ceAvFile').click()
  $('ceAvFile').onchange = () => { const f = $('ceAvFile').files[0]; $('ceAvFile').value = ''; if (!f) return; const rd = new FileReader(); rd.onload = () => openCrop(String(rd.result)); rd.readAsDataURL(f) }
}
function renderCardEdit() {
  if (!CE.built) buildCardEdit()
  const s = S.cards && S.cards.edit; if (!s) return
  const av = $('ceAv'); av.replaceChildren()
  if (s.img) { const im = el('img'); im.src = s.img; im.alt = ''; im.onerror = () => { av.replaceChildren(s.emoji) }; av.append(im) } else av.textContent = s.emoji
  if (s.sub) av.append(el('span', 'ce-sub', s.sub))
  $('ceAvClear').hidden = !s.clearShow
  const m = $('ceAvMsg'); m.hidden = !s.avatarMsg; m.textContent = s.avatarMsg || ''
  syncInput($('ceBio'), s.bio); $('ceBioN').textContent = `${[...$('ceBio').value].length}/60`
  for (const [v] of TIPS) CE.tipRadio[v].checked = s.tipOpt === v
  for (const [, , field] of TIPS) if (field) syncInput(CE.tipInput[field], s[field])
  for (const [, field, , key, vk] of SNS) {
    syncInput(CE.snsInput[field], s[field])
    const act = CE.snsAct[field]; act.replaceChildren()
    const ver = vk ? s[vk] : null
    if (key && ver) {
      if (ver.verified) { const b = el('button', 'chip-btn', '✅'); b.title = '認証済み（押すと解除）'; b.onclick = () => { if (confirm('認証を解除しますか？\n解除すると、相手の画面で ✅ が付かなくなります。')) window.potalk.cmd({ type: 'ceUnverify', k: key }) }; act.append(b) }
      else if (ver.btnShow) { const b = el('button', 'chip-btn', ver.btnLabel || '認証'); b.disabled = !!ver.btnDisabled; b.onclick = () => window.potalk.cmd({ type: 'ceVerify', k: key }); act.append(b) }
    } else if (!key) act.append(el('span', 'muted tiny', '自己申告'))
  }
  $('ceNoImg').checked = !!s.noImg
  const w = $('ceWarn'); w.hidden = !s.warn; w.textContent = s.warn || ''
}

// 画像の切り抜き：ドラッグで位置、つまみで大きさ。枠の中を 512×512 の JPEG にして、ページへ渡す（Mac 版と同じ）
function openCrop(src) {
  const img = new Image()
  img.onerror = () => { const m = $('ceAvMsg'); m.hidden = false; m.textContent = 'この画像は読み込めませんでした。' }
  img.onload = () => {
    const V = 300, ov = $('cropOv'); ov.replaceChildren(); ov.hidden = false
    let zoom = 1, ox = 0, oy = 0, sx = 0, sy = 0, dragging = false
    const base = Math.max(V / img.width, V / img.height), scale = () => base * zoom
    const clampO = (x, y) => ({ x: Math.min(0, Math.max(V - img.width * scale(), x)), y: Math.min(0, Math.max(V - img.height * scale(), y)) })
    const origin = () => clampO((V - img.width * scale()) / 2 + ox, (V - img.height * scale()) / 2 + oy)
    const cv = el('canvas', 'crop-cv'); cv.width = V; cv.height = V
    const draw = () => { const c = cv.getContext('2d'), o = origin(); c.fillStyle = '#fff'; c.fillRect(0, 0, V, V); c.drawImage(img, o.x, o.y, img.width * scale(), img.height * scale()) }
    cv.onpointerdown = e => { dragging = true; sx = e.clientX - ox; sy = e.clientY - oy; cv.setPointerCapture(e.pointerId) }
    cv.onpointermove = e => { if (!dragging) return; ox = e.clientX - sx; oy = e.clientY - sy; draw() }
    cv.onpointerup = () => { dragging = false; const o = origin(); ox = o.x - (V - img.width * scale()) / 2; oy = o.y - (V - img.height * scale()) / 2 }
    const zr = el('input'); zr.type = 'range'; zr.min = 1; zr.max = 4; zr.step = 0.01; zr.value = 1; zr.oninput = () => { zoom = Number(zr.value); draw() }
    const done = ok => {
      ov.hidden = true; ov.replaceChildren()
      if (!ok) return
      const o = origin(), out = el('canvas'); out.width = 512; out.height = 512
      const c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 512, 512); c.imageSmoothingQuality = 'high'
      c.drawImage(img, -o.x / scale(), -o.y / scale(), V / scale(), V / scale(), 0, 0, 512, 512)
      const b64 = out.toDataURL('image/jpeg', 0.85).split(',')[1]
      window.potalk.cmd({ type: 'ceAvatarFile', b64, name: 'avatar.jpg', mime: 'image/jpeg' })
    }
    const yes = el('button', 'yes-blue', '決定'), no = el('button', '', 'やめる'); yes.onclick = () => done(true); no.onclick = () => done(false)
    const bt = el('div', 'ask-btns'); bt.append(no, yes)
    const box = el('div', 'card-box crop-box'); box.append(el('div', 'card-name', '画像の位置を決める'), el('div', 'card-state', 'ドラッグで位置、つまみで大きさを調整します。枠の中が名刺の画像になります。'), cv, zr, bt)
    ov.append(box); draw()
  }
  img.src = src
}

// ---- 本人確認（X・GitHub・Nostr）----
const CA = { built: false, copied: '' }
function buildCardAuth() {
  CA.built = true
  const b = $('caBody')
  b.append(el('h2', 'ce-h', ''), el('div', 'card-foot', ''), el('div', 'small', ''))
  const code = el('div', 'ce-sec'); code.id = 'caCodeBox'; code.append(el('div', 'muted small', 'あなたの名刺の鍵'))
  const cr = el('div', 'ca-box'); cr.append(el('div', 'mono', ''), el('button', 'chip-btn', '📋 鍵の行をコピー')); code.append(cr)
  const post = el('div', 'ce-sec'); post.id = 'caPostBox'
  const pt = el('div', 'ca-box'); pt.append(el('div', '', '')); const pb = el('div', 'row2'); pb.append(el('button', 'chip-btn', '𝕏 でポストする'), el('button', 'chip-btn', '📋 投稿文をコピー')); post.append(pt, pb)
  const inp = el('div', 'ce-sec'); inp.id = 'caInputBox'; const i = el('input'); i.placeholder = 'https://x.com/ユーザー名/status/...'; i.oninput = () => window.potalk.cmd({ type: 'caInput', value: i.value }); inp.append(el('div', 'muted small', '投稿したポストのリンク（共有URL）'), i)
  b.append(code, post, inp, el('div', 'small', ''), el('div', 'muted small', ''))
  $('caCancel').onclick = () => window.potalk.cmd({ type: 'caCancel' })
  $('caVerify').onclick = () => window.potalk.cmd({ type: 'caVerify' })
}
function copyFeedback(btn, text, label) { window.potalk.copyText(text); btn.textContent = '✅ コピー済'; setTimeout(() => { btn.textContent = label }, 1500) }
function renderCardAuth() {
  if (!CA.built) buildCardAuth()
  const a = S.cards && S.cards.auth; if (!a) return
  const b = $('caBody'), k = b.children
  k[0].textContent = a.title; k[1].textContent = a.account; k[2].textContent = a.desc
  const cb = $('caCodeBox'); cb.hidden = !a.codeShow
  if (a.codeShow) { cb.querySelector('.mono').textContent = a.code; const btn = cb.querySelector('button'); btn.onclick = () => copyFeedback(btn, a.code, '📋 鍵の行をコピー') }
  const pb = $('caPostBox'); pb.hidden = !a.postShow
  if (a.postShow) { pb.querySelector('.ca-box div').textContent = a.post; const [tw, cp] = pb.querySelectorAll('button'); tw.onclick = () => window.potalk.openExternal(a.tweet); cp.onclick = () => copyFeedback(cp, a.post, '📋 投稿文をコピー') }
  const ib = $('caInputBox'); ib.hidden = !a.inputShow
  if (a.inputShow) syncInput(ib.querySelector('input'), a.input)
  const msg = k[k.length - 2]; msg.textContent = a.msg || ''; msg.className = 'small ' + (a.msgBad ? 'bad-text' : 'good-text')
  k[k.length - 1].textContent = a.note || ''
  const v = $('caVerify'); v.textContent = a.verifyLabel || '確認する'; v.disabled = !!a.verifyDisabled
}

// ---- プロフィール（名前・アバター・名刺）。ロビーの自分のチップ、または、メニューから ----
let profileOpen = false
function openProfile() { profileOpen = true; $('profileOv').hidden = false; const n = $('pfNameIn'); if (n) n._prev = undefined; renderProfile() }
function renderProfile() {
  const ov = $('profileOv')
  if (!profileOpen || !S.profile) { ov.hidden = true; return }
  ov.hidden = false
  if (!$('pfNameIn')) {
    const box = el('div', 'card-box'); box.id = 'pfBox'
    const inp = el('input'); inp.id = 'pfNameIn'; inp.maxLength = 20; inp.placeholder = 'ゲスト'; inp.oninput = () => window.potalk.cmd({ type: 'setName', name: inp.value.slice(0, 20) })
    const grid = el('div', 'pf-grid'); grid.id = 'pfGrid'
    const b1 = el('button', 'chip-btn wide-btn', '📇 名刺（プロフィールカード）を設定…'); b1.onclick = () => window.potalk.cmd({ type: 'cardEdit' })
    const b2 = el('button', 'chip-btn wide-btn', '🛡 自衛ワードを登録…（含む部屋を一覧に出さない）'); b2.onclick = () => { profileOpen = false; renderProfile(); openBanned() }
    const done = el('button', 'primary', '閉じる'); done.onclick = () => { profileOpen = false; renderProfile() }
    const mk = (key, text) => { const lab = el('label', 'set-row'), c = el('input'); c.type = 'checkbox'; c.dataset.pref = key; c.onchange = () => window.potalk.setPref(key, c.checked); lab.append(c, el('span', 'small', text)); return lab }
    box.append(el('div', 'card-name', '🫖 ぽっと通話'), el('div', 'muted small', 'あなたの名前'), inp, el('div', 'muted small', 'アバター'), grid, b1, b2, el('div', 'muted small', '部屋に入るとき'), mk('muteOnCreate', '部屋を作るとき、ミュートで始める'), mk('muteOnJoin', '部屋に入るとき、ミュートで始める'), el('div', 'muted tiny', '名前・アバターを変えると、次に入る部屋から反映されます。'), done)
    ov.append(box)
  }
  const inp = $('pfNameIn'); syncInput(inp, S.profile.input || S.profile.name || '')
  for (const c of document.querySelectorAll('#pfBox input[data-pref]')) c.checked = (S.wins.prefs || {})[c.dataset.pref] !== false
  const grid = $('pfGrid'); grid.replaceChildren()
  ;(S.profile.avatars || []).forEach((a, i) => { const on = a.on || a.em === S.profile.emoji; const b = el('button', 'pf-av' + (on ? ' on' : ''), a.em); b.onclick = () => window.potalk.cmd({ type: 'setAvatar', i }); grid.append(b) })
}
$('me').onclick = () => openProfile()
$('profileOv').onclick = e => { if (e.target === $('profileOv')) { profileOpen = false; renderProfile() } }

// ---- 全体 ----
function render() {
  const joined = !!(S.room && S.room.joined)
  if (KIND === 'single' || KIND === 'lobby') syncMinWidth()      // ロビー⇄部屋の切り替えで、最小の幅を測り直す
  if (S.wasJoined && !joined) { S.chat = []; S.unread = 0; S.warned.clear(); if (KIND === 'single') S.tab = 'room'; if (S.chatOpen) setChatOpen(false, true) }
  S.wasJoined = joined
  if (KIND === 'cardedit' || KIND === 'cardauth') { $('lobby').hidden = true; $('room').hidden = true; $('cardEditView').hidden = KIND !== 'cardedit'; $('cardAuthView').hidden = KIND !== 'cardauth'; if (KIND === 'cardedit') renderCardEdit(); else renderCardAuth(); return }
  renderPin(); renderSpk(); renderHandle(); renderProfile()
  if (KIND === 'lobby' || KIND === 'drawer') { $('lobby').hidden = false; $('room').hidden = true; renderLobby(); return }
  $('lobby').hidden = KIND !== 'single' || joined; $('room').hidden = !joined
  if (!joined) { if (KIND === 'single') renderLobby(); return }
  if (KIND === 'single' || KIND === 'room') { renderRoom(); renderEq(S.eq) }
  else if (KIND === 'mail') renderMail()
  else if (KIND === 'settings') renderSettings()
  if (KIND !== 'mail' && KIND !== 'settings') renderChat()
  renderTabs()
}

window.potalk.onState(({ t, d }) => {
  if (t === 'eq') { S.eq = d || ''; if (S.room && S.room.joined) renderEq(S.eq); return }
  if (t === 'ui') { uiAction(d || {}); return }
  if (t === 'devices') { S.devices = d || []; if (!$('micMenu').hidden) renderMicMenu(); return }
  if (t === 'linkResult') { const r = d && d.r; if (r === 'joined') return; const msg = { asleep: 'この部屋は見つかりません。存在しないか、すでに終了しています。', invalid: 'この部屋は見つかりません。存在しないか、すでに終了しています。', choose: '同じ名前の部屋が、いくつか開いています。一覧から選んでください。', timeout: '部屋に入れませんでした。もう一度お試しください。' }[r]; if (msg && (KIND === 'single' || KIND === 'lobby')) alert('部屋に入れません\n' + msg); return }
  if (t === 'chatClear') { S.chat = []; S.unread = 0; S.warned.clear(); if (S.room && S.room.joined) renderChat(); return }
  if (t === 'wins') { const was = S.wins.chat; S.wins = d || {}; if (S.wins.chat && !was) S.unread = 0; render(); return }
  if (t === 'chat' && d) { S.chat.push(d); if (!d.sys && !d.hist && !chatVisible()) S.unread++; if (S.room && S.room.joined && (KIND === 'single' || KIND === 'chat' || KIND === 'room')) renderChat(); return }
  if (!['lobby', 'profile', 'room', 'cards'].includes(t)) return
  S[t] = d; render()
})
window.potalk.snapshot().then(s => { Object.assign(S, { lobby: s.lobby, profile: s.profile, room: s.room, eq: s.eq || '', chat: s.chat || [], wins: s.wins || {}, cards: s.cards || null, devices: s.devices || [] }); if (KIND === 'chat') $('chatOpen').hidden = false; render() })

for (const b of document.querySelectorAll('#tabs button[data-tab]')) b.onclick = () => { S.tab = b.dataset.tab; renderTabs() }
$('chatToggle').onclick = () => setChatOpen(!S.chatOpen)
const sendChat = () => { const i = $('chatText'), t = i.value.trim(); if (t) { window.potalk.cmd({ type: 'chat', text: t }); i.value = ''; $('chatCount').textContent = '0/60' } }
$('chatSend').onclick = sendChat
$('chatText').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) sendChat() }
$('chatText').oninput = () => { $('chatCount').textContent = `${$('chatText').value.length}/60` }
$('search').oninput = () => renderLobby()
$('btnRefresh').onclick = () => window.potalk.cmd({ type: 'refreshLobby' })
$('btnNew').onclick = () => { const r = $('createRow'); r.hidden = !r.hidden; $('createKind').hidden = r.hidden; if (!r.hidden) $('newName').focus() }
$('btnHelp').onclick = () => openHelp()
$('btnNotify').onclick = () => window.potalk.setPref('notifyRooms', (S.wins.prefs || {}).notifyRooms === false)
$('micBtn').onclick = () => openMicMenu($('micBtn'))
$('btnMic2').onclick = () => openMicMenu($('btnMic2'))
$('btnCreate').onclick = () => { const n = $('newName').value.trim(); if (n) { const k = (document.querySelector('input[name=ckind]:checked') || {}).value === 'bc' ? 'bc' : 'chat'; window.potalk.cmd({ type: 'create', name: n, kind: k }); $('newName').value = ''; $('createRow').hidden = true; $('createKind').hidden = true } }
$('newName').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('btnCreate').click() }
$('btnRetry').onclick = () => window.potalk.cmd({ type: 'reconnect' })
$('btnMute').onclick = () => window.potalk.cmd({ type: $('btnMute').dataset.act || 'mute' })
$('btnLeave').onclick = () => window.potalk.cmd({ type: 'leave' })
$('btnPin').onclick = $('btnPin2').onclick = $('btnPin3').onclick = () => window.potalk.togglePin()
let shareTimer = 0
$('btnShare').onclick = () => {
  const u = S.room && S.room.share; if (!u) return
  window.potalk.copyText(u)
  const b = $('btnShare'); b.replaceChildren('✓ コピーしました'); b.title = 'コピーしました'; b.classList.add('done')
  clearTimeout(shareTimer); shareTimer = setTimeout(() => { b.replaceChildren(el('span', 'emoji', '🔗'), ' リンクの取得'); b.title = 'この部屋のURLをコピー'; b.classList.remove('done') }, 1600)
}
$('btnSpk').onclick = () => window.potalk.toggleSpk()
$('handle').onclick = () => window.potalk.toggleDrawer()
$('btnChatWin').onclick = () => window.potalk.toggleWin('chat')
$('btnMailWin').onclick = () => window.potalk.toggleWin('mail')
$('btnSetWin').onclick = () => window.potalk.toggleWin('settings')
// 自衛ワードは、ほかの窓で変えても、すぐ反映する
window.addEventListener('storage', e => { if (e.key === 'bannedWords') { banned = loadBanned(); render() } })
window.potalk.setBanned(banned)

// ひとことの上のハンドル：上下にドラッグすると、窓の高さが変わる。ひとこと欄は、大きさを変えず、ハンドルと一緒に動く。
// 窓は、メンバーが 4 人分は見える高さより、小さくならない（main.js の最小の高さ）
{
  const grip = document.querySelector('.chat-grip'); let drag = null
  grip.onpointerdown = e => { if (!S.chatOpen) return; drag = { y: e.screenY }; grip.setPointerCapture(e.pointerId); window.potalk.dragStart(memberSlack()) }
  grip.onpointermove = e => { if (drag) window.potalk.dragMove(e.screenY - drag.y) }
  const end = () => { drag = null }
  grip.onpointerup = end; grip.onpointercancel = end
}

// メンバーが 4 人分は見える高さを、窓の最小の高さにする（ひとことを開いているときは、その分も、自動で入る）
let minSync = 0, sentNeedH = null
// ロビーの窓の最小の幅：各行が、折り返さずに並ぶ幅（行を、見えない所に複製して、そのままの幅を測る）
// ロビーの窓の最小の幅：各行が、折り返さずに並ぶ幅（行を、見えない所に複製して、そのままの幅を測る。人数の文字は、長さが変わるので、数えない）
function naturalWidth(row) {
  const c = row.cloneNode(true)
  c.querySelectorAll('#viewers').forEach(e => e.remove())
  c.removeAttribute('id'); c.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'))
  c.style.cssText = 'position:absolute;left:-99999px;top:0;width:max-content;max-width:none;visibility:hidden'
  row.parentNode.append(c); const w = c.getBoundingClientRect().width; c.remove(); return w
}
let minWSync = 0, sentNeedW = null
function syncMinWidth() {
  cancelAnimationFrame(minWSync)
  minWSync = requestAnimationFrame(() => {
    if (KIND !== 'single' && KIND !== 'lobby') return
    if (!S.wins.scale) return      // 表示サイズが分かるまでは、測らない（100% だと思って測ると、窓が広がってしまう）
    if ($('lobby').hidden) { if (sentNeedW !== -1) { sentNeedW = -1; window.potalk.setMinWidth(1e6) } return }      // 部屋の画面のときは、ふだんの最小に戻す
    if (KIND === 'single' && sentNeedH !== -1) { sentNeedH = -1; window.potalk.setMinHeight(1e6) }      // ロビーでは、部屋用の最小の高さ（メンバー 4 人分）を、解除する
    const rows = [...document.querySelectorAll('#lobby .bar, #lobby .bar2, #lobby .create, #lobby .searchrow, #lobby .foot')].filter(r => r.offsetParent !== null)
    const z = (S.wins.scale || 100) / 100, need = (Math.max(0, ...rows.map(naturalWidth)) + 4) * z, cur = document.documentElement.clientWidth * z
    if (sentNeedW !== null && Math.abs(need - sentNeedW) < 1 && cur >= need) return
    sentNeedW = need; window.potalk.setMinWidth(cur - need)
  })
}
window.addEventListener('resize', syncMinWidth)

// メンバー一覧の、4 人分に対する余裕（DIP。足りないときは負）。行の高さは、実際の画面から測る
function memberSlack() {
  const m = $('members'), row = document.querySelector('#members .member')
  if (!m.clientHeight) return 1e6      // メンバー一覧が隠れているタブでは、制限しない
  const rowH = row ? row.getBoundingClientRect().height : 42
  return (m.clientHeight - (rowH * 4 + 16)) * ((S.wins.scale || 100) / 100)
}
function syncMinHeight() {
  cancelAnimationFrame(minSync)
  minSync = requestAnimationFrame(() => {
    const m = $('members'); if (!m || !m.clientHeight || $('room').hidden || growing || !S.wins.scale) return
    // 一覧より外の高さ + 4 人分：窓の高さが変わっても、変わらない値。変わったときと、窓が足りないときだけ送る
    const row = document.querySelector('#members .member'), rowH = row ? row.getBoundingClientRect().height : 42
    const key = (window.innerHeight - m.clientHeight) + rowH * 4 + 16, slack = memberSlack()
    if (sentNeedH !== null && Math.abs(key - sentNeedH) < 1 && slack >= 0) return
    sentNeedH = key; window.potalk.setMinHeight(slack)
  })
}
window.addEventListener('resize', syncMinHeight)
