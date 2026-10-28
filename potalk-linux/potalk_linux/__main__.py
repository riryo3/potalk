"""起動口。`python3 -m potalk_linux` で起動する。

Chromium 側のフラグは、Qt WebEngine が起動する前に環境変数へ入れておく必要がある。
- autoplay: ページが音を出すのにユーザーの操作を要求しない
- background throttling: 隠し WebView が裏で止められないようにする（Windows 版と同じ指定）
"""
from __future__ import annotations

import os
import sys

_FLAGS = (
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
)


def _ensure_chromium_flags():
    cur = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
    have = set(cur.split())
    add = [f for f in _FLAGS if f not in have]
    if add:
        os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (cur + " " + " ".join(add)).strip()


def main() -> int:
    _ensure_chromium_flags()
    from PySide6.QtWidgets import QApplication

    from .app import App

    qapp = QApplication(sys.argv)
    qapp.setApplicationName("Potalker")
    qapp.setOrganizationName("Potalker")
    qapp.setQuitOnLastWindowClosed(False)
    app = App(qapp)
    app.start()
    return qapp.exec()


if __name__ == "__main__":
    sys.exit(main())
