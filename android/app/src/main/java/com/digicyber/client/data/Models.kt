package com.digicyber.client.data

import org.json.JSONArray
import org.json.JSONObject

// The panel's app API (Manifold, <subscription link>/app/v1), as the desktop app reads it.
data class Account(
    val username: String,
    val enabled: Boolean,
    val expiryTime: Long,
    val upload: Long,
    val download: Long,
    val total: Long,
    val deviceLimit: Int,
    val devices: Int,
)

data class Location(val id: Int, val name: String, val countryCode: String, val city: String, val timezone: String)

data class Config(val protocol: String, val name: String, val link: String, val locationId: Int?, val outbound: JSONObject?)

data class Notice(val id: Int, val body: String, val level: String, val createdAt: Long)

data class Profile(
    val account: Account,
    val title: String,
    val supportUrl: String,
    val announce: String,
    val locations: List<Location>,
    val configs: List<Config>,
    val notices: List<Notice>,
    val raw: String,
) {
    companion object {
        fun parse(text: String): Profile {
            val o = JSONObject(text)
            val a = o.getJSONObject("account")
            val account = Account(
                username = a.optString("username"),
                enabled = a.optBoolean("enabled"),
                expiryTime = a.optLong("expiryTime"),
                upload = a.optLong("upload"),
                download = a.optLong("download"),
                total = a.optLong("total"),
                deviceLimit = a.optInt("deviceLimit"),
                devices = a.optInt("devices"),
            )
            val locations = (o.optJSONArray("locations") ?: JSONArray()).objects().map {
                Location(it.optInt("id"), it.optString("name"), it.optString("countryCode").uppercase(), it.optString("city"), it.optString("timezone"))
            }
            val configs = (o.optJSONArray("configs") ?: JSONArray()).objects().map {
                Config(
                    protocol = it.optString("protocol"),
                    name = it.optString("name"),
                    link = it.optString("link"),
                    locationId = if (it.has("locationId") && !it.isNull("locationId")) it.optInt("locationId") else null,
                    outbound = it.optJSONObject("outbound"),
                )
            }
            val levels = setOf("info", "warning", "critical")
            val notices = (o.optJSONArray("notices") ?: JSONArray()).objects()
                .map { Notice(it.optInt("id"), it.optString("body").trim(), it.optString("level"), it.optLong("createdAt")) }
                .filter { it.body.isNotEmpty() && it.level in levels }
                .sortedByDescending { it.id }
            return Profile(account, o.optString("title"), o.optString("supportUrl"), o.optString("announce").trim(), locations, configs, notices, text)
        }
    }
}

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

enum class ConnState { Disconnected, Connecting, Connected, Disconnecting }

data class Status(
    val state: ConnState = ConnState.Disconnected,
    val locationId: Int? = null,
    val serverId: Int? = null,
    val configName: String = "",
    val protocol: String = "",
    val since: Long = 0,
    val error: String = "",
)

data class Settings(
    val language: String = "fa",
    val theme: String = "dark",
    val protocol: String = "auto",
    val iranDirect: Boolean = true,
    val adBlock: Boolean = false,
    val dns: String = "",
    val splitApps: Set<String> = emptySet(),
    val locationId: Int? = null,
    val dismissedNotices: Set<String> = emptySet(),
    val seenNoticeId: Int = 0,
    val seenAnnounce: String = "",
    val recents: List<Int> = emptyList(),
) {
    fun toJson(): String = JSONObject()
        .put("language", language).put("theme", theme).put("protocol", protocol)
        .put("iranDirect", iranDirect).put("adBlock", adBlock).put("dns", dns)
        .put("splitApps", JSONArray(splitApps.toList()))
        .put("locationId", locationId ?: JSONObject.NULL)
        .put("dismissedNotices", JSONArray(dismissedNotices.toList()))
        .put("seenNoticeId", seenNoticeId).put("seenAnnounce", seenAnnounce)
        .put("recents", JSONArray(recents))
        .toString()

    companion object {
        fun parse(text: String?): Settings {
            if (text.isNullOrEmpty()) return Settings()
            return runCatching {
                val o = JSONObject(text)
                fun strings(key: String): Set<String> = o.optJSONArray(key)?.let { arr -> (0 until arr.length()).map { arr.optString(it) }.toSet() } ?: emptySet()
                Settings(
                    language = o.optString("language", "fa"),
                    theme = o.optString("theme", "dark"),
                    protocol = o.optString("protocol", "auto"),
                    iranDirect = o.optBoolean("iranDirect", true),
                    adBlock = o.optBoolean("adBlock", false),
                    dns = o.optString("dns"),
                    splitApps = strings("splitApps"),
                    locationId = if (o.isNull("locationId")) null else o.optInt("locationId"),
                    dismissedNotices = strings("dismissedNotices"),
                    seenNoticeId = o.optInt("seenNoticeId"),
                    seenAnnounce = o.optString("seenAnnounce"),
                    recents = o.optJSONArray("recents")?.let { arr -> (0 until arr.length()).map { arr.optInt(it) } } ?: emptyList(),
                )
            }.getOrDefault(Settings())
        }
    }
}
