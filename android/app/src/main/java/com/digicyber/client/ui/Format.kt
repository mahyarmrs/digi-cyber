package com.digicyber.client.ui

import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.ceil
import com.digicyber.client.data.Account
import com.digicyber.client.data.Location

// The flag of a two-letter country code as regional indicator letters; null when there is none.
fun flag(code: String): String? {
    val c = code.uppercase()
    if (c.length != 2 || !c.all { it in 'A'..'Z' }) return null
    return c.map { String(Character.toChars(0x1F1E6 + (it - 'A'))) }.joinToString("")
}

// A number or a value of Latin letters inside Persian text, isolated so it keeps its order.
fun iso(text: String): String = "⁨$text⁩"

fun bytes(n: Long): String {
    if (n <= 0) return "0 B"
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var i = 0
    var v = n.toDouble()
    while (v >= 1024 && i < units.size - 1) {
        v /= 1024
        i++
    }
    return String.format(Locale.US, if (i >= 3) "%.2f %s" else if (i == 0) "%.0f %s" else "%.1f %s", v, units[i])
}

fun clock(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return String.format(Locale.US, "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
}

fun ago(t: Strings, at: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = (now - at) / 60_000
    return when {
        at <= 0 -> "—"
        minutes < 1 -> t("justNow")
        minutes < 60 -> t("minutesAgo", "n" to iso("$minutes"))
        else -> t("hoursAgo", "n" to iso("${minutes / 60}"))
    }
}

fun date(t: Strings, ms: Long): String {
    val locale = if (t.language == "fa") Locale("fa", "IR") else Locale.UK
    return DateFormat.getDateInstance(DateFormat.MEDIUM, locale).format(Date(ms))
}

fun dateTime(t: Strings, ms: Long): String {
    val locale = if (t.language == "fa") Locale("fa", "IR") else Locale.UK
    return DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale).format(Date(ms))
}

// What is left of the plan's time, as the account card says it.
fun expiryText(t: Strings, a: Account, now: Long = System.currentTimeMillis()): String = when {
    a.expiryTime > 0 && a.expiryTime <= now -> t("expired")
    a.expiryTime > 0 && a.expiryTime - now < 86_400_000L -> t("hoursLeft")
    a.expiryTime > 0 -> t("daysLeft", "n" to iso("${ceil((a.expiryTime - now) / 86_400_000.0).toInt()}"))
    a.expiryTime < 0 -> t("firstUse")
    else -> t("never")
}

// The location's name, with its city when that adds something; a name that is only the country's
// English name reads in the app's language.
fun placeName(l: Location, countryName: String, englishName: String = ""): String {
    val own = if (countryName.isNotEmpty() && (l.name.isEmpty() || l.name.equals(englishName, ignoreCase = true))) countryName else l.name
    val name = own.ifEmpty { l.countryCode.ifEmpty { "#${l.id}" } }
    return if (l.city.isNotEmpty() && l.city != name) "$name · ${l.city}" else name
}
