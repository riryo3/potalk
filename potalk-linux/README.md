# Potalker（Linux）

ぽっと通話（[potalk.app](https://potalk.app/)）の非公式クライアント **Potalker** の Linux 版です。

Mac 版（Swift）・Windows 版（C#/WPF）と同じ考え方で作っています。通話の仕組みは、画面に出ない WebView の中で potalk.app のページをそのまま動かし（Nostr で相手を探し、WebRTC で話す）、画面だけを Linux 向けに作り直しています。

> ⚠️ **状態：作り始めたところ（アルファ）です。**
> ロビー・部屋・ひとこと・リアクション・名刺など、Mac/Windows 版の基本機能を移植中です。
> 開発は Linux の仮想環境で行っているため、**実機の Linux デスクトップでの動作確認がまだありません**。動いた・動かなかったの報告が、いちばんの助けになります。

## 動かし方

必要なもの: Python 3.10 以降、PySide6（Qt WebEngine）。

```sh
cd potalk-linux
python3 -m venv .venv && . .venv/bin/activate
pip install PySide6
python3 -m potalk_linux
```

ディストリビューションによっては、Qt WebEngine の実行に要るシステムライブラリ（libnss3、libxkbcommon など）が別に要ります。起動時にライブラリ不足のエラーが出たら、その名前でパッケージを入れてください。

## 何ができて、何がまだか

できていること（仮想環境で確認済み）:

- ロビー：部屋の一覧と検索（全角半角・大小・ひらがなカタカナを区別しない）、入っている人の表示
- 部屋の作成（雑談部屋／配信部屋）、一覧からの入室、部屋リンク（`#room=…`）での入室
- 部屋：メンバーの表示、ミュート、スピーカーのミュート、発言／手を挙げる、発言の許可（メンバーの右クリック）、無視、話題タグ、リアクション、部屋の設定（ページ側の項目をそのまま表示）、ひとこと（チャット）、部屋 URL のコピー、過去ログ共有（ページへの差し込みで実現）
- 名刺：表示（リンクは確認してから開く）、編集（bio・チップ窓口・SNS・本人確認の認証／解除・画像の選択と切り抜き）、「無視」の確認
- 配信部屋のおたより：募集の操作、届いたお便りの一覧と公開の操作、お便りを書く欄、公開中のお便りを大きく見せる小窓
- 名前とアバターの設定、マイクの選択

- 単一窓モード（Windows 版と同じ形。入室前は本体いっぱいにロビー、入室すると本体がタブ画面（部屋／おたより／設定）に切り替わり、ロビーは引き出しとして本体の脇に出る。出る側は画面の空きで決まる：本体が画面の左端なら引き出しは右へ、左に幅があれば左へ。ひとことは下の引き出しで、新着の数が出る。部屋以外のタブでもミュート等の小さなバーが出る。📌 で最前面の固定。Ctrl+Shift+P で切り替え、Ctrl+L で引き出しの開閉、Ctrl+]/[ でタブ移動。本体を動かすと引き出しも付いてくる）
- キーボードショートカット（Ctrl+1 ロビー、Ctrl+2 部屋、Ctrl+3 ひとこと、Ctrl+4 おたより、Ctrl+Shift+M マイク、Ctrl+Shift+S スピーカー）
- 飛ぶリアクション絵文字、新しい部屋の通知（音＋トレイ通知）、手を挙げた人が増えたときの音
- 固めた実行ファイル（下の「配布用に固める」参照）

まだ無いもの（Mac/Windows 版にはある）:

- 退出の演出
- 更新の知らせ
- Flatpak / .deb などの配布形式（PyInstaller のフォルダ形式と AppImage は用意あり）

## 配布用に固める

```sh
sh packaging/build_linux.sh   # dist/Potalker/ にフォルダ形式で出力
```

PyInstaller で Python と Qt WebEngine を同梱します（約 590MB と大きめです。Qt WebEngine の分です）。ビルドした環境と近いディストリビューション向けです。デスクトップ登録用の `packaging/potalker.desktop` も同梱しています。

単一ファイルの AppImage にするには、フォルダを作ったあと `sh packaging/make_appimage.sh` を実行します（appimagetool を自動で取得します）。約 227MB の `Potalker-x86_64.AppImage` ができます。中身を取り出して起動するところまで確認済みですが、FUSE でそのまま実行する形と実機での動作は未確認です。ビルド環境が Ubuntu 24.04 相当のため、新しめのディストリビューション向けです。

確認できていないこと:

- **声の実到達**：開発用の仮想環境は UDP が使えず、TURN 中継へ届かなかったため、「2 人つないで声が届く」ところは実機未確認です。Qt WebEngine（Chromium）でマイク取得・ロビー接続・部屋の作成までは確認済みで、通常のデスクトップでは Chrome と同じ経路でつながる見込みですが、保証は実機の報告待ちです。
- 実物のマイク・スピーカーでの聞こえ方、ウィンドウの操作感。

## 構成

| ファイル | 役割 |
| --- | --- |
| `potalk_linux/engine.py` | 画面に出ない WebView（Qt WebEngine）。ページ取得・差し込み・ブリッジとの受け渡し |
| `potalk_linux/patcher.py` | potalk.app のページへの小さな差し込み（Mac 版 PagePatcher.swift と同じ内容） |
| `potalk_linux/assets/bridge.js` | ページ側の橋渡し（Mac/Windows 版と共通。送信先だけ Qt 向けに変更） |
| `potalk_linux/assets/mic.js` | マイクの上書き（共通） |
| `potalk_linux/model.py` | ブリッジから届く状態の形と、検索などの画面に依存しないロジック |
| `potalk_linux/lobby_window.py` | ロビーの窓 |
| `potalk_linux/room_window.py` | 部屋の窓 |
| `potalk_linux/app.py` | 窓とエンジンの取りまとめ |
| `tests/` | 差し込みとモデルの自動テスト（`python3 -m unittest discover -s tests`） |
| `smoke_test.py` | 実ページ相手の確認（ロビー接続〜部屋の作成・入室・退出） |

## 開発メモ

- `QWebEngineProfile` と `QWebChannel` は Python 側で保持し続けること。GC で回収されるとブリッジが黙って死にます（検証で踏みました）。
- 効果音に QtMultimedia（QSoundEffect）を使わないこと。音声まわりの土台が無い環境では、生成の時点でプロセスごと落ちることがあります。`sounds.py` は paplay / pw-play / aplay の外部コマンドに逃がしています。
- ページ本体は HTTP で取りに行って差し込みを当て、`setHtml`（baseURL = potalk.app）で読み込みます。取得や差し込みに失敗したら、元のページを直接読み込みます。
- 土台に WebKitGTK を使わなかった理由：Ubuntu のパッケージでは `RTCPeerConnection` が無効化されていて、通話が成立しません。詳しくは開発時の検証メモ（リポジトリ外）参照。要点は「Chromium 系のエンジンが要る」ことです。

## ライセンス

MIT（リポジトリ全体と共通）。ぽっと通話本体とは関係のない、非公式のクライアントです。
