import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from potalk_linux.model import (  # noqa: E402
    LobbyRoom,
    LobbyState,
    RoomState,
    filter_rooms,
    normalize,
    parse_room_link,
)


class ModelTest(unittest.TestCase):
    def test_lobby_parse(self):
        st = LobbyState.from_dict({
            "status": "x", "viewers": "y",
            "rooms": [{"id": "r1", "name": "部屋", "people": [{"em": "🐱", "name": "ねこ", "muted": True}], "bc": True}],
        })
        self.assertEqual(st.rooms[0].id, "r1")
        self.assertTrue(st.rooms[0].bc)
        self.assertTrue(st.rooms[0].people[0].muted)

    def test_room_parse(self):
        st = RoomState.from_dict({"joined": True, "rid": "abc", "members": [{"em": "🐶", "name": "いぬ", "speaking": True}]})
        self.assertTrue(st.joined)
        self.assertTrue(st.members[0].speaking)

    def test_normalize(self):
        self.assertEqual(normalize("ＡＢＣ　カタカナ"), "abc かたかな")

    def test_filter_by_person_and_kana(self):
        rooms = [
            LobbyRoom(id="1", name="ザツダン部屋", people=[]),
            LobbyRoom(id="2", name="作業部屋", people=[]),
        ]
        rooms[1].people = []
        from potalk_linux.model import Person
        rooms[1].people.append(Person(em="", name="タロウ"))
        self.assertEqual([r.id for r in filter_rooms(rooms, "たろう")], ["2"])
        self.assertEqual([r.id for r in filter_rooms(rooms, "ｻﾞﾂﾀﾞﾝ")], ["1"])

    def test_filter_by_room_link(self):
        rooms = [LobbyRoom(id="abc123", name="x"), LobbyRoom(id="zzz", name="y")]
        got = filter_rooms(rooms, "https://potalk.app/#room=abc123&name=x")
        self.assertEqual([r.id for r in got], ["abc123"])

    def test_room_card_mail_parse(self):
        st = RoomState.from_dict({
            "joined": True, "bcast": True,
            "card": {"emoji": "🐱", "name": "ねこ", "bio": "hi", "socials": [{"t": "𝕏", "u": "https://x.com/a"}], "ignore": {"text": "無視する", "disabled": False}},
            "ignoreAsk": {"title": "無視しますか", "items": ["a"], "yes": "する", "no": "しない"},
            "mail": {"head": [{"text": "募集中", "btns": [{"i": "0", "label": "公開中"}]}],
                     "body": [{"item": True, "em": "🐶", "who": "いぬ", "text": "便り", "shown": True, "btns": []}],
                     "form": {"ph": "書いてね", "btn": "送る", "max": "200"}},
            "mailNow": {"cap": "公開中", "who": "いぬ", "text": "便り"},
        })
        self.assertEqual(st.card.name, "ねこ")
        self.assertTrue(st.card.has_ignore)
        self.assertEqual(st.ignore_ask.yes, "する")
        self.assertEqual(st.mail.head[0].btns[0].label, "公開中")
        self.assertEqual(st.mail.form_max, 200)
        self.assertTrue(st.mail.body[0].shown)
        self.assertFalse(st.mail_now.empty)

    def test_card_edit_ver(self):
        from potalk_linux.model import CardEditState
        st = CardEditState.from_dict({"bio": "x", "verX": {"verified": True}})
        self.assertEqual(st.s("bio"), "x")
        self.assertTrue(st.ver("x").get("verified"))

    def test_drawer_side(self):
        from potalk_linux.model import choose_drawer_side, drawer_x
        # 本体が画面左端：左に空きがない＋右に幅がある → 右に出す
        self.assertEqual(choose_drawer_side(0, 400, 0, 1920, 380), "right")
        self.assertEqual(drawer_x("right", 0, 400, 380), 400 - 24)
        # 本体が右寄り：左に幅がある → 左に出す
        self.assertEqual(choose_drawer_side(800, 1200, 0, 1920, 380), "left")
        self.assertEqual(drawer_x("left", 800, 1200, 380), 800 - 380)
        # 画面が狭く両側とも足りない → 左（重ねる側）に倒す
        self.assertEqual(choose_drawer_side(100, 500, 0, 700, 380), "left")

    def test_parse_room_link(self):
        self.assertEqual(parse_room_link("見て https://potalk.app/#room=abc&name=x ね"), "#room=abc&name=x")
        self.assertIsNone(parse_room_link("リンクなし"))


if __name__ == "__main__":
    unittest.main()
