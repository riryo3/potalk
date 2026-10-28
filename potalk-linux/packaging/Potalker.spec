# PyInstaller の設定。`pyinstaller packaging/Potalker.spec` で dist/Potalker/ ができる。
# Qt WebEngine の同梱が要るので、PySide6 のフックに任せる（collect 系は使わず標準フックで足りる構成）。
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

a = Analysis(
    [os.path.join(ROOT, "packaging", "entry.py")],
    pathex=[ROOT],
    datas=[
        (os.path.join(ROOT, "potalk_linux", "assets"), os.path.join("potalk_linux", "assets")),
    ],
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Potalker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Potalker",
)
