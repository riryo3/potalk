"""アプリ全体の取りまとめ（Mac 版の AppModel / AppDelegate にあたる）。

窓とエンジンをつなぎ、名刺・おたより・公開レターのような付随する窓の開閉、
単一窓モード、ショートカット、効果音、終了の確認、マイクの選択といった、
窓をまたぐ振る舞いを持つ。

単一窓モードは Windows 版（PaneView / MainWindow）と同じ形：
- 入室前は、本体いっぱいにロビーが出る
- 入室すると、本体がタブ画面（部屋／おたより／設定）に切り替わり、
  ロビーは引き出し（別窓）として本体の脇に出る。出る側は画面の空きで決める
- ひとことは下の引き出し（見出しを押して開閉、新着の数が出る）
- 部屋以外のタブでも、ミュート・スピーカー・共有・退出の小さなバーが出る
"""
from __future__ import annotations

import json
import sys

from PySide6.QtCore import QObject, QSettings, Qt
from PySide6.QtGui import QGuiApplication, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QHBoxLayout,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSystemTrayIcon,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from .card_windows import CardAuthDialog, CardEditDialog, CardViewDialog, IgnoreAskDialog
from .engine import Engine
from .lobby_window import LobbyWindow
from .mail_window import LetterWindow, MailWindow
from .model import CardAuthState, CardEditState, LobbyState, RoomState, choose_drawer_side, drawer_x
from .room_window import RoomWindow
from .sounds import SoundPlayer


class _Shell(QMainWindow):
    """単一窓モードの本体。中央はロビー（入室前）か、タブ画面（入室中）。"""

    def __init__(self, app: "App"):
        super().__init__()
        self._app = app
        self.setWindowTitle("Potalker")
        self.resize(560, 640)

    def closeEvent(self, event):  # noqa: N802
        event.ignore()
        self._app.request_close()

    def moveEvent(self, event):  # noqa: N802
        super().moveEvent(event)
        self._app.place_drawer()

    def resizeEvent(self, event):  # noqa: N802
        super().resizeEvent(event)
        self._app.place_drawer()


class App(QObject):
    def __init__(self, qapp: QApplication):
        super().__init__()
        self.qapp = qapp
        self.settings = QSettings("Potalker", "Potalker")
        self.engine = Engine()
        self.lobby = LobbyWindow(self.engine)
        self.room = RoomWindow(self.engine)
        self.mail = MailWindow(self.engine)
        self.letter = LetterWindow()
        self.sounds = SoundPlayer()

        self.card_view: CardViewDialog | None = None
        self._card_key = ""
        self.ignore_dlg: IgnoreAskDialog | None = None
        self._ignore_key = ""
        self.card_edit: CardEditDialog | None = None
        self.card_auth: CardAuthDialog | None = None
        self._letter_key = ""
        self._last_hands = 0
        self._seen_rooms: set[str] = set()
        self._lobby_armed = False

        self.single_pane = self.settings.value("ui/singlePane", False, bool)
        self.shell: _Shell | None = None
        self.pane: QWidget | None = None
        self.tabs: QTabWidget | None = None
        self.drawer_open = False
        self.drawer_side = "left"
        self.chat_open = False
        self.unread = 0

        self.engine.log.connect(lambda m: print("[engine]", m, file=sys.stderr))
        self.engine.ready_changed.connect(self._on_ready)
        self.engine.devices_changed.connect(self.lobby.set_devices)
        self.engine.room_changed.connect(self._on_room)
        self.engine.cards_changed.connect(self._on_cards)
        self.engine.lobby_changed.connect(self._on_lobby)
        self.engine.react_received.connect(self._on_react)
        self.lobby.mic_changed.connect(self._on_mic_chosen)
        self.lobby.close_requested.connect(self._on_lobby_close_requested)
        self.lobby.single_pane_toggled.connect(self.set_single_pane)
        self.room.mail_requested.connect(self._open_mail)
        self.room.chat_panel.message_received.connect(self._on_chat_msg)

        self.lobby.single_pane.blockSignals(True)
        self.lobby.single_pane.setChecked(self.single_pane)
        self.lobby.single_pane.blockSignals(False)

        geo = self.settings.value("lobby/geometry")
        if geo is not None and not self.single_pane:
            self.lobby.restoreGeometry(geo)

        self._setup_tray()
        self._setup_shortcuts()

        # テーマ（ライト／ダーク／システム）
        from . import theme as _theme

        self._theme_mod = _theme
        self.theme_mode = self.settings.value("ui/theme", "system") or "system"
        self.lobby.set_theme_mode(self.theme_mode)
        self.lobby.theme_changed.connect(self._on_theme_changed)
        _theme.apply_theme(self.qapp, self.theme_mode)
        try:
            self.qapp.styleHints().colorSchemeChanged.connect(
                lambda _s: self.theme_mode == "system"
                and _theme.apply_theme(self.qapp, self.theme_mode)
            )
        except Exception:  # noqa: BLE001
            pass

    def _on_theme_changed(self, mode: str):
        self.theme_mode = mode
        self.settings.setValue("ui/theme", mode)
        self._theme_mod.apply_theme(self.qapp, mode)
        self.lobby.list.viewport().update()

    # ---- 起動とモード ----

    def start(self):
        if self.single_pane:
            self._build_shell()
            self.shell.show()
            self._sync_pane()
        else:
            self.lobby.show()
        self.engine.start()

    def set_single_pane(self, on: bool):
        if on == self.single_pane and (self.shell is not None) == on:
            return
        self.single_pane = on
        self.settings.setValue("ui/singlePane", on)
        if self.lobby.single_pane.isChecked() != on:
            self.lobby.single_pane.blockSignals(True)
            self.lobby.single_pane.setChecked(on)
            self.lobby.single_pane.blockSignals(False)
        if on:
            self._build_shell()
            self.room.hide()
            self.mail.hide()
            self.shell.show()
            self._sync_pane()
        else:
            if self.shell is not None:
                self._panels_to_room()
                self.room.setParent(None)
                self.mail.setParent(None)
                self.lobby.setParent(None)
                self.shell.hide()
                self.shell.deleteLater()
                self.shell = None
                self.pane = None
                self.tabs = None
            self.drawer_open = False
            self.lobby.show()
            if self.engine.room.joined:
                self.room.show()

    def _build_shell(self):
        if self.shell is not None:
            return
        self.shell = _Shell(self)
        # タブ画面（入室中）
        pane = QWidget()
        lay = QVBoxLayout(pane)
        lay.setContentsMargins(0, 0, 0, 0)
        top = QHBoxLayout()
        self.pin_check = QCheckBox("📌 最前面")
        self.pin_check.toggled.connect(self._toggle_pin)
        top.addStretch(1)
        top.addWidget(self.pin_check)
        lay.addLayout(top)
        self.tabs = QTabWidget()
        self.tabs.addTab(self.room, "部屋")
        self.tabs.addTab(self.mail, "おたより")
        self.tabs.currentChanged.connect(lambda _i: self._sync_mini_bar())
        lay.addWidget(self.tabs, 1)
        # 部屋以外のタブでも手元にある小さなバー
        mini = QHBoxLayout()
        self.mini_main = QPushButton("🎤 ミュート")
        self.mini_main.clicked.connect(self._mini_main_clicked)
        self.mini_spk = QPushButton("🔊")
        self.mini_spk.clicked.connect(self.room.toggle_speaker)
        self.mini_share = QPushButton("🔗 URLを共有")
        self.mini_share.clicked.connect(self._mini_share)
        self.mini_leave = QPushButton("🚪 退出")
        self.mini_leave.clicked.connect(lambda: self.engine.cmd({"type": "leave"}))
        mini.addWidget(self.mini_main)
        mini.addWidget(self.mini_spk)
        mini.addWidget(self.mini_share)
        mini.addWidget(self.mini_leave)
        self.mini_bar = QWidget()
        self.mini_bar.setLayout(mini)
        lay.addWidget(self.mini_bar)
        # ひとこと（下の引き出し）
        self.chat_head = QPushButton("💬 ひとこと ▲")
        self.chat_head.setFlat(True)
        self.chat_head.clicked.connect(self._toggle_chat)
        lay.addWidget(self.chat_head)
        self.chat_host = QWidget()
        ch = QVBoxLayout(self.chat_host)
        ch.setContentsMargins(0, 0, 0, 0)
        self.chat_host.setMaximumHeight(190)
        self.chat_host.hide()
        lay.addWidget(self.chat_host)
        self.pane = pane
        self._panels_to_pane()

    def _panels_to_pane(self):
        """部屋の窓から、設定とひとことの部品をタブ画面へ移す。"""
        room = self.room
        room.main_layout.removeWidget(room.settings_panel)
        room.main_layout.removeWidget(room.chat_panel)
        room.chat_label.hide()
        self.tabs.addTab(room.settings_panel, "設定")
        self.chat_host.layout().addWidget(room.chat_panel)
        room.chat_panel.setMaximumHeight(16777215)

    def _panels_to_room(self):
        if self.tabs is None:
            return
        room = self.room
        idx = self.tabs.indexOf(room.settings_panel)
        if idx >= 0:
            self.tabs.removeTab(idx)
        room.main_layout.addWidget(room.settings_panel)
        self.chat_host.layout().removeWidget(room.chat_panel)
        room.chat_label.show()
        room.main_layout.addWidget(room.chat_panel)
        room.chat_panel.setMaximumHeight(200)

    def _sync_pane(self):
        """入室状態に合わせて、本体の中身（ロビー／タブ画面）と引き出しをそろえる。"""
        if not self.single_pane or self.shell is None:
            return
        joined = self.engine.room.joined
        if joined:
            if self.shell.centralWidget() is not self.pane:
                self.lobby.setParent(None)
                self.lobby.hide()
                self.shell.setCentralWidget(self.pane)
                self.drawer_open = True
            self.place_drawer()
            self._sync_mini_bar()
        else:
            self.drawer_open = False
            if self.shell.centralWidget() is not self.lobby:
                if self.shell.centralWidget() is self.pane:
                    self.pane.setParent(None)
                    self.pane.hide()
                self.lobby.hide()
                self.shell.setCentralWidget(self.lobby)

    def _toggle_pin(self, on: bool):
        if self.shell is None:
            return
        self.shell.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, on)
        self.shell.show()

    # ---- ひとこと（下の引き出し） ----

    def _toggle_chat(self):
        self.chat_open = not self.chat_open
        self.chat_host.setVisible(self.chat_open)
        if self.chat_open:
            self.unread = 0
        self._sync_chat_head()

    def _sync_chat_head(self):
        if not hasattr(self, "chat_head"):
            return
        if self.chat_open:
            self.chat_head.setText("💬 ひとこと ▼")
        elif self.unread > 0:
            self.chat_head.setText(f"💬 ひとこと 新着 {self.unread} ▲")
        else:
            self.chat_head.setText("💬 ひとこと ▲")

    def _on_chat_msg(self):
        if self.single_pane and self.engine.room.joined and not self.chat_open:
            self.unread += 1
            self._sync_chat_head()

    # ---- 小さなバー ----

    def _sync_mini_bar(self):
        if self.tabs is None:
            return
        on_room = self.tabs.currentWidget() is self.room
        self.mini_bar.setVisible(not on_room)
        st = self.engine.room
        raw = st.raw
        raise_ = raw.get("raise") or {}
        speak = raw.get("speak") or {}
        if raise_.get("show"):
            self.mini_main.setText("🙋 " + (raise_.get("label") or "通話希望"))
            self.mini_main.setEnabled(True)
            self._mini_action = "raise"
        elif speak.get("show"):
            self.mini_main.setText("🎙 " + (speak.get("label") or "マイクを使う"))
            self.mini_main.setEnabled(not speak.get("disabled"))
            self._mini_action = "speak"
        else:
            self.mini_main.setText("🔇 ミュート解除" if st.muted else "🎤 ミュート")
            self.mini_main.setEnabled(st.can_mute)
            self._mini_action = "mute"

    def _mini_main_clicked(self):
        act = getattr(self, "_mini_action", "mute")
        self.engine.cmd({"type": act})

    def _mini_share(self):
        from PySide6.QtGui import QClipboard
        from PySide6.QtWidgets import QApplication

        url = self.room.share_url()
        if url:
            QApplication.clipboard().setText(url, QClipboard.Mode.Clipboard)
            self.mini_share.setText("✓ コピーしました")
            from PySide6.QtCore import QTimer

            QTimer.singleShot(1500, lambda: self.mini_share.setText("🔗 URLを共有"))

    # ---- 引き出し（ロビー） ----

    def place_drawer(self):
        """ロビーを、本体の脇に置く。出る側は画面の空きで決める（Mac/Win と同じ規則）。"""
        if not self.single_pane or self.shell is None or not self.drawer_open:
            return
        if not self.engine.room.joined:
            return
        shell = self.shell
        screen = shell.screen() or QGuiApplication.primaryScreen()
        if screen is None:
            return
        avail = screen.availableGeometry()
        w = max(self.lobby.width(), 360)
        side = choose_drawer_side(
            shell.x(), shell.x() + shell.width(), avail.x(), avail.x() + avail.width(), w
        )
        self.drawer_side = side
        x = drawer_x(side, shell.x(), shell.x() + shell.width(), w)
        self.lobby.resize(w, shell.height())
        self.lobby.move(x, shell.y())
        if not self.lobby.isVisible():
            self.lobby.show()

    def toggle_drawer(self):
        if not self.single_pane or not self.engine.room.joined:
            return
        self.drawer_open = not self.drawer_open
        if self.drawer_open:
            self.place_drawer()
        else:
            self.lobby.hide()

    def _on_lobby_close_requested(self):
        if self.single_pane and self.engine.room.joined:
            # 入室中は、ロビーを閉じる = 引き出しをしまう（終了ではない）
            self.drawer_open = False
            self.lobby.hide()
        else:
            self.request_close()

    # ---- ショートカット（Win 版 Shortcuts.cs と同じ割り当て） ----

    def _setup_shortcuts(self):
        def sc(seq, fn):
            s = QShortcut(QKeySequence(seq), self.lobby)
            s.setContext(Qt.ShortcutContext.ApplicationShortcut)
            s.activated.connect(fn)
            return s

        self._shortcuts = [
            sc("Ctrl+Shift+P", lambda: self.set_single_pane(not self.single_pane)),
            sc("Ctrl+Shift+M", lambda: self.engine.room.joined and self.engine.cmd({"type": "mute"})),
            sc("Ctrl+Shift+S", lambda: self.engine.room.joined and self.room.toggle_speaker()),
            sc("Ctrl+1", self._focus_lobby),
            sc("Ctrl+2", lambda: self.engine.room.joined and self._show_room()),
            sc("Ctrl+3", lambda: self.engine.room.joined and self._focus_chat()),
            sc("Ctrl+4", lambda: self.engine.room.bcast and self._open_mail()),
            sc("Ctrl+L", self.toggle_drawer),
            sc("Ctrl+]", lambda: self._cycle_tab(1)),
            sc("Ctrl+[", lambda: self._cycle_tab(-1)),
        ]

    def _cycle_tab(self, d: int):
        if self.single_pane and self.tabs is not None and self.engine.room.joined:
            self.tabs.setCurrentIndex((self.tabs.currentIndex() + d) % self.tabs.count())

    def _focus_lobby(self):
        if self.single_pane and self.shell is not None:
            self.shell.show()
            self.shell.raise_()
            if self.engine.room.joined:
                self.drawer_open = True
                self.place_drawer()
            self.lobby.search.setFocus()
        else:
            self.lobby.show()
            self.lobby.raise_()
            self.lobby.activateWindow()

    def _show_room(self):
        if self.single_pane and self.shell is not None and self.tabs is not None:
            self.tabs.setCurrentWidget(self.room)
            self.shell.raise_()
        else:
            self.room.show()
            self.room.raise_()
            self.room.activateWindow()

    def _focus_chat(self):
        if self.single_pane:
            self._show_room()
            if not self.chat_open:
                self._toggle_chat()
            self.room.chat_panel.chat_edit.setFocus()
        else:
            self._show_room()
            self.room.chat_panel.chat_edit.setFocus()

    # ---- トレイ（新しい部屋の通知） ----

    def _setup_tray(self):
        self.tray = None
        if QSystemTrayIcon.isSystemTrayAvailable():
            tray = QSystemTrayIcon(self)
            tray.setToolTip("Potalker")
            tray.activated.connect(lambda _r: self._focus_lobby())
            tray.show()
            self.tray = tray

    # ---- 基本 ----

    def _on_ready(self, ready: bool):
        if ready:
            # マイクの列挙には一度取得が要る（ページ側の作法）
            self.engine.cmd({"type": "probeMic"})
            label = self.settings.value("mic/label", "", str)
            if label:
                self.engine.cmd({"type": "setMicLabel", "label": label})

    def _on_mic_chosen(self, label: str):
        self.settings.setValue("mic/label", label)
        self.engine.cmd({"type": "setMicLabel", "label": label})
        self.engine.cmd({"type": "probeMic"})

    def request_close(self):
        if self.engine.room.joined:
            box = QMessageBox(self.shell if self.single_pane else self.lobby)
            box.setWindowTitle("Potalker")
            box.setText("入室中です。退出して終了しますか？")
            b_leave = box.addButton("退出して終了", QMessageBox.ButtonRole.AcceptRole)
            box.addButton("やめる", QMessageBox.ButtonRole.RejectRole)
            box.exec()
            if box.clickedButton() is not b_leave:
                return
            self.engine.cmd({"type": "leave"})
        if not self.single_pane:
            self.settings.setValue("lobby/geometry", self.lobby.saveGeometry())
        self.qapp.quit()

    # ---- ロビー（新しい部屋の通知） ----

    def _on_lobby(self, st: LobbyState):
        ids = {r.id or r.name for r in st.rooms}
        if self._lobby_armed and self.lobby.notify_on:
            for r in st.rooms:
                key = r.id or r.name
                if key not in self._seen_rooms:
                    self.sounds.notify()
                    if self.tray is not None:
                        self.tray.showMessage("新しい部屋ができました", r.name, QSystemTrayIcon.MessageIcon.Information, 4000)
                    break
        self._seen_rooms = ids
        if st.rooms or st.status:
            self._lobby_armed = True

    # ---- 部屋に付随する窓 ----

    def _on_room(self, st: RoomState):
        if not self.single_pane:
            if st.joined:
                self.room.show()
                self.room.raise_()
            else:
                self.room.hide()
        else:
            self._sync_pane()
            if st.joined:
                self._sync_mini_bar()
        # 名刺
        card_key = json.dumps(st.raw.get("card"), sort_keys=True, ensure_ascii=False) if st.card else ""
        if card_key != self._card_key:
            self._card_key = card_key
            if self.card_view is not None:
                self.card_view.close()
                self.card_view = None
            if st.card is not None:
                self.card_view = CardViewDialog(self.engine, st.card, self.room)
                self.card_view.show()
        # 「無視」の確認
        ask_key = json.dumps(st.raw.get("ignoreAsk"), sort_keys=True, ensure_ascii=False) if st.ignore_ask else ""
        if ask_key != self._ignore_key:
            self._ignore_key = ask_key
            if st.ignore_ask is not None:
                self.ignore_dlg = IgnoreAskDialog(self.engine, st.ignore_ask, self.room)
                self.ignore_dlg.exec()
                self.ignore_dlg = None
        # 手を挙げた人が増えたら音（配信者側。Win 版と同じ）
        hands = sum(1 for m in st.members if m.mark == "🙋")
        if hands > self._last_hands:
            self.sounds.notify()
        self._last_hands = hands
        # おたより・公開レター
        if self.mail.isVisible():
            self.mail.refresh(st.mail, st.bcast)
        now = st.mail_now
        letter_key = "" if (now is None or now.empty) else f"{now.cap}|{now.who}|{now.text}"
        if letter_key != self._letter_key:
            self._letter_key = letter_key
            if letter_key:
                self.letter.refresh(now)
                self.letter.show()
            else:
                self.letter.hide()

    def _on_react(self, d: dict):
        emoji = d.get("e") or ""
        if emoji:
            mine = self.engine.profile.name and d.get("n") == self.engine.profile.name
            self.room.fly_reaction(emoji, d.get("n") or "", bool(d.get("u") == "self" or mine))

    def _open_mail(self):
        if self.single_pane and self.shell is not None and self.tabs is not None and self.engine.room.joined:
            self.tabs.setCurrentWidget(self.mail)
            self.shell.raise_()
            return
        if self.single_pane and not self.engine.room.joined:
            return
        self.mail.refresh(self.engine.room.mail, self.engine.room.bcast)
        self.mail.show()
        self.mail.raise_()

    # ---- 名刺の編集・本人確認 ----

    def _on_cards(self, cards: dict):
        edit = cards.get("edit")
        if isinstance(edit, dict):
            st = CardEditState.from_dict(edit)
            if self.card_edit is None:
                self.card_edit = CardEditDialog(self.engine, self.lobby)
                self.card_edit.closed.connect(lambda: setattr(self, "card_edit", None))
                self.card_edit.show()
            self.card_edit.refresh(st)
        elif self.card_edit is not None:
            dlg, self.card_edit = self.card_edit, None
            dlg.close()
        auth = cards.get("auth")
        if isinstance(auth, dict):
            st = CardAuthState.from_dict(auth)
            if self.card_auth is None:
                self.card_auth = CardAuthDialog(self.engine, self.lobby)
                self.card_auth.closed.connect(lambda: setattr(self, "card_auth", None))
                self.card_auth.show()
            self.card_auth.refresh(st)
        elif self.card_auth is not None:
            dlg, self.card_auth = self.card_auth, None
            dlg.close()
