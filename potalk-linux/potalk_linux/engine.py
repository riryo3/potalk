"""通話の仕組み（potalk.app のページ）を動かす、画面に出ない WebView。

Mac 版の Engine.swift / Windows 版の Engine.cs と同じ役割。
Qt WebEngine（Chromium）を土台にし、ブリッジ JS とのやり取りを Qt のシグナルに変える。

注意（検証で踏んだ地雷）:
- QWebEngineProfile と QWebChannel は、Python 側で保持し続けないと GC で回収され、
  ブリッジが黙って死ぬ。必ず self に持つこと。
"""
from __future__ import annotations

import json
import os
import urllib.request

from PySide6.QtCore import QFile, QIODevice, QObject, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import (
    QWebEnginePage,
    QWebEngineProfile,
    QWebEngineScript,
)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QWidget

from . import patcher
from .model import ChatLine, LobbyState, ProfileState, RoomState

HOME = "https://potalk.app/"
ASSETS = os.path.join(os.path.dirname(__file__), "assets")


def _read_asset(name: str) -> str:
    with open(os.path.join(ASSETS, name), encoding="utf-8") as f:
        return f.read()


def _qwebchannel_js() -> str:
    f = QFile(":/qtwebchannel/qwebchannel.js")
    if f.open(QIODevice.OpenModeFlag.ReadOnly):
        data = bytes(f.readAll()).decode("utf-8")
        f.close()
        return data
    return ""


_PRE_BODY = """
window.__pmPost = (obj) => { try { window.__pmNative && window.__pmNative.post(JSON.stringify(obj)); } catch (e) {} };
new QWebChannel(qt.webChannelTransport, (ch) => { window.__pmNative = ch.objects.pmNative; });
"""


class _Bridge(QObject):
    """ページ側ブリッジからの post を受ける口。"""

    def __init__(self, engine: "Engine"):
        super().__init__()
        self._engine = engine

    @Slot(str)
    def post(self, s: str):
        try:
            obj = json.loads(s)
        except Exception:  # noqa: BLE001
            return
        self._engine._on_message(obj)


class _Page(QWebEnginePage):
    """外のサイトへのリンクは外部ブラウザで開く（Mac/Win 版と同じ作法）。"""

    def acceptNavigationRequest(self, url: QUrl, typ, is_main_frame):  # noqa: N802 (Qt naming)
        if (
            is_main_frame
            and typ == QWebEnginePage.NavigationType.NavigationTypeLinkClicked
            and url.scheme() in ("http", "https")
            and url.host() != "potalk.app"
        ):
            QDesktopServices.openUrl(url)
            return False
        return super().acceptNavigationRequest(url, typ, is_main_frame)

    def createWindow(self, _type):  # noqa: N802
        return None  # 新しい窓は作らず、リンクは acceptNavigationRequest 側で外部に回す


class Engine(QObject):
    lobby_changed = Signal(object)    # LobbyState
    profile_changed = Signal(object)  # ProfileState
    room_changed = Signal(object)     # RoomState
    cards_changed = Signal(dict)
    eq_changed = Signal(str)
    chat_received = Signal(object)    # ChatLine
    react_received = Signal(dict)
    devices_changed = Signal(list)
    ready_changed = Signal(bool)
    log = Signal(str)

    def __init__(self, parent: QObject | None = None):
        super().__init__(parent)
        self.lobby = LobbyState()
        self.profile = ProfileState()
        self.room = RoomState()
        self.cards: dict = {}
        self.eq = ""
        self.ready = False
        self.patched = False

        data_dir = os.path.join(
            os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")),
            "Potalker",
        )
        os.makedirs(data_dir, exist_ok=True)

        # プロファイルとチャンネルは保持し続ける（GC 対策）
        self._profile = QWebEngineProfile("Potalker", self)
        self._profile.setPersistentStoragePath(os.path.join(data_dir, "WebEngine"))
        self._profile.setCachePath(os.path.join(data_dir, "WebEngineCache"))

        self._host = QWidget()
        self._host.setFixedSize(900, 700)
        self._host.move(-20000, -20000)  # 画面の外（Mac/Win 版と同じく、止めずに動かし続けるため）
        self.view = QWebEngineView(self._host)
        self.view.resize(900, 700)
        self._page = _Page(self._profile, self.view)
        self.view.setPage(self._page)

        self._bridge = _Bridge(self)
        self._channel = QWebChannel(self)
        self._channel.registerObject("pmNative", self._bridge)
        self._page.setWebChannel(self._channel)

        scripts = self._page.scripts()
        pre = _qwebchannel_js() + _PRE_BODY
        for name, src in (("pre", pre), ("mic", _read_asset("mic.js")), ("bridge", _read_asset("bridge.js"))):
            sc = QWebEngineScript()
            sc.setName("potalker-" + name)
            sc.setSourceCode(src)
            sc.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
            sc.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
            sc.setRunsOnSubFrames(False)
            scripts.insert(sc)

        self._page.featurePermissionRequested.connect(self._on_permission)
        self._page.renderProcessTerminated.connect(self._on_terminated)
        self._host.show()

    # ---- 起動と読み込み ----

    def start(self):
        self._load()

    def reload(self):
        self._set_ready(False)
        self._load()

    def _load(self, hash_: str = ""):
        """本体ページを取りに行って差し込みを当て、baseURL 付きで読み込む（Swift 版と同じ方式）。
        取得や差し込みに失敗したら、元のページを直接読み込む。"""
        html = None
        try:
            req = urllib.request.Request(HOME, headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=20) as res:
                html = res.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            self.log.emit(f"ページの取得に失敗: {e}")
        if html is None:
            self.view.load(QUrl(HOME + hash_))
            return
        out, ok, missing = patcher.apply(html)
        self.patched = ok
        if not ok:
            self.log.emit(f"差し込み位置が見つかりません。元のページを使います: {missing}")
        self._page.setHtml(out, QUrl(HOME + hash_))

    # ---- ページからの知らせ ----

    def _on_message(self, obj: dict):
        t = obj.get("t")
        d = obj.get("d")
        if t == "lobby" and isinstance(d, dict):
            v = LobbyState.from_dict(d)
            if v != self.lobby:
                self.lobby = v
                self.lobby_changed.emit(v)
        elif t == "profile" and isinstance(d, dict):
            v = ProfileState.from_dict(d)
            if v != self.profile:
                self.profile = v
                self.profile_changed.emit(v)
        elif t == "room" and isinstance(d, dict):
            v = RoomState.from_dict(d)
            if v != self.room:
                self.room = v
                self.room_changed.emit(v)
        elif t == "cards" and isinstance(d, dict):
            if d != self.cards:
                self.cards = d
                self.cards_changed.emit(d)
        elif t == "eq":
            v = d if isinstance(d, str) else ""
            if v != self.eq:
                self.eq = v
                self.eq_changed.emit(v)
        elif t == "chat" and isinstance(d, dict):
            self.chat_received.emit(ChatLine.from_dict(d))
        elif t == "react" and isinstance(d, dict):
            self.react_received.emit(d)
        elif t == "devices" and isinstance(d, list):
            devs = [x for x in d if isinstance(x, dict) and x.get("id") not in ("", "default", "communications")]
            self.devices_changed.emit(devs)
        elif t == "ready":
            self._set_ready(True)

    def _set_ready(self, v: bool):
        if v != self.ready:
            self.ready = v
            self.ready_changed.emit(v)

    # ---- 指示 ----

    def cmd(self, d: dict):
        js = "window.__pm && window.__pm.cmd(" + json.dumps(d, ensure_ascii=False) + ")"
        self._page.runJavaScript(js)

    def eval(self, js: str, done=None):
        if done is None:
            self._page.runJavaScript(js)
        else:
            self._page.runJavaScript(js, done)

    # ---- 部屋リンクで入る（Mac/Win 版 openLink の移植） ----

    def open_link(self, text: str, done):
        """done には 'joined' | 'asleep' | 'choose' | 'invalid' | 'timeout' のどれかが返る。"""
        from .model import parse_room_link

        hash_ = parse_room_link(text)
        if hash_ is None:
            return
        self._set_ready(False)
        self._load(hash_)
        probe = (
            "JSON.stringify({t: (document.getElementById('entryText')||{}).textContent||'', "
            "n: !!(document.getElementById('entryNote')&&!document.getElementById('entryNote').hidden), "
            "name: (document.getElementById('room')||{}).value||''})"
        )
        state = {"n": 0, "asleep": 0, "idle": 0, "join_wait": 0}
        timer = QTimer(self)

        def finish(result):
            timer.stop()
            done(result)

        def step():
            state["n"] += 1
            if self.room.joined:
                finish("joined")
                return
            if state["n"] > 80:  # 最大 40 秒
                finish("timeout")
                return
            if not self.ready:
                return
            if state["join_wait"]:
                state["join_wait"] += 1
                if state["join_wait"] > 40:
                    finish("timeout")
                return

            def on_probe(res):
                try:
                    o = json.loads(res) if res else {}
                except Exception:  # noqa: BLE001
                    return
                t = o.get("t", "")
                name = o.get("name", "")
                shown = bool(o.get("n"))
                if "いま開いています" in t and name:
                    self.cmd({"type": "entryJoin"})
                    state["join_wait"] = 1
                elif "同じ名前の部屋" in t:
                    finish("choose")
                elif "😴" in t:
                    state["asleep"] += 1
                    if state["asleep"] > 2:
                        finish("asleep")
                elif not shown and not t and not name:
                    state["idle"] += 1
                    if state["idle"] > 10:
                        finish("invalid")
                else:
                    state["idle"] = 0
                    state["asleep"] = 0

            self.eval(probe, on_probe)

        timer.timeout.connect(step)
        timer.start(500)

    # ---- Qt 側のイベント ----

    def _on_permission(self, origin: QUrl, feature):
        grant = QWebEnginePage.PermissionPolicy.PermissionGrantedByUser
        deny = QWebEnginePage.PermissionPolicy.PermissionDeniedByUser
        ok_kinds = (
            QWebEnginePage.Feature.MediaAudioCapture,
            QWebEnginePage.Feature.MediaVideoCapture,
            QWebEnginePage.Feature.MediaAudioVideoCapture,
            QWebEnginePage.Feature.ClipboardReadWrite,
        )
        self._page.setFeaturePermission(
            origin, feature, grant if (feature in ok_kinds and origin.host() == "potalk.app") else deny
        )

    def _on_terminated(self, *_args):
        self.log.emit("ページの描画プロセスが落ちました。読み込み直します")
        self.reload()
