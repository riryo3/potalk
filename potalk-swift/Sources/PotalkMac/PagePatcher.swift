import Foundation

/// potalk.app の index.html に小さな差し込みを当てる。差し込み位置が見つからなければ元のページをそのまま使う。
enum PagePatcher {

    struct Patch { let find: String; let replace: (String) -> String }

    static let patches: [Patch] = [
        // 名刺と「無視」の確認は、ネイティブ側に出すので、ページ内ではモーダルにしない
        Patch(find: "try { $('cardDlg').showModal() } catch {}", replace: { _ in "try { $('cardDlg').show() } catch {}" }),
        Patch(find: "try { $('ignoreDlg').showModal() } catch { doIgnore(id) }", replace: { _ in "try { $('ignoreDlg').show() } catch { doIgnore(id) }" }),
        // 起動のたびにキーチェーンの確認が出ないよう、名刺の鍵は起動時には読まない。
        // 相手が自分の名刺を見るとき（名刺を渡す直前）に、はじめて読む（本人確認の✅を、相手に見せるため）
        Patch(find: "cardKeyLoad(false).catch(() => {})\nconst CARD_NOSTR_KIND", replace: { _ in "const CARD_NOSTR_KIND" }),
        Patch(find: "      sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {", replace: { _ in
            "      const _pc = loadCard()\n      if (_pc.proofs && Object.keys(_pc.proofs).length) cardKeyLoad(false).catch(() => {}).then(() => sendTo(call.cardAction, myCardPayload(), peerId))\n      else sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {" }),
        Patch(find: "try { $('cropDlg').showModal() } catch { finish(null) }", replace: { _ in "try { $('cropDlg').show() } catch { finish(null) }" }),
        Patch(find: "try { $('cardEditDlg').showModal() } catch {}", replace: { _ in "try { $('cardEditDlg').show() } catch {}" }),
        Patch(find: "try { $('cardAuthDlg').showModal() } catch {}", replace: { _ in "try { $('cardAuthDlg').show() } catch {}" }),
        // 共有するURLには、部屋の名前（&name=…）を付けない（部屋のIDだけで入れる）
        Patch(find: "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id + (name ? '&name=' + encodeURIComponent(name) : '')", replace: { _ in
            "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id" }),
        Patch(find: "btn.onclick = () => askRoom(room, lobbyName(room, people))", replace: { "btn.dataset.room = room; " + $0 }),
        // ひとこと着信音：相手のひとこと（自分の分・履歴は除く）が届いたら、ピコンと鳴らす。設定にスイッチを足す（既定オン・localStorage に保存）
        Patch(find: "id=\"sndReact\"> 🎵 リアクションを音で鳴らす</label>", replace: {
            $0 + "\n      <label class=\"snd-opt\" id=\"sndChatRow\"><input type=\"checkbox\" id=\"sndChat\"> 💬 ひとことが届いたら音で鳴らす</label>" }),
        Patch(find: "const seenRooms = new Set()", replace: {
            "const SND_CHAT_KEY = 'pot-call-snd-chat'\nlet sndChat = lsGet(SND_CHAT_KEY) !== '0'   // 未保存＝オン\nconst soundChat = () => { if (sndChat) playTones([[880, 0, 0.07], [1175, 0.07, 0.12]]) }   // 短いピコン＝ひとこと\n" + $0 }),
        Patch(find: "  reactBox.onchange = () => {\n", replace: {
            "  { const chatBox = $('sndChat'); chatBox.checked = sndChat; chatBox.onchange = () => { sndChat = chatBox.checked; lsSet(SND_CHAT_KEY, sndChat ? '1' : '0'); if (sndChat) { try { ensureAudioCtx() } catch {} ; soundChat() } } }\n" + $0 }),
        Patch(find: "const logChat = (uid, text) => {\n  const me = uid === 'self'\n", replace: {
            $0 + "  if (!me) { try { soundChat() } catch {} }\n" }),
        Patch(find: "const flyReaction = (uid, idx) => {\n", replace: {
            $0 + "  try { window.__pm && window.__pm.react(uid, idx, REACTIONS[idx], uid === 'self' ? '' : ((call.profiles.get(uid) || {}).name || '')) } catch {}\n" }),
    ]

    /// 戻り値: (html, 当てられたか, 見つからなかった位置)
    static func apply(_ html: String) -> (String, Bool, String?) {
        var out = html
        for p in patches {
            guard let first = out.range(of: p.find) else { return (html, false, p.find) }
            if out.range(of: p.find, range: first.upperBound..<out.endIndex) != nil { return (html, false, p.find) }
            out.replaceSubrange(first, with: p.replace(p.find))
        }
        return (out, true, nil)
    }
}
