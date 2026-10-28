"""PyInstaller 用の起動口（python -m potalk_linux と同じ）。"""
from potalk_linux.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
