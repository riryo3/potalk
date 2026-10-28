# potalk-electron-R-ver

Potalker（ぽっと通話 非公式クライアント）の、Electron による**新作**です。既存の `potalk-mac/`（Electron の叩き台）とは別物で、Mac 版（`potalk-swift/`）・Windows 版（`potalk-win/`）・Linux 版（`potalk-linux/`）と同じ方式で作ります。

- **方式**: 画面に出ない engine 窓で potalk.app をそのまま動かし、画面（`ui/`）だけを作り直します。
- **橋の JS**: `engine/bridge.js`・`engine/mic.js` は、Linux 版のものを写しています（`#peerNotice`・`#audioWarn` の読み取りを足してあります）。差し込み（`engine/patcher.js`）は、ほかの版と同じ内容です。
- **本体ページの扱い**: `https://potalk.app/` だけ、取得して差し込みを当てて返します（`main.js` の `installPagePatcher`）。ほかの通信は、そのまま通します。

## 動かす

```bash
npm install
npm start
```

## いまできること（0.0.1）

ロビー（部屋の一覧・更新）、部屋を作る、部屋に入る、メンバー、ミュート、リアクション、つなぎ直す、退出、エラー・お知らせの帯。

## まだ

ひとこと、おたより、部屋の設定、名刺、シングルペインの細かい動き（ドロワー、表示サイズ）、自衛ワード。声が実際に届くところは、未確認です。
