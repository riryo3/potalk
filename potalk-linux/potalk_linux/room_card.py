"""ロビーの部屋一覧をカード風に描くデリゲート。

Mac 版・Windows 版のロビーに倣い、1部屋を角丸のカードとして描く。
1行目に話題（なければ部屋名）、2行目に部屋名と付けた人、経過時間、
最後に人をチップ（丸いピル）で並べる。右上のリンク標識は共有ボタン。
"""
from __future__ import annotations

from PySide6.QtCore import QRect, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import QStyle, QStyledItemDelegate

from . import theme
from .model import LobbyRoom

ROOM_ROLE = Qt.ItemDataRole.UserRole + 1
PAD = 12
TITLE_H = 24
SUB_H = 19
DUR_H = 17
CHIPS_H = 27


def card_height(room: LobbyRoom) -> int:
    h = PAD * 2 + TITLE_H
    if room.sub:
        h += SUB_H
    if room.dur:
        h += DUR_H
    if room.people:
        h += CHIPS_H
    return h


class RoomCardDelegate(QStyledItemDelegate):
    share_clicked = Signal(str)  # room id

    def __init__(self, parent=None):
        super().__init__(parent)
        self._share_rects: dict[str, QRect] = {}

    def sizeHint(self, option, index):  # noqa: N802 (Qt naming)
        room = index.data(ROOM_ROLE)
        size = super().sizeHint(option, index)
        if isinstance(room, LobbyRoom):
            size.setHeight(card_height(room) + 6)
        return size

    def editorEvent(self, event, model, option, index):  # noqa: N802
        if event.type() == event.Type.MouseButtonRelease:
            room = index.data(ROOM_ROLE)
            if isinstance(room, LobbyRoom):
                rect = self._share_rects.get(room.id)
                if rect is not None and rect.contains(event.pos()):
                    self.share_clicked.emit(room.id)
                    return True
        return super().editorEvent(event, model, option, index)

    def paint(self, painter: QPainter, option, index):
        room = index.data(ROOM_ROLE)
        if not isinstance(room, LobbyRoom):
            super().paint(painter, option, index)
            return
        p = theme.CURRENT
        pal_text = QColor(p["text"])
        pal_dim = QColor(p["dim"])
        rect = QRectF(option.rect).adjusted(4, 3, -4, -3)
        selected = bool(option.state & QStyle.StateFlag.State_Selected)
        hover = bool(option.state & QStyle.StateFlag.State_MouseOver)

        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setBrush(QColor(p["card"]))
        if selected:
            painter.setPen(QPen(QColor(p["sel_border"]), 2))
        elif hover:
            painter.setPen(QPen(QColor(p["accent"]), 1))
        else:
            painter.setPen(QPen(QColor(p["card_border"]), 1))
        painter.drawRoundedRect(rect, 12, 12)

        x = rect.x() + PAD
        y = rect.y() + PAD
        right = rect.right() - PAD
        base = option.font

        # 1行目: 話題（なければ部屋名）／人数／共有
        title_font = QFont(base)
        title_font.setBold(True)
        title_font.setPointSize(base.pointSize() + 1)
        painter.setFont(title_font)
        painter.setPen(pal_text)
        kind = "📣" if room.bc else "🏠"
        title = f"🏷 {room.sub}" if room.sub else f"{kind} {room.name or '（名前なし）'}"
        share_rect = QRect(int(right) - 24, int(y), 26, TITLE_H)
        self._share_rects[room.id] = share_rect
        count_text = f"{room.count}人" if room.count else ""
        fm = painter.fontMetrics()
        count_w = fm.horizontalAdvance(count_text) + 10 if count_text else 0
        title_rect = QRectF(x, y, right - 26 - count_w - x, TITLE_H)
        painter.drawText(title_rect, Qt.AlignmentFlag.AlignVCenter, fm.elidedText(title, Qt.TextElideMode.ElideRight, int(title_rect.width())))
        if count_text:
            painter.setPen(QColor(p["count"]))
            painter.drawText(QRectF(right - 26 - count_w, y, count_w, TITLE_H),
                             Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight, count_text)
        painter.setPen(pal_dim)
        painter.drawText(QRectF(share_rect), Qt.AlignmentFlag.AlignCenter, "🔗")
        y += TITLE_H

        # 2行目: 部屋名と付けた人（話題があるときだけ）
        if room.sub:
            sub_font = QFont(base)
            painter.setFont(sub_font)
            painter.setPen(pal_text)
            line = f"{kind} {room.name or '（名前なし）'}"
            painter.drawText(QRectF(x, y, right - x, SUB_H), Qt.AlignmentFlag.AlignVCenter,
                             painter.fontMetrics().elidedText(line, Qt.TextElideMode.ElideRight, int(right - x - 130)))
            if room.sub_by:
                painter.setPen(pal_dim)
                by = f"{room.sub_by} が付けた"
                painter.drawText(QRectF(x, y, right - x, SUB_H),
                                 Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight, by)
            y += SUB_H

        # 経過時間
        if room.dur:
            dur_font = QFont(base)
            dur_font.setPointSize(max(8, base.pointSize() - 1))
            painter.setFont(dur_font)
            painter.setPen(pal_dim)
            painter.drawText(QRectF(x, y, right - x, DUR_H), Qt.AlignmentFlag.AlignVCenter, f"⏱ {room.dur}")
            y += DUR_H

        # 人のチップ
        if room.people:
            chip_font = QFont(base)
            chip_font.setPointSize(max(8, base.pointSize() - 1))
            painter.setFont(chip_font)
            cfm = painter.fontMetrics()
            cx = x
            painter.setPen(Qt.PenStyle.NoPen)
            for person in room.people:
                label = f"{person.em} {person.name}" + (" 🔇" if person.muted else "")
                w = cfm.horizontalAdvance(label) + 18
                if cx + w > right:
                    label = "…"
                    w = cfm.horizontalAdvance(label) + 14
                    if cx + w > right:
                        break
                chip = QRectF(cx, y + 2, w, CHIPS_H - 5)
                painter.setBrush(QColor(p["chip_bg"]))
                painter.drawRoundedRect(chip, 9, 9)
                painter.setPen(QColor(p["chip_text"]))
                painter.drawText(chip, Qt.AlignmentFlag.AlignCenter, label)
                painter.setPen(Qt.PenStyle.NoPen)
                cx += w + 6
                if label == "…":
                    break
            y += CHIPS_H
        painter.restore()
