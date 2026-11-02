package app.potalker.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager

/** 通話中、画面を閉じても、アプリが止められないようにするための、常駐の通知（エンジンは、プロセスの中で動き続ける）。 */
class CallService : Service() {
    private var cpuLock: PowerManager.WakeLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, build(this, Engine.callNote), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        // 画面が消えて長く経っても、CPU が眠って通話が切れないように、通話中だけ起こしておく
        if (cpuLock == null) cpuLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "potalker:call").apply { setReferenceCounted(false); acquire() }
        Engine.start(this)
        return START_NOT_STICKY
    }
    override fun onDestroy() {
        cpuLock?.let { if (it.isHeld) it.release() }; cpuLock = null
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        fun build(ctx: Context, text: String): Notification {
            ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("call", "通話中", NotificationManager.IMPORTANCE_LOW))
            val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            return Notification.Builder(ctx, "call").setContentTitle("Potalker").setContentText(text)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentIntent(open).setOngoing(true).build()
        }
        /** 通知の文を差し替える（自動でつなぎ直したときに、気づけるように） */
        fun update(ctx: Context, text: String) { try { ctx.getSystemService(NotificationManager::class.java).notify(1, build(ctx, text)) } catch (e: Exception) {} }
    }
}
