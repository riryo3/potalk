package app.potalker.android

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/** ひとこと欄：右から出る引き出し。外を押すと閉じる */
@Composable
fun ChatDrawer() {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable { panel = Panel.None }) {
        AnimatedVisibility(shown, Modifier.align(Alignment.CenterEnd), enter = slideInHorizontally { it }, exit = slideOutHorizontally { it }) {
            Column(Modifier.fillMaxHeight().fillMaxWidth(0.88f).background(Bg).clickable(enabled = false) {}.padding(12.dp).imePadding()) {
                Text("💬 ひとこと", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Spacer(Modifier.height(8.dp))
                val state = rememberLazyListState()
                LaunchedEffect(Engine.chat.size) { if (Engine.chat.isNotEmpty()) state.scrollToItem(Engine.chat.size - 1) }
                LazyColumn(Modifier.weight(1f), state = state, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(Engine.chat.toList()) { c ->
                        if (c.optBoolean("sys")) Text(c.optString("text").ifEmpty { c.optString("who") }, color = Dim, fontSize = 12.sp, modifier = Modifier.fillMaxWidth())
                        else Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Card).padding(8.dp), verticalAlignment = Alignment.Top) {
                            Text(c.optString("em"), fontSize = 18.sp)
                            Column(Modifier.padding(start = 8.dp)) {
                                Text(c.optString("who"), color = if (c.optBoolean("hist")) Dim else Teal, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                Text(c.optString("text"), color = if (c.optBoolean("hist")) Dim else Color.White, fontSize = 15.sp)
                            }
                        }
                    }
                }
                var text by remember { mutableStateOf("") }
                fun send() { val t = text.trim(); if (t.isNotEmpty()) { Engine.cmd("type" to "chat", "text" to t); text = "" } }
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(text, { text = it.take(60) }, Modifier.weight(1f), placeholder = { Text("ひとこと…") }, singleLine = true)
                    Button(::send, colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color.White)) { Text("送信") }
                }
            }
        }
    }
}

/** 部屋一覧：部屋の中から、別の部屋へ移る（いまの部屋を出る確認が出る） */
@Composable
fun LobbySheet(room: JSONObject) {
    var pick by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().background(Bg).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(12.dp))
        Text("🏠 通話中の部屋", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Text("いまの部屋：" + room.optString("state"), fontSize = 12.sp, color = Dim)
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            roomsList(this, exceptId = room.optString("rid")) { id -> pick = id }
        }
        Button({ Engine.cmd("type" to "refreshLobby") }, Modifier.fillMaxWidth().padding(vertical = 8.dp), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Color.White)) { Text("🔄 一覧を更新") }
    }
    pick?.let { id ->
        AlertDialog(
            onDismissRequest = { pick = null },
            title = { Text("部屋を移りますか？") },
            text = { Text("いまの部屋を出て、選んだ部屋に入ります。") },
            confirmButton = { TextButton({ pick = null; panel = Panel.None; Engine.joinOther(id) }) { Text("移る") } },
            dismissButton = { TextButton({ pick = null }) { Text("やめる") } }
        )
    }
}

/** 設定：ページの設定（音量・BGM・通知音のスイッチなど）を、そのまま並べる */
@Composable
fun SettingsSheet(room: JSONObject) {
    Column(Modifier.fillMaxSize().background(Bg).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(12.dp))
        Text("⚙ 設定", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(room.arr("settings")) { s ->
                when (s.optString("k")) {
                    "range" -> {
                        val id = s.optString("id")
                        val v = s.optString("value").toFloatOrNull() ?: 0f
                        var cur by remember(id, v) { mutableStateOf(v) }
                        Column {
                            Text(s.optString("label"), color = Color.White, fontSize = 14.sp)
                            Slider(cur, { cur = it }, valueRange = (s.optString("min").toFloatOrNull() ?: 0f)..(s.optString("max").toFloatOrNull() ?: 100f),
                                onValueChangeFinished = { Engine.cmd("type" to "set", "id" to id, "value" to cur.toString()) })
                        }
                    }
                    "check" -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(s.optString("label"), Modifier.weight(1f), color = Color.White, fontSize = 14.sp)
                        Switch(s.optBoolean("checked"), { Engine.cmd("type" to "set", "id" to s.optString("id"), "value" to it) })
                    }
                    "radios" -> Column {
                        for (r in s.arr("items")) Row(Modifier.fillMaxWidth().clickable { Engine.cmd("type" to "set", "id" to r.optString("id"), "value" to true) }, verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(r.optBoolean("checked"), { Engine.cmd("type" to "set", "id" to r.optString("id"), "value" to true) })
                            Text(r.optString("label"), color = Color.White, fontSize = 14.sp)
                        }
                    }
                    "note" -> Text(s.optString("text"), color = Dim, fontSize = 12.sp)
                }
            }
        }
    }
}
