package app.potalker.android

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * GitHub のリリースを見て、新しい版があれば知らせる。「更新する」を選ぶと、APK をダウンロードして、
 * Android のインストーラーを開く（Android は、アプリが自分を黙って入れ替えることはできないので、最後の「更新」は、押してもらう）。
 * 取りにいくのは、このリポジトリ（riryo3/potalk）の「android-v数字」のリリースにある Potalker-Android-数字.apk だけ。
 */
object Updater {
    private const val REPO = "riryo3/potalk"
    private val main = Handler(Looper.getMainLooper())

    class Found(val version: String, val apk: String, val page: String)

    /** 知らせる新しい版（null なら、ダイアログは出ない） */
    var found by mutableStateOf<Found?>(null)
    /** 「更新して再起動」のあとの、ダウンロード・インストールの様子（空なら、何もしていない） */
    var status by mutableStateOf("")
    private var busy = false
    private val asked = HashSet<String>()
    private var started = false

    fun current(ctx: Context): String = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }

    /** 起動の少しあとと、そのあと 6 時間ごとに、自動で確かめる（通話の常駐でプロセスが生きている間は、続く） */
    fun start(ctx: Context) {
        if (started) return; started = true
        val app = ctx.applicationContext
        main.postDelayed({ check(app, false) }, 8_000)
        val tick = object : Runnable { override fun run() { check(app, false); main.postDelayed(this, 6 * 3600 * 1000L) } }
        main.postDelayed(tick, 6 * 3600 * 1000L)
    }

    private fun parts(v: String) = v.split('.').map { it.toIntOrNull() ?: 0 }
    private fun newer(a: String, b: String): Boolean {
        val x = parts(a); val y = parts(b)
        for (i in 0 until maxOf(x.size, y.size)) { val p = x.getOrElse(i) { 0 }; val q = y.getOrElse(i) { 0 }; if (p != q) return p > q }
        return false
    }

    private fun httpGet(url: String): ByteArray {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15000; c.readTimeout = 30000
        c.setRequestProperty("User-Agent", "Potalker-updater"); c.setRequestProperty("Accept", "application/vnd.github+json")
        try { if (c.responseCode != 200) throw java.io.IOException("HTTP ${c.responseCode}"); return c.inputStream.readBytes() } finally { c.disconnect() }
    }

    private fun latest(): Found? {
        val arr = JSONArray(String(httpGet("https://api.github.com/repos/$REPO/releases?per_page=40")))
        var best: Found? = null
        for (i in 0 until arr.length()) {
            val r = arr.getJSONObject(i)
            if (r.optBoolean("draft")) continue   // 試用版（prerelease）は、Android 版の通常の形なので、対象にする
            val m = Regex("^android-v(\\d+\\.\\d+\\.\\d+)$").find(r.optString("tag_name")) ?: continue   // v… や win-v… は別のアプリ
            val ver = m.groupValues[1]
            val assets = r.optJSONArray("assets") ?: continue
            for (j in 0 until assets.length()) {
                val a = assets.getJSONObject(j)
                val url = a.optString("browser_download_url")
                if (a.optString("name") != "Potalker-Android-$ver.apk" || !url.startsWith("https://github.com/$REPO/releases/download/")) continue
                if (best == null || newer(ver, best.version)) best = Found(ver, url, r.optString("html_url"))
            }
        }
        return best
    }

    fun check(ctx: Context, manual: Boolean) {
        if (busy) return
        val app = ctx.applicationContext
        busy = true
        thread {
            try {
                val f = try { latest() } catch (e: Exception) {
                    Engine.log("更新の確認に失敗しました（${e.message}）")
                    if (manual) toast(app, "更新を確認できませんでした。ネットワークを確かめてください")
                    return@thread
                }
                val cur = current(app)
                if (f == null || !newer(f.version, cur)) { if (manual) toast(app, "最新の版です（いまの版は $cur）"); return@thread }
                if (!manual && !asked.add(f.version)) return@thread   // 同じ版は、起動中に何度も聞かない
                asked.add(f.version)
                main.post { found = f }
            } finally { busy = false }
        }
    }

    private fun toast(ctx: Context, s: String) = main.post { Toast.makeText(ctx, s, Toast.LENGTH_LONG).show() }

    /** ダウンロード → 中身の確認（名前・版・署名が、いまのアプリと同じか）→ インストーラーを開く */
    fun install(ctx: Context, f: Found) {
        if (status.isNotEmpty()) return
        val app = ctx.applicationContext
        found = null
        status = "更新をダウンロード中…"
        thread {
            try {
                val dir = File(app.cacheDir, "update").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                val file = File(dir, "Potalker-Android-${f.version}.apk")
                val c = URL(f.apk).openConnection() as HttpURLConnection
                c.connectTimeout = 15000; c.readTimeout = 60000; c.setRequestProperty("User-Agent", "Potalker-updater")
                try {
                    if (c.responseCode != 200) throw java.io.IOException("HTTP ${c.responseCode}")
                    c.inputStream.use { i -> file.outputStream().use { o -> i.copyTo(o) } }
                } finally { c.disconnect() }
                if (file.length() < 5_000_000) throw java.io.IOException("ダウンロードしたファイルが小さすぎます")
                val pm = app.packageManager
                val flags = PackageManager.GET_SIGNING_CERTIFICATES
                val info = pm.getPackageArchiveInfo(file.path, flags) ?: throw java.io.IOException("ダウンロードしたファイルが、アプリではありません")
                if (info.packageName != app.packageName || info.versionName != f.version) throw java.io.IOException("ダウンロードしたアプリの中身が、想定と違います")
                val mine = pm.getPackageInfo(app.packageName, flags).signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
                val theirs = info.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
                if (mine.isNullOrEmpty() || mine != theirs) throw java.io.IOException("署名が、いまのアプリと違います")
                // 通話中は、先に退出する（インストールで、アプリが閉じるため）
                if (Engine.isJoined) { main.post { Engine.cmd("type" to "leave") }; Thread.sleep(700) }
                commit(app, file)
                Engine.log("更新します：${current(app)} → ${f.version}")
                main.post { status = "" }
            } catch (e: Exception) {
                Engine.log("更新に失敗しました（${e.message}）")
                main.post { status = ""; failed = Pair(e.message ?: "原因不明", f.page) }
            }
        }
    }

    /** 失敗したとき、理由とリリースのページを見せる */
    var failed by mutableStateOf<Pair<String, String>?>(null)

    private fun commit(app: Context, file: File) {
        val pi = app.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(app.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = pi.createSession(params)
        pi.openSession(id).use { s ->
            file.inputStream().use { i -> s.openWrite("potalker", 0, file.length()).use { o -> i.copyTo(o); s.fsync(o) } }
            val intent = Intent(app, InstallResultReceiver::class.java).setPackage(app.packageName)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            s.commit(PendingIntent.getBroadcast(app, id, intent, flags).intentSender)
        }
    }
}

/** インストーラーからの返事。確認が要るときは、確認の画面を前に出す（初めて入れるときは、この提供元を許可するかも、聞かれる） */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT))
                if (confirm != null) ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> {}   // 入れ替わると、アプリは閉じる。アプリ一覧から、開き直してもらう
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "原因不明"
                Engine.log("インストールできませんでした（$msg）")
                Handler(Looper.getMainLooper()).post { Updater.failed = Pair(msg, "https://github.com/riryo3/potalk/releases") }
            }
        }
    }
}

@Composable
fun UpdateDialogs() {
    val ctx = LocalContext.current
    val f = Updater.found
    if (f != null) AlertDialog(
        onDismissRequest = { Updater.found = null }, containerColor = Card,
        title = { Text("新しい版（${f.version}）があります", color = Ink) },
        text = { Column { Text("いまの版は ${Updater.current(ctx)} です。更新すると、アプリがいったん閉じます。通話中のときは、部屋から退出します。", color = Ink, fontSize = 14.sp)
            Text("このあと、Android の「インストール」の確認が出ます。「更新」を押すと、入れ替わります。入れ替わったあとは、アプリ一覧から、開き直してください。初めてのときは、「この提供元のアプリを許可」の確認も出ます。", color = Dim, fontSize = 12.sp) } },
        confirmButton = { TextButton({ Updater.install(ctx, f) }) { Text("更新する", color = Teal) } },
        dismissButton = { TextButton({ Updater.found = null }) { Text("あとで", color = Dim) } }
    )
    if (Updater.status.isNotEmpty()) AlertDialog(
        onDismissRequest = {}, containerColor = Card, title = { Text(Updater.status, color = Ink) }, text = { Text("しばらくお待ちください。", color = Dim) }, confirmButton = {}
    )
    Updater.failed?.let { (why, page) ->
        AlertDialog(
            onDismissRequest = { Updater.failed = null }, containerColor = Card,
            title = { Text("更新できませんでした", color = Ink) },
            text = { Text("$why\nリリースのページから、手で入れ替えてください。", color = Ink) },
            confirmButton = { TextButton({ Updater.failed = null; ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(page)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }) { Text("リリースのページを開く", color = Teal) } },
            dismissButton = { TextButton({ Updater.failed = null }) { Text("閉じる", color = Dim) } }
        )
    }
}
