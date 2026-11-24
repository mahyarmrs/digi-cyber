package com.digicyber.client.vpn

// hev-socks5-tunnel (MIT), built by CI with PKGNAME=com/digicyber/client/vpn: it moves the VPN
// interface's packets to Xray's local SOCKS inbound.
object TProxyService {
    init {
        System.loadLibrary("hev-socks5-tunnel")
    }

    @JvmStatic external fun TProxyStartService(configPath: String, fd: Int): Boolean
    @JvmStatic external fun TProxyStopService(): Boolean
    @JvmStatic external fun TProxyIsRunning(): Boolean
    @JvmStatic external fun TProxyGetStats(): LongArray?
}
