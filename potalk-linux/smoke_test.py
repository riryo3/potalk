#!/usr/bin/env python3
"""実ページ相手のスモークテスト（手動実行用・自動テストには入れない）。

本物の potalk.app につなぎ、次を確認する:
  1. ページが読み込め、ブリッジの ready が来る
  2. ロビーの状態が「接続中」から先に進む（Nostr リレー接続）
  3. 部屋が作れて、入室状態になる
  4. 退出できる

使い方（検証環境ではプロキシと偽マイクのフラグが要る）:
  QT_QPA_PLATFORM=offscreen \
  QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox --use-fake-device-for-media-stream \
    --use-fake-ui-for-media-stream --proxy-server=http://127.0.0.1:18080 \
    --ignore-certificate-errors" \
  python3 smoke_test.py

通常の Linux デスクトップでは、フラグなしで `python3 smoke_test.py` でよい
（--no-sandbox は root 実行時のみ）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QTimer  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from potalk_linux.engine import Engine  # noqa: E402


def main() -> int:
    app = QApplication(sys.argv)
    engine = Engine()
    engine.log.connect(lambda m: print("[log]", m, flush=True))
    step = {"n": 0}
    result = {"code": 1}

    def fail(msg):
        print("SMOKE FAIL:", msg, flush=True)
        app.quit()

    def tick():
        step["n"] += 1
        n = step["n"]
        if n == 1:
            engine.start()
        elif not engine.ready:
            if n % 10 == 0:
                print(f"…ready 待ち ({n * 2}s)", flush=True)
        elif step.get("phase", 0) == 0:
            st = engine.lobby.status
            if st and "接続中" not in st:
                print("OK: ロビー接続:", st, flush=True)
                print("…部屋を作成します", flush=True)
                engine.cmd({"type": "create", "name": "linuxスモークテスト部屋", "kind": "chat"})
                step["phase"] = 1
            elif n % 10 == 0:
                print(f"…ロビー接続待ち status={st!r}", flush=True)
        elif step.get("phase") == 1:
            if engine.room.joined:
                print(f"OK: 入室できた rid={engine.room.rid} state={engine.room.state}", flush=True)
                engine.cmd({"type": "leave"})
                step["phase"] = 2
        elif step.get("phase") == 2:
            if not engine.room.joined:
                print("OK: 退出できた", flush=True)
                print("SMOKE PASS", flush=True)
                result["code"] = 0
                app.quit()
                return
        if n > 150:  # 300 秒
            fail("timeout")
            return
        QTimer.singleShot(2000, tick)

    QTimer.singleShot(500, tick)
    app.exec()
    return result["code"]


if __name__ == "__main__":
    sys.exit(main())
