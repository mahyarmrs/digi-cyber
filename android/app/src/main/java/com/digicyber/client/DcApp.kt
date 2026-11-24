package com.digicyber.client

import android.app.Application
import android.os.Build
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.digicyber.client.data.AppLog
import com.digicyber.client.data.ConnState
import com.digicyber.client.data.Repo
import com.digicyber.client.vpn.VpnState

class DcApp : Application() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        // The log since the app started, for a support report; the last run's stays readable after a crash.
        AppLog.open(File(filesDir, "logs"))
        AppLog.i("app", "Digi Cyber ${BuildConfig.VERSION_NAME} on Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}")
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            AppLog.e("app", "crash in ${t.name}", e)
            previous?.uncaughtException(t, e)
        }
        Repo.init(this)
        // Time connected and recent locations follow the connection, whichever screen is open.
        scope.launch {
            var last = ""
            VpnState.status.collect {
                Repo.track(it)
                val line = "status ${it.state} ${it.protocol} ${if (it.configName.isNotEmpty()) "\"${it.configName}\"" else ""} ${if (it.error.isNotEmpty()) "(${it.error})" else ""}".replace(Regex("\\s+"), " ").trim()
                if (line != last) AppLog.i("app", line)
                last = line
            }
        }
        scope.launch {
            while (true) {
                delay(60_000)
                if (VpnState.status.value.state == ConnState.Connected) Repo.heartbeat()
            }
        }
    }
}
