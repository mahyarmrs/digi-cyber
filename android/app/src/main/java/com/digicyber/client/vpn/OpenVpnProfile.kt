package com.digicyber.client.vpn

import android.util.Base64

// The panel carries an OpenVPN profile as openvpn://<the .ovpn file in base64url>, the link the desktop app reads too.
object OpenVpnProfile {
    private const val SCHEME = "openvpn://"

    // Directives that run programs, read or write files, or open a control port: the same list as the desktop app.
    private val forbidden = setOf(
        "up", "down", "route-up", "route-pre-down", "ipchange", "tls-verify", "tls-export-cert", "auth-user-pass-verify",
        "client-connect", "client-disconnect", "learn-address", "script-security", "plugin", "config", "cd", "chroot",
        "log", "log-append", "writepid", "status", "daemon", "askpass", "iproute", "dev-node", "tmp-dir", "syslog",
        "setcon", "replay-persist", "ifconfig-pool-persist", "machine-readable-output", "http-proxy-user-pass", "echo",
    )

    // Files are accepted only inline (<ca>…</ca>).
    private val inlineOnly = setOf(
        "ca", "cert", "key", "tls-auth", "tls-crypt", "tls-crypt-v2", "extra-certs", "secret", "pkcs12", "crl-verify", "dh", "auth-user-pass",
    )

    class Prepared(val config: String, val username: String?, val password: String?)

    fun decode(link: String): String? {
        if (!link.startsWith(SCHEME)) return null
        val body = link.substring(SCHEME.length).trim()
        val padded = body + "=".repeat((4 - body.length % 4) % 4)
        val text = runCatching { String(Base64.decode(padded, Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8) }.getOrNull() ?: return null
        val profile = text.replace("\r\n", "\n")
        if (!Regex("^[ \\t]*client[ \\t]*$", RegexOption.MULTILINE).containsMatchIn(profile)) return null
        if (!Regex("^[ \\t]*remote[ \\t]+\\S+", RegexOption.MULTILINE).containsMatchIn(profile)) return null
        return profile
    }

    // The first directive the app will not run, or null when the profile is safe.
    fun unsafeDirective(profile: String): String? {
        var block: String? = null
        val opening = Regex("^<([a-z0-9-]+)>$", RegexOption.IGNORE_CASE)
        for (raw in profile.split('\n')) {
            val line = raw.trim()
            if (block != null) {
                if (line.equals("</$block>", ignoreCase = true)) block = null
                continue
            }
            val open = opening.matchEntire(line)
            if (open != null) {
                block = open.groupValues[1].lowercase()
                continue
            }
            if (line.isEmpty() || line.startsWith("#") || line.startsWith(";")) continue
            val parts = line.split(Regex("\\s+"))
            val name = parts[0].trimStart('-').lowercase()
            if (name in forbidden || name.startsWith("management")) return name
            if (name in inlineOnly && parts.size > 1 && parts[1] != "[inline]") return name
        }
        return block?.let { "<$it>" }
    }

    // The login moves out of the file into the management socket, which the app answers; the socket goes in.
    fun prepare(profile: String, managementSocket: String): Prepared {
        val out = StringBuilder()
        var username: String? = null
        var password: String? = null
        val lines = profile.split('\n')
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            if (line.trim().equals("<auth-user-pass>", ignoreCase = true)) {
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().equals("</auth-user-pass>", ignoreCase = true)) body += lines[i++]
                i++
                username = body.getOrNull(0)
                password = body.getOrNull(1)
                out.append("auth-user-pass\n")
                continue
            }
            out.append(line).append('\n')
            i++
        }
        // Over UDP the server only learns that a client left from an exit notification; without one it
        // keeps the session, and the account's seat, until its keepalive gives up (two minutes on Manifold).
        // OpenVPN waits a second per try before it exits; one is enough, since the app also tells the panel
        // which session left (Api.disconnected). The last one in the file wins.
        if (udp(profile)) out.append("explicit-exit-notify 1\n")
        out.append("management ").append(managementSocket).append(" unix\n")
        out.append("management-hold\n")
        out.append("management-query-passwords\n")
        return Prepared(out.toString(), username, password)
    }

    // The first server of the profile, for the ping.
    fun remote(profile: String): Pair<String, Int>? {
        val m = Regex("^[ \\t]*remote[ \\t]+(\\S+)(?:[ \\t]+(\\d+))?", RegexOption.MULTILINE).find(profile) ?: return null
        return m.groupValues[1].trim('[', ']') to (m.groupValues[2].toIntOrNull() ?: 1194)
    }

    // OpenVPN's default is UDP; "proto tcp-client" or a TCP remote makes it TCP. ([ \t], not \s: a match must not run into the next line.)
    fun udp(profile: String): Boolean {
        val remoteProto = Regex("^[ \\t]*remote[ \\t]+\\S+[ \\t]+\\d+[ \\t]+(\\S+)", RegexOption.MULTILINE).find(profile)?.groupValues?.get(1)
        val proto = remoteProto ?: Regex("^[ \\t]*proto[ \\t]+(\\S+)", RegexOption.MULTILINE).find(profile)?.groupValues?.get(1) ?: "udp"
        return proto.lowercase().startsWith("udp")
    }
}
