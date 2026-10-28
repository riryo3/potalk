"""おたより（配信部屋）の窓と、公開中のお便りを大きく見せる小窓。

Windows 版 MailWindows.cs と同じ構成。ボタンの番号は、ページ側の
「見出しのボタン全部＋本文のボタン全部」の並び順（ブリッジの mailbtn）に合わせる。
"""
from __future__ import annotations

import json

from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from .engine import Engine
from .model import MailBtn, MailNow, MailState


class MailWindow(QWidget):
    def __init__(self, engine: Engine):
        super().__init__()
        self.engine = engine
        self.setWindowTitle("おたより")
        self.resize(380, 500)
        self._key = ""

        lay = QVBoxLayout(self)
        self.head_box = QVBoxLayout()
        lay.addLayout(self.head_box)
        self.body_box = QVBoxLayout()
        body_wrap = QWidget()
        body_wrap.setLayout(self.body_box)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(body_wrap)
        lay.addWidget(scroll, 1)

        self.ph = QLabel("")
        self.ph.setStyleSheet("color: gray;")
        lay.addWidget(self.ph)
        row = QHBoxLayout()
        self.input = QLineEdit()
        self.input.returnPressed.connect(self._send)
        self.counter = QLabel("")
        self.send_btn = QPushButton("送る")
        self.send_btn.clicked.connect(self._send)
        row.addWidget(self.input, 1)
        row.addWidget(self.counter)
        row.addWidget(self.send_btn)
        lay.addLayout(row)
        self.input.textChanged.connect(self._update_counter)
        self._max = 0

    def _update_counter(self):
        if 0 < self._max < 100000:
            self.counter.setText(f"{len(self.input.text())}/{self._max}")
        else:
            self.counter.setText("")

    def _send(self):
        text = self.input.text().strip()
        if text:
            self.engine.cmd({"type": "mailsend", "text": text})
            self.input.clear()

    def _mail_btn(self, b: MailBtn) -> QPushButton:
        btn = QPushButton(b.label)
        on = b.on or ("公開中" in b.label)
        if on:
            btn.setStyleSheet("border: 1px solid teal;")
        try:
            idx = int(b.i)
        except ValueError:
            idx = 0
        btn.clicked.connect(lambda _=False, i=idx: self.engine.cmd({"type": "mailbtn", "i": i}))
        return btn

    def refresh(self, mail: MailState | None, bcast: bool):
        # 内容が同じなら作り直さない（スクロール位置が戻るのを避ける。Win 版と同じ）
        key = json.dumps(mail.raw if mail else {}, sort_keys=True, ensure_ascii=False) + str(bcast)
        if key == self._key:
            return
        self._key = key
        for box in (self.head_box, self.body_box):
            while box.count():
                item = box.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.deleteLater()
        if mail is None or not bcast:
            self.body_box.addWidget(QLabel("配信部屋のときだけ使えます。"))
            self.ph.setText("")
            return
        for h in mail.head:
            row = QHBoxLayout()
            if h.text:
                row.addWidget(QLabel(h.text))
            for b in h.btns:
                row.addWidget(self._mail_btn(b))
            row.addStretch(1)
            w = QWidget()
            w.setLayout(row)
            self.head_box.addWidget(w)
        for item in mail.body:
            if item.item:
                box = QVBoxLayout()
                who = QLabel(f"{item.em} {item.who}")
                who.setStyleSheet("color: gray;")
                box.addWidget(who)
                text = QLabel(item.text)
                text.setWordWrap(True)
                box.addWidget(text)
                btn_row = QHBoxLayout()
                for b in item.btns:
                    btn_row.addWidget(self._mail_btn(b))
                btn_row.addStretch(1)
                box.addLayout(btn_row)
                w = QWidget()
                w.setLayout(box)
                if item.shown:
                    w.setStyleSheet("border: 1.5px solid #2a7fff; border-radius: 6px;")
                self.body_box.addWidget(w)
            else:
                lb = QLabel(item.text)
                lb.setWordWrap(True)
                lb.setStyleSheet("color: gray;")
                self.body_box.addWidget(lb)
        self.body_box.addStretch(1)
        self.ph.setText(mail.form_ph if mail.has_form else "")
        self.send_btn.setText(mail.form_btn or "送る")
        self._max = mail.form_max
        if 0 < self._max < 100000:
            self.input.setMaxLength(self._max)
        self._update_counter()


class LetterWindow(QWidget):
    """公開中のお便りを大きく見せる小窓。"""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("公開中のお便り")
        self.resize(440, 250)
        lay = QVBoxLayout(self)
        self.cap = QLabel("")
        self.cap.setStyleSheet("color: gray;")
        self.who = QLabel("")
        self.who.setStyleSheet("font-size: 15px;")
        self.text = QLabel("")
        self.text.setStyleSheet("font-size: 22px;")
        self.text.setWordWrap(True)
        lay.addWidget(self.cap)
        lay.addWidget(self.who)
        lay.addWidget(self.text)
        lay.addStretch(1)

    def refresh(self, now: MailNow):
        self.cap.setText(now.cap)
        self.who.setText(now.who.strip("：: "))
        self.text.setText(now.text)
