package app.potalker.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

val Bg = Color(0xFF0F1426)
val Card = Color(0xFF1B2340)
val Teal = Color(0xFF16B8A6)
val Red = Color(0xFFD93036)
val Orange = Color(0xFFD9822B)
val Dim = Color(0xFF9AA0B5)

/** いま、前に出している窓（ひとこと・部屋一覧・設定） */
enum class Panel { None, Chat, Mail, Lobby, Settings }
var panel by mutableStateOf(Panel.None)

fun JSONObject.arr(k: String): List<JSONObject> { val a = optJSONArray(k) ?: JSONArray(); return List(a.length()) { a.getJSONObject(it) } }

@Composable
fun LobbyScreen() {
    val me = Engine.profile
    var menu by remember { mutableStateOf(false) }
    var create by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var joinPick by remember { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("ぽっと通話", Modifier.weight(1f), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text("非公式・Android", fontSize = 11.sp, color = Dim)
            }
        }
        // 自分の名前（押すと、名前・アイコン、名刺、自衛ワードの入口が出る）
        item {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Card).clickable { menu = true }.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(me?.optString("emoji").orEmpty().ifEmpty { "🙂" }, fontSize = 24.sp)
                Spacer(Modifier.padding(5.dp))
                Text(me?.optString("name").orEmpty().ifEmpty { "…" }, Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 1)
                Text("設定 ▾", color = Dim, fontSize = 13.sp)
            }
        }
        // 部屋を作るボタン（1 行）
        item { Button({ create = true }, Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color.White)) { Text("＋ 部屋を作る") } }
        // 検索（1 行）と、その右に、一覧の再読み込み
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(query, { query = it.take(200) }, Modifier.weight(1f), placeholder = { Text("🔍 部屋名・話題・人の名前・URL", maxLines = 1) }, singleLine = true,
                    trailingIcon = { if (query.isNotEmpty()) Text("✕", Modifier.clickable { query = "" }.padding(12.dp), color = Dim) })
                Box(Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(Card).clickable { Engine.cmd("type" to "refreshLobby") }, contentAlignment = Alignment.Center) { Text("🔄", fontSize = 22.sp) }
            }
        }
        item { Text("通話中の部屋", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White) }
        roomsList(this, query = query) { id -> joinPick = id }
        item { Spacer(Modifier.height(24.dp)) }
    }
    if (menu) ProfileMenu { menu = false }
    if (create) CreateRoomDialog { create = false }
    joinPick?.let { id ->
        val r = Engine.lobby?.arr("rooms").orEmpty().firstOrNull { it.optString("id") == id }
        val title = r?.optString("sub")?.ifEmpty { null } ?: r?.optString("name").orEmpty().ifEmpty { "この部屋" }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { joinPick = null }, containerColor = Card,
            title = { Text("部屋に入りますか？", color = Color.White) },
            text = { Text("「$title」に入ります。", color = Color.White) },
            confirmButton = { androidx.compose.material3.TextButton({ joinPick = null; Engine.joinRoom(id) }) { Text("入る", color = Teal) } },
            dismissButton = { androidx.compose.material3.TextButton({ joinPick = null }) { Text("やめる", color = Dim) } }
        )
    }
}

/** 自分の名前を押したときの入口 */
@Composable
private fun ProfileMenu(close: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = close, containerColor = Card,
        title = { Text("設定", color = Color.White) },
        text = {
            Column {
                for ((label, act) in listOf<Pair<String, () -> Unit>>(
                    "👤 名前・アイコン" to { page = Page.Profile },
                    "📇 名刺（画像・SNS・本人確認）" to { Engine.cmd("type" to "cardEdit") },
                    "🛡 自衛ワード" to { page = Page.Banned },
                )) Text(label, Modifier.fillMaxWidth().clickable { close(); act() }.padding(vertical = 14.dp), color = Color.White, fontSize = 16.sp)
                Spacer(Modifier.height(6.dp))
                MuteSettings()
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(close) { Text("閉じる", color = Teal) } }
    )
}

/** 部屋を作る：部屋の名前と、雑談・配信を決める */
@Composable
private fun CreateRoomDialog(close: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var broadcast by remember { mutableStateOf(false) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = close, containerColor = Card,
        title = { Text("部屋を作る", color = Color.White) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it.take(30) }, Modifier.fillMaxWidth(), placeholder = { Text("部屋の名前（○○の部屋）") }, singleLine = true)
                for ((label, bc) in listOf("🏠 雑談（みんなで話す）" to false, "📣 配信（あなたの声だけ）" to true))
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (broadcast == bc) Teal.copy(alpha = 0.35f) else Bg).clickable { broadcast = bc }.padding(horizontal = 12.dp, vertical = 12.dp)) {
                        Text(label, color = Color.White, fontSize = 15.sp, fontWeight = if (broadcast == bc) FontWeight.Bold else FontWeight.Normal)
                    }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton({
                if (name.isNotBlank()) { Engine.createRoom(name.trim(), broadcast); close() }
            }, enabled = name.isNotBlank()) { Text("作る", color = Teal) }
        },
        dismissButton = { androidx.compose.material3.TextButton(close) { Text("やめる", color = Dim) } }
    )
}

/** 検索：部屋名・話題タグ・いまいる人の名前を探す。全角半角・大文字小文字・ひらがなカタカナを区別しない。部屋の URL（#room=…）を貼ると、その部屋に絞り込む */
private fun roomMatches(r: JSONObject, q: String): Boolean {
    val t = q.trim(); if (t.isEmpty()) return true
    val m = Regex("room=([^&\\s]+)").find(t)
    if (m != null) return r.optString("id") == m.groupValues[1]
    val key = Engine.fold(t)
    val texts = mutableListOf(r.optString("name"), r.optString("sub"), r.optString("subBy"))
    r.optJSONArray("people")?.let { a -> for (i in 0 until a.length()) texts += a.getJSONObject(i).optString("name") }
    return texts.any { Engine.fold(it).contains(key) }
}

/** 通話中の部屋の一覧（ロビーの画面と、部屋の中の「部屋一覧」で、同じものを使う） */
fun roomsList(scope: androidx.compose.foundation.lazy.LazyListScope, exceptId: String = "", query: String = "", onPick: (String) -> Unit) {
    val all = Engine.lobby?.arr("rooms").orEmpty().filter { it.optString("id") != exceptId && !Engine.isBannedRoom(it) }
    val rooms = all.filter { roomMatches(it, query) }
    if (rooms.isEmpty()) scope.item { Text(if (all.isNotEmpty()) "「${query.trim()}」に合う部屋は、ありません" else Engine.lobby?.optString("status").orEmpty().ifEmpty { "部屋を探しています…" }, color = Dim) }
    scope.items(rooms) { r ->
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Card).clickable { onPick(r.optString("id")) }.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.optString("sub").ifEmpty { r.optString("name") }.ifEmpty { "（名前なし）" }, Modifier.weight(1f), fontWeight = FontWeight.Bold, color = Color.White, maxLines = 1)
                Text(r.optString("count"), color = Teal, fontWeight = FontWeight.Bold)
            }
            if (r.optString("sub").isNotEmpty()) Text(r.optString("name"), color = Dim, fontSize = 13.sp, maxLines = 1)
            val ps = r.arr("people").joinToString("  ") { it.optString("em") + it.optString("name") }
            if (ps.isNotEmpty()) Text(ps, color = Color.White, fontSize = 13.sp, maxLines = 1)
        }
    }
}

@Composable
fun RoomScreen() {
    val room = Engine.room ?: return
    BackHandler(enabled = panel != Panel.None) { panel = Panel.None }
    LaunchedEffectChat()
    Column(Modifier.fillMaxSize()) {
        // 内容の部分（下のタブは、いつも見えるように、この外に置く）
        Box(Modifier.weight(1f).fillMaxWidth()) {
            RoomMain(room, Modifier.fillMaxSize())
            // 画面の右端のタブ：押す／左へスワイプで、ひとこと欄が出る
            EdgeTab(Modifier.align(Alignment.CenterEnd), room.optBoolean("bcast"))
            when (panel) {
                Panel.Chat -> ChatDrawer()
                Panel.Mail -> MailDrawer(room)
                Panel.Lobby -> LobbySheet(room)
                Panel.Settings -> SettingsSheet(room)
                Panel.None -> {}
            }
        }
        BottomTabs()
    }
    CardDialog(room)
    IgnoreDialog(room)
}

@Composable
private fun LaunchedEffectChat() {
    androidx.compose.runtime.LaunchedEffect(panel) {
        Engine.chatOpen = panel == Panel.Chat
        if (panel == Panel.Chat) Engine.unread = 0
    }
}

@Composable
private fun RoomMain(room: JSONObject, modifier: Modifier) {
    Column(modifier.padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(12.dp))
        Text(room.optString("state").ifEmpty { "通話中" }, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White)
        val tag = room.optJSONObject("tag")
        if (tag != null && tag.optBoolean("show")) {
            var edit by remember { mutableStateOf(false) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                LinkText("🏷 " + tag.optString("text").ifEmpty { "話題はまだありません" }, Dim, 13.sp, Modifier.weight(1f))
                androidx.compose.material3.TextButton({ edit = true }) { Text(tag.optString("btn").ifEmpty { "つける" }, color = Teal) }
            }
            if (edit) TagDialog("") { edit = false; it?.let { t -> Engine.cmd("type" to "tag", "text" to t) } }
        }
        // 配信部屋で、いま届いているおたより
        room.optJSONObject("mailNow")?.let { m ->
            Column(Modifier.fillMaxWidth().padding(top = 6.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFF12524C)).clickable { panel = Panel.Mail }.padding(10.dp)) {
                Text(m.optString("cap"), color = Dim, fontSize = 11.sp)
                LinkText(m.optString("who") + " " + m.optString("text"), Color.White, 14.sp)
            }
        }
        // ページが出すお知らせ・警告（マイクが使えなかった／音が届いていない など）
        for (msg in listOf(room.optString("notice"), room.optString("audioWarn"), room.optString("crowdNote"))) if (msg.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(msg, Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (msg.startsWith("🔌") || msg.contains("失敗") || msg.contains("できません") || msg.contains("に達しました")) Red else Orange).padding(10.dp), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
        val members = room.arr("members")
        Text("いま一緒にいる人：${members.size}人", color = Dim, fontSize = 13.sp)
        Spacer(Modifier.height(6.dp))
        LazyColumn(Modifier.weight(1f).padding(end = 26.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {      // 右端のタブが、♥ などに重ならないように、右を空ける
            itemsIndexed(members) { idx, m ->
                val speaking = m.optBoolean("speaking")
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (speaking) Teal.copy(alpha = 0.25f) else Card)
                    .clickable(enabled = m.optBoolean("tap")) { Engine.cmd("type" to "card", "i" to idx) }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(m.optString("em"), fontSize = 24.sp)
                    Spacer(Modifier.padding(6.dp))
                    Column(Modifier.weight(1f)) {
                        Text((m.optString("mark").let { if (it.isEmpty()) "" else "$it " }) + m.optString("name") + if (m.optBoolean("you")) "（あなた）" else "", color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1)
                        if (m.optString("stage").isNotEmpty()) Text(m.optString("stage"), color = Teal, fontSize = 12.sp)
                    }
                    if (m.optBoolean("muted")) Text("🔇", fontSize = 18.sp)
                    m.optJSONObject("grant")?.let { g -> Text(if (g.optBoolean("on")) "🎙 登壇中" else "🎙 登壇", Modifier.padding(start = 6.dp).clip(RoundedCornerShape(8.dp)).background(if (g.optBoolean("on")) Teal else Card).clickable { Engine.cmd("type" to "grant", "i" to idx) }.padding(horizontal = 8.dp, vertical = 4.dp), color = Color.White, fontSize = 12.sp) }
                    m.optJSONObject("ig")?.let { ig -> Text(if (ig.optBoolean("off")) "♡" else "♥", Modifier.padding(start = 8.dp).clickable { Engine.cmd("type" to "ignoreRow", "i" to idx) }, color = Red, fontSize = 20.sp) }
                }
            }
        }
        // リアクション
        val reactions = room.optJSONArray("reactions")
        if (reactions != null && reactions.length() > 0) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                for (i in 0 until reactions.length()) {
                    Box(Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(Card).clickable { Engine.cmd("type" to "react", "i" to i) }, contentAlignment = Alignment.Center) {
                        Text(reactions.optString(i), fontSize = 20.sp)
                    }
                }
            }
        }
        val muted = room.optBoolean("muted")
        val speak = room.optJSONObject("speak"); val raise = room.optJSONObject("raise")
        if ((speak != null && speak.optBoolean("show")) || (raise != null && raise.optBoolean("show"))) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (speak != null && speak.optBoolean("show")) Button({ Engine.cmd("type" to "speak") }, Modifier.weight(1f), enabled = !speak.optBoolean("disabled"), colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color.White)) { Text(speak.optString("label")) }
                if (raise != null && raise.optBoolean("show")) Button({ Engine.cmd("type" to "raise") }, Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text(raise.optString("label")) }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({ Engine.cmd("type" to "mute") }, Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = if (muted) Orange else Card, contentColor = Color.White)) { Text(if (muted) "🎤 ミュート中" else "🎤 ミュート") }
            Button({ Engine.toggleSpeaker() }, Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = if (Engine.spkMuted) Orange else Card, contentColor = Color.White)) { Text(if (Engine.spkMuted) "🔇 ミュート中" else "🔈 ミュート") }
        }
        val ctx = LocalContext.current
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({
                val url = room.optString("share")
                if (url.isNotEmpty()) {
                    (ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("potalk", url))
                    android.widget.Toast.makeText(ctx, "リンクをコピーしました", android.widget.Toast.LENGTH_SHORT).show()
                }
            }, Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text("🔗 リンクの取得") }
            Button({ Engine.cmd("type" to "reconnect") }, Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text("🔄 つなぎ直す") }
        }
        var leaveAsk by remember { mutableStateOf(false) }
        Button({ leaveAsk = true }, Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 8.dp), colors = ButtonDefaults.buttonColors(containerColor = Red, contentColor = Color.White)) { Text("退出") }
        if (leaveAsk) androidx.compose.material3.AlertDialog(
            onDismissRequest = { leaveAsk = false }, containerColor = Card,
            title = { Text("退出しますか？", color = Color.White) },
            text = { Text("この部屋から出て、ロビーに戻ります。", color = Color.White) },
            confirmButton = { androidx.compose.material3.TextButton({ leaveAsk = false; Engine.cmd("type" to "leave") }) { Text("退出する", color = Red) } },
            dismissButton = { androidx.compose.material3.TextButton({ leaveAsk = false }) { Text("やめる", color = Dim) } }
        )
    }
}

/** 画面の下のタブ：部屋 ／ 部屋一覧 ／ 設定 */
@Composable
private fun BottomTabs() {
    Row(Modifier.fillMaxWidth().background(Card).navigationBarsPadding().height(56.dp)) {
        @Composable fun tab(label: String, p: Panel, mod: Modifier) {
            val on = panel == p
            Column(mod.fillMaxSize().clickable { panel = p }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(label, color = if (on) Teal else Dim, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, fontSize = 13.sp)
                if (on) Box(Modifier.padding(top = 3.dp).width(28.dp).height(3.dp).clip(RoundedCornerShape(2.dp)).background(Teal))
            }
        }
        tab("👥 部屋", Panel.None, Modifier.weight(1f))
        tab("🏠 部屋一覧", Panel.Lobby, Modifier.weight(1f))
        tab("⚙ 設定", Panel.Settings, Modifier.weight(1f))
    }
}

/** 画面の右端のタブ（💬 ひとこと、配信部屋では 📮 おたよりも）。新着があると、赤い数が付く */
@Composable
private fun EdgeTab(modifier: Modifier, bcast: Boolean) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        @Composable fun tab(emoji: String, p: Panel, badge: Int) {
            Box(
                Modifier.width(34.dp).height(84.dp)
                    .clip(RoundedCornerShape(topStart = 14.dp, bottomStart = 14.dp))
                    .background(Teal)
                    .clickable { panel = p }
                    .pointerInput(Unit) { detectHorizontalDragGestures { _, dx -> if (dx < -6) panel = p } },
                contentAlignment = Alignment.Center
            ) {
                Text(emoji, fontSize = 20.sp)
                if (badge > 0) Box(Modifier.align(Alignment.TopStart).padding(3.dp).size(18.dp).clip(CircleShape).background(Red), contentAlignment = Alignment.Center) {
                    Text(if (badge > 9) "9+" else "$badge", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        tab("💬", Panel.Chat, Engine.unread)
        if (bcast) tab("📮", Panel.Mail, 0)
    }
}
