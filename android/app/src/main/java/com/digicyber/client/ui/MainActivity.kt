package com.digicyber.client.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import com.digicyber.client.data.Repo
import com.digicyber.client.data.SignIn
import com.digicyber.client.data.Status
import com.digicyber.client.vpn.DcVpnService
import com.digicyber.client.vpn.VpnState

class MainActivity : ComponentActivity() {
    private var pendingLocation: Int? = null

    // Android asks the user once before any app may run a VPN.
    private val vpnPermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) DcVpnService.connect(this, pendingLocation)
        else VpnState.status.value = Status(error = "vpn_denied")
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySystemBars(Repo.settings.value.theme != "light")
        if (savedInstanceState == null) takeSignInLink(intent)
        setContent { DcRoot(this) }
        // Notices arrive as notifications too; Android 13 asks for that once the user is signed in.
        lifecycleScope.launch {
            Repo.signedIn.first { it }
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        // While the app is open the profile is fetched every 10 minutes, so panel changes show up.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                var first = true
                while (true) {
                    if (Repo.signedIn.value) {
                        Repo.refresh()
                        if (first) Repo.ping()
                        first = false
                    }
                    delay(Repo.REFRESH_MS)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeSignInLink(intent)
    }

    // A tapped digicyber://login?sub=…&user=… link (from the bot, the panel or a browser).
    private fun takeSignInLink(intent: Intent?) {
        val data = intent?.dataString ?: return
        SignIn.parse(data)?.let { Repo.pendingSignIn.value = it }
    }

    // Light status-bar icons on the dark theme, dark ones on the light theme; the pages draw behind the bars.
    fun applySystemBars(dark: Boolean) {
        val style = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }

    fun connect(locationId: Int?) {
        Repo.updateSettings { it.copy(locationId = locationId) }
        pendingLocation = locationId
        val ask = VpnService.prepare(this)
        if (ask != null) vpnPermission.launch(ask) else DcVpnService.connect(this, locationId)
    }

    fun disconnect() {
        DcVpnService.disconnect(this)
    }
}
