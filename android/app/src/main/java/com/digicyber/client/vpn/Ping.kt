package com.digicyber.client.vpn

import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import com.digicyber.client.core.Core
import com.digicyber.client.data.AppLog
import com.digicyber.client.data.Config
import com.digicyber.client.data.Profile
import com.digicyber.client.data.Settings
import com.digicyber.client.data.Repo

// Windows and desktop Linux/macOS measure a config with an HTTP request to Google's generate_204
// page through a temporary Xray proxy. Android uses an isolated native Xray instance so that test
// does not replace the Xray instance that may currently be carrying the VPN.
object Ping {
    const val connectivityTestUrl = "http://google.com/generate_204"
    private const val timeoutMs = 8_000
    private val xrayLock = Mutex()
    private val hostPattern = Regex("^[A-Za-z0-9.:_\\[\\]][A-Za-z0-9.:_\\-\\[\\]%]*$")

    fun tcp(host: String, port: Int, timeoutMs: Int = 3000): Int? = runCatching {
        Socket().use { socket ->
            val started = System.nanoTime()
            socket.connect(InetSocketAddress(host, port), timeoutMs)
            ((System.nanoTime() - started) / 1_000_000).toInt().coerceAtLeast(1)
        }
    }.getOrNull()

    fun icmp(host: String): Int? {
        if (!hostPattern.matches(host)) return null
        return runCatching {
            val process = ProcessBuilder("ping", "-c", "1", "-W", "2", host).redirectErrorStream(true).start()
            val out = process.inputStream.bufferedReader().use { it.readText() }
            process.waitFor()
            Regex("[=<]\\s*(\\d+(?:[.,]\\d+)?)\\s*ms").find(out)?.groupValues?.get(1)?.replace(',', '.')?.toDouble()?.toInt()?.coerceAtLeast(1)
        }.getOrNull()
    }

    private fun freePort(): Int = ServerSocket(0).use { it.localPort }

    private fun resolve(names: List<String>): Map<String, List<String>> {
        val out = ConcurrentHashMap<String, List<String>>()
        val workers = names.map { name ->
            thread(isDaemon = true, name = "url-test-dns") {
                val addresses = runCatching { InetAddress.getAllByName(name).toList() }.getOrNull() ?: return@thread
                val v4 = addresses.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
                val v6 = addresses.filterIsInstance<Inet6Address>().mapNotNull { it.hostAddress?.substringBefore('%') }
                (v4.ifEmpty { v6 }).distinct().takeIf { it.isNotEmpty() }?.let { out[name] = it }
            }
        }
        val deadline = System.currentTimeMillis() + 6_000
        for (worker in workers) worker.join((deadline - System.currentTimeMillis()).coerceAtLeast(1))
        return HashMap(out)
    }

    private fun measure204(config: Config, settings: Settings, testUrl: String): Int? {
        val outbound = XrayConfig.proxyOutboundFor(config.protocol, config.link, config.outbound)
        if (outbound == null) {
            AppLog.w("ping", "${config.protocol}: no Xray outbound for URL test")
            return null
        }
        val url = runCatching { URL(testUrl) }.getOrNull()
        if (url == null || url.protocol != "http" || url.host.isBlank()) {
            AppLog.w("ping", "invalid HTTP test URL")
            return null
        }

        var conn: HttpURLConnection? = null
        try {
            val context = Repo.context()
            Core.setAssetDir(XrayAssets.ensure(context))
            val port = freePort()
            val hosts = resolve(XrayConfig.serverNames(outbound))
            val configJson = XrayConfig.build(
                outbound = outbound,
                socksPort = port,
                iranDirect = false,
                adBlock = false,
                dns = XrayConfig.dnsServers(settings.dns),
                hosts = hosts,
                logLevel = "warning",
            )
            Core.startPing(configJson)

            val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", port))
            conn = (url.openConnection(proxy) as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                instanceFollowRedirects = false
                useCaches = false
                setRequestProperty("Cache-Control", "no-cache")
                setRequestProperty("Connection", "close")
            }
            val started = System.nanoTime()
            val code = conn.responseCode
            val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started).toInt().coerceAtLeast(1)
            if (code != HttpURLConnection.HTTP_NO_CONTENT) {
                AppLog.w("ping", "${config.protocol}: HTTP URL test answered $code instead of 204")
                return null
            }
            AppLog.i("ping", "${config.protocol}: HTTP 204 URL test answered in ${elapsed} ms")
            return elapsed
        } catch (error: Exception) {
            AppLog.w("ping", "${config.protocol}: HTTP 204 URL test failed: ${error.message ?: error.javaClass.simpleName}")
            return null
        } finally {
            conn?.disconnect()
            runCatching { Core.stopPing() }
        }
    }

    // Available to instrumentation tests with a local 204 endpoint; production calls use the same
    // fixed Google endpoint as the desktop builds.
    suspend fun urlTest(config: Config, settings: Settings, testUrl: String = connectivityTestUrl): Int? =
        xrayLock.withLock { withContext(Dispatchers.IO) { measure204(config, settings, testUrl) } }

    private suspend fun allXray(profile: Profile, settings: Settings): Map<String, Int?> {
        val out = linkedMapOf<String, Int?>()
        for (config in profile.configs.filter { it.protocol != "openvpn" && Candidates.runnable(it) }.distinctBy { it.link }) {
            out[config.link] = urlTest(config, settings)
        }
        return out
    }

    // OpenVPN is tested at its remote endpoint on Android, where the VPN app itself is excluded from
    // the tunnel to keep Xray/OpenVPN sockets from looping back into it. Xray and WireGuard locations
    // get the same HTTP 204 URL check as desktop through an isolated Xray instance.
    suspend fun all(profile: Profile, settings: Settings): Map<String, Int?> = withContext(Dispatchers.IO) {
        val urlResults = allXray(profile, settings)
        val openVpnResults = profile.configs.filter { it.protocol == "openvpn" && Candidates.runnable(it) }.map { config ->
            val target = Candidates.serverAddress(config) ?: return@map config.link to null
            val (host, port) = target
            val ms = if (Candidates.answersOnUdp(config)) icmp(host) else (tcp(host, port) ?: icmp(host))
            config.link to ms
        }
        urlResults + openVpnResults
    }
}
