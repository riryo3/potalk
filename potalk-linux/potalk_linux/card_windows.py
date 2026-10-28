"""名刺まわりの窓：表示・編集・本人確認・「無視」の確認。

すべてページ側の状態（ブリッジ経由）に同期する。保存や検証の実処理はページが持ち、
ここは入力と表示だけ（Mac 版・Windows 版と同じ分担）。
"""
from __future__ import annotations

import base64

from PySide6.QtCore import QByteArray, QBuffer, QIODevice, Qt, Signal
from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices, QImage
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QRadioButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from .engine import Engine
from .model import CardAuthState, CardEditState, CardView, IgnoreAsk


class SyncedLineEdit(QLineEdit):
    """ページ側の値と同期する入力欄。入力中はページからの値で上書きしない。"""

    def __init__(self, on_commit):
        super().__init__()
        self._on_commit = on_commit
        self.editingFinished.connect(lambda: self._on_commit(self.text()))

    def sync(self, value: str):
        if not self.hasFocus() and self.text() != value:
            self.setText(value)


def _confirm(parent, title: str, body: str, yes_label: str) -> bool:
    box = QMessageBox(parent)
    box.setWindowTitle("Potalker")
    box.setText(title)
    box.setInformativeText(body)
    yes = box.addButton(yes_label, QMessageBox.ButtonRole.AcceptRole)
    box.addButton("やめる", QMessageBox.ButtonRole.RejectRole)
    box.exec()
    return box.clickedButton() is yes


class CardViewDialog(QDialog):
    """相手（または自分）の名刺。"""

    def __init__(self, engine: Engine, card: CardView, parent=None):
        super().__init__(parent)
        self.engine = engine
        self.setWindowTitle("名刺")
        self.setModal(False)
        lay = QVBoxLayout(self)
        head = QHBoxLayout()
        emoji = QLabel(card.emoji or "🙂")
        emoji.setStyleSheet("font-size: 30px;")
        head.addWidget(emoji)
        names = QVBoxLayout()
        nm = QLabel(card.name)
        nm.setStyleSheet("font-size: 17px; font-weight: bold;")
        names.addWidget(nm)
        if card.state:
            st = QLabel(card.state)
            st.setStyleSheet("color: gray;")
            names.addWidget(st)
        head.addLayout(names, 1)
        lay.addLayout(head)
        if card.bio:
            bio = QLabel(card.bio)
            bio.setWordWrap(True)
            lay.addWidget(bio)
        for s in card.socials:
            if not s.u:
                continue
            link = QLabel(f'<a href="{s.u}">{s.t or s.u}</a>')
            link.setOpenExternalLinks(False)
            link.linkActivated.connect(lambda u: _confirm(self, "リンクを開きますか？", u, "開く") and QDesktopServices.openUrl(QUrl(u)))
            lay.addWidget(link)
        if card.foot:
            foot = QLabel(card.foot)
            foot.setStyleSheet("font-weight: bold;")
            foot.setWordWrap(True)
            lay.addWidget(foot)
        if card.edit:
            b = QPushButton("✏️ 自分の名刺を編集する")
            b.clicked.connect(lambda: engine.cmd({"type": "cardEditFromCard"}))
            lay.addWidget(b)
        if card.has_ignore:
            b = QPushButton("❤ " + card.ignore_text)
            b.setEnabled(not card.ignore_disabled)
            b.clicked.connect(lambda: engine.cmd({"type": "cardIgnore"}))
            lay.addWidget(b)
        close = QPushButton("閉じる")
        close.clicked.connect(lambda: engine.cmd({"type": "cardClose"}))
        lay.addWidget(close)

    def closeEvent(self, event):  # noqa: N802
        self.engine.cmd({"type": "cardClose"})
        super().closeEvent(event)


class IgnoreAskDialog(QDialog):
    """「無視」の最終確認。"""

    def __init__(self, engine: Engine, ask: IgnoreAsk, parent=None):
        super().__init__(parent)
        self.setWindowTitle("確認")
        self.setModal(True)
        lay = QVBoxLayout(self)
        t = QLabel(ask.title)
        t.setStyleSheet("font-size: 15px; font-weight: bold;")
        t.setWordWrap(True)
        lay.addWidget(t)
        for item in ask.items:
            lb = QLabel("• " + item)
            lb.setWordWrap(True)
            lay.addWidget(lb)
        row = QHBoxLayout()
        yes = QPushButton(ask.yes or "無視する")
        yes.clicked.connect(lambda: (engine.cmd({"type": "ignoreYes"}), self.accept()))
        no = QPushButton(ask.no or "やめる")
        no.clicked.connect(lambda: (engine.cmd({"type": "ignoreNo"}), self.reject()))
        row.addWidget(yes)
        row.addWidget(no)
        lay.addLayout(row)


def _crop_to_jpeg_b64(path: str) -> str | None:
    """画像を中心で正方形に切り抜き、512×512 の JPEG にして base64 で返す（Qt だけで行う簡易版）。"""
    img = QImage(path)
    if img.isNull():
        return None
    side = min(img.width(), img.height())
    x = (img.width() - side) // 2
    y = (img.height() - side) // 2
    sq = img.copy(x, y, side, side).scaled(512, 512, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
    buf = QBuffer()
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    sq.save(buf, "JPEG", 85)
    data = bytes(buf.data())
    buf.close()
    return base64.b64encode(data).decode("ascii")


_TIPS = [
    ("none", "提示しない（非表示）", None, ""),
    ("ofuse", "☕ OFUSE", "tipOfuse", "URL または ユーザID"),
    ("amazon", "📦 ほしい物リスト", "tipAmazon", "URL または リストID"),
    ("zap", "⚡ Nostr Zap", "tipZap", "name@domain または npub"),
    ("kofi", "☕ Ko-fi", "tipKofi", "URL または ユーザ名"),
    ("bmac", "🥐 Buy Me Coffee", "tipBmac", "URL または ユーザ名"),
]

_SNS = [
    ("𝕏 (Twitter)", "snsX", "URL または @ID", "x"),
    ("🐙 GitHub", "snsGithub", "URL または ユーザ名", "github"),
    ("📝 note", "snsNote", "URL または クリエイター名", None),
    ("📸 Instagram", "snsInstagram", "URL または ユーザ名", None),
    ("▶️ YouTube", "snsYoutube", "URL または @ハンドル", None),
    ("🟣 Nostr", "snsNostr", "URL または npub1...", "nostr"),
]


class CardEditDialog(QDialog):
    closed = Signal()

    def __init__(self, engine: Engine, parent=None):
        super().__init__(parent)
        self.engine = engine
        self.setWindowTitle("名刺の設定")
        self.resize(520, 720)
        self._syncs: list = []

        root = QWidget()
        lay = QVBoxLayout(root)
        title = QLabel("📇 名刺（プロフィール）設定")
        title.setStyleSheet("font-size: 16px; font-weight: bold;")
        lay.addWidget(title)
        note = QLabel("端末にのみ保存され、相手があなたのアイコン・名前を押した時だけ直接渡されます。")
        note.setWordWrap(True)
        note.setStyleSheet("color: gray;")
        lay.addWidget(note)

        # アバター
        lay.addWidget(QLabel("名刺アイコン（画像または絵文字）"))
        av_row = QHBoxLayout()
        self.av_emoji = QLabel("🙂")
        self.av_emoji.setStyleSheet("font-size: 26px;")
        self.av_sub = QLabel("")
        av_row.addWidget(self.av_emoji)
        av_row.addWidget(self.av_sub)
        b_pick = QPushButton("📷 画像を選ぶ")
        b_pick.clicked.connect(self._pick_image)
        self.b_clear = QPushButton("画像を削除")
        self.b_clear.clicked.connect(lambda: engine.cmd({"type": "ceAvatarClear"}))
        av_row.addWidget(b_pick)
        av_row.addWidget(self.b_clear)
        lay.addLayout(av_row)
        self.av_msg = QLabel("")
        self.av_msg.setWordWrap(True)
        lay.addWidget(self.av_msg)

        # bio
        lay.addWidget(QLabel("ひとこと（bio）"))
        self.bio = SyncedLineEdit(lambda v: engine.cmd({"type": "ceField", "field": "bio", "value": v[:60]}))
        self.bio.setMaxLength(60)
        lay.addWidget(self.bio)
        self._syncs.append(lambda st: self.bio.sync(st.s("bio")))

        # チップ
        lay.addWidget(QLabel("お礼・チップ窓口（提示する1件を選択）"))
        self._tip_radios: dict[str, QRadioButton] = {}
        for v, name, field_name, ph in _TIPS:
            row = QHBoxLayout()
            rb = QRadioButton(name)
            rb.clicked.connect(lambda _=False, vv=v: engine.cmd({"type": "ceTipOpt", "v": vv}))
            row.addWidget(rb)
            self._tip_radios[v] = rb
            if field_name:
                box = SyncedLineEdit(lambda t, f=field_name: engine.cmd({"type": "ceField", "field": f, "value": t}))
                box.setPlaceholderText(ph)
                row.addWidget(box, 1)
                self._syncs.append(lambda st, f=field_name, b=box: b.sync(st.s(f)))
            lay.addLayout(row)
        self._syncs.append(self._sync_tips)

        # SNS
        lay.addWidget(QLabel("SNS ID（オプトイン本人確認対応）"))
        for name, field_name, ph, key in _SNS:
            row = QHBoxLayout()
            row.addWidget(QLabel(name))
            box = SyncedLineEdit(lambda t, f=field_name: engine.cmd({"type": "ceField", "field": f, "value": t}))
            box.setPlaceholderText(ph)
            row.addWidget(box, 1)
            self._syncs.append(lambda st, f=field_name, b=box: b.sync(st.s(f)))
            if key is None:
                row.addWidget(QLabel("自己申告"))
            else:
                btn = QPushButton("認証")
                btn.clicked.connect(lambda _=False, k=key, b=btn: self._verify_clicked(k, b))
                row.addWidget(btn)
                self._syncs.append(lambda st, k=key, b=btn: self._sync_verify(st, k, b))
            lay.addLayout(row)
        sns_note = QLabel("※ 各サービスのプロフィールURLを貼ると自動でIDに切り詰めます。「認証」で本人確認すると、相手が「✅ を確かめる」を押したときに確認できます。")
        sns_note.setWordWrap(True)
        sns_note.setStyleSheet("color: gray; font-size: 11px;")
        lay.addWidget(sns_note)

        self.no_img = QCheckBox("相手の名刺の画像を表示しない（絵文字だけにする）")
        self.no_img.toggled.connect(lambda on: engine.cmd({"type": "ceNoImg", "on": on}))
        lay.addWidget(self.no_img)
        self.warn = QLabel("")
        self.warn.setWordWrap(True)
        lay.addWidget(self.warn)

        outer = QVBoxLayout(self)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(root)
        outer.addWidget(scroll, 1)
        bar = QHBoxLayout()
        b_close = QPushButton("閉じる")
        b_close.clicked.connect(self.close)
        b_save = QPushButton("保存する")
        b_save.clicked.connect(lambda: engine.cmd({"type": "ceSave"}))
        bar.addWidget(b_close)
        bar.addStretch(1)
        bar.addWidget(b_save)
        outer.addLayout(bar)

    def _sync_tips(self, st: CardEditState):
        cur = st.s("tipOpt")
        for v, rb in self._tip_radios.items():
            rb.setChecked(v == cur)

    def _sync_verify(self, st: CardEditState, key: str, btn: QPushButton):
        ver = st.ver(key)
        if ver.get("verified"):
            btn.setText("✅ 認証済み（解除）")
            btn.setEnabled(True)
            btn.setProperty("mode", "unverify")
        elif ver.get("btnShow"):
            btn.setText(ver.get("btnLabel") or "認証")
            btn.setEnabled(not ver.get("btnDisabled"))
            btn.setProperty("mode", "verify")
        else:
            btn.setText("認証")
            btn.setEnabled(False)
            btn.setProperty("mode", "")

    def _verify_clicked(self, key: str, btn: QPushButton):
        if btn.property("mode") == "unverify":
            if _confirm(self, "認証を解除しますか？", "解除すると、相手の画面で ✅ が付かなくなります。", "解除する"):
                self.engine.cmd({"type": "ceUnverify", "k": key})
        else:
            self.engine.cmd({"type": "ceVerify", "k": key})

    def _pick_image(self):
        path, _ = QFileDialog.getOpenFileName(self, "画像を選ぶ", "", "画像 (*.png *.jpg *.jpeg *.gif *.bmp *.webp)")
        if not path:
            return
        b64 = _crop_to_jpeg_b64(path)
        if b64 is None:
            QMessageBox.warning(self, "Potalker", "画像を読み込めませんでした。")
            return
        self.engine.cmd({"type": "ceAvatarFile", "b64": b64, "name": "avatar.jpg", "mime": "image/jpeg"})

    def refresh(self, st: CardEditState):
        self.av_emoji.setText(st.s("emoji") or "🙂")
        self.av_sub.setText(st.s("sub"))
        self.b_clear.setVisible(st.b("clearShow"))
        self.av_msg.setText(st.s("avatarMsg"))
        self.no_img.blockSignals(True)
        self.no_img.setChecked(st.b("noImg"))
        self.no_img.blockSignals(False)
        self.warn.setText(st.s("warn"))
        for fn in self._syncs:
            fn(st)

    def closeEvent(self, event):  # noqa: N802
        self.engine.cmd({"type": "ceClose"})
        self.closed.emit()
        super().closeEvent(event)


class CardAuthDialog(QDialog):
    closed = Signal()

    def __init__(self, engine: Engine, parent=None):
        super().__init__(parent)
        self.engine = engine
        self.setWindowTitle("本人確認")
        self.resize(480, 560)
        lay = QVBoxLayout(self)
        self.title = QLabel("")
        self.title.setStyleSheet("font-size: 16px; font-weight: bold;")
        self.title.setWordWrap(True)
        self.account = QLabel("")
        self.account.setStyleSheet("font-weight: bold;")
        self.account.setWordWrap(True)
        self.desc = QLabel("")
        self.desc.setWordWrap(True)
        lay.addWidget(self.title)
        lay.addWidget(self.account)
        lay.addWidget(self.desc)

        lay.addWidget(QLabel("あなたの名刺の鍵"))
        code_row = QHBoxLayout()
        self.code = QLabel("")
        self.code.setWordWrap(True)
        self.code.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        b_copy_code = QPushButton("📋 鍵の行をコピー")
        b_copy_code.clicked.connect(lambda: QApplication.clipboard().setText(self.code.text()))
        code_row.addWidget(self.code, 1)
        code_row.addWidget(b_copy_code)
        self.code_sec = QWidget()
        self.code_sec.setLayout(code_row)
        lay.addWidget(self.code_sec)

        self.post = QLabel("")
        self.post.setWordWrap(True)
        self.post.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        lay.addWidget(self.post)
        post_row = QHBoxLayout()
        self.b_tweet = QPushButton("𝕏 でポストする")
        self.b_tweet.clicked.connect(lambda: self._tweet_url and QDesktopServices.openUrl(QUrl(self._tweet_url)))
        b_copy_post = QPushButton("📋 投稿文をコピー")
        b_copy_post.clicked.connect(lambda: QApplication.clipboard().setText(self.post.text()))
        post_row.addWidget(self.b_tweet)
        post_row.addWidget(b_copy_post)
        self.post_sec = QWidget()
        self.post_sec.setLayout(post_row)
        lay.addWidget(self.post_sec)

        lay.addWidget(QLabel("投稿したポストのリンク（共有URL）"))
        self.input = SyncedLineEdit(lambda v: engine.cmd({"type": "caInput", "value": v}))
        lay.addWidget(self.input)

        self.msg = QLabel("")
        self.msg.setWordWrap(True)
        self.note = QLabel("")
        self.note.setWordWrap(True)
        self.note.setStyleSheet("color: gray; font-size: 11px;")
        lay.addWidget(self.msg)
        lay.addWidget(self.note)
        bar = QHBoxLayout()
        b_cancel = QPushButton("やめる")
        b_cancel.clicked.connect(self.close)
        self.b_verify = QPushButton("確認する")
        self.b_verify.clicked.connect(lambda: engine.cmd({"type": "caVerify"}))
        bar.addWidget(b_cancel)
        bar.addStretch(1)
        bar.addWidget(self.b_verify)
        lay.addLayout(bar)
        self._tweet_url = ""

    def refresh(self, st: CardAuthState):
        self.title.setText(st.s("title"))
        self.account.setText(st.s("account"))
        self.desc.setText(st.s("desc"))
        self.code_sec.setVisible(st.b("codeShow"))
        self.code.setText(st.s("code"))
        self.post_sec.setVisible(st.b("postShow"))
        self.post.setVisible(st.b("postShow"))
        self.post.setText(st.s("post"))
        self._tweet_url = st.s("tweet")
        self.input.setVisible(st.b("inputShow"))
        self.input.sync(st.s("input"))
        self.msg.setText(st.s("msg"))
        self.msg.setStyleSheet("color: #c0392b;" if st.b("msgBad") else "color: teal;")
        self.note.setText(st.s("note"))
        self.b_verify.setText(st.s("verifyLabel") or "確認する")
        self.b_verify.setEnabled(not st.b("verifyDisabled"))

    def closeEvent(self, event):  # noqa: N802
        self.engine.cmd({"type": "caCancel"})
        self.closed.emit()
        super().closeEvent(event)
