package com.digicyber.client

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import com.digicyber.client.core.Core
import com.digicyber.client.vpn.TProxyService
import com.digicyber.client.vpn.XrayConfig

// On a real device: the native libraries the build packs must load and work, which compiling cannot show.
@RunWith(AndroidJUnit4::class)
class EnginesTest {
    @Test
    fun tunnelLibraryLoadsAndRegistersItsNatives() {
        // JNI_OnLoad registers the natives on com/digicyber/client/vpn/TProxyService; a wrong PKGNAME throws here.
        assertFalse(TProxyService.TProxyIsRunning())
    }

    @Test
    fun xrayRunsTheConfigTheAppWritesAndServesItsSocksPort() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.filesDir, "xray-test").apply { mkdirs() }
        for (name in listOf("geoip.dat", "geosite.dat")) {
            context.assets.open(name).use { input -> File(dir, name).outputStream().use { input.copyTo(it) } }
        }
        Core.setAssetDir(dir.absolutePath)

        val target = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
        thread {
            runCatching { target.accept().use { it.getOutputStream().write("through xray".toByteArray()) } }
        }
        val socksPort = ServerSocket(0).use { it.localPort }
        // Ad blocking and Iranian sites direct need geosite and geoip categories: the geo files must load.
        val config = XrayConfig.build(JSONObject().put("protocol", "freedom"), socksPort, iranDirect = true, adBlock = true, dns = listOf("1.1.1.1"))
        Core.start(config)
        try {
            // A plain socket through the SOCKS port: what hev-socks5-tunnel does with every connection.
            Socket(Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", socksPort))).use { socket ->
                socket.soTimeout = 5000
                socket.connect(InetSocketAddress("127.0.0.1", target.localPort), 5000)
                assertEquals("through xray", socket.getInputStream().bufferedReader().readText())
            }
        } finally {
            Core.stop()
            target.close()
        }
    }
}
