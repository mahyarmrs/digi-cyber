package com.digicyber.client.data

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

// What a sign-in QR code, a tapped digicyber:// link or a pasted text holds: the subscription link,
// and the username when the code carries both (the bot's QR code and the panel's sign-in link do).
data class SignInCode(val subLink: String, val username: String) {
    val complete: Boolean get() = username.isNotBlank()
}

object SignIn {
    const val SCHEME = "digicyber"

    // digicyber://login?sub=<subscription link>&user=<username>, or a bare subscription link.
    fun parse(text: String): SignInCode? {
        val raw = text.trim()
        if (raw.isEmpty()) return null
        if (raw.startsWith("$SCHEME:", ignoreCase = true)) {
            val query = raw.substringAfter('?', "").substringBefore('#')
            val params = query.split('&').mapNotNull { part ->
                val i = part.indexOf('=')
                if (i <= 0) null else decode(part.substring(0, i)) to decode(part.substring(i + 1))
            }.toMap()
            val sub = params["sub"]?.trim().orEmpty()
            if (!isSubLink(sub)) return null
            return SignInCode(sub, params["user"]?.trim().orEmpty())
        }
        return if (isSubLink(raw)) SignInCode(raw, "") else null
    }

    // The same rule the app API's address is built with: http(s), a host and a path.
    fun isSubLink(text: String): Boolean {
        val uri = runCatching { URI(text.trim()) }.getOrNull() ?: return false
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return false
        if (uri.rawAuthority.isNullOrEmpty()) return false
        return (uri.rawPath ?: "").split('/').any { it.isNotEmpty() }
    }

    fun build(code: SignInCode): String = "$SCHEME://login?sub=${encode(code.subLink)}&user=${encode(code.username)}"

    private fun decode(s: String): String = runCatching { URLDecoder.decode(s, "UTF-8") }.getOrDefault(s)

    private fun encode(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
