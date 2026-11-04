"""potalk.app の index.html に小さな差し込みを当てる。

Mac 版（PagePatcher.swift）・Windows 版（PagePatcher.cs）と同じ内容・同じ作法。
差し込み位置が見つからない／複数あるときは、元のページをそのまま使う。
（ページの作りが変わっても、壊れたページを読み込まないための安全弁）
"""
from __future__ import annotations



def _append(extra: str):
    return lambda found: found + extra


def _prepend(extra: str):
    return lambda found: extra + found


def _const(value: str):
    return lambda found: value


# (find, replace) — replace は見つけた文字列を受け取って差し替え後の文字列を返す
PATCHES: list[tuple[str, callable]] = [
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
