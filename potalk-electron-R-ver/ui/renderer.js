'use strict'
const $ = id => document.getElementById(id)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
const S = { lobby: null, profile: null, room: null, eq: '', dismissed: '' }

// 状態の文言「通話中：部屋の名前」を、状態と部屋の名前に分ける
function splitState(t) {
  t = t || '未参加'
  for (const sep of ['：', '｜']) {
    const i = t.indexOf(sep)
    if (i > 0 && i < t.length - 1) return { status: t.slice(0, i).trim(), title: t.slice(i + 1).trim() }
  }
  return { status: '', title: t }
}
const isBad = t => /失敗|切断|エラー|できません/.test(t || '')

function renderLobby() {
  const l = S.lobby, p = S.profile
  $('me').textContent = p ? `${p.emoji || ''} ${p.name || 'ゲスト'}` : ''
  $('viewers').textContent = l ? l.viewers : ''
  const box = $('rooms'); box.replaceChildren()
  for (const r of (l ? l.rooms : [])) {
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
  if (l && !l.rooms.length) box.append(el('div', 'empty', '通話中の部屋は、まだありません'))
}

function renderRoom() {
  const r = S.room
  const { status, title } = splitState(r.state)
  $('roomTitle').textContent = title
  const b = $('roomStatus'); b.textContent = status; b.hidden = !status
  b.className = 'badge ' + (isBad(r.state) ? 'bad' : r.state.includes('通話中') ? 'ok' : 'busy')
  $('roomCount').textContent = `${r.members.length}人`
  const tag = $('tagRow'); tag.hidden = !r.tag.show; tag.textContent = '🏷 ' + (r.tag.text || '話題はまだありません')
  // エラー・お知らせの帯（状態の文言のエラー、ページの #peerNotice・#audioWarn）
  const msgs = []
  if (isBad(r.state)) msgs.push({ t: r.state, bad: true })
  if (r.notice && r.notice !== S.dismissed) msgs.push({ t: r.notice, bad: /^🔌|失敗|できません/.test(r.notice), dismiss: true })
  if (r.audioWarn) msgs.push({ t: r.audioWarn, bad: false })
  const ban = $('banner'); ban.replaceChildren(); ban.hidden = !msgs.length
  for (const m of msgs) {
    const d = el('div', 'banner-item ' + (m.bad ? 'bad' : 'warn'), m.t)
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
  const rx = $('reactions'); rx.replaceChildren()
  r.reactions.forEach((e, i) => { const b = el('button', 'react', e); b.onclick = () => window.potalk.cmd({ type: 'react', i }); rx.append(b) })
  const mute = $('btnMute'); mute.hidden = !r.canMute; mute.textContent = r.muted ? '🔇 ミュート解除' : '🎙 ミュート'
  mute.className = 'wide' + (r.muted ? ' muted' : '')
}

function render() {
  const joined = !!(S.room && S.room.joined)
  $('lobby').hidden = joined; $('room').hidden = !joined
  if (joined) { renderRoom(); $('eq').textContent = S.eq } else renderLobby()
}

window.potalk.onState(({ t, d }) => {
  if (t === 'eq') { S.eq = d || ''; if (S.room && S.room.joined) $('eq').textContent = S.eq; return }
  if (!['lobby', 'profile', 'room'].includes(t)) return
  S[t] = d; render()
})
window.potalk.snapshot().then(s => { Object.assign(S, { lobby: s.lobby, profile: s.profile, room: s.room, eq: s.eq || '' }); render() })

$('btnRefresh').onclick = () => window.potalk.cmd({ type: 'refreshLobby' })
$('btnCreate').onclick = () => { const n = $('newName').value.trim(); if (n) { window.potalk.cmd({ type: 'create', name: n, kind: 'chat' }); $('newName').value = '' } }
$('newName').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('btnCreate').click() }
$('btnRetry').onclick = () => window.potalk.cmd({ type: 'reconnect' })
$('btnMute').onclick = () => window.potalk.cmd({ type: 'mute' })
$('btnLeave').onclick = () => window.potalk.cmd({ type: 'leave' })
