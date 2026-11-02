package app.potalker.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** ロビー・部屋のどちらからでも開く、全画面のページ */
enum class Page { None, Profile, Banned }
var page by mutableStateOf(Page.None)

/** 名刺の編集中（ページが窓を開いている間）は、編集の画面を、最前面に出す */
@Composable
fun PagesOverlay() {
    val cards = Engine.cards
    val edit = cards?.optJSONObject("edit")
    when {
        edit != null -> CardEditPage(edit)
        page == Page.Profile -> ProfilePage()
        page == Page.Banned -> BannedPage()
    }
    cards?.optJSONObject("auth")?.let { AuthDialog(it) }
}

@Composable
private fun PageFrame(title: String, onBack: () -> Unit, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    BackHandler { onBack() }
    Column(Modifier.fillMaxSize().background(Bg).statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onBack) { Text("← 戻る", color = Teal) }
            Text(title, Modifier.padding(start = 4.dp), color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f).padding(horizontal = 16.dp)) { content() }
    }
}

/** 入室・部屋作成のときの、ミュートの設定 */
@Composable
fun MuteSettings() {
    Column {
        for ((label, on, set) in listOf(
            Triple("入室したとき、マイクをミュートにする", Engine.muteOnJoin, { v: Boolean -> Engine.changeMuteOnJoin(v) }),
            Triple("部屋を作ったとき、マイクをミュートにする", Engine.muteOnCreate, { v: Boolean -> Engine.changeMuteOnCreate(v) }),
        )) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), color = Color.White, fontSize = 14.sp)
            androidx.compose.material3.Switch(on, set)
        }
    }
}

/** ロビーと、部屋の設定タブに置く、3 つの入口 */
@Composable
fun ProfileEntries() {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        @Composable fun chip(label: String, mod: Modifier, click: () -> Unit) =
            Box(mod.height(56.dp).clip(RoundedCornerShape(12.dp)).background(Card).clickable(onClick = click).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
                Text(label, color = Color.White, fontSize = 13.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        chip("👤 名前・アイコン", Modifier.weight(1f)) { page = Page.Profile }
        chip("📇 名刺", Modifier.weight(1f)) { Engine.cmd("type" to "cardEdit") }
        chip("🛡 自衛ワード", Modifier.weight(1f)) { page = Page.Banned }
    }
}

// ---- 名前とアイコン ----
@Composable
private fun ProfilePage() {
    val p = Engine.profile
    PageFrame("👤 名前・アイコン", { page = Page.None }) {
        var name by remember { mutableStateOf(p?.optString("input").orEmpty().ifEmpty { p?.optString("name").orEmpty() }) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(p?.optString("emoji").orEmpty().ifEmpty { "🙂" }, fontSize = 40.sp)
            Spacer(Modifier.padding(6.dp))
            Text(p?.optString("name").orEmpty(), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(name, { name = it.take(20) }, Modifier.weight(1f), label = { Text("名前（20 文字まで）") }, singleLine = true)
            Button({ Engine.cmd("type" to "setName", "name" to name.trim()) }, colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color.White)) { Text("決める") }
        }
        Spacer(Modifier.height(12.dp))
        Text("アイコン", color = Dim, fontSize = 13.sp)
        val avatars = p?.arr("avatars").orEmpty()
        LazyVerticalGrid(GridCells.Adaptive(52.dp), Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(avatars.withIndex().toList()) { (i, a) ->
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(12.dp)).background(if (a.optBoolean("on")) Teal.copy(alpha = 0.4f) else Card).clickable { Engine.cmd("type" to "setAvatar", "i" to i) }, contentAlignment = Alignment.Center) {
                    Text(a.optString("em"), fontSize = 26.sp)
                }
            }
        }
        Button({ page = Page.None; Engine.cmd("type" to "cardEdit") }, Modifier.fillMaxWidth().padding(vertical = 10.dp), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text("📇 名刺（画像・SNS・本人確認）を編集") }
    }
}

// ---- 名刺の編集 ----
@Composable
private fun CardEditPage(e: JSONObject) {
    val ctx = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) squareJpeg(ctx, uri)?.let { Engine.cmd("type" to "ceAvatarFile", "b64" to it, "name" to "avatar.jpg", "mime" to "image/jpeg") } }
    PageFrame("📇 名刺（プロフィール）設定", { Engine.cmd("type" to "ceClose") }) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // アイコン
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val bmp = dataUrlBitmap(e.optString("img"))
                if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.size(56.dp).clip(CircleShape), contentScale = ContentScale.Crop)
                else Text(e.optString("emoji").ifEmpty { "🙂" }, fontSize = 40.sp)
                Button({ pick.launch("image/*") }, colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text("📷 画像を選ぶ") }
                if (e.optBoolean("clearShow")) TextButton({ Engine.cmd("type" to "ceAvatarClear") }) { Text("画像を削除", color = Red) }
            }
            if (e.optString("avatarMsg").isNotEmpty()) Text(e.optString("avatarMsg"), color = Orange, fontSize = 12.sp)
            // ひとこと（bio）
            field("ひとこと（bio・60 文字まで）", e.optString("bio"), 60, "bio")
            // 投げ銭
            Text("投げ銭の案内", color = Dim, fontSize = 13.sp)
            val tipOpt = e.optString("tipOpt").ifEmpty { "none" }
            tipRow("none", "提示しない（非表示）", tipOpt, null)
            for ((k, label, ph, key) in listOf(
                Quad("ofuse", "OFUSE", "URL または ユーザID", "tipOfuse"), Quad("amazon", "Amazon ほしい物リスト", "URL または リストID", "tipAmazon"),
                Quad("zap", "Zap（Lightning）", "name@domain または npub", "tipZap"), Quad("kofi", "Ko-fi", "URL または ユーザ名", "tipKofi"), Quad("bmac", "Buy Me a Coffee", "URL または ユーザ名", "tipBmac"))
            ) tipRow(k, label, tipOpt, Triple(key, ph, e.optString(key)))
            // SNS
            Text("SNS・リンク（本人確認ができるのは X・GitHub・Nostr）", color = Dim, fontSize = 13.sp)
            for ((label, key, k) in listOf(Triple("X", "snsX", "x"), Triple("GitHub", "snsGithub", "github"), Triple("note", "snsNote", ""), Triple("Instagram", "snsInstagram", ""), Triple("YouTube", "snsYoutube", ""), Triple("Nostr", "snsNostr", "nostr"))) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.weight(1f)) { field(label, e.optString(key), 400, key) }
                    if (k.isNotEmpty()) {
                        val v = e.optJSONObject("ver" + k.replaceFirstChar { it.uppercase() })
                        if (v != null && v.optBoolean("verified")) Text("✅", Modifier.clickable { Engine.cmd("type" to "ceUnverify", "k" to k) }, fontSize = 22.sp)
                        else if (v != null && v.optBoolean("btnShow")) Button({ Engine.cmd("type" to "ceVerify", "k" to k) }, enabled = !v.optBoolean("btnDisabled"), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text(v.optString("btnLabel").ifEmpty { "認証" }) }
                    }
                }
            }
            Row(Modifier.clickable { Engine.cmd("type" to "ceNoImg", "on" to !e.optBoolean("noImg")) }, verticalAlignment = Alignment.CenterVertically) {
                Checkbox(e.optBoolean("noImg"), { Engine.cmd("type" to "ceNoImg", "on" to it) })
                Text("相手の名刺の画像を表示しない（絵文字だけにする）", color = Color.White, fontSize = 13.sp)
            }
            if (e.optString("warn").isNotEmpty()) Text(e.optString("warn"), color = Orange, fontSize = 12.sp)
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({ Engine.cmd("type" to "ceClose") }, Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text("閉じる") }
            Button({ Engine.cmd("type" to "ceSave") }, Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color.White)) { Text("保存") }
        }
    }
}

private data class Quad(val k: String, val label: String, val ph: String, val key: String)
private operator fun Quad.component1() = k
private operator fun Quad.component2() = label
private operator fun Quad.component3() = ph
private operator fun Quad.component4() = key

/** 1 つの欄。開いたときの値で始めて、書くたびに、ページへ渡す */
@Composable
private fun field(label: String, initial: String, max: Int, key: String) {
    var v by remember { mutableStateOf(initial) }
    OutlinedTextField(v, { v = it.take(max); Engine.cmd("type" to "ceField", "field" to key, "value" to v) }, Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = key != "bio")
}

@Composable
private fun tipRow(value: String, label: String, current: String, input: Triple<String, String, String>?) {
    Column {
        Row(Modifier.clickable { Engine.cmd("type" to "ceTipOpt", "v" to value) }, verticalAlignment = Alignment.CenterVertically) {
            RadioButton(current == value, { Engine.cmd("type" to "ceTipOpt", "v" to value) })
            Text(label, color = Color.White, fontSize = 14.sp)
        }
        if (input != null && current == value) {
            var v by remember { mutableStateOf(input.third) }
            OutlinedTextField(v, { v = it.take(200); Engine.cmd("type" to "ceField", "field" to input.first, "value" to v) }, Modifier.fillMaxWidth().padding(start = 40.dp), placeholder = { Text(input.second) }, singleLine = true)
        }
    }
}

/** ページが出す data:image/…;base64,… を、画像にする */
private fun dataUrlBitmap(u: String): Bitmap? = try {
    if (!u.startsWith("data:")) null else { val b = Base64.decode(u.substringAfter(","), Base64.DEFAULT); BitmapFactory.decodeByteArray(b, 0, b.size) }
} catch (e: Exception) { null }

/** 選んだ画像を、中央で正方形に切り抜いて、256px の JPEG にする（ページの切り抜きの窓は、自動で「決定」される） */
private fun squareJpeg(ctx: android.content.Context, uri: Uri): String? = try {
    val src = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it) }
    val side = minOf(src.width, src.height)
    val sq = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
    val out = Bitmap.createScaledBitmap(sq, 256, 256, true)
    val bo = ByteArrayOutputStream(); out.compress(Bitmap.CompressFormat.JPEG, 88, bo)
    Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP)
} catch (e: Exception) { null }

// ---- 本人確認 ----
@Composable
private fun AuthDialog(a: JSONObject) {
    val ctx = LocalContext.current
    var input by remember(a.optString("title")) { mutableStateOf(a.optString("input")) }
    AlertDialog(
        onDismissRequest = { Engine.cmd("type" to "caCancel") },
        containerColor = Card,
        title = { Column { Text(a.optString("title"), color = Color.White); if (a.optString("account").isNotEmpty()) Text(a.optString("account"), color = Dim, fontSize = 12.sp) } },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (a.optString("desc").isNotEmpty()) Text(a.optString("desc"), color = Color.White, fontSize = 13.sp)
            if (a.optBoolean("codeShow")) Text(a.optString("code"), Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Bg).clickable { copy(ctx, a.optString("code")) }.padding(10.dp), color = Teal, fontSize = 13.sp)
            if (a.optBoolean("postShow")) {
                Text(a.optString("post"), Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Bg).clickable { copy(ctx, a.optString("post")) }.padding(10.dp), color = Color.White, fontSize = 13.sp)
                if (a.optString("tweet").startsWith("https://")) TextButton({ ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(a.optString("tweet")))) }) { Text("X で投稿する", color = Teal) }
            }
            if (a.optBoolean("inputShow")) OutlinedTextField(input, { input = it; Engine.cmd("type" to "caInput", "value" to it) }, Modifier.fillMaxWidth(), label = { Text("投稿・ページの URL") }, singleLine = true)
            if (a.optString("msg").isNotEmpty()) Text(a.optString("msg"), color = if (a.optBoolean("msgBad")) Red else Teal, fontSize = 13.sp)
            if (a.optString("note").isNotEmpty()) Text(a.optString("note"), color = Dim, fontSize = 11.sp)
        } },
        confirmButton = { TextButton({ Engine.cmd("type" to "caVerify") }, enabled = !a.optBoolean("verifyDisabled")) { Text(a.optString("verifyLabel").ifEmpty { "確認する" }, color = Teal) } },
        dismissButton = { TextButton({ Engine.cmd("type" to "caCancel") }) { Text("やめる", color = Dim) } }
    )
}

private fun copy(ctx: android.content.Context, text: String) {
    (ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("potalk", text))
    android.widget.Toast.makeText(ctx, "コピーしました", android.widget.Toast.LENGTH_SHORT).show()
}

// ---- 自衛ワード ----
@Composable
private fun BannedPage() {
    val ctx = LocalContext.current
    var input by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var del by remember { mutableStateOf<String?>(null) }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) try {
            val text = ctx.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() }
            val (a, s) = Engine.importBanned(text); note = "${a}件を足しました（重複・空は ${s}件を飛ばしました）"
        } catch (e: Exception) { note = "ファイルを読めませんでした" }
    }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        if (uri != null) try {
            ctx.contentResolver.openOutputStream(uri)!!.use { it.write((Engine.banned.joinToString("\n") + "\n").toByteArray(Charsets.UTF_8)) }
            note = "${Engine.banned.size}件を書き出しました"
        } catch (e: Exception) { note = "書き出せませんでした" }
    }
    PageFrame("🛡 自衛ワード", { page = Page.None }) {
        Text("見たくない言葉を登録すると、その言葉を含む部屋（部屋の名前・話題タグ・タグを付けた人・いまいる人の名前）が、一覧に出なくなります。いまの部屋に、登録した言葉を含む名前の人がいたときは、通知でお知らせします。", color = Dim, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(input, { input = it.take(40) }, Modifier.weight(1f), placeholder = { Text("登録する言葉") }, singleLine = true)
            Button({ if (Engine.addBanned(input)) { input = ""; note = "" } else note = "すでに登録されているか、空です" }, colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color.White)) { Text("追加") }
        }
        if (note.isNotEmpty()) Text(note, color = Orange, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(Engine.banned.toList()) { w ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Card).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(w, Modifier.weight(1f), color = Color.White, fontSize = 15.sp)
                    TextButton({ del = w }) { Text("消す", color = Red) }
                }
            }
            if (Engine.banned.isEmpty()) item { Text("まだ登録がありません", color = Dim) }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({ importer.launch("text/*") }, Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text("📥 読み込む") }
            Button({ exporter.launch("jiei-words-" + SimpleDateFormat("yyyy-MM-dd", Locale.JAPAN).format(Date()) + ".txt") }, Modifier.weight(1f), enabled = Engine.banned.isNotEmpty(), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text("📤 書き出す") }
        }
    }
    del?.let { w ->
        AlertDialog(onDismissRequest = { del = null }, containerColor = Card,
            title = { Text("このワードを消しますか？", color = Color.White) },
            text = { Text("「$w」を消すと、このワードを含む部屋が、また一覧に出ます。", color = Color.White) },
            confirmButton = { TextButton({ Engine.removeBanned(w); del = null }) { Text("消す", color = Red) } },
            dismissButton = { TextButton({ del = null }) { Text("やめる", color = Dim) } })
    }
}
