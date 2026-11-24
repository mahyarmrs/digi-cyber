package com.digicyber.client.data

import java.util.Calendar
import java.util.TimeZone

// Time spent connected, kept on the phone only: the sessions of the last days, and from them
// the bars of this calendar week the home page draws.
data class Session(val start: Long, val end: Long)

data class DayBar(val start: Long, val secured: Long, val elapsed: Long, val today: Boolean, val future: Boolean)

object Secured {
    const val DAY = 86_400_000L
    private const val KEEP = 9 * DAY

    fun encode(sessions: List<Session>): String = sessions.joinToString(",") { "${it.start}-${it.end}" }

    fun decode(text: String?): List<Session> = text.orEmpty().split(',').mapNotNull { part ->
        val start = part.substringBefore('-').toLongOrNull()
        val end = part.substringAfter('-', "").toLongOrNull()
        if (start == null || end == null || end <= start) null else Session(start, end)
    }

    // A session is added when it ends; older ones than a week and a bit are dropped.
    fun add(sessions: List<Session>, session: Session, now: Long): List<Session> {
        if (session.end <= session.start) return prune(sessions, now)
        return prune(sessions + session, now)
    }

    fun prune(sessions: List<Session>, now: Long): List<Session> = sessions.filter { it.end > now - KEEP }

    // The seven days of the week that holds now, from firstDay (Calendar.SATURDAY in Persian,
    // Calendar.SUNDAY in English). open is a session still running.
    fun week(sessions: List<Session>, open: Session?, now: Long, zone: TimeZone, firstDay: Int): List<DayBar> {
        val all = if (open != null) sessions + open else sessions
        val cal = Calendar.getInstance(zone).apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val todayStart = cal.timeInMillis
        while (cal.get(Calendar.DAY_OF_WEEK) != firstDay) cal.add(Calendar.DAY_OF_YEAR, -1)
        return (0 until 7).map {
            val start = cal.timeInMillis
            cal.add(Calendar.DAY_OF_YEAR, 1)
            val end = cal.timeInMillis
            val until = minOf(end, now)
            val secured = if (until <= start) 0L else all.sumOf { s -> (minOf(s.end, until) - maxOf(s.start, start)).coerceAtLeast(0) }
            DayBar(start, secured, (until - start).coerceAtLeast(0), start == todayStart, start > now)
        }
    }

    // The latest locations connected to, newest first, without repeats.
    fun recents(list: List<Int>, id: Int, keep: Int = 6): List<Int> = (listOf(id) + list.filter { it != id }).take(keep)
}
