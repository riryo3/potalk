package app.potalker.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/** 押されたリンク（確認の窓に出す） */
var linkAsk by mutableStateOf<String?>(null)

private val URL_RE = Regex("""https?://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+""")
private const val TRAIL = ".,;:!?'\")）」』、。"

/** 文の中の URL（http・https）を、リンクにする。リンクの外の文字は、そのまま */
fun linkify(text: String): AnnotatedString = buildAnnotatedString {
    var last = 0
    for (m in URL_RE.findAll(text)) {
        val url = m.value.trimEnd { it in TRAIL }
        if (url.length <= "https://".length) continue
        val start = m.range.first
        append(text.substring(last, start))
        withLink(LinkAnnotation.Clickable(tag = url, styles = TextLinkStyles(SpanStyle(color = Teal, textDecoration = TextDecoration.Underline)), linkInteractionListener = { linkAsk = url })) { append(url) }
        last = start + url.length
    }
    append(text.substring(last))
}

/** URL を、押せるリンクにして出す文字 */
@Composable
fun LinkText(text: String, color: Color, fontSize: TextUnit = 14.sp, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    val a = remember(text) { linkify(text) }
    Text(a, modifier, color = color, fontSize = fontSize, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

/** リンクを開く前の確認（開く先を、見せる） */
@Composable
fun LinkAskDialog() {
    val url = linkAsk ?: return
    val ctx = LocalContext.current
    AlertDialog(
        onDismissRequest = { linkAsk = null }, containerColor = Card,
        title = { Text("リンクを開きますか？", color = Ink) },
        text = { Column { Text(url, color = Teal, fontSize = 14.sp); Text("ブラウザで開きます。", color = Dim, fontSize = 12.sp) } },
        confirmButton = { TextButton({ linkAsk = null; ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }) { Text("開く", color = Teal) } },
        dismissButton = { TextButton({ linkAsk = null }) { Text("やめる", color = Dim) } }
    )
}
