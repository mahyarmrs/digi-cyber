package com.digicyber.client

import android.os.ParcelFileDescriptor
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import android.net.VpnService
import com.digicyber.client.data.ConnState
import com.digicyber.client.data.Repo
import com.digicyber.client.data.Status
import com.digicyber.client.ui.MainActivity
import com.digicyber.client.vpn.DcVpnService
import com.digicyber.client.vpn.VpnState

// Every protocol the app runs through Xray, end to end on a real Android: sign in to the test panel
// (android/test/mock-panel.mjs), then connect to each location, whose one config points at CI's server
// for that protocol (android/test/protocol-servers.sh), in the shapes Manifold hands them over: VLESS
// with its server in settings, WireGuard whose outbound lost its key's '+', VLESS without TLS to a
// public name. Connected means a page came back through it. Then a support report reaches the panel.
@RunWith(AndroidJUnit4::class)
class ProtocolsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private fun shell(command: String): String {
        val pfd = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().use { it.readText() }
    }

    private fun waitFor(ms: Long, done: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            if (done()) return true
            Thread.sleep(200)
        }
        return done()
    }

    @Test
    fun connectsThroughEveryXrayProtocolAndWireGuard() {
        val panel = InstrumentationRegistry.getArguments().getString("panel")
        assumeTrue("no test panel", !panel.isNullOrEmpty())
        shell("appops set ${context.packageName} ACTIVATE_VPN allow")
        assertNull("VPN consent", VpnService.prepare(context))
        runBlocking { Repo.login(panel!!, "demo-user") }
        val profile = Repo.profile.value!!
        Repo.updateSettings { it.copy(protocol = "auto", dns = "", splitApps = emptySet(), iranDirect = true, adBlock = false) }

        val failures = mutableListOf<String>()
        ActivityScenario.launch(MainActivity::class.java).use {
            for ((locationId, protocol) in listOf(1 to "vless", 2 to "vmess", 3 to "trojan", 4 to "shadowsocks", 5 to "wireguard", 8 to "vless")) {
                val config = profile.configs.first { it.locationId == locationId }
                assertEquals(protocol, config.protocol)
                VpnState.status.value = Status()
                DcVpnService.connect(context, config.locationId)
                val trail = mutableListOf<String>()
                waitFor(60_000) {
                    val s = VpnState.status.value
                    val step = "${s.state} ${s.protocol} ${s.error}".trim()
                    if (trail.lastOrNull() != step) trail += step
                    s.state == ConnState.Connected || (s.state == ConnState.Disconnected && s.error.isNotEmpty())
                }
                val status = VpnState.status.value
                if (status.state != ConnState.Connected || status.protocol != protocol) failures += "$protocol (location $locationId): $trail"
                DcVpnService.disconnect(context)
                assertTrue("$protocol: disconnect", waitFor(15_000) { VpnState.status.value.state == ConnState.Disconnected })
                Thread.sleep(1000)
            }
        }
        if (failures.isNotEmpty()) {
            val log = com.digicyber.client.data.AppLog.text().lines().takeLast(120).joinToString(" | ")
            throw AssertionError("${failures.joinToString(" ; ")} | $log")
        }
        assertEquals(emptyList<String>(), failures)

        // The log of all that goes to the panel as a report, and the panel files it.
        val (id, error) = runBlocking { Repo.sendReport("CI report") }
        assertNull("report error", error)
        assertTrue("report number", !id.isNullOrEmpty())
        val text = Repo.logText()
        assertTrue("the log has the connection steps", "trying wireguard" in text && "the test page answered" in text)
        assertTrue("no session token in the log", "test-session-token" !in text)
    }
}
