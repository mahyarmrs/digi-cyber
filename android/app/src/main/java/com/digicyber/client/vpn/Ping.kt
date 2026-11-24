package com.digicyber.client.vpn

import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import com.digicyber.client.data.Profile

// One probe per server: the TCP connect time, or an ICMP echo for servers that answer on UDP only.
object Ping {
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

    suspend fun all(profile: Profile): Map<String, Int?> = coroutineScope {
        val probes = ConcurrentHashMap<String, Deferred<Int?>>()
        fun once(key: String, probe: () -> Int?): Deferred<Int?> = probes.getOrPut(key) { async(Dispatchers.IO) { probe() } }
        profile.configs.filter { Candidates.runnable(it) }.map { config ->
            async(Dispatchers.IO) {
                val target = Candidates.serverAddress(config) ?: return@async config.link to null
                val (host, port) = target
                val ms = if (Candidates.answersOnUdp(config)) {
                    once("icmp $host") { icmp(host) }.await()
                } else {
                    once("tcp $host:$port") { tcp(host, port) }.await() ?: once("icmp $host") { icmp(host) }.await()
                }
                config.link to ms
            }
        }.awaitAll().toMap()
    }
}
