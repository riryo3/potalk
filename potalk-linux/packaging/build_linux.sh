#!/bin/sh
# Potalker（Linux）を PyInstaller で固める。成果物は dist/Potalker/（フォルダ形式）。
# 使い方:  sh packaging/build_linux.sh
set -eu
cd "$(dirname "$0")/.."

if [ ! -d .build-venv ]; then
  python3 -m venv .build-venv
fi
. .build-venv/bin/activate
pip install -q --upgrade pip
pip install -q PySide6 pyinstaller

pyinstaller --noconfirm --distpath dist --workpath build packaging/Potalker.spec
cp packaging/potalker.desktop dist/Potalker/
echo "できたもの: dist/Potalker/Potalker"
echo "※ この形式は、ビルドした環境と近いディストリビューション向けです。"
echo "  AppImage 化は dist/Potalker を AppDir に入れて appimagetool で包めます（未検証）。"
