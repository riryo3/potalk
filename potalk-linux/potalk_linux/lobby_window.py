"""ロビー（本体の窓）。部屋の一覧・検索・作成・プロフィールの入口。

並びは Mac 版・Windows 版に倣っている: 最上段にプロフィールとマイク、
ボタン行、検索＋更新、カード型の部屋一覧、下段に通知とテーマ。
"""
from __future__ import annotations

from PySide6.QtCore import Qt, QUrl, Signal
from PySide6.QtGui import QClipboard, QDesktopServices
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from .engine import HOME as HOME_URL
from .engine import Engine
from .model import LobbyState, ProfileState, filter_rooms
from .room_card import ROOM_ROLE, RoomCardDelegate

THEME_ITEMS = [("システムに合わせる", "system"), ("ライト", "light"), ("ダーク", "dark")]


class ProfileDialog(QDialog):
    """名前とアバターの設定（ページ側のプロフィールに反映される）。"""

    def __init__(self, engine: Engine, parent=None):
        super().__init__(parent)
        self.engine = engine
        self.setWindowTitle("名前・アバター")
        lay = QVBoxLayout(self)
        self.name_edit = QLineEdit(engine.profile.input or engine.profile.name)
        self.name_edit.setMaxLength(20)
        lay.addWidget(QLabel("名前"))
        lay.addWidget(self.name_edit)
        lay.addWidget(QLabel("アバター"))
        grid = QGridLayout()
        self._avatar_btns: list[QToolButton] = []
        for i, av in enumerate(engine.profile.avatars):
            b = QToolButton()
            b.setText(av.em)
            b.setCheckable(True)
            b.setChecked(av.on)
            b.clicked.connect(lambda _=False, idx=i: self._pick_avatar(idx))
            grid.addWidget(b, i // 6, i % 6)
            self._avatar_btns.append(b)
        lay.addLayout(grid)
        box = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        box.rejected.connect(self.reject)
        box.accepted.connect(self.accept)
        lay.addWidget(box)
        self.name_edit.editingFinished.connect(self._apply_name)

    def _apply_name(self):
        name = self.name_edit.text()
        if name and name != self.engine.profile.input:
            self.engine.cmd({"type": "setName", "name": name})

    def _pick_avatar(self, idx: int):
        self.engine.cmd({"type": "setAvatar", "i": idx})
        for i, b in enumerate(self._avatar_btns):
            b.setChecked(i == idx)


class AboutDialog(QDialog):
    """「これはなに？」の説明。"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("これはなに？")
        lay = QVBoxLayout(self)
        text = QLabel(
            "Potalker は、ぽっと通話（potalk.app）の非公式クライアントです。\n"
            "Mac 版・Windows 版と同じ仕組みで、画面に出ない WebView で potalk.app を"
            "そのまま動かし、画面だけを Linux 向けに作り直しています。\n"
            "ぽっと通話本体とは関係のない有志のクライアントです。"
            "利用は自己責任でお願いします。"
        )
        text.setWordWrap(True)
        lay.addWidget(text)
        row = QHBoxLayout()
        b_open = QPushButton("potalk.app を開く")
        b_open.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(HOME_URL)))
        box = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        box.rejected.connect(self.reject)
        row.addWidget(b_open)
        row.addStretch(1)
        row.addWidget(box)
        lay.addLayout(row)


class LobbyWindow(QWidget):
    join_requested = Signal(str)     # room id（App 側で二重入室などを捌く場合に使う）
    create_requested = Signal(str, str)
    mic_changed = Signal(str)        # 選んだマイクの名前
    close_requested = Signal()       # 終了の確認は App 側で行う
    single_pane_toggled = Signal(bool)
    theme_changed = Signal(str)      # system / light / dark

    notify_on = False                # 「部屋の通知」のチェック状態（App が効果音にも使う）

    def closeEvent(self, event):  # noqa: N802 (Qt naming)
        event.ignore()
        self.close_requested.emit()

    def __init__(self, engine: Engine):
        super().__init__()
        self.engine = engine
        self.setWindowTitle("Potalker")
        self.resize(400, 600)

        lay = QVBoxLayout(self)

        # 最上段: プロフィールとマイク
        prof = QHBoxLayout()
        self.emoji_label = QLabel("🙂")
        self.emoji_label.setStyleSheet("font-size: 28px;")
        self.name_label = QLabel("名前・アバターを設定")
        self.mic_combo = QComboBox()
        self.mic_combo.addItem("（既定）", "")
        self.mic_combo.setMaximumWidth(170)
        self.mic_combo.currentIndexChanged.connect(
            lambda _i: self.mic_changed.emit(self.mic_combo.currentData() or "")
        )
        prof.addWidget(self.emoji_label)
        prof.addWidget(self.name_label, 1)
        prof.addWidget(QLabel("🎤"))
        prof.addWidget(self.mic_combo)
        lay.addLayout(prof)

        # ボタン行
        btn_row = QHBoxLayout()
        b_about = QPushButton("？ これはなに？")
        b_about.clicked.connect(lambda: AboutDialog(self).exec())
        b_create = QPushButton("🏠 部屋を作る")
        b_create.clicked.connect(lambda: self._create("chat"))
        btn_prof = QPushButton("名前・アバター…")
        btn_prof.clicked.connect(self._open_profile)
        btn_card = QPushButton("名刺…")
        btn_card.clicked.connect(lambda: engine.cmd({"type": "cardEdit"}))
        btn_row.addWidget(b_about)
        btn_row.addWidget(b_create)
        btn_row.addStretch(1)
        btn_row.addWidget(btn_prof)
        btn_row.addWidget(btn_card)
        lay.addLayout(btn_row)

        # 部屋名と配信部屋
        create_row = QHBoxLayout()
        self.new_name = QLineEdit()
        self.new_name.setPlaceholderText("部屋の名前（空でも作れます）")
        self.new_name.setMaxLength(30)
        b_bc = QPushButton("📣 配信部屋を作る")
        b_bc.clicked.connect(lambda: self._create("bc"))
        create_row.addWidget(self.new_name, 1)
        create_row.addWidget(b_bc)
        lay.addLayout(create_row)

        # 検索＋更新
        search_row = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("部屋・タグ・人の名前で検索（部屋のURLでも可）")
        self.search.textChanged.connect(lambda _t: self._refresh_rooms())
        b_refresh = QPushButton("🔄 更新")
        b_refresh.clicked.connect(lambda: engine.cmd({"type": "refreshLobby"}))
        search_row.addWidget(self.search, 1)
        search_row.addWidget(b_refresh)
        lay.addLayout(search_row)

        # リンクで入る
        link_row = QHBoxLayout()
        self.link_edit = QLineEdit()
        self.link_edit.setPlaceholderText("部屋のリンクを貼る")
        b_link = QPushButton("リンクで入る")
        b_link.clicked.connect(self._open_link)
        link_row.addWidget(self.link_edit, 1)
        link_row.addWidget(b_link)
        lay.addLayout(link_row)

        # 一覧（カード型）
        self.list = QListWidget()
        self.list.setMouseTracking(True)
        delegate = RoomCardDelegate(self.list)
        delegate.share_clicked.connect(self._share_room)
        self.list.setItemDelegate(delegate)
        self.list.itemDoubleClicked.connect(self._join_item)
        lay.addWidget(self.list, 1)

        # 下段: 通知と見ている人数
        foot = QHBoxLayout()
        self.notify = QPushButton("🔔 部屋の通知：オフ")
        self.notify.setObjectName("pillButton")
        self.notify.setCheckable(True)
        self.notify.toggled.connect(self._on_notify_toggled)
        self.quiet = QCheckBox("静かに入る")
        self.viewers_label = QLabel("")
        foot.addWidget(self.notify)
        foot.addWidget(self.quiet)
        foot.addStretch(1)
        foot.addWidget(self.viewers_label)
        lay.addLayout(foot)

        # 最下段: 単一窓とテーマ
        foot2 = QHBoxLayout()
        self.single_pane = QCheckBox("単一窓モード（Ctrl+Shift+P）")
        self.single_pane.toggled.connect(lambda on: self.single_pane_toggled.emit(on))
        self.theme_combo = QComboBox()
        for label, mode in THEME_ITEMS:
            self.theme_combo.addItem(label, mode)
        self.theme_combo.currentIndexChanged.connect(
            lambda _i: self.theme_changed.emit(self.theme_combo.currentData() or "system")
        )
        foot2.addWidget(self.single_pane)
        foot2.addStretch(1)
        foot2.addWidget(QLabel("テーマ"))
        foot2.addWidget(self.theme_combo)
        lay.addLayout(foot2)
        self.status_label = QLabel("")
        lay.addWidget(self.status_label)

        engine.lobby_changed.connect(self._on_lobby)
        engine.profile_changed.connect(self._on_profile)
        self._lobby = LobbyState()

    def set_theme_mode(self, mode: str):
        """テーマのプルダウンを、保存済みの設定に合わせる（信号は止める）。"""
        idx = self.theme_combo.findData(mode)
        self.theme_combo.blockSignals(True)
        self.theme_combo.setCurrentIndex(idx if idx >= 0 else 0)
        self.theme_combo.blockSignals(False)

    # ---- 状態の反映 ----

    def _on_lobby(self, st: LobbyState):
        self._lobby = st
        self.status_label.setText(st.status)
        self.viewers_label.setText(st.viewers)
        self._refresh_rooms()

    def _on_profile(self, st: ProfileState):
        self.emoji_label.setText(st.emoji or "🙂")
        self.name_label.setText(st.name or "名前・アバターを設定")

    def _refresh_rooms(self):
        rooms = filter_rooms(self._lobby.rooms, self.search.text())
        self.list.clear()
        for r in rooms:
            head = ("📣 " if r.bc else "🏠 ") + (r.name or "（名前なし）")
            if r.count:
                head += f"（{r.count}人）"
            item = QListWidgetItem(head)
            item.setData(Qt.ItemDataRole.UserRole, r.id)
            item.setData(ROOM_ROLE, r)
            self.list.addItem(item)

    def _on_notify_toggled(self, on: bool):
        self.notify_on = on
        self.notify.setText("🔔 部屋の通知：オン" if on else "🔔 部屋の通知：オフ")
        self.engine.cmd({"type": "sndRoom", "on": on})

    def _share_room(self, rid: str):
        if rid:
            QApplication.clipboard().setText(HOME_URL + "#room=" + rid, QClipboard.Mode.Clipboard)
            self.status_label.setText("部屋のリンクをコピーしました")

    # ---- マイク ----

    def set_devices(self, devices: list[dict]):
        cur = self.mic_combo.currentData()
        self.mic_combo.blockSignals(True)
        self.mic_combo.clear()
        self.mic_combo.addItem("（既定）", "")
        for d in devices:
            label = d.get("label") or d.get("id") or ""
            if label:
                self.mic_combo.addItem(label, label)
        idx = self.mic_combo.findData(cur)
        self.mic_combo.setCurrentIndex(idx if idx >= 0 else 0)
        self.mic_combo.blockSignals(False)

    # ---- 操作 ----

    def _create(self, kind: str):
        name = self.new_name.text()
        self.engine.cmd({"type": "create", "name": name, "kind": kind})
        self.create_requested.emit(name, kind)

    def _join_item(self, item: QListWidgetItem):
        rid = item.data(Qt.ItemDataRole.UserRole)
        if rid:
            self.engine.cmd({"type": "join", "id": rid, "quiet": self.quiet.isChecked()})
            self.join_requested.emit(rid)

    def _open_link(self):
        text = self.link_edit.text().strip()
        if not text:
            return

        def done(result: str):
            msgs = {
                "joined": "入室しました",
                "asleep": "部屋は眠っているようです",
                "choose": "同じ名前の部屋が複数あります。一覧から選んでください",
                "invalid": "部屋のリンクとして読み取れませんでした",
                "timeout": "入室が時間切れになりました",
            }
            self.status_label.setText(msgs.get(result, result))

        self.engine.open_link(text, done)

    def _open_profile(self):
        dlg = ProfileDialog(self.engine, self)
        dlg.exec()
