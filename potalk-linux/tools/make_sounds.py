#!/usr/bin/env python3
"""効果音（WAV）を生成する。実行すると potalk_linux/assets/ に置き直す。

Windows 版は OS のシステム音（Asterisk）を使っている。Linux には共通の
システム音の約束がないので、小さなチャイムを自前で持つ。
"""
import math
import os
import struct
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "potalk_linux", "assets")


def tone(freq: float, t: float) -> float:
    return math.sin(2 * math.pi * freq * t)


def write_wav(name: str, samples: list[float]):
    path = os.path.join(OUT, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        frames = b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 30000)) for s in samples)
        w.writeframes(frames)
    print("wrote", path)


def notify():
    # 2音の小さなチャイム（ド→ソ相当の柔らかい音）
    out = []
    total = int(RATE * 0.45)
    for i in range(total):
        t = i / RATE
        env = math.exp(-3.5 * t)
        s = 0.6 * tone(1318.5, t) * env
        if t > 0.09:
            s += 0.6 * tone(1760.0, t - 0.09) * math.exp(-3.5 * (t - 0.09))
        out.append(s * 0.5)
    return out


if __name__ == "__main__":
    write_wav("notify.wav", notify())
