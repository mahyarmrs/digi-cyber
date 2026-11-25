package com.digicyber.client.data

import java.net.URI
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

// One locally saved panel session. SharedPreferences is app-private, as the single-session values were.
data class SavedAccount(
    val id: String,
    val subLink: String,
    val username: String,
    val token: String,
    val profile: String? = null,
    val fetchedAt: Long = 0L,
)

data class AccountSummary(val id: String, val username: String, val label: String, val active: Boolean)

data class AccountState(val accounts: List<SavedAccount>, val activeAccountId: String?)

object AccountSessions {
    fun idFor(subLink: String, username: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest("${subLink.trim()}\n${username.trim()}".toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }.take(24)
    }

    fun encode(accounts: List<SavedAccount>): String = JSONArray().apply {
        accounts.forEach { account ->
            put(JSONObject()
                .put("id", account.id)
                .put("subLink", account.subLink)
                .put("username", account.username)
                .put("token", account.token)
                .put("profile", account.profile ?: JSONObject.NULL)
                .put("fetchedAt", account.fetchedAt))
        }
    }.toString()

    fun decode(serialized: String?): List<SavedAccount> {
        if (serialized.isNullOrBlank()) return emptyList()
        val array = runCatching { JSONArray(serialized) }.getOrNull() ?: return emptyList()
        val result = mutableListOf<SavedAccount>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val link = item.optString("subLink").trim()
            val username = item.optString("username").trim()
            val token = item.optString("token")
            if (link.isEmpty() || username.isEmpty() || token.isEmpty()) continue
            val id = idFor(link, username)
            val storedId = item.optString("id")
            if (storedId.isNotEmpty() && storedId != id) continue
            val profile = item.optString("profile").takeIf { item.has("profile") && !item.isNull("profile") && it.isNotEmpty() }
            val account = SavedAccount(id, link, username, token, profile, item.optLong("fetchedAt"))
            val existing = result.indexOfFirst { it.id == id }
            if (existing < 0) result += account else result[existing] = account
        }
        return result
    }

    // Upgrade the single-account preferences used by releases before multi-account support.
    fun migrate(
        serialized: String?,
        activeAccountId: String?,
        legacySubLink: String?,
        legacyUsername: String?,
        legacyToken: String?,
        legacyProfile: String?,
        legacyFetchedAt: Long,
    ): AccountState {
        val accounts = decode(serialized).toMutableList()
        val link = legacySubLink?.trim().orEmpty()
        val username = legacyUsername?.trim().orEmpty()
        val token = legacyToken.orEmpty()
        if (link.isNotEmpty() && username.isNotEmpty() && token.isNotEmpty()) {
            val id = idFor(link, username)
            val index = accounts.indexOfFirst { it.id == id }
            if (index < 0) {
                accounts += SavedAccount(id, link, username, token, legacyProfile, legacyFetchedAt)
            } else {
                val existing = accounts[index]
                accounts[index] = existing.copy(
                    profile = existing.profile ?: legacyProfile,
                    fetchedAt = if (existing.fetchedAt > 0) existing.fetchedAt else legacyFetchedAt,
                )
            }
        }
        val active = activeAccountId?.takeIf { id -> accounts.any { it.id == id } }
            ?: accounts.firstOrNull()?.id
        return AccountState(accounts, active)
    }

    fun summaries(accounts: List<SavedAccount>, activeAccountId: String?): List<AccountSummary> = accounts.map { account ->
        val label = runCatching { URI(account.subLink).host.orEmpty() }.getOrDefault("")
        AccountSummary(account.id, account.username, label, account.id == activeAccountId)
    }
}
