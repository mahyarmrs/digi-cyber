package com.digicyber.client.vpn

import java.net.URLDecoder
import org.json.JSONArray
import org.json.JSONObject

// The same configuration the desktop app writes (src/main/configs/xray.ts): the panel's outbound
// (WireGuard's built from its link) behind a local SOCKS inbound, with its server names resolved ahead.
object XrayConfig {
    val defaultDns = listOf("1.1.1.1", "8.8.8.8")
    const val CARRIER_ADDRESS = "10.255.255.254"
    private val wgKey = Regex("^[A-Za-z0-9+/]{43}=$")

    fun dnsServers(setting: String): List<String> {
        val list = setting.split(Regex("[\\s,]+")).filter { it.matches(Regex("^[0-9a-fA-F.:]+$")) }
        return list.ifEmpty { defaultDns }
    }

    private fun isIp(s: String): Boolean = s.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")) || (s.contains(':') && s.matches(Regex("^[0-9a-fA-F:.]+$")))

    // settings itself (VLESS, Hysteria as Manifold writes them), vnext entries (VMess), servers entries (Trojan, Shadowsocks).
    private fun serverEntries(outbound: JSONObject): List<JSONObject> {
        val settings = outbound.optJSONObject("settings") ?: return emptyList()
        val out = mutableListOf<JSONObject>()
        if (settings.opt("address") is String) out += settings
        for (key in listOf("vnext", "servers")) {
            val list = settings.optJSONArray(key) ?: continue
            for (i in 0 until list.length()) list.optJSONObject(i)?.takeIf { it.opt("address") is String }?.let { out += it }
        }
        return out
    }

    private fun splitHostPort(endpoint: String): Pair<String, String>? {
        Regex("^\\[([^\\]]+)]:(\\d+)$").find(endpoint)?.let { return it.groupValues[1] to it.groupValues[2] }
        return Regex("^([^:]+):(\\d+)$").find(endpoint)?.let { it.groupValues[1] to it.groupValues[2] }
    }

    // The server names (not addresses) an outbound dials, to be resolved before it runs.
    fun serverNames(outbound: JSONObject): List<String> {
        val names = linkedSetOf<String>()
        for (e in serverEntries(outbound)) names += e.optString("address")
        outbound.optJSONObject("settings")?.optJSONArray("peers")?.let { peers ->
            for (i in 0 until peers.length()) splitHostPort(peers.optJSONObject(i)?.optString("endpoint") ?: "")?.let { names += it.first }
        }
        return names.filter { it.isNotEmpty() && !isIp(it) }
    }

    // The query of a wireguard:// link, '+' kept as '+': a key is base64, which has many and no spaces.
    private fun query(link: String): Map<String, String> {
        val at = link.indexOf('?')
        if (at < 0) return emptyMap()
        val out = linkedMapOf<String, String>()
        for (part in link.substring(at + 1).substringBefore('#').split('&')) {
            val k = part.substringBefore('=').lowercase()
            val v = part.substringAfter('=', "")
            val decoded = runCatching { URLDecoder.decode(v.replace("+", "%2B"), "UTF-8") }.getOrDefault(v)
            if (k.isNotEmpty() && k !in out) out[k] = decoded
        }
        return out
    }

    private fun list(s: String?): List<String> = (s ?: "").split(',').map { it.trim() }.filter { it.isNotEmpty() }

    // WireGuard from its link: the panel's outbound for it can carry a key whose '+' became a space
    // (Manifold reads the key from the link twice), which Xray refuses.
    fun wireguardOutbound(link: String, fallback: JSONObject?): JSONObject? {
        val m = Regex("^(?:wireguard|wg)://([^@/?#]*)@([^/?#]+)", RegexOption.IGNORE_CASE).find(link.trim())
        var secretKey = m?.groupValues?.get(1)?.let { runCatching { URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }.getOrDefault(it) } ?: ""
        var endpoint = m?.groupValues?.get(2) ?: ""
        val q = query(link)
        val fb = fallback?.optJSONObject("settings") ?: JSONObject()
        val fbPeer = fb.optJSONArray("peers")?.optJSONObject(0) ?: JSONObject()
        fun repair(v: String?) = (v ?: "").trim().replace(' ', '+')
        if (!wgKey.matches(secretKey)) secretKey = repair(fb.optString("secretKey"))
        val publicKey = repair(q["publickey"] ?: q["public_key"] ?: q["peerpublickey"] ?: fbPeer.optString("publicKey"))
        if (endpoint.isEmpty()) endpoint = fbPeer.optString("endpoint")
        if (!wgKey.matches(secretKey) || !wgKey.matches(publicKey) || splitHostPort(endpoint) == null) return null

        var address = list(q["address"] ?: q["ip"])
        if (address.isEmpty()) address = fb.optJSONArray("address")?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() } } ?: emptyList()
        if (address.isEmpty()) return null
        val allowed = list(q["allowedips"] ?: q["allowed_ips"]).ifEmpty { listOf("0.0.0.0/0", "::/0") }
        val peer = JSONObject().put("publicKey", publicKey).put("endpoint", endpoint).put("allowedIPs", JSONArray(allowed))
        val psk = repair(q["presharedkey"] ?: q["preshared_key"] ?: q["psk"] ?: fbPeer.optString("preSharedKey"))
        if (psk.isNotEmpty()) peer.put("preSharedKey", psk)
        val keepAlive = (q["keepalive"] ?: q["persistentkeepalive"])?.toIntOrNull() ?: fbPeer.optInt("keepAlive", 0)
        if (keepAlive > 0) peer.put("keepAlive", keepAlive)

        val has6 = address.any { it.contains(':') }
        val settings = JSONObject()
            .put("secretKey", secretKey)
            .put("address", JSONArray(address))
            .put("peers", JSONArray().put(peer))
            .put("noKernelTun", true)
            .put("domainStrategy", if (has6) "ForceIP" else "ForceIPv4")
        val mtu = q["mtu"]?.toIntOrNull() ?: fb.optInt("mtu", 0)
        if (mtu in 576..9000) settings.put("mtu", mtu)
        val reserved = list(q["reserved"]).map { it.toIntOrNull() ?: -1 }
        if (reserved.isNotEmpty() && reserved.all { it in 0..255 }) settings.put("reserved", JSONArray(reserved))
        else fb.optJSONArray("reserved")?.let { settings.put("reserved", it) }
        return JSONObject().put("protocol", "wireguard").put("settings", settings)
    }

    fun proxyOutboundFor(protocol: String, link: String, outbound: JSONObject?): JSONObject? {
        if (protocol == "wireguard") wireguardOutbound(link, outbound)?.let { return it }
        return outbound?.let { JSONObject(it.toString()) }
    }

    private fun isPublic(address: String): Boolean {
        if (!isIp(address)) return !Regex("(^|\\.)(localhost|local|lan|internal|home\\.arpa)$", RegexOption.IGNORE_CASE).containsMatchIn(address)
        if (address.contains(':')) {
            val v6 = address.lowercase()
            return !(v6 == "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80"))
        }
        val (a, b) = address.split('.').map { it.toInt() }
        return !(a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254) || (a == 100 && b in 64..127))
    }

    // Xray 26.7+ refuses VLESS and Trojan without TLS to a public address; such an outbound then points
    // at a private one and dials through a freedom outbound that redirects to the real server.
    private fun carryPlain(proxy: JSONObject, extra: JSONArray) {
        val protocol = proxy.optString("protocol")
        if (protocol != "vless" && protocol != "trojan") return
        val stream = proxy.optJSONObject("streamSettings") ?: JSONObject()
        val security = stream.optString("security")
        if (security.isNotEmpty() && security != "none") return
        val encryption = proxy.optJSONObject("settings")?.optString("encryption") ?: ""
        if (protocol == "vless" && encryption.isNotEmpty() && encryption != "none") return
        val entry = serverEntries(proxy).firstOrNull() ?: return
        val real = entry.optString("address")
        val port = entry.optInt("port", -1)
        if (!isPublic(real) || port <= 0) return
        entry.put("address", CARRIER_ADDRESS)
        val network = stream.optString("network").ifEmpty { "tcp" }
        val key = mapOf("ws" to "wsSettings", "httpupgrade" to "httpupgradeSettings", "xhttp" to "xhttpSettings", "splithttp" to "splithttpSettings")[network]
        if (key != null) {
            val t = stream.optJSONObject(key) ?: JSONObject()
            val headers = t.optJSONObject("headers")
            if (t.optString("host").isEmpty() && headers?.optString("Host").isNullOrEmpty() && headers?.optString("host").isNullOrEmpty()) t.put("host", real)
            stream.put(key, t)
        } else if (network == "grpc") {
            val g = stream.optJSONObject("grpcSettings") ?: JSONObject()
            if (g.optString("authority").isEmpty()) g.put("authority", if (real.contains(':')) "[$real]" else real)
            stream.put("grpcSettings", g)
        }
        val sockopt = stream.optJSONObject("sockopt") ?: JSONObject()
        sockopt.put("dialerProxy", "carrier")
        stream.put("sockopt", sockopt)
        proxy.put("streamSettings", stream)
        val target = if (real.contains(':')) "[$real]:$port" else "$real:$port"
        extra.put(
            JSONObject().put("tag", "carrier").put("protocol", "freedom").put("settings", JSONObject().put("redirect", target))
                .put("streamSettings", JSONObject().put("sockopt", JSONObject().put("domainStrategy", "UseIPv4"))),
        )
    }

    fun build(
        outbound: JSONObject,
        socksPort: Int,
        iranDirect: Boolean,
        adBlock: Boolean,
        dns: List<String>,
        hosts: Map<String, List<String>> = emptyMap(),
        logLevel: String = "warning",
        logFile: String? = null,
    ): String {
        val proxy = JSONObject(outbound.toString()).put("tag", "proxy")
        val stream = proxy.optJSONObject("streamSettings") ?: JSONObject()
        val sockopt = stream.optJSONObject("sockopt") ?: JSONObject()
        // Server names come from the hosts below; without them Xray would ask through the tunnel.
        val onlyV6 = hosts.values.any { ips -> ips.isNotEmpty() && ips.all { it.contains(':') } }
        sockopt.put("domainStrategy", if (onlyV6) "UseIP" else "UseIPv4")
        stream.put("sockopt", sockopt)
        proxy.put("streamSettings", stream)
        val extra = JSONArray()
        carryPlain(proxy, extra)

        val rules = JSONArray()
        if (adBlock) rules.put(JSONObject().put("type", "field").put("domain", JSONArray().put("geosite:category-ads-all")).put("outboundTag", "block"))
        rules.put(JSONObject().put("type", "field").put("ip", JSONArray().put("geoip:private")).put("outboundTag", "direct"))
        if (iranDirect) {
            rules.put(JSONObject().put("type", "field").put("domain", JSONArray().put("geosite:category-ir").put("regexp:\\.ir$")).put("outboundTag", "direct"))
            rules.put(JSONObject().put("type", "field").put("ip", JSONArray().put("geoip:ir")).put("outboundTag", "direct"))
        }
        val socks = JSONObject()
            .put("tag", "socks")
            .put("listen", "127.0.0.1")
            .put("port", socksPort)
            .put("protocol", "socks")
            .put("settings", JSONObject().put("auth", "noauth").put("udp", true))
            .put("sniffing", JSONObject().put("enabled", true).put("destOverride", JSONArray().put("http").put("tls").put("quic")).put("routeOnly", true))
        val dnsConfig = JSONObject().put("servers", JSONArray(dns)).put("queryStrategy", if (onlyV6) "UseIP" else "UseIPv4")
        if (hosts.isNotEmpty()) {
            val h = JSONObject()
            for ((name, ips) in hosts) if (ips.isNotEmpty()) h.put("full:$name", if (ips.size == 1) ips[0] else JSONArray(ips))
            dnsConfig.put("hosts", h)
        }
        val log = JSONObject().put("loglevel", logLevel).put("access", "none")
        if (logFile != null) log.put("error", logFile)
        val outbounds = JSONArray().put(proxy).put(JSONObject().put("tag", "direct").put("protocol", "freedom")).put(JSONObject().put("tag", "block").put("protocol", "blackhole"))
        for (i in 0 until extra.length()) outbounds.put(extra.get(i))
        return JSONObject()
            .put("log", log)
            .put("dns", dnsConfig)
            .put("inbounds", JSONArray().put(socks))
            .put("outbounds", outbounds)
            .put("routing", JSONObject().put("domainStrategy", "IPIfNonMatch").put("rules", rules))
            .toString()
    }
}
