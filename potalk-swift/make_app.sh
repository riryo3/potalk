#!/bin/bash
# 使い方: ./make_app.sh [debug|release|universal]   → build/Potalker.app を作る（universal は Apple Silicon と Intel の両対応）
set -e
CFG="${1:-release}"
cd "$(dirname "$0")"
if [ "$CFG" = "universal" ]; then
  swift build -c release --arch arm64 --arch x86_64 2>&1 | tail -2
  BIN=".build/out/Products/Release/PotalkMac"
else
  swift build -c "$CFG" 2>&1 | tail -3
  BIN=".build/$CFG/PotalkMac"
fi
NAME="Potalker"
VER="0.3.0"
APP="build/$NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$NAME"
[ -f ../potalk-mac/icon.icns ] && cp ../potalk-mac/icon.icns "$APP/Contents/Resources/icon.icns"
# ライセンスと第三者の表示も、アプリの中に入れる
[ -f ../LICENSE ] && cp ../LICENSE "$APP/Contents/Resources/LICENSE.txt"
[ -f ../THIRD_PARTY_NOTICES.md ] && cp ../THIRD_PARTY_NOTICES.md "$APP/Contents/Resources/THIRD_PARTY_NOTICES.md"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Potalker</string>
<key>CFBundleDisplayName</key><string>Potalker</string>
<key>CFBundleIdentifier</key><string>app.potalker.mac</string>
<key>CFBundleExecutable</key><string>Potalker</string>
<key>NSHumanReadableCopyright</key><string>ぽっと通話（potalk.app）の非公式クライアントです。サイトの作者とは関係ありません。</string>
<key>CFBundleIconFile</key><string>icon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VER</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>通話のためにマイクを使用します。</string>
<key>NSLocalNetworkUsageDescription</key><string>通話相手と直接つなぐために、ローカルネットワークを使用します。</string>
<key>LSApplicationCategoryType</key><string>public.app-category.social-networking</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
# 署名: 環境変数 CODESIGN_ID に署名用の証明書名を入れると、それで署名する（既定は簡易署名）。
# 署名の素性が変わらなければ、キーチェーンの「常に許可」が、ビルドし直しても効き続ける。
codesign --force --deep --sign "${CODESIGN_ID:--}" "$APP" 2>&1 | tail -1
echo "built: $APP"
