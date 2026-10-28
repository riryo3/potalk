"""potalk.app の index.html に小さな差し込みを当てる。

Mac 版（PagePatcher.swift）・Windows 版（PagePatcher.cs）と同じ内容・同じ作法。
差し込み位置が見つからない／複数あるときは、元のページをそのまま使う。
（ページの作りが変わっても、壊れたページを読み込まないための安全弁）
"""
from __future__ import annotations

HIST_CODE = """
    // ---- [potalker] 過去ログ共有 ----
    window.__pmPatched = 1
    const pmHistSend = id => {
      const rows = [...chatLogEl.querySelectorAll('.cl-row:not(.cl-sys):not(.cl-hist)')].slice(-30)
      const items = rows.map(r => ({
        e: r.querySelector('.cl-em')?.textContent || '',
        n: (r.querySelector('.cl-who')?.textContent || '').replace('（あなた）', '') || (profile && profile.name) || '',
        t: r.querySelector('.cl-text')?.textContent || '',
      })).filter(x => x.t)
      if (items.length) sendTo(pmHistAction, items, id)
    }
    let pmHistFor = null, pmHistAction = null
    const pmHistRecv = (data, peerId) => {
      if (!call.joinedId || pmHistFor === call.joinedId || call.ignored.has(peerId) || !Array.isArray(data)) return
      pmHistFor = call.joinedId
      const frag = document.createDocumentFragment()
      const head = document.createElement('div'); head.className = 'cl-row cl-sys cl-hist'
      const hx = document.createElement('span'); hx.className = 'cl-text'; hx.textContent = 'ここから過去ログ（参加者から受け取ったもの・真偽は未確認）'
      head.append(hx); frag.append(head)
      data.slice(-30).forEach(x => {
        const t = capText(x && x.t, CHAT_MAX); if (!t) return
        const row = document.createElement('div'); row.className = 'cl-row cl-hist'
        const em = document.createElement('span'); em.className = 'cl-em'; em.textContent = capText(x.e, 8, '🙂')
        const who = document.createElement('span'); who.className = 'cl-who'; who.textContent = capText(x.n, 20, 'ゲスト')
        const tx = document.createElement('span'); tx.className = 'cl-text'; tx.textContent = t
        row.append(em, who, tx); frag.append(row)
      })
      if (frag.childElementCount > 1) { chatLogEl.prepend(frag); chatLogEl.hidden = false }
    }

"""


def _append(extra: str):
    return lambda found: found + extra


def _prepend(extra: str):
    return lambda found: extra + found


def _const(value: str):
    return lambda found: value


# (find, replace) — replace は見つけた文字列を受け取って差し替え後の文字列を返す
PATCHES: list[tuple[str, callable]] = [
    ("const CHAT_LOG_MAX = 30\n", _append(HIST_CODE)),
    (
        "call.chatAction = call.room.makeAction('chat')",
        _prepend("pmHistAction = call.room.makeAction('hist'); pmHistAction.onMessage = (d, { peerId }) => pmHistRecv(d, peerId)\n  "),
    ),
    ("sendProfile(id); sendMeta(id);", _append(" pmHistSend(id);")),
    # 名刺と「無視」の確認は、ネイティブ側に出すので、ページ内ではモーダルにしない
    ("try { $('cardDlg').showModal() } catch {}", _const("try { $('cardDlg').show() } catch {}")),
    ("try { $('ignoreDlg').showModal() } catch { doIgnore(id) }", _const("try { $('ignoreDlg').show() } catch { doIgnore(id) }")),
    # 起動のたびに鍵の確認が出ないよう、名刺の鍵は起動時には読まない（Mac 版と同じ理由）
    ("cardKeyLoad(false).catch(() => {})\nconst CARD_NOSTR_KIND", _const("const CARD_NOSTR_KIND")),
    (
        "      sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {",
        _const(
            "      const _pc = loadCard()\n"
            "      if (_pc.proofs && Object.keys(_pc.proofs).length) cardKeyLoad(false).catch(() => {}).then(() => sendTo(call.cardAction, myCardPayload(), peerId))\n"
            "      else sendTo(call.cardAction, myCardPayload(), peerId)\n"
            "    } else if (data.k === 'res') {"
        ),
    ),
    ("try { $('cropDlg').showModal() } catch { finish(null) }", _const("try { $('cropDlg').show() } catch { finish(null) }")),
    ("try { $('cardEditDlg').showModal() } catch {}", _const("try { $('cardEditDlg').show() } catch {}")),
    ("try { $('cardAuthDlg').showModal() } catch {}", _const("try { $('cardAuthDlg').show() } catch {}")),
    # 共有する URL には、部屋の名前（&name=…）を付けない（部屋の ID だけで入れる）
    (
        "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id + (name ? '&name=' + encodeURIComponent(name) : '')",
        _const("const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id"),
    ),
    ("btn.onclick = () => askRoom(room, lobbyName(room, people))", _prepend("btn.dataset.room = room; ")),
    (
        "const flyReaction = (uid, idx) => {\n",
        _append("  try { window.__pm && window.__pm.react(uid, idx, REACTIONS[idx], uid === 'self' ? '' : ((call.profiles.get(uid) || {}).name || '')) } catch {}\n"),
    ),
]


def apply(html: str) -> tuple[str, bool, str | None]:
    """戻り値: (html, 当てられたか, 見つからなかった位置)。

    どれか1つでも位置が見つからない／2つ以上あるときは、元の html をそのまま返す。
    """
    out = html
    for find, replace in PATCHES:
        first = out.find(find)
        if first < 0:
            return html, False, find
        if out.find(find, first + len(find)) >= 0:
            return html, False, find
        out = out[:first] + replace(find) + out[first + len(find):]
    return out, True, None
