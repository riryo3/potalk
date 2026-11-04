'use strict'
// potalk.app の index.html に小さな差し込みを当てる（Mac 版 PagePatcher.swift・Windows 版 PagePatcher.cs・Linux 版 patcher.py と同じ内容）。
// 差し込み位置が見つからない／2つ以上あるときは、元のページをそのまま使う（ページの作りが変わっても、壊れたページを読み込まないための安全弁）
const fs = require('fs')
const path = require('path')

const append = extra => found => found + extra
const prepend = extra => found => extra + found
const constant = value => () => value

const PATCHES = [
  // 名刺と「無視」の確認は、こちらの画面に出すので、ページ内ではモーダルにしない
  ["try { $('cardDlg').showModal() } catch {}", constant("try { $('cardDlg').show() } catch {}")],
  ["try { $('ignoreDlg').showModal() } catch { doIgnore(id) }", constant("try { $('ignoreDlg').show() } catch { doIgnore(id) }")],
  ["cardKeyLoad(false).catch(() => {})\nconst CARD_NOSTR_KIND", constant("const CARD_NOSTR_KIND")],
  ["      sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {", constant(
    "      const _pc = loadCard()\n" +
    "      if (_pc.proofs && Object.keys(_pc.proofs).length) cardKeyLoad(false).catch(() => {}).then(() => sendTo(call.cardAction, myCardPayload(), peerId))\n" +
    "      else sendTo(call.cardAction, myCardPayload(), peerId)\n" +
    "    } else if (data.k === 'res') {")],
  ["try { $('cropDlg').showModal() } catch { finish(null) }", constant("try { $('cropDlg').show() } catch { finish(null) }")],
  ["try { $('cardEditDlg').showModal() } catch {}", constant("try { $('cardEditDlg').show() } catch {}")],
  ["try { $('cardAuthDlg').showModal() } catch {}", constant("try { $('cardAuthDlg').show() } catch {}")],
  // 共有する URL には、部屋の名前（&name=…）を付けない（部屋の ID だけで入れる）
  ["const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id + (name ? '&name=' + encodeURIComponent(name) : '')",
    constant("const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id")],
  ["btn.onclick = () => askRoom(room, lobbyName(room, people))", prepend("btn.dataset.room = room; ")],
  // ひとこと着信音：相手のひとこと（自分の分・履歴は除く）が届いたら、ピコンと鳴らす。設定の「🔔」並びにスイッチを足す（既定オン・ブラウザの localStorage に保存）
  ["id=\"sndReact\"> 🎵 リアクションを音で鳴らす</label>", append("\n      <label class=\"snd-opt\" id=\"sndChatRow\"><input type=\"checkbox\" id=\"sndChat\"> 💬 ひとことが届いたら音で鳴らす</label>")],
  ["const seenRooms = new Set()", prepend("const SND_CHAT_KEY = 'pot-call-snd-chat'\nlet sndChat = lsGet(SND_CHAT_KEY) !== '0'   // 未保存＝オン\nconst soundChat = () => { if (sndChat) playTones([[880, 0, 0.07], [1175, 0.07, 0.12]]) }   // 短いピコン＝ひとこと\n")],
  ["  reactBox.onchange = () => {\n", prepend("  { const chatBox = $('sndChat'); chatBox.checked = sndChat; chatBox.onchange = () => { sndChat = chatBox.checked; lsSet(SND_CHAT_KEY, sndChat ? '1' : '0'); if (sndChat) { try { ensureAudioCtx() } catch {} ; soundChat() } } }\n")],
  ["const logChat = (uid, text) => {\n  const me = uid === 'self'\n", append("  if (!me) { try { soundChat() } catch {} }\n")],
  ["const flyReaction = (uid, idx) => {\n", append("  try { window.__pm && window.__pm.react(uid, idx, REACTIONS[idx], uid === 'self' ? '' : ((call.profiles.get(uid) || {}).name || '')) } catch {}\n")],
]

/** 戻り値: { html, ok, missing }。どれか1つでも位置が見つからない／2つ以上あるときは、元の html を返す */
function apply(html) {
  let out = html
  for (const [find, replace] of PATCHES) {
    const first = out.indexOf(find)
    if (first < 0) return { html, ok: false, missing: find }
    if (out.indexOf(find, first + find.length) >= 0) return { html, ok: false, missing: find }
    out = out.slice(0, first) + replace(find) + out.slice(first + find.length)
  }
  return { html: out, ok: true, missing: null }
}

module.exports = { apply }
