'use strict'
const $ = id => document.getElementById(id)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
// 窓の種類：single（ひとつの窓）／ lobby・room・chat・mail・settings（分けた窓）。main.js が ?w= で教える
const KIND = new URLSearchParams(location.search).get('w') || 'single'
document.body.dataset.w = KIND
const CHAT_H = 221      // ひとこと用ドロワーを開いたとき、窓が伸びる高さ（ドロワー本体 220 + 区切り 1）
const S = { lobby: null, profile: null, room: null, eq: '', dismissed: '', tab: { mail: 'mail', settings: 'settings' }[KIND] || 'room', chat: [], wins: {}, unread: 0, chatOpen: false, wasJoined: false, warned: new Set(), sliding: false }

// ---- 自衛ワード（含む部屋・人を、一覧に出さない。全角半角・大文字小文字・ひらがなカタカナは区別しない）----
const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
const loadBanned = () => { try { const a = JSON.parse(localStorage.getItem('bannedWords') || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }
let banned = loadBanned()                       // 新しく登録したものが先頭
const saveBanned = () => { try { localStorage.setItem('bannedWords', JSON.stringify(banned)) } catch {} }
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
  const q = fold($('search').value)
  const box = $('rooms'); box.replaceChildren()
  const rooms = (l ? l.rooms : []).filter(r => !roomWord(r)).filter(r => !q || [r.name, r.sub, ...(r.people || []).map(m => m.name)].some(x => fold(x).includes(q)))
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
    card.onclick = () => { if (r.id) window.potalk.cmd({ type: 'join', id: r.id, quiet: false }) }
    box.append(card)
  }
  if (!rooms.length) box.append(el('div', 'empty', l && l.rooms.length ? '表示できる部屋は、ありません' : '通話中の部屋は、まだありません'))
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
  const tag = $('tagRow'); tag.hidden = !r.tag.show; tag.textContent = '🏷 ' + (r.tag.text || '話題はまだありません')
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
  r.members.forEach(m => {
    const row = el('div', 'member' + (m.speaking ? ' speaking' : '') + (m.you ? ' you' : ''))
    const mic = el('span', 'mic'); if (m.muted) mic.append(micOff())
    row.append(el('span', 'em', m.em), mic,
      (() => { const c = el('span', 'conn'); if (m.conn === 'relay' || m.conn === 'direct') c.append(connIcon(m.conn)); return c })(),
      el('span', 'name', m.name + (m.you ? '（あなた）' : '')))
    if (m.mark) row.append(el('span', 'mark', m.mark))
    box.append(row)
  })
  renderLegend()
  if (r.more) box.append(el('div', 'muted small', r.more))
  const rx = $('reactions'); rx.replaceChildren()
  r.reactions.forEach((e, i) => { const x = el('button', 'react', e); x.onclick = () => window.potalk.cmd({ type: 'react', i }); rx.append(x) })
  const mute = $('btnMute'); mute.hidden = !r.canMute; mute.textContent = r.muted ? '🔇 ミュート解除' : '🎙 ミュート'
  mute.className = 'wide' + (r.muted ? ' muted' : '')
  if (KIND === 'single') { renderTabs(); renderSettings(); renderMail() }
  renderWinBtns()
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
function renderPin() { for (const id of ['btnPin', 'btnPin2']) $(id).classList.toggle('on', !!S.wins.pinned) }

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
function setChatOpen(open) {
  if (open === S.chatOpen) return
  S.chatOpen = open; if (open) S.unread = 0
  $('chatOpen').hidden = !open
  window.potalk.growBy(open ? CHAT_H : -CHAT_H)
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

// ---- 全体 ----
function render() {
  const joined = !!(S.room && S.room.joined)
  if (S.wasJoined && !joined) { S.chat = []; S.unread = 0; S.warned.clear(); if (KIND === 'single') S.tab = 'room'; if (S.chatOpen) setChatOpen(false) }
  S.wasJoined = joined
  renderPin()
  if (KIND === 'lobby') { $('lobby').hidden = false; $('room').hidden = true; renderLobby(); return }
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
  if (t === 'wins') { const was = S.wins.chat; S.wins = d || {}; if (S.wins.chat && !was) S.unread = 0; render(); return }
  if (t === 'chat' && d) { S.chat.push(d); if (!d.sys && !d.hist && !chatVisible()) S.unread++; if (S.room && S.room.joined && (KIND === 'single' || KIND === 'chat' || KIND === 'room')) renderChat(); return }
  if (!['lobby', 'profile', 'room'].includes(t)) return
  S[t] = d; render()
})
window.potalk.snapshot().then(s => { Object.assign(S, { lobby: s.lobby, profile: s.profile, room: s.room, eq: s.eq || '', chat: s.chat || [], wins: s.wins || {} }); if (KIND === 'chat') $('chatOpen').hidden = false; render() })

for (const b of document.querySelectorAll('#tabs button[data-tab]')) b.onclick = () => { S.tab = b.dataset.tab; renderTabs() }
$('chatToggle').onclick = () => setChatOpen(!S.chatOpen)
const sendChat = () => { const i = $('chatText'), t = i.value.trim(); if (t) { window.potalk.cmd({ type: 'chat', text: t }); i.value = ''; $('chatCount').textContent = '0/60' } }
$('chatSend').onclick = sendChat
$('chatText').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) sendChat() }
$('chatText').oninput = () => { $('chatCount').textContent = `${$('chatText').value.length}/60` }
$('search').oninput = () => renderLobby()
$('btnRefresh').onclick = () => window.potalk.cmd({ type: 'refreshLobby' })
$('btnNew').onclick = () => { const r = $('createRow'); r.hidden = !r.hidden; if (!r.hidden) $('newName').focus() }
$('btnCreate').onclick = () => { const n = $('newName').value.trim(); if (n) { window.potalk.cmd({ type: 'create', name: n, kind: 'chat' }); $('newName').value = ''; $('createRow').hidden = true } }
$('newName').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('btnCreate').click() }
$('btnRetry').onclick = () => window.potalk.cmd({ type: 'reconnect' })
$('btnMute').onclick = () => window.potalk.cmd({ type: 'mute' })
$('btnLeave').onclick = () => window.potalk.cmd({ type: 'leave' })
$('btnPin').onclick = $('btnPin2').onclick = () => window.potalk.togglePin()
$('btnChatWin').onclick = () => window.potalk.toggleWin('chat')
$('btnMailWin').onclick = () => window.potalk.toggleWin('mail')
$('btnSetWin').onclick = () => window.potalk.toggleWin('settings')
// 自衛ワードは、ほかの窓で変えても、すぐ反映する
window.addEventListener('storage', e => { if (e.key === 'bannedWords') { banned = loadBanned(); render() } })
