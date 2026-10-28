"""アプリ全体の取りまとめ（Mac 版の AppModel / AppDelegate にあたる）。

窓とエンジンをつなぎ、名刺・おたより・公開レターのような付随する窓の開閉、
単一窓モード、ショートカット、効果音、終了の確認、マイクの選択といった、
窓をまたぐ振る舞いを持つ。

単一窓モードは、通話中の部屋を中心にした形（Mac 版・Windows 版と同じ考え方）：
- 入室前は、ロビーが主役の窓として出る
- 入室すると、部屋の窓が主役になる。部屋一覧は部屋の左端の帯から開く
  引き出し（ロビー）として部屋の脇に出て、部屋を動かすと付いてくる。
  出る側は画面の空きで決める
- ひとことは、部屋の下の引き出し（見出しを押して開閉、新着の数が出る）
- 設定は部屋の上部のタブにあり、おたよりは部屋から開く小窓のまま
"""
from __future__ import annotations

import json
import sys

from PySide6.QtCore import QObject, QSettings, Qt
from PySide6.QtGui import QGuiApplication, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QApplication,
    QMessageBox,
    QSystemTrayIcon,
)

from .card_windows import CardAuthDialog, CardEditDialog, CardViewDialog, IgnoreAskDialog
from .engine import Engine
from .lobby_window import LobbyWindow
from .mail_window import LetterWindow, MailWindow
from .model import CardAuthState, CardEditState, LobbyState, RoomState, choose_drawer_side, drawer_x
from .room_window import RoomWindow
from .sounds import SoundPlayer


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
        self.drawer_open = False
        self.drawer_side = "left"

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
        self.room.pin_toggled.connect(self._toggle_pin)
        self.room.drawer_toggle_requested.connect(self.toggle_drawer)
        self.room.close_requested.connect(self._on_room_close_requested)
        self.room.geometry_changed.connect(self.place_drawer)

        self.lobby.single_pane.blockSignals(True)
        self.lobby.single_pane.setChecked(self.single_pane)
        self.lobby.single_pane.blockSignals(False)

        geo = self.settings.value("lobby/geometry")
        if geo is not None:
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
        self.room.set_pane_mode(self.single_pane)
        self.lobby.show()
        self.engine.start()

    def set_single_pane(self, on: bool):
        if on == self.single_pane:
            return
        self.single_pane = on
        self.settings.setValue("ui/singlePane", on)
        if self.lobby.single_pane.isChecked() != on:
            self.lobby.single_pane.blockSignals(True)
            self.lobby.single_pane.setChecked(on)
            self.lobby.single_pane.blockSignals(False)
        self.room.set_pane_mode(on)
        self.mail.hide()
        if on and self.engine.room.joined:
            self.drawer_open = True
            self.room.show()
            self.room.raise_()
            self.place_drawer()
            self.room.set_drawer_open_hint(True)
        else:
            self.drawer_open = False
            if not on and self.engine.room.joined:
                self.room.show()
            self.lobby.show()

    def _toggle_pin(self, on: bool):
        self.room.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, on)
        self.room.show()

    def _on_room_close_requested(self):
        if self.single_pane:
            self.request_close()
        else:
            self.room.hide()

    # ---- ひとこと（下の引き出し） ----

    def _on_chat_msg(self):
        if self.single_pane and self.engine.room.joined and not self.room.chat_open:
            self.room.bump_unread()

    # ---- 引き出し（ロビー） ----

    def place_drawer(self):
        """ロビーを、部屋の窓の脇に置く。出る側は画面の空きで決める（Mac/Win と同じ規則）。"""
        if not self.single_pane or not self.drawer_open:
            return
        if not self.engine.room.joined:
            return
        anchor = self.room
        screen = anchor.screen() or QGuiApplication.primaryScreen()
        if screen is None:
            return
        avail = screen.availableGeometry()
        w = max(self.lobby.width(), 360)
        side = choose_drawer_side(
            anchor.x(), anchor.x() + anchor.width(), avail.x(), avail.x() + avail.width(), w
        )
        self.drawer_side = side
        x = drawer_x(side, anchor.x(), anchor.x() + anchor.width(), w)
        self.lobby.resize(w, anchor.height())
        self.lobby.move(x, anchor.y())
        if not self.lobby.isVisible():
            self.lobby.show()

    def toggle_drawer(self):
        if not self.single_pane or not self.engine.room.joined:
            return
        self.drawer_open = not self.drawer_open
        self.room.set_drawer_open_hint(self.drawer_open)
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
        if self.engine.room.joined:
            self.room.cycle_tab(d)

    def _focus_lobby(self):
        if self.single_pane and self.engine.room.joined:
            self.drawer_open = True
            self.room.set_drawer_open_hint(True)
            self.place_drawer()
            self.lobby.raise_()
            self.lobby.search.setFocus()
        else:
            self.lobby.show()
            self.lobby.raise_()
            self.lobby.activateWindow()

    def _show_room(self):
        if self.single_pane:
            self.room.set_tab(0)
        self.room.show()
        self.room.raise_()
        self.room.activateWindow()

    def _focus_chat(self):
        self._show_room()
        if self.single_pane:
            self.room.set_chat_open(True)
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
        drawer_now = self.single_pane and self.engine.room.joined
        if self.engine.room.joined:
            box = QMessageBox(self.room if drawer_now else self.lobby)
            box.setWindowTitle("Potalker")
            box.setText("入室中です。退出して終了しますか？")
            b_leave = box.addButton("退出して終了", QMessageBox.ButtonRole.AcceptRole)
            box.addButton("やめる", QMessageBox.ButtonRole.RejectRole)
            box.exec()
            if box.clickedButton() is not b_leave:
                return
            self.engine.cmd({"type": "leave"})
        if not drawer_now:
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
        if st.joined:
            self.room.show()
            self.room.raise_()
            if self.single_pane:
                # ロビーは部屋の引き出しになる
                self.drawer_open = True
                self.room.set_drawer_open_hint(True)
                self.place_drawer()
        else:
            self.room.hide()
            if self.single_pane:
                self.drawer_open = False
                self.room.set_drawer_open_hint(False)
                self.lobby.show()
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
        if not self.engine.room.joined:
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
