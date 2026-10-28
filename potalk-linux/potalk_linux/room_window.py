"""部屋の窓と、その部品（ひとこと・部屋の設定）。

通話中の部屋が中心。設定は上部のタブ、ひとことは下の引き出し、
部屋一覧は左端の帯から開く引き出し（ロビー）として、部屋に付随する。
"""
from __future__ import annotations

import random

from PySide6.QtCore import QPropertyAnimation, QPoint, Qt, Signal
from PySide6.QtGui import QClipboard
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QGraphicsOpacityEffect,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QPushButton,
    QSizePolicy,
    QSlider,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from .engine import Engine
from .model import ChatLine, RoomState

HOME_URL = "https://potalk.app/"


class ChatPanel(QWidget):
    """ひとこと（チャット）の部品。ログと入力欄。"""

    message_received = Signal()

    def __init__(self, engine: Engine):
        super().__init__()
        self.engine = engine
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        self.chat_list = QListWidget()
        lay.addWidget(self.chat_list, 1)
        row = QHBoxLayout()
        self.chat_edit = QLineEdit()
        self.chat_edit.setMaxLength(60)
        self.chat_edit.returnPressed.connect(self._send_chat)
        b_send = QPushButton("送る")
        b_send.clicked.connect(self._send_chat)
        row.addWidget(self.chat_edit, 1)
        row.addWidget(b_send)
        lay.addLayout(row)
        engine.chat_received.connect(self._on_chat)

    def _send_chat(self):
        text = self.chat_edit.text()
        if text:
            self.engine.cmd({"type": "chat", "text": text})
            self.chat_edit.clear()

    def _on_chat(self, line: ChatLine):
        prefix = "💬 " if not line.sys else ""
        who = f"{line.em} {line.who}: " if line.who else ""
        self.chat_list.addItem(QListWidgetItem(prefix + who + line.text))
        self.chat_list.scrollToBottom()
        self.message_received.emit()


class SettingsPanel(QWidget):
    """部屋の設定の部品。ページ側の設定項目をそのまま描く。"""

    def __init__(self, engine: Engine):
        super().__init__()
        self.engine = engine
        self.box = QVBoxLayout(self)
        self.box.setContentsMargins(0, 0, 0, 0)
        self._widgets: list[QWidget] = []

    def rebuild(self, settings: list[dict]):
        kinds = [s.get("k") for s in settings]
        if kinds == [w.property("kind") for w in self._widgets] and len(settings) == len(self._widgets):
            return
        for w in self._widgets:
            self.box.removeWidget(w)
            w.deleteLater()
        self._widgets = []
        for s in settings:
            k = s.get("k")
            if k == "range":
                row = QWidget()
                row.setProperty("kind", "range")
                h = QHBoxLayout(row)
                h.setContentsMargins(0, 0, 0, 0)
                h.addWidget(QLabel(s.get("label", "")))
                sl = QSlider(Qt.Orientation.Horizontal)
                sl.setMinimum(int(float(s.get("min", 0))))
                sl.setMaximum(int(float(s.get("max", 100))))
                sl.setValue(int(float(s.get("value", 0))))
                sid = s.get("id")
                sl.valueChanged.connect(lambda v, i=sid: self.engine.cmd({"type": "set", "id": i, "value": v}))
                h.addWidget(sl, 1)
                self.box.addWidget(row)
                self._widgets.append(row)
            elif k == "check":
                cb = QCheckBox(s.get("label", ""))
                cb.setProperty("kind", "check")
                cb.setChecked(bool(s.get("checked")))
                sid = s.get("id")
                cb.toggled.connect(lambda on, i=sid: self.engine.cmd({"type": "set", "id": i, "value": on}))
                self.box.addWidget(cb)
                self._widgets.append(cb)
            elif k == "note":
                lb = QLabel(s.get("text", ""))
                lb.setProperty("kind", "note")
                lb.setWordWrap(True)
                self.box.addWidget(lb)
                self._widgets.append(lb)
            elif k == "radios":
                row = QWidget()
                row.setProperty("kind", "radios")
                h = QHBoxLayout(row)
                h.setContentsMargins(0, 0, 0, 0)
                for it in s.get("items") or []:
                    b = QPushButton(it.get("label", ""))
                    b.setCheckable(True)
                    b.setChecked(bool(it.get("checked")))
                    iid = it.get("id")
                    b.clicked.connect(lambda _=False, i=iid: self.engine.cmd({"type": "set", "id": i, "value": True}))
                    h.addWidget(b)
                self.box.addWidget(row)
                self._widgets.append(row)


class RoomWindow(QWidget):
    """部屋の窓。通話中の部屋が中心で、単一窓モードでは両脇に引き出しを持つ。

    - 上部: 部屋／設定のタブと 📌（最前面）
    - 左端の細い帯（単一窓モードのみ）: 部屋一覧の引き出しの取っ手
    - 下部: ひとことは引き出し（単一窓モードのみ。窓モードでは常時表示）
    """

    mail_requested = Signal()
    pin_toggled = Signal(bool)
    drawer_toggle_requested = Signal()
    chat_toggled = Signal(bool)
    close_requested = Signal()
    geometry_changed = Signal()

    def __init__(self, engine: Engine):
        super().__init__()
        self.engine = engine
        self.setWindowTitle("部屋")
        self.resize(400, 640)
        self._spk_on = False
        self._room = RoomState()
        self._fx_anims: list = []
        self._pane = False
        self.chat_open = False
        self._unread = 0

        outer = QVBoxLayout(self)
        self.main_layout = outer

        # 上部: タブと最前面
        head = QHBoxLayout()
        self.tab_room = QPushButton("部屋")
        self.tab_room.setCheckable(True)
        self.tab_room.setChecked(True)
        self.tab_room.setFlat(True)
        self.tab_room.clicked.connect(lambda: self.set_tab(0))
        self.tab_settings = QPushButton("設定")
        self.tab_settings.setCheckable(True)
        self.tab_settings.setFlat(True)
        self.tab_settings.clicked.connect(lambda: self.set_tab(1))
        self.pin_check = QCheckBox("📌 最前面")
        self.pin_check.toggled.connect(lambda on: self.pin_toggled.emit(on))
        head.addWidget(self.tab_room)
        head.addWidget(self.tab_settings)
        head.addStretch(1)
        head.addWidget(self.pin_check)
        outer.addLayout(head)

        body = QHBoxLayout()
        outer.addLayout(body, 1)

        # 左端の帯（部屋一覧の引き出しの取っ手、単一窓モードのみ）
        self.strip = QPushButton("›\n部\n屋\n一\n覧")
        self.strip.setFixedWidth(22)
        self.strip.setStyleSheet("padding: 6px 0px;")
        self.strip.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Expanding)
        self.strip.clicked.connect(lambda: self.drawer_toggle_requested.emit())
        self.strip.hide()
        body.addWidget(self.strip)

        self.stack = QStackedWidget()
        body.addWidget(self.stack, 1)

        page = QWidget()
        self.room_page = page
        lay = QVBoxLayout(page)
        self.page_layout = lay
        self.stack.addWidget(page)
        self.settings_panel = SettingsPanel(engine)
        self.stack.addWidget(self.settings_panel)

        self.state_label = QLabel("")
        self.state_label.setObjectName("roomTitle")
        self.state_label.setWordWrap(True)
        lay.addWidget(self.state_label)

        # 話題タグ（見出しの直下の帯）
        tag_row = QHBoxLayout()
        self.tag_label = QLabel("")
        self.tag_label.setWordWrap(True)
        b_tag = QPushButton("変える")
        b_tag.setObjectName("pillButton")
        b_tag.clicked.connect(self._edit_tag)
        tag_row.addWidget(self.tag_label, 1)
        tag_row.addWidget(b_tag)
        self.tag_widget = QWidget()
        self.tag_widget.setLayout(tag_row)
        lay.addWidget(self.tag_widget)

        self.members = QListWidget()
        self.members.itemClicked.connect(self._member_clicked)
        self.members.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.members.customContextMenuRequested.connect(self._member_menu)
        lay.addWidget(self.members, 1)

        # 接続の様子（ページの #eq を中央のピルで出す）
        eq_row = QHBoxLayout()
        self.eq_label = QLabel("")
        self.eq_label.setObjectName("pillLabel")
        self.eq_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        eq_row.addStretch(1)
        eq_row.addWidget(self.eq_label)
        eq_row.addStretch(1)
        lay.addLayout(eq_row)

        # リアクション
        self.react_row = QHBoxLayout()
        lay.addLayout(self.react_row)
        self._react_btns: list[QPushButton] = []

        # 操作（Mac/Win の並び: 大きなマイク、発言まわり、共有と退出）
        self.btn_mic = QPushButton("🎙 マイク")
        self.btn_mic.setObjectName("warnButton")
        self.btn_mic.setCheckable(True)
        self.btn_mic.clicked.connect(lambda: engine.cmd({"type": "mute"}))
        self.btn_spk = QPushButton("🔊 スピーカー")
        self.btn_spk.setCheckable(True)
        self.btn_spk.clicked.connect(self.toggle_speaker)
        ctl = QHBoxLayout()
        ctl.addWidget(self.btn_mic, 1)
        ctl.addWidget(self.btn_spk)
        lay.addLayout(ctl)
        self.btn_speak = QPushButton("🎤 発言する")
        self.btn_speak.clicked.connect(lambda: engine.cmd({"type": "speak"}))
        self.btn_raise = QPushButton("✋ 手を挙げる")
        self.btn_raise.clicked.connect(lambda: engine.cmd({"type": "raise"}))
        self.btn_mail = QPushButton("✉ おたより")
        self.btn_mail.clicked.connect(lambda: self.mail_requested.emit())
        ctl2 = QHBoxLayout()
        ctl2.addWidget(self.btn_speak)
        ctl2.addWidget(self.btn_raise)
        ctl2.addWidget(self.btn_mail)
        lay.addLayout(ctl2)
        b_share = QPushButton("🔗 URLを共有")
        b_share.clicked.connect(self._copy_url)
        b_leave = QPushButton("🚪 退出")
        b_leave.setObjectName("dangerButton")
        b_leave.clicked.connect(lambda: engine.cmd({"type": "leave"}))
        ctl3 = QHBoxLayout()
        ctl3.addWidget(b_share, 1)
        ctl3.addWidget(b_leave, 1)
        lay.addLayout(ctl3)

        # ひとこと（単一窓では下の引き出し、窓モードでは常時表示）
        self.chat_head = QPushButton("💬 ひとこと ▲")
        self.chat_head.setFlat(True)
        self.chat_head.clicked.connect(lambda: self.set_chat_open(not self.chat_open))
        self.chat_head.hide()
        lay.addWidget(self.chat_head)
        self.chat_label = QLabel("ひとこと")
        lay.addWidget(self.chat_label)
        self.chat_panel = ChatPanel(engine)
        self.chat_panel.setMaximumHeight(200)
        lay.addWidget(self.chat_panel)

        engine.room_changed.connect(self._on_room)
        engine.eq_changed.connect(self.eq_label.setText)

    # ---- 単一窓モードとの切り替え ----

    def set_pane_mode(self, on: bool):
        self._pane = on
        self.strip.setVisible(on)
        self.chat_head.setVisible(on)
        if on:
            self.chat_label.hide()
            self.chat_panel.setVisible(self.chat_open)
        else:
            self.chat_label.show()
            self.chat_panel.setMaximumHeight(200)
            self.chat_panel.show()

    def set_tab(self, idx: int):
        self.stack.setCurrentIndex(idx)
        for i, b in enumerate((self.tab_room, self.tab_settings)):
            b.blockSignals(True)
            b.setChecked(i == idx)
            b.blockSignals(False)

    def cycle_tab(self, d: int):
        self.set_tab((self.stack.currentIndex() + d) % self.stack.count())

    def set_chat_open(self, on: bool):
        self.chat_open = on
        if on:
            self._unread = 0
        if self._pane:
            self.chat_panel.setVisible(on)
        self._sync_chat_head()
        self.chat_toggled.emit(on)

    def bump_unread(self):
        self._unread += 1
        self._sync_chat_head()

    def _sync_chat_head(self):
        if self.chat_open:
            self.chat_head.setText("💬 ひとこと ▼")
        elif self._unread > 0:
            self.chat_head.setText(f"💬 ひとこと（新着 {self._unread}）▲")
        else:
            self.chat_head.setText("💬 ひとこと ▲")

    def set_drawer_open_hint(self, open_: bool):
        self.strip.setText(("‹" if open_ else "›") + "\n部\n屋\n一\n覧")

    # ---- 窓の出来事 ----

    def closeEvent(self, event):  # noqa: N802 (Qt naming)
        event.ignore()
        self.close_requested.emit()

    def moveEvent(self, event):  # noqa: N802
        super().moveEvent(event)
        self.geometry_changed.emit()

    def resizeEvent(self, event):  # noqa: N802
        super().resizeEvent(event)
        self.geometry_changed.emit()

    # ---- 状態の反映 ----

    def _on_room(self, st: RoomState):
        self._room = st
        self.setWindowTitle(st.state or "部屋")
        self.state_label.setText(st.state)
        self.members.clear()
        for m in st.members:
            marks = []
            if m.you:
                marks.append("（あなた）")
            if m.muted:
                marks.append("🔇")
            if m.speaking:
                marks.append("🗣")
            if m.mark:
                marks.append(m.mark)
            if m.conn:
                marks.append("🌐" if m.conn == "direct" else "🛰" if m.conn == "relay" else "")
            text = f"{m.em} {m.name} {' '.join(x for x in marks if x)}"
            if m.stage:
                text += f" [{m.stage}]"
            self.members.addItem(QListWidgetItem(text))
        if st.more:
            self.members.addItem(QListWidgetItem(st.more))
        self.btn_mic.setEnabled(st.can_mute)
        self.btn_mic.setChecked(st.muted)
        self.btn_mic.setText("🔇 ミュート解除" if st.muted else "🎙 ミュート")
        raw = st.raw
        tag = raw.get("tag") or {}
        self.tag_widget.setVisible(bool(tag.get("show")))
        self.tag_label.setText(tag.get("text") or "")
        self.btn_mail.setVisible(st.bcast)
        speak = raw.get("speak") or {}
        raise_ = raw.get("raise") or {}
        self.btn_speak.setVisible(bool(speak.get("show")))
        self.btn_speak.setText(speak.get("label") or "🎤 発言する")
        self.btn_speak.setEnabled(not speak.get("disabled"))
        self.btn_raise.setVisible(bool(raise_.get("show")))
        self.btn_raise.setText(raise_.get("label") or "✋ 手を挙げる")
        self._rebuild_reactions(st.reactions)
        self.settings_panel.rebuild(raw.get("settings") or [])
        # 窓の出し隠しは App 側が担う

    def _rebuild_reactions(self, reactions: list[str]):
        if [b.text() for b in self._react_btns] == reactions:
            return
        for b in self._react_btns:
            self.react_row.removeWidget(b)
            b.deleteLater()
        self._react_btns = []
        for i, r in enumerate(reactions):
            b = QPushButton(r)
            b.setObjectName("pillButton")
            f = b.font()
            f.setPointSize(f.pointSize() + 3)
            b.setFont(f)
            b.clicked.connect(lambda _=False, idx=i: self.engine.cmd({"type": "react", "i": idx}))
            self.react_row.addWidget(b)
            self._react_btns.append(b)

    # ---- 操作 ----

    def toggle_speaker(self):
        self._spk_on = not self._spk_on
        self.engine.cmd({"type": "spk", "on": self._spk_on})
        self.btn_spk.setText("🔇 スピーカー（オフ）" if self._spk_on else "🔊 スピーカー")
        self.btn_spk.setChecked(self._spk_on)

    def share_url(self) -> str:
        return HOME_URL + "#room=" + self._room.rid if self._room.rid else ""

    def _copy_url(self):
        url = self.share_url()
        if url:
            QApplication.clipboard().setText(url, QClipboard.Mode.Clipboard)

    def _member_clicked(self, item: QListWidgetItem):
        idx = self.members.row(item)
        if 0 <= idx < len(self._room.members):
            self.engine.cmd({"type": "card", "i": idx})

    def _member_menu(self, pos):
        item = self.members.itemAt(pos)
        if item is None:
            return
        idx = self.members.row(item)
        if not (0 <= idx < len(self._room.members)):
            return
        m = self._room.members[idx]
        menu = QMenu(self)
        menu.addAction("名刺を見る", lambda: self.engine.cmd({"type": "card", "i": idx}))
        if m.tap and not m.you:
            menu.addAction("発言を許可する", lambda: self.engine.cmd({"type": "grant", "i": idx}))
        if not m.you:
            menu.addAction("無視する…", lambda: self.engine.cmd({"type": "ignoreRow", "i": idx}))
        menu.exec(self.members.viewport().mapToGlobal(pos))

    def _edit_tag(self):
        text, ok = QInputDialog.getText(self, "話題タグ", "話題タグ（30文字まで）", text="")
        if ok:
            self.engine.cmd({"type": "tag", "text": text[:30]})

    # ---- 飛ぶ絵文字 ----

    def fly_reaction(self, emoji: str, who: str, self_sent: bool):
        """リアクションの絵文字を、窓の下の方からふわっと浮かばせる（最大12個）。"""
        if not hasattr(self, "_fx_layer"):
            self._fx_layer = QWidget(self)
            self._fx_layer.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
            self._fx_layer.show()
        layer = self._fx_layer
        layer.setGeometry(self.rect())
        layer.raise_()
        if len(layer.children()) >= 12:
            return
        box = QWidget(layer)
        bl = QVBoxLayout(box)
        bl.setContentsMargins(0, 0, 0, 0)
        em = QLabel(emoji)
        em.setStyleSheet("font-size: 26px;")
        em.setAlignment(Qt.AlignmentFlag.AlignCenter)
        bl.addWidget(em)
        if who:
            nm = QLabel(who)
            nm.setStyleSheet("font-size: 10px; color: gray;")
            nm.setAlignment(Qt.AlignmentFlag.AlignCenter)
            bl.addWidget(nm)
        box.adjustSize()
        x = 40 + random.randint(-8, 8) if self_sent else max(40, random.randint(0, max(60, self.width() - 100)))
        y = max(120, int(self.height() * 0.6))
        box.move(x, y)
        box.show()
        eff = QGraphicsOpacityEffect(box)
        box.setGraphicsEffect(eff)
        up = QPropertyAnimation(box, b"pos", self)
        up.setDuration(1400)
        up.setStartValue(QPoint(x, y))
        up.setEndValue(QPoint(x, y - 110))
        fade = QPropertyAnimation(eff, b"opacity", self)
        fade.setDuration(1400)
        fade.setStartValue(1.0)
        fade.setEndValue(0.0)
        fade.finished.connect(box.deleteLater)
        up.start()
        fade.start()
        self._fx_anims += [up, fade]
