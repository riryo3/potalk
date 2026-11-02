'use strict'
// Linux の AppImage 用：本体の実行ファイルを別名にして、元の名前には「サンドボックスを切って本体を呼ぶ」小さなスクリプトを置く。
// AppImage は一時フォルダへ展開されて動き、chrome-sandbox に必要な権限（root 所有・4755）を付けられないため、そのままでは起動できない。
// Electron 本体は JS より前にこれを確認するので、main.js からは切り替えられず、起動の前に渡す必要がある。
// ※ .deb など、権限を付けて入れる配布方法を足すときは、この処理を AppImage だけに限ること。
const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'linux') return
  const exe = path.join(ctx.appOutDir, ctx.packager.executableName)
  fs.renameSync(exe, exe + '.bin')
  fs.writeFileSync(exe, '#!/bin/bash\nexec "$(dirname "$(readlink -f "$0")")/' + ctx.packager.executableName + '.bin" --no-sandbox "$@"\n', { mode: 0o755 })
}
