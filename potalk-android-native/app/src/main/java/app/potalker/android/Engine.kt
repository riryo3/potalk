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
    class Fly(val id: Long, val emoji: String, val who: String, val self: Boolean, val xr: Float)
    val flies = mutableStateListOf<Fly>()
    private var flySeq = 0L
    var unread by mutableStateOf(0)         // ひとこと欄を開いていない間に届いた、新着の数
    var chatOpen = false                    // 画面が、ひとこと欄を開いているか
    private var joined = false
    private var pendingLink: String? = null

    val isJoined: Boolean get() = room?.optBoolean("joined") == true

    @SuppressLint("SetJavaScriptEnabled")
    fun start(context: Context) {
        if (web != null) return
        app = context.applicationContext as Application
        loadBanned()
        muteOnJoin = prefs.getBoolean("muteOnJoin", true); muteOnCreate = prefs.getBoolean("muteOnCreate", true)
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
        w.loadUrl(HOME)
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
        if (lobby?.arr("rooms").orEmpty().any { it.optString("id") == id }) { joinRoom(id); return }
        if (tries < 8) { main.postDelayed({ joinLinkRoom(url, id, tries + 1) }, 1500); return }
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
            "ready" -> { ready = true; pendingLink?.let { openLink(it) } }
            "lobby" -> lobby = d as? JSONObject
            "profile" -> profile = d as? JSONObject
            "cards" -> cards = d as? JSONObject
            "react" -> (d as? JSONObject)?.let { r ->
                if (flies.size < 12 && r.optString("e").isNotEmpty()) flies.add(Fly(++flySeq, r.optString("e"), if (r.optString("u") == "self") "" else r.optString("n"), r.optString("u") == "self", Math.random().toFloat()))
            }
            "room" -> { room = d as? JSONObject; onJoinedChanged(); checkBannedMembers(); applyPendingMute() }
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
        if (now) { app.startForegroundService(Intent(app, CallService::class.java)) } else { chat.clear(); unread = 0; app.stopService(Intent(app, CallService::class.java)) }
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
