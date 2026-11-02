package app.potalker.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import kotlinx.coroutines.delay
import java.util.Calendar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Engine.start(this)
        val need = mutableListOf<String>()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need += Manifest.permission.RECORD_AUDIO
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) need += Manifest.permission.POST_NOTIFICATIONS
        if (need.isNotEmpty()) requestPermissions(need.toTypedArray(), 1)
        handleLink(intent)
        setContent { Themed { App() } }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleLink(intent) }
    private fun handleLink(i: Intent?) { val u = i?.data; if (u != null && u.host == "potalk.app") Engine.openLink(u.toString()) }
}

@Composable
fun App() {
    Box(Modifier.fillMaxSize().background(Bg).statusBarsPadding()) {
        if (Engine.isJoined) RoomScreen() else LobbyScreen()
        PagesOverlay()
        LinkAskDialog()
    }
}

/** 見た目（昼夜）を当てる。端末の昼夜・時刻が変わったら、追いかける */
@Composable
private fun Themed(content: @Composable () -> Unit) {
    Look.systemDark = isSystemInDarkTheme()
    LaunchedEffect(Unit) {
        while (true) {
            val c = Calendar.getInstance()
            Look.minute = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
            delay(30_000)
        }
    }
    val dark = Look.dark
    val view = LocalView.current
    SideEffect {   // 上の帯・下の帯の文字を、地の明るさに合わせる
        val w = (view.context as android.app.Activity).window
        val c = WindowCompat.getInsetsController(w, view)
        c.isAppearanceLightStatusBars = !dark
        c.isAppearanceLightNavigationBars = !dark
    }
    val scheme = if (dark) darkColorScheme(primary = Teal, background = Bg, surface = Card, onSurface = Ink, onBackground = Ink)
    else lightColorScheme(primary = Teal, background = Bg, surface = Card, onSurface = Ink, onBackground = Ink)
    MaterialTheme(colorScheme = scheme, content = content)
}
