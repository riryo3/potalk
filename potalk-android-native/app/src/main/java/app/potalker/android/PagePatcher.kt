package app.potalker.android

/** potalk.app の index.html に、小さな差し込みを当てる（Mac 版・Windows 版・Electron 版と同じ内容）。
 *  差し込み位置が見つからない／2つ以上あるときは、元のページをそのまま使う（ページの作りが変わっても、壊れたページを読み込まないための安全弁）。 */
object PagePatcher {
    private class Patch(val find: String, val replace: (String) -> String)

    private fun patches(): List<Patch> = listOf(
        // 名刺と「無視」の確認は、こちらの画面に出すので、ページ内ではモーダルにしない
        Patch("try { $('cardDlg').showModal() } catch {}") { "try { $('cardDlg').show() } catch {}" },
        Patch("try { $('ignoreDlg').showModal() } catch { doIgnore(id) }") { "try { $('ignoreDlg').show() } catch { doIgnore(id) }" },
        // 名刺の鍵は、起動時には読まない。相手が自分の名刺を見るとき（名刺を渡す直前）に、はじめて読む
        Patch("cardKeyLoad(false).catch(() => {})\nconst CARD_NOSTR_KIND") { "const CARD_NOSTR_KIND" },
        Patch("      sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {") {
            "      const _pc = loadCard()\n      if (_pc.proofs && Object.keys(_pc.proofs).length) cardKeyLoad(false).catch(() => {}).then(() => sendTo(call.cardAction, myCardPayload(), peerId))\n      else sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {"
        },
        Patch("try { $('cropDlg').showModal() } catch { finish(null) }") { "try { $('cropDlg').show() } catch { finish(null) }" },
        Patch("try { $('cardEditDlg').showModal() } catch {}") { "try { $('cardEditDlg').show() } catch {}" },
        Patch("try { $('cardAuthDlg').showModal() } catch {}") { "try { $('cardAuthDlg').show() } catch {}" },
        Patch("btn.onclick = () => askRoom(room, lobbyName(room, people))") { "btn.dataset.room = room; $it" },
        // 共有する部屋の URL から &name= を外す
        Patch("const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id + (name ? '&name=' + encodeURIComponent(name) : '')") {
            "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id"
        },
        // ひとこと着信音：相手のひとこと（自分の分・履歴は除く）が届いたら、ピコンと鳴らす。設定にスイッチを足す（既定オン）
        Patch("id=\"sndReact\"> 🎵 リアクションを音で鳴らす</label>") {
            "$it\n      <label class=\"snd-opt\" id=\"sndChatRow\"><input type=\"checkbox\" id=\"sndChat\"> 💬 ひとことが届いたら音で鳴らす</label>"
        },
        Patch("const seenRooms = new Set()") {
            "const SND_CHAT_KEY = 'pot-call-snd-chat'\nlet sndChat = lsGet(SND_CHAT_KEY) !== '0'   // 未保存＝オン\nconst soundChat = () => { if (sndChat) playTones([[880, 0, 0.07], [1175, 0.07, 0.12]]) }   // 短いピコン＝ひとこと\n$it"
        },
        Patch("  reactBox.onchange = () => {\n") {
            "  { const chatBox = $('sndChat'); chatBox.checked = sndChat; chatBox.onchange = () => { sndChat = chatBox.checked; lsSet(SND_CHAT_KEY, sndChat ? '1' : '0'); if (sndChat) { try { ensureAudioCtx() } catch {} ; soundChat() } } }\n$it"
        },
        Patch("const logChat = (uid, text) => {\n  const me = uid === 'self'\n") { "$it  if (!me) { try { soundChat() } catch {} }\n" },
        Patch("const flyReaction = (uid, idx) => {\n") {
            "$it  try { window.__pm && window.__pm.react(uid, idx, REACTIONS[idx], uid === 'self' ? '' : ((call.profiles.get(uid) || {}).name || '')) } catch {}\n"
        },
    )

    /** 戻り値：当てたページ。位置が見つからない／2つ以上あるときは、元の html をそのまま返す（false の組で知らせる） */
    fun apply(html: String): Pair<String, Boolean> {
        var out = html
        for (p in patches()) {
            val first = out.indexOf(p.find)
            if (first < 0) return html to false
            if (out.indexOf(p.find, first + p.find.length) >= 0) return html to false
            out = out.substring(0, first) + p.replace(p.find) + out.substring(first + p.find.length)
        }
        return out to true
    }
}
