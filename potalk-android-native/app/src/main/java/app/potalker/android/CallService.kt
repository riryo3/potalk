package app.potalker.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.IBinder
import android.os.PowerManager

/** 通話中、画面を閉じても、アプリが止められないようにするための、常駐の通知（エンジンは、プロセスの中で動き続ける）。 */
class CallService : Service() {
    private var cpuLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("call", "通話中", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, "call")
            .setContentTitle("Potalker")
            .setContentText("通話中です。タップすると開きます")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        // 画面が消えて長く経っても、CPU と Wi-Fi が眠って通話が切れないように、通話中だけ起こしておく
        if (cpuLock == null) cpuLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "potalker:call").apply { setReferenceCounted(false); acquire() }
        if (wifiLock == null) @Suppress("DEPRECATION") { wifiLock = (applicationContext.getSystemService(WIFI_SERVICE) as WifiManager).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "potalker:call").apply { setReferenceCounted(false); acquire() } }
        Engine.start(this)
        return START_NOT_STICKY
    }
    override fun onDestroy() {
        cpuLock?.let { if (it.isHeld) it.release() }; cpuLock = null
        wifiLock?.let { if (it.isHeld) it.release() }; wifiLock = null
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
