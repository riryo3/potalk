#!/usr/bin/env python3
"""アプリのスクリーンショットを撮る（開発用）。

画面のない環境でも Qt の offscreen で描画して PNG に保存する。
ロビー（実データ）と、自分で作った部屋に入ったところの2枚を撮る。

使い方:
  python3 tools/screenshot.py [出力フォルダ]
検証環境（Muse の VM）ではプロキシと偽マイクの環境変数が要る。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QSettings, QTimer  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from potalk_linux.app import App  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "screenshots"
os.makedirs(OUT, exist_ok=True)


def grab(widget, name):
    widget.repaint()
    pix = widget.grab()
    path = os.path.join(OUT, name)
    pix.save(path, "PNG")
    print("saved:", path, pix.size().width(), "x", pix.size().height(), flush=True)


def main() -> int:
    qapp = QApplication(sys.argv)
    # スクショ用に単一窓モードは切っておく
    QSettings("Potalker", "Potalker").setValue("ui/singlePane", False)
    ctl = App(qapp)
    ctl.start()
    ctl.lobby.resize(920, 660)
    state = {"phase": 0, "ticks": 0}

    def tick():
        state["ticks"] += 1
        n = state["ticks"]
        eng = ctl.engine
        if state["phase"] == 0:
            st = eng.lobby.status if eng.ready else ""
            rooms = eng.lobby.rooms if eng.ready else []
            if eng.ready and rooms and st and "接続中" not in st:
                # 部屋が見えてから少し置いて、ページ側の準備が整ってから撮る・作る
                state["seen"] = state.get("seen", 0) + 1
                if state["seen"] < 10:
                    return
                print("lobby ready:", st, "| rooms:", len(rooms), flush=True)
                grab(ctl.lobby, "lobby.png")
                eng.cmd({"type": "create", "name": "スクショ用テスト部屋", "kind": "chat"})
                state["phase"] = 1
            elif n > 90:
                print("lobby timeout, grabbing anyway", flush=True)
                grab(ctl.lobby, "lobby.png")
                qapp.quit()
        elif state["phase"] == 1:
            if eng.room.state == "joined":
                ctl.room.resize(880, 720)
                state["phase"] = 2
                state["at"] = n
            elif n > 400:
                print("join timeout, room state:", eng.room.state, flush=True)
                qapp.quit()
        elif state["phase"] == 2:
            if n - state["at"] >= 4:  # 入室描画が落ち着くまで少し待つ
                grab(ctl.room, "room.png")
                eng.cmd({"type": "leave"})
                state["phase"] = 3
                state["at"] = n
        elif state["phase"] == 3:
            if n - state["at"] >= 2:
                qapp.quit()

    timer = QTimer()
    timer.timeout.connect(tick)
    timer.start(500)
    QTimer.singleShot(240_000, qapp.quit)
    return qapp.exec()


if __name__ == "__main__":
    sys.exit(main())
