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
import org.json.JSONObject
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
    var spkMuted by mutableStateOf(false)
    val chat = mutableStateListOf<JSONObject>()
    var unread by mutableStateOf(0)         // ひとこと欄を開いていない間に届いた、新着の数
    var chatOpen = false                    // 画面が、ひとこと欄を開いているか
    private var joined = false
    private var pendingLink: String? = null

    val isJoined: Boolean get() = room?.optBoolean("joined") == true

    @SuppressLint("SetJavaScriptEnabled")
    fun start(context: Context) {
        if (web != null) return
        app = context.applicationContext as Application
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
        w.loadUrl(url)
        // リンクの部屋が、いま開かれていないときは、ページが「このまま入ってみる」を出す。少し待って、押す（開いている部屋なら、押す先がないので、何も起きない）
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

    /** いまの部屋を出て、別の部屋に入る */
    fun joinOther(id: String) {
        cmd("type" to "leave")
        main.postDelayed({ cmd("type" to "join", "id" to id, "quiet" to false) }, 1500)
    }

    fun toggleSpeaker() { spkMuted = !spkMuted; cmd("type" to "spk", "on" to spkMuted) }

    private fun handle(m: JSONObject) {
        val d = m.opt("d")
        when (m.optString("t")) {
            "ready" -> { ready = true; pendingLink?.let { openLink(it) } }
            "lobby" -> lobby = d as? JSONObject
            "profile" -> profile = d as? JSONObject
            "room" -> { room = d as? JSONObject; onJoinedChanged() }
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

    private class Bridge {
        @JavascriptInterface fun post(s: String) { try { val j = JSONObject(s); main.post { handle(j) } } catch (e: Exception) {} }
    }
}
