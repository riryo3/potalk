"""ライト／ダークのテーマ。

色は土台だけ用意し、主役はレイアウト。パレットと QSS は Qt に触れない
純粋なデータ＋文字列として持ち、単体テストできるようにしてある。
適用（apply_theme）だけが Qt を使う。
"""
from __future__ import annotations

MODES = ("system", "light", "dark")

LIGHT = {
    "bg": "#f5f5f7",
    "card": "#ffffff",
    "card_border": "#d8dae0",
    "text": "#1d1d20",
    "dim": "#6d6d74",
    "accent": "#1f6feb",
    "accent_soft": "#e3ecfd",
    "count": "#0a8f6f",
    "chip_bg": "#eef0f3",
    "chip_text": "#33343a",
    "input_bg": "#ffffff",
    "btn_bg": "#ffffff",
    "btn_border": "#c9ccd4",
    "warn": "#e8791d",
    "warn_text": "#ffffff",
    "danger": "#d93636",
    "danger_text": "#ffffff",
    "sel_border": "#1f6feb",
}

DARK = {
    "bg": "#26262a",
    "card": "#3a3a40",
    "card_border": "#4c4c53",
    "text": "#f2f2f5",
    "dim": "#a8a8b0",
    "accent": "#4c9aff",
    "accent_soft": "#31435f",
    "count": "#3fd0ae",
    "chip_bg": "#4a4a51",
    "chip_text": "#ececf0",
    "input_bg": "#333338",
    "btn_bg": "#3d3d43",
    "btn_border": "#565660",
    "warn": "#e8791d",
    "warn_text": "#ffffff",
    "danger": "#d94040",
    "danger_text": "#ffffff",
    "sel_border": "#4c9aff",
}

PALETTES = {"light": LIGHT, "dark": DARK}

# 描画（カードのデリゲートなど）が参照する現在のパレット
CURRENT: dict = LIGHT


def resolve(mode: str, system_dark: bool) -> str:
    """設定値と OS の外観から、実際に使うテーマ（light/dark）を決める。"""
    if mode == "light":
        return "light"
    if mode == "dark":
        return "dark"
    return "dark" if system_dark else "light"


def build_qss(p: dict) -> str:
    """パレットからアプリ全体のスタイルシートを組み立てる。"""
    return f"""
QWidget {{ background: {p['bg']}; color: {p['text']}; }}
QDialog {{ background: {p['bg']}; color: {p['text']}; }}
QLabel {{ background: transparent; }}
QLabel#roomTitle {{ font-size: 15px; font-weight: bold; }}
QLabel#pillLabel {{ background: {p['chip_bg']}; color: {p['dim']}; border-radius: 12px; padding: 4px 14px; }}
QLineEdit, QComboBox, QSpinBox, QTextEdit, QPlainTextEdit {{
    background: {p['input_bg']}; color: {p['text']};
    border: 1px solid {p['card_border']}; border-radius: 8px; padding: 5px 8px;
    selection-background-color: {p['accent']};
}}
QLineEdit:focus, QComboBox:focus {{ border: 1px solid {p['accent']}; }}
QPushButton {{
    background: {p['btn_bg']}; color: {p['text']};
    border: 1px solid {p['btn_border']}; border-radius: 9px; padding: 6px 12px;
}}
QPushButton:hover {{ border-color: {p['accent']}; }}
QPushButton:pressed {{ background: {p['accent_soft']}; }}
QPushButton:checked {{ background: {p['accent_soft']}; border-color: {p['accent']}; }}
QPushButton#primaryButton {{ background: {p['accent']}; color: #ffffff; border-color: {p['accent']}; }}
QPushButton#warnButton {{ background: {p['warn']}; color: {p['warn_text']}; border-color: {p['warn']}; font-weight: bold; }}
QPushButton#dangerButton {{ background: {p['danger']}; color: {p['danger_text']}; border-color: {p['danger']}; font-weight: bold; }}
QPushButton#pillButton {{ border-radius: 13px; padding: 4px 12px; }}
QToolButton {{
    background: {p['btn_bg']}; color: {p['text']};
    border: 1px solid {p['btn_border']}; border-radius: 8px; padding: 4px 8px;
}}
QToolButton:checked {{ background: {p['accent_soft']}; border-color: {p['accent']}; }}
QCheckBox {{ background: transparent; spacing: 6px; }}
QListWidget {{ background: transparent; border: none; outline: 0; }}
QListWidget::item {{ background: transparent; border: none; }}
QListView {{ background: transparent; border: none; outline: 0; }}
QTabWidget::pane {{ border: 1px solid {p['card_border']}; border-radius: 10px; top: -1px; }}
QTabBar::tab {{
    background: transparent; color: {p['dim']}; padding: 7px 18px;
    border: none; border-bottom: 2px solid transparent;
}}
QTabBar::tab:selected {{ color: {p['accent']}; border-bottom: 2px solid {p['accent']}; font-weight: bold; }}
QScrollBar:vertical {{ background: transparent; width: 10px; margin: 0; }}
QScrollBar::handle:vertical {{ background: {p['card_border']}; border-radius: 5px; min-height: 30px; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 0; }}
QScrollBar::handle:horizontal {{ background: {p['card_border']}; border-radius: 5px; min-width: 30px; }}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0; }}
QMenu {{ background: {p['card']}; color: {p['text']}; border: 1px solid {p['card_border']}; }}
QMenu::item:selected {{ background: {p['accent_soft']}; }}
QToolTip {{ background: {p['card']}; color: {p['text']}; border: 1px solid {p['card_border']}; }}
QComboBox QAbstractItemView {{ background: {p['card']}; color: {p['text']}; selection-background-color: {p['accent_soft']}; }}
"""


def apply_theme(qapp, mode: str) -> str:
    """テーマをアプリへ適用し、実際に使ったテーマ名を返す。"""
    from PySide6.QtCore import Qt
    from PySide6.QtGui import QColor, QPalette

    hints = qapp.styleHints()
    system_dark = hints.colorScheme() == Qt.ColorScheme.Dark
    name = resolve(mode, system_dark)
    p = PALETTES[name]
    global CURRENT
    CURRENT = p
    qapp.setStyleSheet(build_qss(p))
    pal = QPalette()
    pal.setColor(QPalette.ColorRole.Window, QColor(p["bg"]))
    pal.setColor(QPalette.ColorRole.WindowText, QColor(p["text"]))
    pal.setColor(QPalette.ColorRole.Base, QColor(p["input_bg"]))
    pal.setColor(QPalette.ColorRole.Text, QColor(p["text"]))
    pal.setColor(QPalette.ColorRole.Button, QColor(p["btn_bg"]))
    pal.setColor(QPalette.ColorRole.ButtonText, QColor(p["text"]))
    pal.setColor(QPalette.ColorRole.Highlight, QColor(p["accent"]))
    qapp.setPalette(pal)
    return name
