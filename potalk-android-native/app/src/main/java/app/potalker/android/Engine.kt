package app.potalker.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

/** 通話のエンジン：画面に出さない WebView で、ぽっと通話（potalk.app）のページを動かす（Mac 版・Windows 版と同じ作り）。
 *  プロセスの中に 1 つだけ置く。画面（Activity）が閉じても、作り直されても、通話は続く。 */
object Engine {
    const val HOME = "https://potalk.app/"
    private val main = Handler(Looper.getMainLooper())
    private lateinit var app: Application
    private var web: WebView? = null
    private var started = false

    // ページから届く状態（画面は、これを読んで描く）
    var lobby by mutableStateOf<JSONObject?>(null)
    var profile by mutableStateOf<JSONObject?>(null)
    var room by mutableStateOf<JSONObject?>(null)
    var ready by mutableStateOf(false)
    var cards by mutableStateOf<JSONObject?>(null)        // 名刺の編集・本人確認の窓の状態
    var muteOnJoin by mutableStateOf(true)                // 入室したとき、マイクをミュートにする（Mac 版・Windows 版・Electron 版と同じ。初期値はオン）
    var muteOnCreate by mutableStateOf(true)              // 部屋を作ったとき、マイクをミュートにする（同上）
    private var pendingMuteUntil = 0L                     // この時刻まで、「入ったら、ミュートにする」を待つ
    val banned = mutableStateListOf<String>()             // 自衛ワード（新しいものが先頭）
    private val warned = HashSet<String>()                // 自衛ワードの警告を、もう出した名前
    var spkMuted by mutableStateOf(false)
    val chat = mutableStateListOf<JSONObject>()
    /** 部屋の画面に、いま浮かんでいるリアクション（絵文字）。Mac 版・Windows 版と同じく、最大 12 個 */
    class Fly(val id: Long, val emoji: String, val who: String, val self: Boolean, val dx: Float)
    val flies = mutableStateListOf<Fly>()
    private var flySeq = 0L
    var unread by mutableStateOf(0)         // ひとこと欄を開いていない間に届いた、新着の数
    var chatOpen = false                    // 画面が、ひとこと欄を開いているか
    private var joined = false
    private var pendingLink: String? = null
    private var recovering = false          // 描画プロセスが終了されて、部屋に入り直している間

    val isJoined: Boolean get() = room?.optBoolean("joined") == true

    // ---- 接続の見張り：相手と一人もつながっていない（またはマイクが止まった）状態が続いたら、自動でつなぎ直す ----
    var callNote = "通話中です。タップすると開きます"      // 通話中の通知の文
    private var pcN = 0; private var pcOk = 0; private var micState = ""
    private var micLive = false                         // 今回の入室で、マイクが動いているのを見たか（前の通話の止まったマイクを、数えないため）
    private var healthAt = 0L                           // 最後に、ページから状態が届いた時刻
    private var badSince = 0L                           // 「切れている」が続き始めた時刻（0＝いま、切れていない）
    private var goodSince = 0L                          // 「つながっている」が続き始めた時刻
    private var nextTryAt = 0L                          // この時刻までは、つなぎ直さない
    private var backoffMs = 60_000L
    private var autoCount = 0
    private var lastSig = ""
    private val badGraceMs = 90_000L                    // 切れた状態がこれだけ続いたら、つなぎ直す
    private val watchdog = object : Runnable {
        override fun run() {
            if (!isJoined) return
            val now = System.currentTimeMillis()
            val others = (room?.optJSONArray("members")?.length() ?: 0) > 1
            val micBad = micLive && (micState.startsWith("ended") || micState.endsWith("/muted"))
            val stale = healthAt != 0L && now - healthAt > 60_000          // ページから、1 分以上、何も届かない
            val netBad = others && pcN > 0 && pcOk == 0 || others && pcN == 0 && healthAt != 0L
            val bad = netBad || micBad || stale
            if (!bad) { badSince = 0L; if (goodSince == 0L) goodSince = now; if (now - goodSince > 120_000) backoffMs = 60_000L }
            else {
                goodSince = 0L
                if (badSince == 0L) { badSince = now; log("切れているようです（相手との接続 $pcOk/$pcN、マイク $micState、ページの応答 ${if (stale) "なし" else "あり"}）") }
                if (now - badSince >= badGraceMs && now >= nextTryAt) {
                    autoCount++
                    log("自動でつなぎ直します（$autoCount 回目）")
                    callNote = "通話中です（${android.text.format.DateFormat.format("H:mm", now)} に、自動でつなぎ直しました：$autoCount 回）"
                    CallService.update(app, callNote)
                    cmd("type" to "reconnect")
                    nextTryAt = now + backoffMs; backoffMs = minOf(backoffMs * 2, 600_000L); badSince = 0L
                }
            }
            main.postDelayed(this, 15_000)
        }
    }
    private fun startWatchdog() { main.removeCallbacks(watchdog); healthAt = 0L; badSince = 0L; goodSince = 0L; nextTryAt = 0L; backoffMs = 60_000L; autoCount = 0; main.postDelayed(watchdog, 15_000) }

    // ---- 通話の記録（切れた原因を、後から調べるため。端末の中だけに残す） ----
    private val logFile get() = java.io.File(app.filesDir, "call.log")
    @Synchronized fun log(msg: String) {
        try {
            val f = logFile
            if (f.length() > 200_000) f.writeText(f.readText().takeLast(100_000).substringAfter('\n'))
            f.appendText("${java.text.SimpleDateFormat("MM/dd HH:mm:ss", java.util.Locale.JAPAN).format(java.util.Date())} $msg\n")
        } catch (e: Exception) {}
    }
    private var memLogAt = 0L
    /** 5 分ごとに、メモリの使用量を記録する（アプリが、メモリ不足で終了させられていないかを調べるため） */
    private fun logMemory(force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && now - memLogAt < 300_000) return
        memLogAt = now
        try {
            val am = app.getSystemService(android.app.ActivityManager::class.java)
            val mi = android.app.ActivityManager.MemoryInfo(); am.getMemoryInfo(mi)
            val pss = am.getProcessMemoryInfo(intArrayOf(android.os.Process.myPid()))[0].totalPss / 1024
            log("メモリ：アプリ ${pss}MB、端末の空き ${mi.availMem / 1048576}MB${if (mi.lowMemory) "（不足）" else ""}")
        } catch (e: Exception) {}
    }
    /** 前回の終了の理由を記録する（Android 11 以降） */
    private fun logLastExit() {
        if (android.os.Build.VERSION.SDK_INT < 30) return
        try {
            val am = app.getSystemService(android.app.ActivityManager::class.java)
            val last = prefs.getLong("lastExitTs", 0L)
            for (e in am.getHistoricalProcessExitReasons(null, 0, 3).sortedBy { it.timestamp }) {
                if (e.timestamp <= last) continue
                prefs.edit().putLong("lastExitTs", e.timestamp).apply()
                val why = when (e.reason) {
                    android.app.ApplicationExitInfo.REASON_LOW_MEMORY -> "メモリ不足"
                    android.app.ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "資源の使いすぎ"
                    android.app.ApplicationExitInfo.REASON_CRASH -> "異常終了（クラッシュ）"
                    android.app.ApplicationExitInfo.REASON_CRASH_NATIVE -> "異常終了（ネイティブ）"
                    android.app.ApplicationExitInfo.REASON_ANR -> "応答なし（ANR）"
                    android.app.ApplicationExitInfo.REASON_USER_REQUESTED -> "ユーザーが停止"
                    android.app.ApplicationExitInfo.REASON_USER_STOPPED -> "ユーザーが強制停止"
                    android.app.ApplicationExitInfo.REASON_SIGNALED -> "シグナルで終了"
                    android.app.ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "依存先の終了"
                    android.app.ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "起動の失敗"
                    android.app.ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "権限の変更"
                    android.app.ApplicationExitInfo.REASON_EXIT_SELF -> "自分で終了"
                    else -> "その他(${e.reason})"
                }
                log("前回の終了の理由：$why（${e.description.orEmpty()}、${java.text.SimpleDateFormat("MM/dd HH:mm:ss", java.util.Locale.JAPAN).format(java.util.Date(e.timestamp))}）")
            }
        } catch (e: Exception) {}
    }
    fun readLog(): String = try { logFile.readText().takeLast(30_000).ifEmpty { "（まだ記録がありません）" } } catch (e: Exception) { "（まだ記録がありません）" }

    @SuppressLint("SetJavaScriptEnabled")
    fun start(context: Context) {
        if (web != null) return
        app = context.applicationContext as Application
        if (!started) {
            started = true
            if (prefs.getBoolean("wasJoined", false)) { log("アプリが起動しました（前回は、通話中にアプリが終了していました）"); prefs.edit().putBoolean("wasJoined", false).apply() }
            else log("アプリが起動しました")
            logLastExit(); logMemory(true)
            app.registerComponentCallbacks(object : android.content.ComponentCallbacks2 {
                override fun onTrimMemory(level: Int) { if (level in android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW..android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL || level >= android.content.ComponentCallbacks2.TRIM_MEMORY_MODERATE) { log("端末がメモリ不足を知らせました（レベル $level）"); logMemory(true) } }
                override fun onConfigurationChanged(c: android.content.res.Configuration) {}
                @Deprecated("") override fun onLowMemory() { log("端末がメモリ不足を知らせました（onLowMemory）") }
            })
        }
        loadBanned()
        muteOnJoin = prefs.getBoolean("muteOnJoin", true); muteOnCreate = prefs.getBoolean("muteOnCreate", true)
        Look.mode = prefs.getString("theme", "time").takeIf { it in listOf("time", "auto", "day", "night") } ?: "time"
        val w = WebView(app)
        web = w
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // ページは、UA に「; wv)」があると「アプリ内ブラウザ（マイクが使えないかも）」の警告を出す。このアプリはマイクを許可しているので外す
            userAgentString = userAgentString.replace("; wv)", ")") + " Potalker-Android/0.1.0"
        }
        w.addJavascriptInterface(Bridge(), "PotalkAndroid")
        w.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? {
                val u = r.url
                if (u.host == "potalk.app" && r.isForMainFrame && r.method == "GET" && (u.path.isNullOrEmpty() || u.path == "/" || u.path == "/index.html")) {
                    return try { patched(u.toString()) } catch (e: Exception) { null }
                }
                return null
            }
            override fun onRenderProcessGone(v: WebView, d: android.webkit.RenderProcessGoneDetail): Boolean {
                main.post { recoverWebView(d.didCrash()) }
                return true      // true を返さないと、システムが、アプリごと終了させる
            }
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                if (r.url.host == "potalk.app") return false
                app.startActivity(Intent(Intent.ACTION_VIEW, r.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))     // 外のサイトは、ブラウザで開く
                return true
            }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(req: PermissionRequest) {
                // マイクだけ許可する（カメラなどは許可しない）。マイクの許可は、画面（Activity）が、先に取る
                val mic = req.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                val granted = app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                main.post { if (mic && granted && req.origin.host == "potalk.app") req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req.deny() }
            }
        }
        // 画面が閉じていても、ページの描画プロセスを、重要なものとして扱ってもらう（システムに、終了させられにくくする）
        w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        w.loadUrl(HOME)
    }

    /** システム（機種の省電力など）に、ページの描画プロセスだけを終了させられたとき：アプリごと落ちずに、ページを作り直して、同じ部屋に入り直す */
    private fun recoverWebView(crashed: Boolean) {
        val rid = if (isJoined) room?.optString("rid").orEmpty() else ""
        log("ページの描画プロセスが${if (crashed) "クラッシュ" else "システムに終了"}されました。ページを作り直します${if (rid.isNotEmpty()) "（部屋に入り直します）" else ""}")
        try { web?.destroy() } catch (e: Exception) {}
        web = null; ready = false; room = null; joined = false
        lobby = null          // 前のページの部屋の一覧が残っていると、新しいページの準備ができる前に、入る命令を出してしまう
        main.removeCallbacks(watchdog)
        recovering = rid.isNotEmpty()
        if (rid.isNotEmpty()) pendingLink = HOME + "#room=" + rid
        start(app)
        if (rid.isNotEmpty()) main.postDelayed({
            recovering = false
            if (!isJoined) { log("部屋に入り直せませんでした。通話を終わります"); app.stopService(Intent(app, CallService::class.java)); prefs.edit().putBoolean("wasJoined", false).apply() }
        }, 90_000)
    }

    /** 部屋のリンクを開く（ページが起動して、ロビーが読めたら入る） */
    fun openLink(url: String) {
        pendingLink = url
        val w = web ?: return
        if (!ready) return
        pendingLink = null
        if (isJoined) { w.loadUrl(url); return }
        val id = Uri.parse(url).fragment.orEmpty().removePrefix("room=").substringBefore("&")
        if (id.isEmpty()) { w.loadUrl(url); return }
        joinLinkRoom(url, id, 0)
    }

    /** リンクの部屋が、ロビーの一覧にあれば、一覧から入る（確実）。一覧に出てくるまで少し待ち、出なければ、ページのリンクの入り方にまかせる */
    private fun joinLinkRoom(url: String, id: String, tries: Int) {
        if (isJoined) return
        if (recovering) log("入り直し：入室を試みます（tries=$tries、一覧に部屋あり=${lobby?.arr("rooms").orEmpty().any { it.optString("id") == id }}）")
        if (lobby?.arr("rooms").orEmpty().any { it.optString("id") == id }) {
            joinRoom(id)
            // 入る命令が、ページに無視されることがある。入れていなければ、少し待って、もう一度出す
            if (recovering && tries < 12) main.postDelayed({ joinLinkRoom(url, id, tries + 4) }, 6000)
            return
        }
        // 描画プロセスを作り直した直後は、一覧が届くまで 20 秒ほどかかるので、入り直しのときは、長く待つ
        if (tries < (if (recovering) 50 else 8)) { main.postDelayed({ joinLinkRoom(url, id, tries + 1) }, 1500); return }
        // 部屋が、いま開かれていないとき：ページに、リンクを開かせて、「このまま入ってみる」を押す
        val frag = Uri.parse(url).fragment.orEmpty()
        main.post { web?.evaluateJavascript("(function(h){location.hash='';setTimeout(function(){location.hash=h},80)})(${JSONObject.quote(frag)})", null) }
        for (ms in longArrayOf(8000, 14000)) main.postDelayed({ if (!isJoined) cmd("type" to "entryTry") }, ms)
    }

    /** ページを取ってきて、差し込みを当てて、橋の JS を足す */
    private fun patched(url: String): WebResourceResponse {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000; c.readTimeout = 15000
        val raw = c.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8)
        fun asset(n: String) = app.assets.open(n).use { it.readBytes() }.toString(Charsets.UTF_8)
        val (html, _) = PagePatcher.apply(raw, asset("hist.js") + "\n")
        val head = html.indexOf("<head>")
        val out = if (head < 0) html else html.substring(0, head + 6) + "<script>" + asset("mic.js") + "</script><script>" + asset("bridge.js") + "</script>" + html.substring(head + 6)
        return WebResourceResponse("text/html", "UTF-8", ByteArrayInputStream(out.toByteArray(Charsets.UTF_8)))
    }

    /** 画面からの命令（ミュート・入室・退出 など）。ページの橋（bridge.js）に渡す */
    fun cmd(vararg kv: Pair<String, Any?>) {
        val j = JSONObject(); for ((k, v) in kv) j.put(k, v)
        main.post { web?.evaluateJavascript("window.__pm && window.__pm.cmd($j)", null) }
    }

    /** 部屋に入る（設定がオンなら、入ったあと、マイクをミュートにする） */
    fun joinRoom(id: String) { armMute(muteOnJoin); cmd("type" to "join", "id" to id, "quiet" to false) }

    /** 部屋を作る（設定がオンなら、入ったあと、マイクをミュートにする） */
    fun createRoom(name: String, broadcast: Boolean) { armMute(muteOnCreate); cmd("type" to "create", "name" to name, "kind" to if (broadcast) "bc" else "chat") }

    fun changeMuteOnJoin(v: Boolean) { muteOnJoin = v; prefs.edit().putBoolean("muteOnJoin", v).apply() }
    fun changeTheme(v: String) { Look.mode = v; prefs.edit().putString("theme", v).apply() }
    fun changeMuteOnCreate(v: Boolean) { muteOnCreate = v; prefs.edit().putBoolean("muteOnCreate", v).apply() }

    private fun armMute(on: Boolean) { pendingMuteUntil = if (on) System.currentTimeMillis() + 40000 else 0L }

    /** 入った（マイクが使える状態になった）ら、まだ、ミュートでなければ、1 回だけ、ミュートにする */
    private fun applyPendingMute() {
        if (pendingMuteUntil == 0L) return
        if (System.currentTimeMillis() > pendingMuteUntil) { pendingMuteUntil = 0L; return }
        val r = room ?: return
        if (!r.optBoolean("joined") || !r.optBoolean("canMute")) return
        pendingMuteUntil = 0L
        if (!r.optBoolean("muted")) cmd("type" to "mute")
    }

    /** いまの部屋を出て、別の部屋に入る */
    fun joinOther(id: String) {
        cmd("type" to "leave")
        main.postDelayed({ joinRoom(id) }, 1500)
    }

    fun toggleSpeaker() { spkMuted = !spkMuted; cmd("type" to "spk", "on" to spkMuted) }

    private fun handle(m: JSONObject) {
        val d = m.opt("d")
        when (m.optString("t")) {
            "ready" -> { ready = true; if (recovering) log("入り直し：ページの準備ができました"); pendingLink?.let { openLink(it) } }
            "lobby" -> { lobby = d as? JSONObject; if (recovering) log("入り直し：部屋の一覧が届きました（${lobby?.arr("rooms").orEmpty().size} 件）") }
            "profile" -> profile = d as? JSONObject
            "cards" -> cards = d as? JSONObject
            "react" -> (d as? JSONObject)?.let { r ->
                if (flies.size < 12 && r.optString("e").isNotEmpty()) flies.add(Fly(++flySeq, r.optString("e"), if (r.optString("u") == "self") "" else r.optString("n"), r.optString("u") == "self", (Math.random() * 20 - 10).toFloat()))
            }
            "health" -> (d as? JSONObject)?.let { h ->
                healthAt = System.currentTimeMillis(); pcN = h.optInt("n"); pcOk = h.optInt("ok"); micState = h.optString("mic"); if (micState == "live") micLive = true
                val stText = h.optJSONObject("st")?.let { o -> o.keys().asSequence().sorted().joinToString(" ") { "$it=${o.optInt(it)}" } }.orEmpty()
                val sig = "$pcOk/$pcN ${micState}"
                if (isJoined && sig != lastSig) { lastSig = sig; log("接続 $pcOk/$pcN（$stText）、マイク ${micState.ifEmpty { "なし" }}") }
                logMemory(false)
            }
            "room" -> { room = d as? JSONObject; if (recovering) log("入り直し：部屋の状態が届きました（joined=${room?.optBoolean("joined")}）"); onJoinedChanged(); checkBannedMembers(); applyPendingMute() }
            "chat" -> (d as? JSONObject)?.let {
                chat.add(it); if (chat.size > 300) chat.removeAt(0)
                if (!chatOpen && !it.optBoolean("sys") && !it.optBoolean("hist") && !it.optString("who").endsWith("（あなた）")) unread++
            }
        }
    }

    /** 入室したら、通話中の常駐（通知）を始める。退出したら、やめる */
    private fun onJoinedChanged() {
        val now = isJoined
        if (now == joined) return
        joined = now
        prefs.edit().putBoolean("wasJoined", now).apply()
        if (now) {
            recovering = false
            log("入室しました"); micLive = false; callNote = "通話中です。タップすると開きます"; lastSig = ""
            app.startForegroundService(Intent(app, CallService::class.java)); startWatchdog()
        } else {
            log("退出しました"); main.removeCallbacks(watchdog)
            chat.clear(); unread = 0; app.stopService(Intent(app, CallService::class.java))
        }
    }

    // ---- 自衛ワード（Mac 版・Windows 版と同じ：含む部屋を、一覧に出さない。いまの部屋に含む名前の人がいたら、知らせる） ----
    private val prefs get() = app.getSharedPreferences("potalker", Context.MODE_PRIVATE)
    private fun loadBanned() {
        banned.clear()
        try { val a = JSONArray(prefs.getString("bannedWords", "[]")); for (i in 0 until a.length()) banned.add(a.getString(i)) } catch (e: Exception) {}
    }
    private fun saveBanned() { prefs.edit().putString("bannedWords", JSONArray(banned.toList()).toString()).apply() }
    /** 大文字小文字・全角半角・ひらがなカタカナの違いを、そろえる */
    fun fold(t: String): String = Normalizer.normalize(t, Normalizer.Form.NFKC).lowercase().map { if (it in '\u3041'..'\u3096') (it.code + 0x60).toChar() else it }.joinToString("")
    fun addBanned(word: String): Boolean {
        val t = word.trim(); if (t.isEmpty() || banned.any { fold(it) == fold(t) }) return false
        banned.add(0, t); saveBanned(); return true
    }
    fun removeBanned(word: String) { banned.remove(word); saveBanned() }
    /** 1 行 1 ワードのテキストを、まとめて足す（ファイルの先頭が最新なので、後ろから足して、並びを保つ）。（足した数, 飛ばした数） */
    fun importBanned(text: String): Pair<Int, Int> {
        var added = 0; var skipped = 0
        for (l in text.lines().map { it.trim() }.filter { it.isNotEmpty() }.reversed()) if (addBanned(l)) added++ else skipped++
        return added to skipped
    }
    fun matchedBanned(name: String): String? { if (banned.isEmpty()) return null; val h = fold(name); return banned.firstOrNull { h.contains(fold(it)) } }
    fun isBannedRoom(r: JSONObject): Boolean {
        if (banned.isEmpty()) return false
        val names = mutableListOf(r.optString("name"), r.optString("sub"), r.optString("subBy"))
        r.optJSONArray("people")?.let { a -> for (i in 0 until a.length()) names += a.getJSONObject(i).optString("name") }
        return names.any { matchedBanned(it) != null }
    }
    private fun checkBannedMembers() {
        val ms = room?.optJSONArray("members") ?: return
        for (i in 0 until ms.length()) {
            val m = ms.getJSONObject(i); if (m.optBoolean("you")) continue
            val name = m.optString("name"); val w = matchedBanned(name) ?: continue
            if (warned.add(name)) notifyBanned(name, w)
        }
    }
    private fun notifyBanned(name: String, word: String) {
        try {
            val nm = app.getSystemService(android.app.NotificationManager::class.java)
            nm.createNotificationChannel(android.app.NotificationChannel("warn", "自衛ワード", android.app.NotificationManager.IMPORTANCE_DEFAULT))
            nm.notify(name.hashCode(), android.app.Notification.Builder(app, "warn").setContentTitle("自衛ワードを含む名前の人がいます")
                .setContentText("$name（登録ワード：$word）").setSmallIcon(android.R.drawable.ic_dialog_alert).setAutoCancel(true).build())
        } catch (e: Exception) {}
    }

    private class Bridge {
        @JavascriptInterface fun post(s: String) { try { val j = JSONObject(s); main.post { handle(j) } } catch (e: Exception) {} }
    }
}
