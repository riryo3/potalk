import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from potalk_linux import patcher  # noqa: E402


def fixture_html() -> str:
    parts = ["<html><script>\n"]
    parts.append("const CHAT_LOG_MAX = 30\n")
    parts.append("call.chatAction = call.room.makeAction('chat')\n")
    parts.append("sendProfile(id); sendMeta(id);\n")
    parts.append("try { $('cardDlg').showModal() } catch {}\n")
    parts.append("try { $('ignoreDlg').showModal() } catch { doIgnore(id) }\n")
    parts.append("cardKeyLoad(false).catch(() => {})\nconst CARD_NOSTR_KIND = 1\n")
    parts.append("      sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {\n")
    parts.append("try { $('cropDlg').showModal() } catch { finish(null) }\n")
    parts.append("try { $('cardEditDlg').showModal() } catch {}\n")
    parts.append("try { $('cardAuthDlg').showModal() } catch {}\n")
    parts.append("const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id + (name ? '&name=' + encodeURIComponent(name) : '')\n")
    parts.append("btn.onclick = () => askRoom(room, lobbyName(room, people))\n")
    parts.append("const flyReaction = (uid, idx) => {\n")
    parts.append("</script></html>")
    return "".join(parts)


class PatcherTest(unittest.TestCase):
    def test_all_patches_apply(self):
        out, ok, missing = patcher.apply(fixture_html())
        self.assertTrue(ok, f"missing: {missing}")
        self.assertIsNone(missing)
        self.assertIn("window.__pmPatched = 1", out)
        self.assertIn("pmHistAction = call.room.makeAction('hist')", out)
        self.assertIn("pmHistSend(id);", out)
        self.assertNotIn("showModal() } catch {}\ntry { $('ignoreDlg')", out)
        self.assertIn("$('cardDlg').show()", out)
        self.assertNotIn("cardKeyLoad(false).catch(() => {})\nconst CARD_NOSTR_KIND", out)
        self.assertIn("btn.dataset.room = room; btn.onclick", out)
        self.assertIn("window.__pm.react(uid, idx", out)
        self.assertNotIn("&name=' + encodeURIComponent(name)", out)

    def test_missing_anchor_returns_original(self):
        html = fixture_html().replace("const CHAT_LOG_MAX = 30\n", "")
        out, ok, missing = patcher.apply(html)
        self.assertFalse(ok)
        self.assertEqual(out, html)
        self.assertEqual(missing, "const CHAT_LOG_MAX = 30\n")

    def test_duplicate_anchor_returns_original(self):
        html = fixture_html() + "sendProfile(id); sendMeta(id);"
        out, ok, missing = patcher.apply(html)
        self.assertFalse(ok)
        self.assertEqual(out, html)


if __name__ == "__main__":
    unittest.main()
