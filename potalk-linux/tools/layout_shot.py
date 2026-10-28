#!/usr/bin/env python3
"""レイアウト確認用のスクリーンショット（ネットワーク不要・偽データ）。

使い方: python3 tools/layout_shot.py [light|dark] [出力フォルダ]
ロビーと部屋の窓を、サンプルの状態で両テーマ分撮れる。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

from potalk_linux import theme  # noqa: E402
from potalk_linux.engine import Engine  # noqa: E402
from potalk_linux.lobby_window import LobbyWindow  # noqa: E402
from potalk_linux.model import LobbyRoom, LobbyState, Member, Person, RoomState  # noqa: E402
from potalk_linux.room_window import RoomWindow  # noqa: E402

MODE = sys.argv[1] if len(sys.argv) > 1 else "light"
OUT = sys.argv[2] if len(sys.argv) > 2 else "layout-shots"
os.makedirs(OUT, exist_ok=True)


def sample_lobby() -> LobbyState:
    return LobbyState(
        status="",
        viewers="👥 いまだいたい10人が見ています",
        rooms=[
            LobbyRoom(
                id="r1", name="Potalker 非公式クライアント テスト", count="3",
                sub="Linuxネイティブ版をAIに作らせる", sub_by="リョータ",
                dur="2時間6分", bc=False,
                people=[
                    Person(em="🐼", name="リョータ", muted=True),
                    Person(em="🦉", name="雨の日のラプサンスーチョン"),
                    Person(em="🐼", name="リョータ"),
                ],
            ),
            LobbyRoom(
                id="r2", name="qramoの部屋", count="1", sub="テスト中", sub_by="qramo",
                dur="24分", bc=False,
                people=[Person(em="🦉", name="qramo", muted=True), Person(em="🌙", name="つくよみ")],
            ),
            LobbyRoom(
                id="r3", name="ぽっと通話にようこそ", count="1", dur="263時間22分",
                people=[Person(em="🍵", name="ぽっと通話")],
            ),
            LobbyRoom(
                id="r4", name="夕方の配信", count="12", sub="雑談しながら作業", sub_by="たがみん",
                dur="48分", bc=True,
                people=[Person(em="🎧", name="たがみん")],
            ),
        ],
    )


def sample_room() -> RoomState:
    return RoomState(
        joined=True, rid="abc123", state="通話中：Potalker 非公式クライアント テスト（3人）",
        can_mute=True, muted=True,
        members=[
            Member(em="🐼", name="ひなたのレモンバーム", you=True, muted=True, conn="relay"),
            Member(em="🦉", name="雨の日のラプサンスーチョン", muted=True, mark="🌿", conn="relay"),
            Member(em="🐼", name="リョータ", mark="🌿", speaking=True),
        ],
        reactions=["👏", "😂", "✨", "👍", "🤔", "😮", "🎉", "🍵"],
        raw={
            "tag": {"show": True, "text": "🏷 いまの話題：Linuxネイティブ版をAIに作らせる"},
            "speak": {"show": False},
            "raise": {"show": True, "label": "✋ 手を挙げる"},
            "settings": [],
        },
    )


def main() -> int:
    app = QApplication(sys.argv)
    theme.apply_theme(app, MODE)
    engine = Engine()

    lobby = LobbyWindow(engine)
    lobby.resize(460, 640)
    lobby._on_lobby(sample_lobby())
    lobby.show()
    for _ in range(6):
        app.processEvents()
    lobby.grab().save(os.path.join(OUT, f"lobby-{MODE}.png"), "PNG")
    print("saved lobby", MODE, flush=True)

    room = RoomWindow(engine)
    room.resize(430, 640)
    room._on_room(sample_room())
    room.eq_label.setText("☁️ 中継 / 🔀 直接　詳細…")
    room.show()
    app.processEvents()
    room.grab().save(os.path.join(OUT, f"room-{MODE}.png"), "PNG")
    print("saved room", MODE, flush=True)

    # 単一窓モードの部屋（左端の帯＋ひとこと引き出し）
    room.set_pane_mode(True)
    room.set_drawer_open_hint(True)
    room.bump_unread()
    room.bump_unread()
    app.processEvents()
    room.grab().save(os.path.join(OUT, f"room-pane-{MODE}.png"), "PNG")
    print("saved room-pane", MODE, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
