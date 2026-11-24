package com.digicyber.client

import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import com.digicyber.client.data.ConnState
import com.digicyber.client.data.Profile
import com.digicyber.client.data.Repo
import com.digicyber.client.data.Status
import com.digicyber.client.ui.MainActivity
import com.digicyber.client.vpn.DcVpnService
import com.digicyber.client.vpn.OpenVpn
import com.digicyber.client.vpn.OpenVpnProfile
import com.digicyber.client.vpn.VpnState

// OpenVPN on a real Android: the program the build packs must run, and the app must connect through
// CI's OpenVPN servers (android/openvpn/test-server.sh) with the profiles Manifold writes.
@RunWith(AndroidJUnit4::class)
class OpenVpnTest {
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
    fun theOpenVpnProgramRunsWithItsCompressionLibraries() {
        val exe = OpenVpn.binary(context)
        assertTrue("$exe is missing", exe.exists())
        val proc = ProcessBuilder(exe.absolutePath, "--version").redirectErrorStream(true).start()
        val out = proc.inputStream.bufferedReader().use { it.readText() }
        proc.waitFor()
        assertTrue(out, out.contains("OpenVPN 2.7") && out.contains("[LZO]") && out.contains("[LZ4]") && out.contains("OpenSSL 3"))
    }

    @Test
    fun theProfileIsReadCheckedAndPrepared() {
        val profile = "# test\nclient\ndev tun\nproto udp\nremote 10.0.2.2 1195\n<auth-user-pass>\nz7b21tfbhc\npa ss\"w\\rd\n</auth-user-pass>\n<ca>\nCA\n</ca>\n"
        val link = "openvpn://" + Base64.encodeToString(profile.toByteArray(), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val decoded = OpenVpnProfile.decode(link)!!
        assertNull(OpenVpnProfile.unsafeDirective(decoded))
        assertEquals("up", OpenVpnProfile.unsafeDirective(decoded + "up /system/bin/sh\n"))
        assertEquals("ca", OpenVpnProfile.unsafeDirective(decoded + "ca /sdcard/ca.pem\n"))
        assertEquals("management", OpenVpnProfile.unsafeDirective(decoded + "management 0.0.0.0 7505\n"))
        assertNull(OpenVpnProfile.decode("openvpn://" + Base64.encodeToString("hello".toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP)))

        val prepared = OpenVpnProfile.prepare(decoded, "/data/x/mgmt")
        assertEquals("z7b21tfbhc", prepared.username)
        assertEquals("pa ss\"w\\rd", prepared.password)
        assertFalse(prepared.config.contains("pa ss"))
        assertTrue(prepared.config.contains("\nauth-user-pass\n<ca>"))
        assertTrue(prepared.config.endsWith("management /data/x/mgmt unix\nmanagement-hold\nmanagement-query-passwords\n"))
        // UDP tells the server when the app disconnects; TCP's closing connection already does.
        assertTrue(prepared.config.contains("\nexplicit-exit-notify 1\nmanagement "))
        assertFalse(OpenVpnProfile.prepare(decoded.replace("proto udp", "proto tcp-client"), "/data/x/mgmt").config.contains("explicit-exit-notify"))

        assertEquals("10.0.2.2" to 1195, OpenVpnProfile.remote(decoded))
        assertTrue(OpenVpnProfile.udp(decoded))
        assertFalse(OpenVpnProfile.udp(decoded.replace("proto udp", "proto tcp-client")))
        assertEquals(24, OpenVpn.prefixOf("255.255.255.0"))
        assertEquals(1, OpenVpn.prefixOf("128.0.0.0"))
        assertEquals(OpenVpn.Route("10.8.0.0", 24), OpenVpn.network("10.8.0.2", 24))
        assertEquals(OpenVpn.Route("128.0.0.0", 1), OpenVpn.network("128.0.0.0", 1))
    }

    // OpenVPN on its own with the app's prepared profile: it must come up and open its management socket.
    @Test
    fun openVpnStartsWithTheAppsProfileAndOpensItsManagementSocket() {
        val link = InstrumentationRegistry.getArguments().getString("ovpnTcp")
        assumeTrue("no test server", !link.isNullOrEmpty())
        val dir = java.io.File(context.noBackupFilesDir, "openvpn-test").apply { mkdirs() }
        val socket = java.io.File(dir, "mgmt").apply { delete() }
        val conf = java.io.File(dir, "profile.ovpn")
        conf.writeText(OpenVpnProfile.prepare(OpenVpnProfile.decode(link!!)!!, socket.absolutePath).config)
        val proc = ProcessBuilder(OpenVpn.binary(context).absolutePath, "--config", conf.absolutePath, "--tmp-dir", context.cacheDir.absolutePath).directory(dir).redirectErrorStream(true).start()
        val output = StringBuilder()
        val reader = Thread { runCatching { proc.inputStream.bufferedReader().forEachLine { synchronized(output) { output.append(it).append(" | ") } } } }.apply { start() }
        val opened = waitFor(10_000) { socket.exists() }
        proc.destroy()
        reader.join(3000)
        assertTrue("no management socket: ${synchronized(output) { output.toString() }}", opened)
    }

    @Test
    fun connectsThroughOpenVpnOverTcp() = connectThrough("ovpnTcp", "10.8.0.1")

    @Test
    fun connectsThroughOpenVpnOverUdp() = connectThrough("ovpnUdp", "10.9.0.1")

    private fun connectThrough(argument: String, gateway: String) {
        val link = InstrumentationRegistry.getArguments().getString(argument)
        assumeTrue("no test server for $argument", !link.isNullOrEmpty())
        val decoded = OpenVpnProfile.decode(link!!)
        assertTrue("the link (${link.length} characters) is not an OpenVPN profile", decoded != null)
        assertNull("unsafe directive", OpenVpnProfile.unsafeDirective(decoded!!))
        // What the user's "Allow" in Android's VPN dialog grants.
        shell("appops set ${context.packageName} ACTIVATE_VPN allow")
        assertNull("VPN consent", VpnService.prepare(context))

        val profile = JSONObject()
            .put("account", JSONObject().put("username", "z7b21tfbhc").put("enabled", true))
            .put("locations", JSONArray().put(JSONObject().put("id", 1).put("name", "Test").put("countryCode", "DE")))
            .put("configs", JSONArray().put(JSONObject().put("protocol", "openvpn").put("name", "test $argument").put("link", link).put("locationId", 1)))
        Repo.profile.value = Profile.parse(profile.toString())
        Repo.settings.value = Repo.settings.value.copy(protocol = "openvpn", dns = "", splitApps = emptySet())

        VpnState.status.value = Status()
        ActivityScenario.launch(MainActivity::class.java).use {
            DcVpnService.connect(context, 1)
            // Every state the connection passes through, for the failure message.
            val trail = mutableListOf<String>()
            try {
                waitFor(60_000) {
                    val s = VpnState.status.value
                    val step = "${s.state} ${s.protocol} ${s.configName} ${s.error}".trim()
                    if (trail.lastOrNull() != step) trail += step
                    s.state == ConnState.Connected || (s.state == ConnState.Disconnected && s.error.isNotEmpty())
                }
                val status = VpnState.status.value
                assertEquals("states: $trail", ConnState.Connected, status.state)
                assertEquals("openvpn", status.protocol)

                // The shell is not left out of the VPN as the app is: its ping goes through the tunnel to the server.
                val ping = shell("ping -c 3 -W 3 $gateway")
                assertTrue(ping, ping.contains("bytes from $gateway"))
                assertEquals("the connection held: $trail", ConnState.Connected, VpnState.status.value.state)

                DcVpnService.disconnect(context)
                assertTrue("disconnect", waitFor(15_000) { VpnState.status.value.state == ConnState.Disconnected })
                // Android takes the interface down once OpenVPN has exited and closed it.
                assertTrue("the tunnel is gone", waitFor(10_000) { !shell("ping -c 1 -W 1 $gateway").contains("bytes from $gateway") })
            } catch (e: AssertionError) {
                // One line, as the test report shows only the first: the app's own log, OpenVPN's output included.
                val log = shell("logcat -d -v brief --pid=${android.os.Process.myPid()}").lines()
                    .filter { "openvpn" in it || "DcVpn" in it }.takeLast(80).joinToString(" | ")
                throw AssertionError("${e.message} | $log", e)
            }
        }
    }
}
