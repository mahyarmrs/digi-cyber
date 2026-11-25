package com.digicyber.client.data

import android.annotation.SuppressLint
import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings.Secure
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import com.digicyber.client.BuildConfig
import com.digicyber.client.core.Core
import com.digicyber.client.vpn.Candidates
import com.digicyber.client.vpn.DcVpnService
import com.digicyber.client.vpn.Ping
import com.digicyber.client.vpn.VpnState

// What the app knows and shows: the session, the profile, the settings and the pings.
// The token stays in the app's private storage, which only this app can read.
object Repo {
    private lateinit var prefs: SharedPreferences
    private lateinit var app: Application

    val profile = MutableStateFlow<Profile?>(null)
    val settings = MutableStateFlow(Settings())
    val signedIn = MutableStateFlow(false)
    val signOutReason = MutableStateFlow("")
    val fetchedAt = MutableStateFlow(0L)
    val pings = MutableStateFlow<Map<String, Int?>>(emptyMap())
    val pinging = MutableStateFlow(false)
    val accounts = MutableStateFlow<List<AccountSummary>>(emptyList())
    val activeAccountId = MutableStateFlow<String?>(null)
    val addingAccount = MutableStateFlow(false)
    // A sign-in code that arrived as a digicyber:// link, waiting for the window to act on it.
    val pendingSignIn = MutableStateFlow<SignInCode?>(null)
    val sessions = MutableStateFlow<List<Session>>(emptyList())
    private var accountRecords = mutableListOf<SavedAccount>()
    private val accountMutex = Mutex()
    private val pingMutex = Mutex()
    private var openSince = 0L

    val userAgent: String get() = "DigiCyber/${BuildConfig.VERSION_NAME} (android)"

    // Changes made on the panel reach the app within this time; the refresh button is for now.
    const val REFRESH_MS = 10 * 60_000L

    fun init(application: Application) {
        app = application
        prefs = application.getSharedPreferences("dt", Context.MODE_PRIVATE)
        settings.value = Settings.parse(prefs.getString("settings", null))
        val storedAccounts = prefs.getString("accounts", null)
        val migrated = AccountSessions.migrate(
            serialized = storedAccounts,
            activeAccountId = prefs.getString("activeAccountId", null),
            legacySubLink = prefs.getString("subLink", null),
            legacyUsername = prefs.getString("username", null),
            legacyToken = prefs.getString("token", null),
            legacyProfile = prefs.getString("profile", null),
            legacyFetchedAt = prefs.getLong("fetchedAt", 0L),
        )
        accountRecords = migrated.accounts.toMutableList()
        activeAccountId.value = migrated.activeAccountId
        accounts.value = AccountSessions.summaries(accountRecords, activeAccountId.value)
        val active = activeAccount()
        profile.value = active?.profile?.let { runCatching { Profile.parse(it) }.getOrNull() }
        fetchedAt.value = active?.fetchedAt ?: 0L
        signedIn.value = active?.token?.isNotEmpty() == true && profile.value != null
        signOutReason.value = ""
        sessions.value = Secured.decode(prefs.getString("sessions", null))
        // A session the app was stopped in counts until the last time it was seen running.
        val since = prefs.getLong("openSince", 0L)
        val seen = prefs.getLong("openSeen", 0L)
        if (since > 0) closeSession(Session(since, maxOf(since, seen)))
        val oldKeysRemain = listOf("subLink", "username", "token", "profile", "fetchedAt").any(prefs::contains)
        if (oldKeysRemain || storedAccounts != AccountSessions.encode(accountRecords) || prefs.getString("activeAccountId", null) != activeAccountId.value) {
            persistAccounts()
        }
        for (account in accountRecords) AppLog.secret(account.token, *AppLog.linkSecrets(account.subLink).toTypedArray())
        if (signedIn.value) AppLog.i("app", "signed in as ${lastUsername()}: ${profile.value?.let { summary(it) }}")
    }

    private fun activeAccount(): SavedAccount? = accountRecords.firstOrNull { it.id == activeAccountId.value }

    private fun persistAccounts() {
        val validActive = activeAccountId.value?.takeIf { id -> accountRecords.any { it.id == id } }
        activeAccountId.value = validActive
        val editor = prefs.edit()
            .putString("accounts", AccountSessions.encode(accountRecords))
            .remove("subLink")
            .remove("username")
            .remove("token")
            .remove("profile")
            .remove("fetchedAt")
        if (validActive == null) editor.remove("activeAccountId") else editor.putString("activeAccountId", validActive)
        editor.apply()
        accounts.value = AccountSessions.summaries(accountRecords, validActive)
    }

    private fun clearPings() {
        pings.value = emptyMap()
    }

    fun beginAddAccount() {
        pendingSignIn.value = null
        addingAccount.value = true
    }

    fun cancelAddAccount() {
        pendingSignIn.value = null
        addingAccount.value = false
    }

    fun summary(p: Profile): String {
        val counts = p.configs.groupingBy { it.protocol }.eachCount()
        return "${p.locations.size} location(s), ${p.configs.size} config(s): ${counts.entries.joinToString(", ") { "${it.key} ${it.value}" }.ifEmpty { "none" }}"
    }

    // Every connection state passes through here: a session starts on Connected and ends when that stops.
    fun track(status: Status) {
        val now = System.currentTimeMillis()
        if (status.state == ConnState.Connected) {
            if (openSince == 0L) {
                openSince = if (status.since in 1..now) status.since else now
                prefs.edit().putLong("openSince", openSince).putLong("openSeen", now).apply()
            }
            val id = status.serverId ?: status.locationId
            if (id != null && settings.value.recents.firstOrNull() != id) updateSettings { it.copy(recents = Secured.recents(it.recents, id)) }
        } else if (openSince != 0L) {
            val session = Session(openSince, now)
            openSince = 0L
            closeSession(session)
        }
    }

    fun heartbeat() {
        if (openSince != 0L) prefs.edit().putLong("openSeen", System.currentTimeMillis()).apply()
    }

    fun openSession(): Session? = if (openSince != 0L) Session(openSince, System.currentTimeMillis()) else null

    private fun closeSession(session: Session) {
        val next = Secured.add(sessions.value, session, System.currentTimeMillis())
        sessions.value = next
        prefs.edit().putString("sessions", Secured.encode(next)).remove("openSince").remove("openSeen").apply()
    }

    fun context(): Context = app

    fun updateSettings(change: (Settings) -> Settings) {
        val next = change(settings.value)
        settings.value = next
        prefs.edit().putString("settings", next.toJson()).apply()
    }

    // ANDROID_ID survives reinstalling the app, so the phone keeps its slot of the device limit.
    @SuppressLint("HardwareIds")
    fun deviceId(): String {
        val androidId = Secure.getString(app.contentResolver, Secure.ANDROID_ID)
        if (!androidId.isNullOrEmpty()) {
            val hash = MessageDigest.getInstance("SHA-256").digest("digi-cyber:${androidId.lowercase()}".toByteArray())
            return hash.joinToString("") { "%02x".format(it) }.take(32)
        }
        return prefs.getString("deviceFallback", null) ?: UUID.randomUUID().toString().replace("-", "").also {
            prefs.edit().putString("deviceFallback", it).apply()
        }
    }

    private fun device() = DeviceInfo(
        deviceId = deviceId(),
        deviceName = listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.joinToString(" ").ifEmpty { "Android" },
        os = "android",
        osVersion = Build.VERSION.RELEASE ?: "",
        appVersion = BuildConfig.VERSION_NAME,
    )

    // The subscription link alone signs in: the account's name comes from the subscription itself,
    // unless a sign-in link already carried it. Other saved accounts stay available for switching.
    suspend fun login(subLink: String, given: String = "") = withContext(Dispatchers.IO) {
        val link = subLink.trim()
        AppLog.secret(*AppLog.linkSecrets(link).toTypedArray())
        val base = Api.base(link)
        val username = given.trim().ifEmpty {
            try {
                Api.subscriptionAccount(link, userAgent)
            } catch (e: ApiException) {
                AppLog.w("app", "sign-in failed: ${e.code}")
                throw e
            }
        }.trim()
        val id = AccountSessions.idFor(link, username)
        val existing = accountMutex.withLock { accountRecords.any { it.id == id && it.token.isNotEmpty() } }
        if (existing) {
            switchAccount(id)
            return@withContext
        }

        AppLog.i("app", "signing in as $username on ${runCatching { URI(base).host }.getOrNull()}")
        val info = device()
        val token = try {
            Api.login(base, username, info, userAgent)
        } catch (e: ApiException) {
            AppLog.w("app", "sign-in failed: ${e.code}")
            throw e
        }
        AppLog.secret(token)
        val fetched = try {
            Api.profile(base, token, info.deviceId, userAgent)
        } catch (e: Exception) {
            runCatching { Api.logout(base, token, info.deviceId, userAgent) }
            throw e
        }
        AppLog.i("app", "signed in: ${summary(fetched)}")
        if (activeAccountId.value != null && activeAccountId.value != id) {
            try {
                disconnectForAccountChange()
            } catch (e: Exception) {
                runCatching { Api.logout(base, token, info.deviceId, userAgent) }
                throw e
            }
            updateSettings { it.copy(locationId = null, recents = emptyList()) }
        }
        val now = System.currentTimeMillis()
        accountMutex.withLock {
            accountRecords.removeAll { it.id == id }
            accountRecords += SavedAccount(id, link, username, token, fetched.raw, now)
            activeAccountId.value = id
            persistAccounts()
            profile.value = fetched
            fetchedAt.value = now
            clearPings()
            signOutReason.value = ""
            addingAccount.value = false
            signedIn.value = true
        }
    }

    private suspend fun disconnectForAccountChange() {
        if (VpnState.status.value.state == ConnState.Disconnected) return
        AppLog.i("app", "disconnecting before changing accounts")
        DcVpnService.disconnect(app)
        val disconnected = withTimeoutOrNull(20_000) {
            VpnState.status.first { it.state == ConnState.Disconnected }
            true
        } ?: false
        if (!disconnected) throw ApiException("connection_lost")
    }

    suspend fun switchAccount(accountId: String): Profile? = withContext(Dispatchers.IO) {
        val target = accountMutex.withLock { accountRecords.firstOrNull { it.id == accountId } }
            ?: throw ApiException("bad_session", 401)
        if (activeAccountId.value != accountId) {
            disconnectForAccountChange()
            accountMutex.withLock {
                val stillSaved = accountRecords.firstOrNull { it.id == accountId }
                    ?: throw ApiException("bad_session", 401)
                activeAccountId.value = stillSaved.id
                profile.value = stillSaved.profile?.let { runCatching { Profile.parse(it) }.getOrNull() }
                fetchedAt.value = stillSaved.fetchedAt
                signedIn.value = stillSaved.token.isNotEmpty() && profile.value != null
                signOutReason.value = ""
                addingAccount.value = false
                clearPings()
                updateSettings { it.copy(locationId = null, recents = emptyList()) }
                persistAccounts()
                AppLog.i("app", "switched to account ${stillSaved.username}")
            }
        } else {
            signedIn.value = target.token.isNotEmpty()
        }
        refresh()
        profile.value
    }

    private val sessionEnding = setOf("bad_session", "app_disabled", "not_found")

    // Keep each account's cache separate; a slow reply from the previous account never replaces the current one.
    suspend fun refresh(): String? = withContext(Dispatchers.IO) {
        val session = accountMutex.withLock { activeAccount() } ?: return@withContext "bad_session"
        try {
            val fetched = Api.profile(Api.base(session.subLink), session.token, deviceId(), userAgent)
            val now = System.currentTimeMillis()
            accountMutex.withLock {
                val index = accountRecords.indexOfFirst { it.id == session.id }
                if (index >= 0) {
                    accountRecords[index] = accountRecords[index].copy(profile = fetched.raw, fetchedAt = now)
                    persistAccounts()
                }
                if (activeAccountId.value == session.id) {
                    profile.value = fetched
                    fetchedAt.value = now
                    signedIn.value = true
                }
            }
            null
        } catch (e: ApiException) {
            AppLog.w("app", "profile refresh failed: ${e.code}")
            if (e.code in sessionEnding) forgetSession(session.id, e.code)
            e.code
        }
    }

    private suspend fun forgetSession(id: String, reason: String) {
        accountMutex.withLock {
            val wasActive = activeAccountId.value == id
            accountRecords.removeAll { it.id == id }
            if (wasActive) {
                activeAccountId.value = accountRecords.firstOrNull()?.id
                val fallback = activeAccount()
                profile.value = fallback?.profile?.let { runCatching { Profile.parse(it) }.getOrNull() }
                fetchedAt.value = fallback?.fetchedAt ?: 0L
                signedIn.value = fallback?.token?.isNotEmpty() == true && profile.value != null
                signOutReason.value = if (signedIn.value) "" else reason
                clearPings()
                updateSettings { it.copy(locationId = null, recents = emptyList()) }
            }
            persistAccounts()
        }
    }

    // What support needs to read a log: the app, the phone, the settings, the account's configs and the state.
    private fun reportHeader(): String {
        val s = settings.value
        val p = profile.value
        val st = VpnState.status.value
        val lines = mutableListOf(
            "Digi Cyber ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL} · ${Build.SUPPORTED_ABIS.joinToString(",")}",
            "Engines: Xray ${runCatching { Core.version() }.getOrDefault("?")}",
            "Account: ${p?.account?.username ?: lastUsername()} · panel ${runCatching { URI(lastSubLink()).host }.getOrNull() ?: "-"}",
            "Status: ${st.state} ${st.protocol} ${if (st.configName.isNotEmpty()) "\"${st.configName}\"" else ""} ${if (st.error.isNotEmpty()) "error ${st.error}" else ""}".trim(),
            "Settings: protocol ${s.protocol}, Iran direct ${s.iranDirect}, ad block ${s.adBlock}, DNS ${s.dns.ifEmpty { "default" }}, apps outside ${s.splitApps.size}, language ${s.language}",
            "Profile: ${p?.let { summary(it) } ?: "-"}${if (fetchedAt.value > 0) " · fetched ${java.util.Date(fetchedAt.value)}" else ""}",
        )
        for (c in p?.configs ?: emptyList()) {
            val target = Candidates.serverAddress(c)
            lines += "  ${c.protocol.padEnd(11)} location ${(c.locationId?.toString() ?: "-").padEnd(4)} ${target?.let { "${it.first}:${it.second}" } ?: "?"} \"${c.name}\"${if (Candidates.runnable(c)) "" else " (not run on Android)"}"
        }
        return lines.joinToString("\n")
    }

    private fun fileTail(name: String, maxChars: Int): String = runCatching {
        val f = java.io.File(app.filesDir, "logs/$name")
        if (f.exists()) AppLog.tail(f.readText(), maxChars) else ""
    }.getOrDefault("")

    // The app's own process log (logcat), for what went past AppLog, such as a native library's messages.
    private fun logcat(): String = runCatching {
        val proc = ProcessBuilder("logcat", "-d", "-v", "time", "-t", "800", "--pid=${android.os.Process.myPid()}").redirectErrorStream(true).start()
        val text = proc.inputStream.bufferedReader().use { it.readText() }
        proc.waitFor()
        text
    }.getOrDefault("")

    fun logText(): String {
        val parts = mutableListOf(reportHeader(), "", "=== app ===", AppLog.text())
        fileTail("xray.log", 200_000).takeIf { it.isNotBlank() }?.let { parts += listOf("=== xray (current connection) ===", it) }
        fileTail("tunnel.log", 100_000).takeIf { it.isNotBlank() }?.let { parts += listOf("=== tunnel ===", it) }
        logcat().takeIf { it.isNotBlank() }?.let { parts += listOf("=== logcat ===", AppLog.tail(it, 200_000)) }
        AppLog.previousRun().takeIf { it.isNotBlank() }?.let { parts += listOf("=== previous run (end) ===", it) }
        val secrets = accountRecords.flatMap { account -> listOf(account.token) + AppLog.linkSecrets(account.subLink) }
        return AppLog.redact(parts.joinToString("\n"), secrets)
    }

    // Null on success with the report's number in reportId; otherwise the error code.
    suspend fun sendReport(message: String): Pair<String?, String?> = withContext(Dispatchers.IO) {
        val account = accountMutex.withLock { activeAccount() } ?: return@withContext null to "bad_session"
        AppLog.i("app", "sending a support report")
        val info = device()
        val body = JSONObject()
            .put("message", message.take(4000))
            .put("log", AppLog.tail(logText(), 2_000_000))
            .put("deviceId", info.deviceId)
            .put("deviceName", info.deviceName)
            .put("os", info.os)
            .put("osVersion", info.osVersion)
            .put("appVersion", info.appVersion)
        try {
            val id = Api.report(Api.base(account.subLink), account.token, info.deviceId, userAgent, body)
            AppLog.i("app", "support report sent${id?.let { " (number $it)" } ?: ""}")
            id to null
        } catch (e: ApiException) {
            AppLog.w("app", "support report failed: ${e.code}")
            null to e.code
        }
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        val target = accountMutex.withLock { activeAccount() } ?: run {
            addingAccount.value = false
            profile.value = null
            signedIn.value = false
            return@withContext
        }
        disconnectForAccountChange()
        runCatching { Api.logout(Api.base(target.subLink), target.token, deviceId(), userAgent) }
        accountMutex.withLock {
            accountRecords.removeAll { it.id == target.id }
            if (activeAccountId.value == target.id) {
                activeAccountId.value = accountRecords.firstOrNull()?.id
                val fallback = activeAccount()
                profile.value = fallback?.profile?.let { runCatching { Profile.parse(it) }.getOrNull() }
                fetchedAt.value = fallback?.fetchedAt ?: 0L
                signedIn.value = fallback?.token?.isNotEmpty() == true && profile.value != null
                signOutReason.value = ""
                clearPings()
                updateSettings { it.copy(locationId = null, recents = emptyList()) }
            }
            addingAccount.value = false
            pendingSignIn.value = null
            persistAccounts()
        }
        if (signedIn.value) refresh()
    }

    // Tells the panel this device left a connection (Api.disconnected); best effort, on the caller's thread.
    fun tellPanelLeft(protocol: String, locationId: Int?, address: String?) {
        val account = activeAccount() ?: return
        runCatching { Api.disconnected(Api.base(account.subLink), account.token, deviceId(), userAgent, protocol, locationId, address) }
            .onFailure { AppLog.w("DcRepo", "telling the panel this device left failed: $it") }
    }

    fun lastSubLink(): String = activeAccount()?.subLink.orEmpty()
    fun lastUsername(): String = activeAccount()?.username.orEmpty()

    suspend fun ping() = pingMutex.withLock {
        val accountId = activeAccountId.value ?: return@withLock
        val p = profile.value ?: return@withLock
        pinging.value = true
        try {
            val result = Ping.all(p, settings.value)
            if (activeAccountId.value == accountId) pings.value = result
        } finally {
            pinging.value = false
        }
    }
}
