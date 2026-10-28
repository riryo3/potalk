'use strict'
const $ = id => document.getElementById(id)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
const CHAT_H = 221      // ひとこと用ドロワーを開いたとき、窓が伸びる高さ（ドロワー本体 220 + 区切り 1）
const S = { lobby: null, profile: null, room: null, eq: '', dismissed: '', tab: 'room', chat: [], unread: 0, chatOpen: false, wasJoined: false, warned: new Set(), sliding: false }

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
    top.append(el('span', 'room-name', (r.bc ? '📣 ' : '') + r.name), el('span', 'room-count', r.count))
    card.append(top)
    if (r.sub) card.append(el('div', 'room-sub', '🏷 ' + r.sub))
    if (r.dur) card.append(el('div', 'room-dur', r.dur))
    const people = el('div', 'people')
    for (const m of (r.people || [])) people.append(el('span', 'person', `${m.em} ${m.name}${m.muted ? ' 🔇' : ''}`))
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
  if (!r.bcast && S.tab === 'mail') S.tab = 'room'

  // 自衛ワードを含む名前の人が入ったら、1人につき1回、通知する（部屋を出るまで）
  const hits = []
  for (const m of r.members) {
    if (m.you) continue
    const w = banned.length ? matchWord([m.name]) : null
    if (!w) continue
    hits.push({ name: m.name, w })
    if (!S.warned.has(m.name)) { S.warned.add(m.name); window.potalk.notify('自衛ワードを含む名前の人がいます', `${m.name}（登録ワード：${w}）`) }
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
    row.append(el('span', 'em', m.em), el('span', 'mic' + (m.muted ? ' off' : ''), m.muted ? '🔇' : ''),
      el('span', 'conn', m.conn === 'relay' ? '☁︎' : m.conn === 'direct' ? '⇄' : ''),
      el('span', 'name', (m.mark ? m.mark + ' ' : '') + m.name + (m.you ? '（あなた）' : '')))
    box.append(row)
  })
  if (r.more) box.append(el('div', 'muted small', r.more))
  const rx = $('reactions'); rx.replaceChildren()
  r.reactions.forEach((e, i) => { const x = el('button', 'react', e); x.onclick = () => window.potalk.cmd({ type: 'react', i }); rx.append(x) })
  const mute = $('btnMute'); mute.hidden = !r.canMute; mute.textContent = r.muted ? '🔇 ミュート解除' : '🎙 ミュート'
  mute.className = 'wide' + (r.muted ? ' muted' : '')
  renderTabs(); renderSettings(); renderMail()
}

function renderTabs() {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === S.tab)
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
  if (S.wasJoined && !joined) { S.chat = []; S.unread = 0; S.warned.clear(); S.tab = 'room'; if (S.chatOpen) setChatOpen(false) }
  S.wasJoined = joined
  $('lobby').hidden = joined; $('room').hidden = !joined
  if (joined) { renderRoom(); renderChat(); $('eq').textContent = S.eq } else renderLobby()
}

window.potalk.onState(({ t, d }) => {
  if (t === 'eq') { S.eq = d || ''; if (S.room && S.room.joined) $('eq').textContent = S.eq; return }
  if (t === 'chat' && d) { S.chat.push(d); if (!d.sys && !d.hist && !S.chatOpen) S.unread++; if (S.room && S.room.joined) renderChat(); return }
  if (!['lobby', 'profile', 'room'].includes(t)) return
  S[t] = d; render()
})
window.potalk.snapshot().then(s => { Object.assign(S, { lobby: s.lobby, profile: s.profile, room: s.room, eq: s.eq || '' }); render() })

for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => { S.tab = b.dataset.tab; renderTabs() }
$('chatToggle').onclick = () => setChatOpen(!S.chatOpen)
const sendChat = () => { const i = $('chatText'), t = i.value.trim(); if (t) { window.potalk.cmd({ type: 'chat', text: t }); i.value = ''; $('chatCount').textContent = '0/60' } }
$('chatSend').onclick = sendChat
$('chatText').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) sendChat() }
$('chatText').oninput = () => { $('chatCount').textContent = `${$('chatText').value.length}/60` }
$('search').oninput = () => renderLobby()
$('btnRefresh').onclick = () => window.potalk.cmd({ type: 'refreshLobby' })
$('btnCreate').onclick = () => { const n = $('newName').value.trim(); if (n) { window.potalk.cmd({ type: 'create', name: n, kind: 'chat' }); $('newName').value = '' } }
$('newName').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('btnCreate').click() }
$('btnRetry').onclick = () => window.potalk.cmd({ type: 'reconnect' })
$('btnMute').onclick = () => window.potalk.cmd({ type: 'mute' })
$('btnLeave').onclick = () => window.potalk.cmd({ type: 'leave' })
