package com.digicyber.client.data

// The bell's list: the subscription's announcement on top, then the panel's notices newest first.
data class NoticeEntry(val key: String, val id: Int, val body: String, val level: String, val createdAt: Long)

fun noticeLog(profile: Profile): List<NoticeEntry> {
    val out = mutableListOf<NoticeEntry>()
    if (profile.announce.isNotEmpty()) out += NoticeEntry("announce", 0, profile.announce, "info", 0)
    profile.notices.forEach { out += NoticeEntry(it.id.toString(), it.id, it.body, it.level, it.createdAt) }
    return out
}

fun bannerNotices(log: List<NoticeEntry>, dismissed: Set<String>): List<NoticeEntry> {
    val open = log.filter { it.level != "info" && it.key !in dismissed }
    return open.filter { it.level == "critical" } + open.filter { it.level == "warning" }
}

fun unreadNotices(log: List<NoticeEntry>, settings: Settings): Int =
    log.count { if (it.key == "announce") it.body != settings.seenAnnounce else it.id > settings.seenNoticeId }
