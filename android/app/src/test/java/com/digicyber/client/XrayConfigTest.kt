package com.digicyber.client

import java.net.URLEncoder
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.digicyber.client.data.AppLog
import com.digicyber.client.vpn.XrayConfig

// The same cases as the desktop app's test/fixes.test.ts.
class XrayConfigTest {
    private val priv = "cOFJbW0HSNNXo+dpvVBiNMGbWXfzKaw8tc+B+WWRjX0="
    private val pub = "Sa1M9+7tF7y2jNcvHDb2EhHH9dsZdFWkU6P3RuPXamY="
    private val psk = "FpCyhws9cxwWoV4xELtfJvjJN+zQVRPISllRWgeopVE="
    private fun e(s: String) = URLEncoder.encode(s, "UTF-8")
    private val link get() = "wireguard://${e(priv)}@wg.example.com:51820?address=10.66.66.2%2F32&keepalive=25&mtu=1420&presharedkey=${e(psk)}&publickey=${e(pub)}#wg-de"
    // What Manifold's app API hands over today: the key read twice, its '+' turned into spaces.
    private val panel get() = JSONObject("""{"protocol":"wireguard","settings":{"secretKey":"${priv.replace('+', ' ')}","address":["10.66.66.2/32"],"peers":[{"publicKey":"$pub","endpoint":"wg.example.com:51820","preSharedKey":"$psk","keepAlive":25}]}}""")

    @Test
    fun buildsWireGuardFromTheLinkWithTheKeysIntact() {
        val ob = XrayConfig.proxyOutboundFor("wireguard", link, panel)!!
        val s = ob.getJSONObject("settings")
        assertEquals(priv, s.getString("secretKey"))
        val peer = s.getJSONArray("peers").getJSONObject(0)
        assertEquals(pub, peer.getString("publicKey"))
        assertEquals(psk, peer.getString("preSharedKey"))
        assertEquals("wg.example.com:51820", peer.getString("endpoint"))
        assertEquals(25, peer.getInt("keepAlive"))
        assertEquals(1420, s.getInt("mtu"))
        assertTrue(s.getBoolean("noKernelTun"))
        assertEquals(listOf("wg.example.com"), XrayConfig.serverNames(ob))
    }

    @Test
    fun repairsThePanelOutboundWhenTheLinkHasNoKey() {
        val ob = XrayConfig.proxyOutboundFor("wireguard", "wireguard://@wg.example.com:51820", panel)!!
        assertEquals(priv, ob.getJSONObject("settings").getString("secretKey"))
    }

    @Test
    fun resolvedServerNamesGoToXrayHosts() {
        val vless = JSONObject("""{"protocol":"vless","settings":{"address":"de.example.com","port":443,"id":"u"},"streamSettings":{"security":"tls"}}""")
        val cfg = JSONObject(XrayConfig.build(vless, 1080, iranDirect = true, adBlock = false, dns = listOf("1.1.1.1"), hosts = mapOf("de.example.com" to listOf("203.0.113.7"))))
        assertEquals("203.0.113.7", cfg.getJSONObject("dns").getJSONObject("hosts").getString("full:de.example.com"))
        assertEquals(3, cfg.getJSONArray("outbounds").length())
    }

    @Test
    fun carriesPlainVlessToAPublicServer() {
        val plain = JSONObject("""{"protocol":"vless","settings":{"address":"ir.example.com","port":8080,"id":"u","encryption":"none"},"streamSettings":{"network":"ws","security":"none","wsSettings":{"path":"/x","host":""}}}""")
        val cfg = JSONObject(XrayConfig.build(plain, 1080, iranDirect = true, adBlock = false, dns = listOf("1.1.1.1")))
        val proxy = cfg.getJSONArray("outbounds").getJSONObject(0)
        assertEquals(XrayConfig.CARRIER_ADDRESS, proxy.getJSONObject("settings").getString("address"))
        assertEquals("carrier", proxy.getJSONObject("streamSettings").getJSONObject("sockopt").getString("dialerProxy"))
        assertEquals("ir.example.com", proxy.getJSONObject("streamSettings").getJSONObject("wsSettings").getString("host"))
        val carrier = cfg.getJSONArray("outbounds").getJSONObject(3)
        assertEquals("ir.example.com:8080", carrier.getJSONObject("settings").getString("redirect"))
        val lan = JSONObject("""{"protocol":"trojan","settings":{"servers":[{"address":"192.168.1.5","port":443}]},"streamSettings":{"security":"none"}}""")
        assertEquals(3, JSONObject(XrayConfig.build(lan, 1080, iranDirect = true, adBlock = false, dns = listOf("1.1.1.1"))).getJSONArray("outbounds").length())
    }

    @Test
    fun logLeavesSecretsOut() {
        val text = AppLog.redact("GET https://s.example.com/sub/abcdef123456/app/v1 Bearer tok vless://u@h:1 $priv password=x1y2", AppLog.linkSecrets("https://s.example.com/sub/abcdef123456"))
        for (bad in listOf("abcdef123456", "Bearer tok", "u@h", priv, "x1y2")) assertFalse(bad, text.contains(bad))
        assertTrue(text.contains("s.example.com"))
        assertNotNull(XrayConfig.wireguardOutbound("wireguard://$priv@[2001:db8::1]:51820?publickey=$pub&address=10.0.0.2/32", null))
    }
}
