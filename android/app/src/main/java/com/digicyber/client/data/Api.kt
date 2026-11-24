package com.digicyber.client.data

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.zip.GZIPOutputStream
import org.json.JSONObject

// code is the panel's error code (bad_login, device_limit, ...) or network / bad_response.
class ApiException(val code: String, val status: Int = 0) : Exception(code)

data class DeviceInfo(val deviceId: String, val deviceName: String, val os: String, val osVersion: String, val appVersion: String)

object Api {
    // The app API answers under the subscription link itself, on any of its paths.
    fun base(subLink: String): String {
        val uri = runCatching { URI(subLink.trim()) }.getOrNull() ?: throw ApiException("bad_link")
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") throw ApiException("bad_link")
        val path = (uri.rawPath ?: "").trimEnd('/')
        if (path.split('/').none { it.isNotEmpty() } || uri.rawAuthority.isNullOrEmpty()) throw ApiException("bad_link")
        return "$scheme://${uri.rawAuthority}$path/app/v1"
    }

    private fun call(url: String, method: String, userAgent: String, headers: Map<String, String> = emptyMap(), body: String? = null, timeoutMs: Int = 15_000): JSONObject {
        val conn = try {
            (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "application/json")
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toByteArray()) }
                }
            }
        } catch (e: Exception) {
            AppLog.w("DcApi", "$method ${url.substringAfterLast('/')}: $e")
            throw ApiException("network")
        }
        try {
            val status = try {
                conn.responseCode
            } catch (e: Exception) {
                AppLog.w("DcApi", "$method ${url.substringAfterLast('/')}: $e")
                throw ApiException("network")
            }
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = runCatching { JSONObject(text) }.getOrNull()
            if (status !in 200..299) {
                val code = json?.optString("error")?.takeIf { it.isNotEmpty() } ?: if (status == 404) "not_found" else "bad_response"
                throw ApiException(code, status)
            }
            return json ?: throw ApiException("bad_response", status)
        } finally {
            conn.disconnect()
        }
    }

    // The subscription's own summary (Manifold's <link>?format=info) names its accounts, so a
    // customer signs in with the link alone: the first name is the account the app signs in as.
    fun infoUrl(subLink: String): String {
        base(subLink)
        val link = subLink.trim().substringBefore('#')
        return if (link.contains('?')) "$link&format=info" else "$link?format=info"
    }

    fun subscriptionAccount(subLink: String, userAgent: String): String {
        val conn = try {
            (URL(infoUrl(subLink)).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 15_000
                readTimeout = 15_000
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "application/json")
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            AppLog.w("DcApi", "GET info: $e")
            throw ApiException("network")
        }
        try {
            val status = try {
                conn.responseCode
            } catch (e: Exception) {
                AppLog.w("DcApi", "GET info: $e")
                throw ApiException("network")
            }
            if (status == 404 || status == 403 || status == 410) throw ApiException("bad_sub", status)
            if (status !in 200..299) throw ApiException("bad_response", status)
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            return accountIn(text) ?: throw ApiException(if (runCatching { JSONObject(text).has("emails") }.getOrDefault(false)) "bad_sub" else "link_login_unsupported", status)
        } finally {
            conn.disconnect()
        }
    }

    // The first account name in a ?format=info summary; null when it is not one or names none.
    fun accountIn(text: String): String? {
        val emails = runCatching { JSONObject(text).optJSONArray("emails") }.getOrNull() ?: return null
        return (0 until emails.length()).map { emails.optString(it).trim() }.firstOrNull { it.isNotEmpty() }
    }

    fun login(base: String, username: String, device: DeviceInfo, userAgent: String): String {
        val body = JSONObject()
            .put("username", username)
            .put("deviceId", device.deviceId)
            .put("deviceName", device.deviceName)
            .put("os", device.os)
            .put("osVersion", device.osVersion)
            .put("appVersion", device.appVersion)
        val token = call("$base/login", "POST", userAgent, body = body.toString()).optString("token")
        if (token.isEmpty()) throw ApiException("bad_response", 200)
        return token
    }

    fun profile(base: String, token: String, deviceId: String, userAgent: String): Profile {
        val json = call("$base/profile", "GET", userAgent, mapOf("Authorization" to "Bearer $token", "X-HWID" to deviceId))
        if (!json.has("account") || !json.has("configs")) throw ApiException("bad_response", 200)
        return Profile.parse(json.toString())
    }

    // POST /report (Manifold 0.20+): the panel files the log under the session's account and answers its number.
    // The JSON goes gzipped, since a log is large and compresses well.
    fun report(base: String, token: String, deviceId: String, userAgent: String, body: JSONObject): String? {
        val packed = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(body.toString().toByteArray()) } }.toByteArray()
        val conn = try {
            (URL("$base/report").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 20_000
                readTimeout = 90_000
                doOutput = true
                setFixedLengthStreamingMode(packed.size)
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("X-HWID", deviceId)
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Content-Encoding", "gzip")
                outputStream.use { it.write(packed) }
            }
        } catch (e: Exception) {
            AppLog.w("DcApi", "POST report: $e")
            throw ApiException("network")
        }
        try {
            val status = try {
                conn.responseCode
            } catch (e: Exception) {
                AppLog.w("DcApi", "POST report: $e")
                throw ApiException("network")
            }
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = runCatching { JSONObject(text) }.getOrNull()
            // A panel without the endpoint answers 404 or 405, or a page that is not this API's.
            if (status == 404 || status == 405 || status == 501) throw ApiException("report_unsupported", status)
            if (status !in 200..299) throw ApiException(json?.optString("error")?.takeIf { it.isNotEmpty() } ?: "bad_response", status)
            if (json == null || !(json.has("id") || json.has("ok"))) throw ApiException("report_unsupported", status)
            return json.opt("id")?.takeIf { it != JSONObject.NULL }?.toString()
        } finally {
            conn.disconnect()
        }
    }

    // POST /disconnected: this device has left the protocol it used at that location. WireGuard tells the
    // server nothing when a peer goes, so without this the panel holds the account's seat until the peer
    // has been quiet for a while. OpenVPN's goodbye takes the server five seconds, so its tunnel address
    // goes along: it names the session among an account's several, for the panel to close it.
    // A panel without the endpoint answers 404 or 405, which is fine.
    fun disconnected(base: String, token: String, deviceId: String, userAgent: String, protocol: String, locationId: Int?, address: String?) {
        val body = JSONObject().put("protocol", protocol).put("locationId", locationId ?: JSONObject.NULL)
        if (address != null) body.put("address", address)
        try {
            call("$base/disconnected", "POST", userAgent, mapOf("Authorization" to "Bearer $token", "X-HWID" to deviceId), body.toString(), timeoutMs = 5_000)
        } catch (e: ApiException) {
            if (e.status != 404 && e.status != 405 && e.status != 501) throw e
        }
    }

    fun logout(base: String, token: String, deviceId: String, userAgent: String) {
        call("$base/logout", "POST", userAgent, mapOf("Authorization" to "Bearer $token", "X-HWID" to deviceId), "{}")
    }
}
