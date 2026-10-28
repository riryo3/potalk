"""効果音。

Qt のマルチメディアは、音声まわりの土台（PipeWire 等）が無い環境では
生成の時点でプロセスごと落ちることがあったため使わない。
paplay / pw-play / aplay のどれかがあれば、それで小さな WAV を鳴らす。
無ければ黙って何もしない（本体の動作には影響させない）。
"""
from __future__ import annotations

import os
import shutil

from PySide6.QtCore import QProcess

_ASSETS = os.path.join(os.path.dirname(__file__), "assets")
_WAV = os.path.join(_ASSETS, "notify.wav")
_PLAYERS = ("paplay", "pw-play", "aplay")


class SoundPlayer:
    def __init__(self):
        self._player = next((p for p in _PLAYERS if shutil.which(p)), None)

    def notify(self):
        if self._player is None:
            return
        try:
            QProcess.startDetached(self._player, [_WAV])
        except Exception:  # noqa: BLE001 — 音が出なくても本体は止めない
            pass
