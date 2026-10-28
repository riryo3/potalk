"""部屋カードの高さ計算のテスト（描画はしない）。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from potalk_linux.model import LobbyRoom, Person  # noqa: E402
from potalk_linux.room_card import PAD, TITLE_H, SUB_H, DUR_H, CHIPS_H, card_height  # noqa: E402


class CardHeightTest(unittest.TestCase):
    def test_minimal_room(self):
        r = LobbyRoom(name="a")
        self.assertEqual(card_height(r), PAD * 2 + TITLE_H)

    def test_full_room(self):
        r = LobbyRoom(name="a", sub="topic", dur="3分", people=[Person(name="x")])
        self.assertEqual(card_height(r), PAD * 2 + TITLE_H + SUB_H + DUR_H + CHIPS_H)

    def test_height_grows_with_content(self):
        base = card_height(LobbyRoom(name="a"))
        with_dur = card_height(LobbyRoom(name="a", dur="1分"))
        self.assertGreater(with_dur, base)


if __name__ == "__main__":
    unittest.main()
