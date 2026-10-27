# Potalker（ぽっと通話 非公式クライアント）

> **これは非公式のクライアントです。** [ぽっと通話（potalk.app）](https://potalk.app/) の作者とは関係がありません。通話の仕組み（Nostr での相手探しと WebRTC）は、サイトのページをそのまま利用し、画面まわりだけを、Mac と Windows 向けに、それぞれ作り直しています。ご利用は自己責任でお願いします。

## 対応している OS

| OS | 状態 | 場所 |
|---|---|---|
| **macOS**（14 以降） | 対応しています | `potalk-swift/`（Swift 製） |
| **Windows** | 対応しています | `potalk-win/`（C# / WPF / WebView2 製） |
| **Linux** | **対応していません。他の方の貢献に期待しています。**（Electron 版で動いたという報告はあります。下の「Linux 版（試験中）」を参照） | － |

- Linux は、手が回っていません。Electron 版（`potalk-mac/`）が、Linux で動いたという報告はありますが、私は確認していません。Linux 向けに、きちんと作ってくださる方がいれば、プルリクエストや Issue を、お待ちしています。

| フォルダ | 中身 |
|---|---|
| `potalk-swift/` | Swift 製（AppKit / SwiftUI）の **Potalker**（Mac 版）。通話の仕組みは、画面に出ない WKWebView で動かす。 |
| `potalk-win/` | C# 製（WPF / WebView2）の **Potalker**（Windows 版）。考え方は Mac 版と同じ。 |
| `potalk-mac/` | Electron 製（先に作った試作版）。 |

## ダウンロード（Swift 版）

[Releases](https://github.com/riryo3/potalk/releases) から `Potalker-*.zip` をダウンロードして、展開した「Potalker.app」を「アプリケーション」に入れてください（Apple Silicon・Intel 両対応、macOS 14 以降）。

- Apple の公証を受けていないため、ブラウザでダウンロードした直後は「開けません」と出ることがあります。そのときは、アプリを**右クリック →「開く」**、または次のコマンドを実行してください。

  ```bash
  xattr -dr com.apple.quarantine /Applications/Potalker.app
  ```

- 初回の起動で、マイク・ローカルネットワーク・通知の許可を求められます。

### Mac 版で、キーチェーンの確認（パスワードの入力）が出ることがあります

Mac 版（Swift 版）では、「Potalker がキーチェーン内の “Potalker WebCrypto Master Key” に保存されている機密情報を使用しようとしています」という確認が出て、Mac のログインパスワードを求められることがあります。**Windows 版・Electron 版では出ません。**

- **出る場面**: 名刺の本人確認（X・GitHub・Nostr の ✅）をしている人が、相手に名刺を見られたとき。名刺の設定を開いたとき、本人確認を始めたとき。
- **理由**: 名刺の鍵（取り出せない形で、この Mac の中に保存されています）を読むとき、macOS が、キーチェーンの許可を確認するためです。Web の部品（WebKit）の仕様で、アプリ側では避けられません。通常の通話だけなら、起動時には出ません。
- **対処**: 「常に許可」を押すと、同じアプリのあいだは、出なくなります。「拒否」を押しても、アプリは使えます（本人確認の ✅ を相手に見せる機能だけが、使えなくなります）。
- **ビルドし直すと、また出ます**: 簡易署名のアプリは、ビルドのたびに、署名の素性が変わります。署名用の証明書を使うと（下の「Swift 版のビルド」を参照）、出なくなります。

## Mac 版の使い方のメモ

### ウインドウの使い方（複数ウインドウ／シングルペイン）

左上の名前のボタン →「初期設定」の「シングルペイン（1つの窓にまとめる）」で、切り替えます。通話中に切り替えても、通話は続きます。

- **複数ウインドウ（既定）**: ロビー、部屋、ひとこと、おたより、設定を、別々の小窓で開きます。画面の端や、ほかの窓に吸い付きます。
- **シングルペイン**: 小さな画面向けです。1つの窓にまとめます。
  - 入室前は、縦長の部屋一覧です。入室すると、部屋の小窓くらいの幅になります（窓の右端と上端は動きません）。
  - 上のタブで、部屋、ひとこと、おたより（配信部屋のときだけ）、設定を切り替えます。新着があるタブは、色がつきます（雑談部屋に新しい人が入ったときは、「部屋」のタブ）。
  - 窓の左端の取っ手から、部屋の一覧が、窓の左にドロワーとして開きます。
  - 「📌」で、ほかの窓の上に浮かせる（最前面）かどうかを切り替えます。既定はオンです。

### ショートカット（ウインドウメニュー）

| キー | 動き |
|---|---|
| ⌘1 | メインウインドウを前に出す |
| ⌘2 / ⌘3 / ⌘4 / ⌘5 | 部屋 / ひとこと / おたより（配信部屋のとき）/ 部屋の設定（シングルペインではタブの切り替え） |
| ⌘L | 部屋一覧のドロワーを開く／閉じる（シングルペイン） |
| ⌘] / ⌘[ | 次のタブ／前のタブ（シングルペイン） |
| ⇧⌘P | シングルペインで表示（オン・オフ） |

### 検索

ロビーの検索欄は、部屋名・話題タグ・いま部屋にいる人の名前を探します。全角と半角、大文字と小文字、ひらがなとカタカナの違いを、区別しません。

### 通知

新しい部屋ができると、通知と音でお知らせします（ロビー下の「部屋の通知」で、オン・オフ）。作られて数分以内の部屋だけを通知します。起動、読み込み直し、入室、退出、部屋の作成、「更新」のあとの数秒は、通知を止めます。

### 初回の起動

初回だけ、ぽっと通話の作者への感謝を、ごあいさつの画面に出します。「次から表示しない」の☑を外して閉じると、次の起動でも、もう一度出ます。「これはなに？」からも読めます。

## Swift 版のビルド

```bash
cd potalk-swift
./make_app.sh release     # build/Potalker.app ができる（簡易署名・この Mac の CPU 用）
./make_app.sh universal   # Apple Silicon と Intel の両対応
```

- macOS 14 以降、Xcode（Swift 6）が必要です。
- 署名用の証明書がある場合は、`CODESIGN_ID="証明書の名前" ./make_app.sh release` のように指定できます。署名が変わらなければ、キーチェーンの「常に許可」が、ビルドし直しても効き続けます（既定は簡易署名で、ビルドのたびに許可の確認が出ることがあります）。
- ページへの小さな差し込み（過去ログ共有、リアクションの効果など）は `Sources/PotalkMac/PagePatcher.swift` にあります。差し込み位置が見つからないときは、元のページをそのまま使います。

## Windows 版

[Releases](https://github.com/riryo3/potalk/releases) から `Potalker-win-x64.zip` をダウンロードして展開し、`Potalker.exe` を実行してください（Windows 10 / 11、64bit。.NET の別途インストールは不要です）。

- 署名していないため、SmartScreen の警告が出ることがあります（「詳細情報」→「実行」）。
- 通話の描画に Microsoft Edge WebView2 ランタイムを使います（Windows 11 には最初から入っています。入っていない場合は起動時にエラーが出ます）。
- 初回の通話で、マイクの許可を求められることがあります。
- 設定とウィンドウの位置は `%APPDATA%\Potalker\` に保存されます。
- 窓の使い方は、2通りから選べます。初期設定の窓の「1つの窓にまとめる（シングルペイン）」で切り替えます（`Ctrl+Shift+P` でも切り替えられます）。
  - 複数ウインドウ（初期）：本体（一覧）、部屋、ひとこと、おたより、設定が、別々の窓です。小窓は、画面の端と、ほかの窓の縁に吸着します。
  - シングルペイン：画面の小さなPC向けです。入室すると、1つの窓が、タブ（部屋・ひとこと・おたより・設定）に変わります。左の取っ手（`Ctrl+L`）から、部屋の一覧が、窓の左に出ます。
- ショートカット（「これはなに？」の窓にも載っています）：`Ctrl+1` 本体、`Ctrl+2` 部屋、`Ctrl+3` ひとこと、`Ctrl+4` おたより、`Ctrl+5` 部屋の設定、`Ctrl+L` 部屋一覧、`Ctrl+]` `Ctrl+[` 次・前のタブ、`Ctrl+Shift+P` シングルペインの切り替え。
- 入室中にアプリを終了しようとすると、確認が出ます。
- ロビーの検索は、大文字小文字、全角半角、ひらがなカタカナの違いを区別しません。部屋のURL（`#room=…`）を貼ると、その部屋に絞り込みます。
- 部屋のURLのコピーでは、`&name=…` を省きます（ひとこと欄の60文字に収まるように。初期設定でオフにできます）。
- 本人確認（X・GitHub・Nostr）は、まだ実機で試していません。

### Windows 版のビルド

```bash
cd potalk-win
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o out
```

- .NET 8 SDK が必要です。GitHub Actions（`.github/workflows/build-windows-native.yml`）でも作れます。`win-v*` のタグを付けて push すると、Releases に zip が載ります。
- ページへの小さな差し込みは `PagePatcher.cs` にあります（Swift 版と同じ内容）。

## Electron 版（Windows・試作）

Electron 版（`potalk-mac/`）も、Windows 向けにビルドできます。GitHub Actions（`.github/workflows/build-windows.yml`）が、インストーラー（.exe）と zip を作ります。新しい Windows 版（`potalk-win/`）のほうが小さく軽いので、こちらは試作として残しています。

- ローカルで作る場合: `cd potalk-mac && npm ci && npm run dist:win`

## Linux 版（試験中）

Electron 版（`potalk-mac/`）は、Linux でも起動できます。2026年10月に、Linux Mint（ThinkPad L570）での動作報告がありました。起動直後は少し重いものの、動き出してからは快適に使えたとのことです。

- 必要なものは Node.js（動作報告の環境は v24 LTS）と git です。起動方法は下の「Electron 版」と同じです。

  ```bash
  git clone https://github.com/riryo3/potalk.git
  cd potalk/potalk-mac
  npm install
  npm start
  ```

- ライブラリ不足で起動しない場合は、次を入れてください（Linux Mint 22 / Ubuntu 24.04 系。21 系では `libasound2t64` の代わりに `libasound2` を使います）。

  ```bash
  sudo apt install -y libgtk-3-0 libnss3 libasound2t64
  ```

- `The SUID sandbox helper binary was found, but is not configured correctly` というエラーで止まる場合は、サンドボックスなしで起動できます。

  ```bash
  npx electron --no-sandbox .
  ```

  `--no-sandbox` は、Chromium の安全のための仕組み（サンドボックス）を切る回避策です。使うのは、ご自分の手元で、信頼できるサイトだけを開く場合に限ってください。毎回ではなく恒常的に対処したい場合は、`node_modules/electron/dist/chrome-sandbox` の所有者を root にし、権限を 4755 に直してください（`sudo` が必要です）。

- 作者の環境では未確認です。ビルド済みパッケージ（AppImage や .deb）の配布も、まだありません。

## Electron 版

```bash
cd potalk-mac
npm install
npm start
```

## 参考にしたもの

このクライアントは、ぽっと通話の公開リポジトリ **[po-talk/po-talk.github.io](https://github.com/po-talk/po-talk.github.io)** を参考にして作りました。ページの構造や、通話の仕組み（部屋の探索、データのやり取り）を、このリポジトリのソースで調べ、画面まわりを Mac 向けに作り直しています。実行時には、公開されている potalk.app のページをそのまま読み込んで使います。サイトの作者の方々に感謝します。

## 注意

- 実験用の非公式クライアントです。通話の相手探しや中継（TURN）は、potalk.app と同じ仕組みを使っています。
- サイト本体（potalk.app）の作者は別の方です。このリポジトリには、サイトのソースは含めていません。
- 「ぽっと通話」「potalk」の名前とサイトは、それぞれの作者のものです。

## ライセンス

このリポジトリのコードは [MIT License](LICENSE) です（Copyright (c) 2026 riryo3）。参考にしたリポジトリのライセンスの表示は、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。
