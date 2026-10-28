#!/bin/sh
# Potalker を単一ファイルの AppImage に固める。
# 先に build_linux.sh で PyInstaller のフォルダを作っておくこと。
# 使い方: sh packaging/make_appimage.sh [出力先AppImageのパス]
set -eu
cd "$(dirname "$0")/.."

APPIMAGETOOL="${APPIMAGETOOL:-$HOME/.local/bin/appimagetool}"
if [ ! -x "$APPIMAGETOOL" ]; then
    mkdir -p "$(dirname "$APPIMAGETOOL")"
    curl -L -o "$APPIMAGETOOL" \
        https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
    chmod +x "$APPIMAGETOOL"
fi

DIST="dist/Potalker"
[ -d "$DIST" ] || { echo "先に build_linux.sh を実行してください（$DIST がありません）" >&2; exit 1; }

APPDIR="dist/Potalker.AppDir"
OUT="${1:-dist/Potalker-x86_64.AppImage}"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/lib/potalker" "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/share/icons/hicolor/512x512/apps"
cp -a --no-preserve=ownership "$DIST/." "$APPDIR/usr/lib/potalker/"

cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
exec "$APPDIR/usr/lib/potalker/Potalker" "$@"
EOF
chmod +x "$APPDIR/AppRun"

sed 's/^Exec=.*/Exec=potalker/; s/^Categories=.*/Categories=Network;Chat;/; /^\[Desktop Entry\]/a Icon=potalker' \
    packaging/potalker.desktop > "$APPDIR/potalker.desktop"
cp "$APPDIR/potalker.desktop" "$APPDIR/usr/share/applications/potalker.desktop"

ICON_SRC="../potalk-mac/assets/icon.png"
[ -f "$ICON_SRC" ] || ICON_SRC="packaging/icon.png"
cp "$ICON_SRC" "$APPDIR/potalker.png"
cp "$ICON_SRC" "$APPDIR/usr/share/icons/hicolor/512x512/apps/potalker.png"

ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" "$APPDIR" "$OUT"
echo "作りました: $OUT"
