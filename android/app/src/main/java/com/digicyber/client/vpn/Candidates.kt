package com.digicyber.client.vpn

import android.util.Base64
import java.net.URI
import org.json.JSONObject
import com.digicyber.client.data.Config
import com.digicyber.client.data.Profile

// Android runs the Xray protocols (WireGuard included) and OpenVPN. L2TP needs Android's own VPN client,
// which apps cannot drive and which Android 12 removed.
object Candidates {
    private val xrayProtocols = setOf("vless", "vmess", "trojan", "shadowsocks", "hysteria", "hysteria2", "wireguard")

    fun runnable(config: Config): Boolean = when (config.protocol) {
        "openvpn" -> config.link.startsWith("openvpn://")
        in xrayProtocols -> config.outbound != null
        else -> false
    }

    fun usableLocationIds(profile: Profile): Set<Int> = profile.configs.filter { runnable(it) }.mapNotNull { it.locationId }.toSet()

    private fun matches(choice: String, config: Config): Boolean = when (choice) {
        "xray" -> config.protocol != "wireguard" && config.protocol != "openvpn"
        "wireguard" -> config.protocol == "wireguard"
        "openvpn" -> config.protocol == "openvpn"
        else -> true
    }

    // Auto tries the Xray protocols first, as the desktop app does: they get through filtering where the others are blocked.
    private fun rank(config: Config): Int = when (config.protocol) {
        "wireguard" -> 1
        "openvpn" -> 2
        else -> 0
    }

    // The configs a connect to locationId tries, Xray protocols, then WireGuard, then OpenVPN, quickest first.
    fun forLocation(profile: Profile, locationId: Int?, choice: String, pings: Map<String, Int?>): List<Config> =
        profile.configs
            .filter { runnable(it) && matches(choice, it) && (locationId == null || it.locationId == locationId) }
            .sortedWith(compareBy<Config>({ rank(it) }, { pings[it.link] ?: Int.MAX_VALUE }))

    fun bestPing(profile: Profile, pings: Map<String, Int?>, locationId: Int?): Int? =
        profile.configs.filter { runnable(it) && (locationId == null || it.locationId == locationId) }.mapNotNull { pings[it.link] }.minOrNull()

    fun answersOnUdp(config: Config): Boolean = when (config.protocol) {
        "openvpn" -> OpenVpnProfile.decode(config.link)?.let { OpenVpnProfile.udp(it) } ?: false
        else -> config.protocol in setOf("wireguard", "hysteria", "hysteria2")
    }

    fun serverAddress(config: Config): Pair<String, Int>? = runCatching {
        if (config.protocol == "openvpn") return OpenVpnProfile.decode(config.link)?.let { OpenVpnProfile.remote(it) }
        if (config.protocol == "vmess") {
            val json = JSONObject(String(Base64.decode(config.link.removePrefix("vmess://"), Base64.DEFAULT)))
            val host = json.optString("add")
            return if (host.isEmpty()) null else host to (json.optString("port").toIntOrNull() ?: 443)
        }
        val uri = URI(config.link)
        val host = (uri.host ?: return null).trim('[', ']')
        host to (if (uri.port > 0) uri.port else 443)
    }.getOrNull()
}
