package com.digicyber.client.data

import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// What the app and its engines said since it started, redacted as it is written: the newest part in
// memory for the support report, and a file so the previous run (one that crashed) can be read too.
// Every line also goes to logcat.
object AppLog {
    private const val MAX_CHARS = 1_200_000
    private val lines = ArrayDeque<String>()
    private var chars = 0
    private val secrets = linkedSetOf<String>()
    private var file: File? = null
    private var previous: File? = null
    private val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    private val shareLink = Regex("\\b(vless|vmess|trojan|ss|ssr|hysteria2?|hy2|tuic|wireguard|wg|openvpn|l2tp|digicyber)://[^\\s\"'<>]+", RegexOption.IGNORE_CASE)
    private val uuid = Regex("\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b")
    private val key32 = Regex("(?<![A-Za-z0-9+/_-])(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})(?![A-Za-z0-9+/=_-])")
    private val bearer = Regex("\\bBearer\\s+[^\\s\"']+", RegexOption.IGNORE_CASE)
    private val named = Regex("\\b(password|passwd|pass|psk|secret|secretKey|privateKey|preSharedKey|token)([\"']?\\s*[:=]\\s*[\"']?)[^\\s\"',&;]+", RegexOption.IGNORE_CASE)
    private val authToken = Regex("\\bauth-token(\\s+|,)[^\\s,']+", RegexOption.IGNORE_CASE)
    const val HIDDEN = "‹hidden›"

    // The same rules as the desktop app (src/shared/redact.ts).
    fun redact(text: String, extra: Collection<String> = emptyList()): String {
        var out = text
        for (s in secrets + extra) if (s.length >= 4) out = out.replace(s, HIDDEN)
        out = shareLink.replace(out) { "${it.groupValues[1]}://$HIDDEN" }
        out = bearer.replace(out, "Bearer $HIDDEN")
        out = named.replace(out) { "${it.groupValues[1]}${it.groupValues[2]}$HIDDEN" }
        out = authToken.replace(out) { "auth-token${it.groupValues[1]}$HIDDEN" }
        out = uuid.replace(out, "‹id›")
        return key32.replace(out, "‹key›")
    }

    // The subscription id (last path segment) of a subscription link, or the whole link.
    fun linkSecrets(link: String): List<String> {
        val id = runCatching { java.net.URI(link.trim()).path }.getOrNull()?.split('/')?.lastOrNull { it.isNotEmpty() }
        return if (id != null && id.length >= 6) listOf(id) else listOf(link.trim())
    }

    @Synchronized
    fun open(dir: File) {
        runCatching {
            dir.mkdirs()
            val current = File(dir, "digi-cyber.log")
            val prev = File(dir, "digi-cyber.prev.log")
            if (current.exists()) current.renameTo(prev)
            previous = prev
            current.writeText(lines.joinToString(""))
            file = current
        }.onFailure { file = null }
    }

    @Synchronized
    fun secret(vararg values: String?) {
        var added = false
        for (v in values) if (v != null && v.length >= 4 && secrets.add(v)) added = true
        if (added) {
            val redone = lines.map { redact(it) }
            lines.clear()
            lines.addAll(redone)
        }
    }

    @Synchronized
    fun write(source: String, text: String) {
        val at = stamp.format(Date())
        val chunk = StringBuilder()
        for (raw in text.split('\n')) {
            val line = raw.trimEnd()
            if (line.isNotEmpty()) chunk.append(at).append(" [").append(source).append("] ").append(redact(line)).append('\n')
        }
        if (chunk.isEmpty()) return
        val s = chunk.toString()
        lines.addLast(s)
        chars += s.length
        while (chars > MAX_CHARS && lines.size > 1) chars -= lines.removeFirst().length
        file?.let { f -> runCatching { f.appendText(s) }.onFailure { file = null } }
    }

    fun i(tag: String, text: String) {
        Log.i(tag, text)
        write(tag, text)
    }

    fun w(tag: String, text: String) {
        Log.w(tag, text)
        write(tag, text)
    }

    fun e(tag: String, text: String, error: Throwable? = null) {
        Log.e(tag, text, error)
        write(tag, if (error != null) "$text: ${Log.getStackTraceString(error)}" else text)
    }

    @Synchronized
    fun text(): String = lines.joinToString("")

    // The end of the previous run's log, for a crash that ended it.
    fun previousRun(maxChars: Int = 150_000): String = runCatching {
        val text = previous?.takeIf { it.exists() }?.readText() ?: return ""
        redact(if (text.length > maxChars) text.substring(text.indexOf('\n', text.length - maxChars) + 1) else text)
    }.getOrDefault("")

    // The keep-the-newest end of a text, cut at a line.
    fun tail(text: String, maxChars: Int): String {
        if (text.length <= maxChars) return text
        val cut = text.indexOf('\n', text.length - maxChars)
        return "… (${text.length - maxChars} earlier characters left out)\n" + text.substring(cut + 1)
    }
}
