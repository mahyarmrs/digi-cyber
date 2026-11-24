package com.digicyber.client

import java.util.Calendar
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.digicyber.client.data.SignIn
import com.digicyber.client.data.SignInCode
import com.digicyber.client.data.Secured
import com.digicyber.client.data.Session

class SignInTest {
    @Test
    fun theBotsCodeCarriesTheLinkAndTheUsername() {
        // As the bot writes it with PHP's rawurlencode.
        val code = SignIn.parse("digicyber://login?sub=https%3A%2F%2Fsub.example.com%3A2096%2Fsub%2Fab12cd&user=z7b21tfbhc")
        assertEquals(SignInCode("https://sub.example.com:2096/sub/ab12cd", "z7b21tfbhc"), code)
        assertTrue(code!!.complete)
    }

    @Test
    fun aPlainSubscriptionLinkAsksForTheUsername() {
        val code = SignIn.parse("  http://1.2.3.4:2096/sub/ab12cd \n")
        assertEquals(SignInCode("http://1.2.3.4:2096/sub/ab12cd", ""), code)
        assertFalse(code!!.complete)
    }

    @Test
    fun whatIsNotASignInCodeIsRefused() {
        assertNull(SignIn.parse("vless://uuid@host:443?type=tcp#x"))
        assertNull(SignIn.parse("https://example.com/"))
        assertNull(SignIn.parse("digicyber://login?user=dana"))
        assertNull(SignIn.parse("digicyber://login?sub=ftp%3A%2F%2Fx%2Fsub&user=dana"))
        assertNull(SignIn.parse(""))
    }

    @Test
    fun aBuiltCodeReadsBackTheSameEvenWithSpacesAndPersian() {
        val original = SignInCode("https://s.example.com/sub/x?name=a+b", "کاربر 1+2")
        assertEquals(original, SignIn.parse(SignIn.build(original)))
    }

    @Test
    fun theWeekSplitsASessionAcrossMidnightAndLeavesFutureDaysEmpty() {
        val zone = TimeZone.getTimeZone("Asia/Tehran")
        val cal = Calendar.getInstance(zone).apply { clear(); set(2026, Calendar.NOVEMBER, 18, 12, 0) } // a Wednesday
        val now = cal.timeInMillis
        val wedStart = Calendar.getInstance(zone).apply { clear(); set(2026, Calendar.NOVEMBER, 18, 0, 0) }.timeInMillis
        val hour = 3_600_000L
        // Tuesday 23:00 to Wednesday 01:00, and an open session from 11:00.
        val sessions = listOf(Session(wedStart - hour, wedStart + hour))
        val week = Secured.week(sessions, Session(now - hour, now), now, zone, Calendar.SATURDAY)
        assertEquals(7, week.size)
        assertEquals(Calendar.SATURDAY, Calendar.getInstance(zone).apply { timeInMillis = week[0].start }.get(Calendar.DAY_OF_WEEK))
        val wed = week.indexOfFirst { it.today }
        assertEquals(4, wed)
        assertEquals(hour, week[wed - 1].secured)
        assertEquals(2 * hour, week[wed].secured)
        assertEquals(12 * hour, week[wed].elapsed)
        assertTrue(week[wed + 1].future)
        assertEquals(0L, week[wed + 1].secured)
    }

    @Test
    fun sessionsSurviveTheirTextFormAndOldOnesAreDropped() {
        val now = 100 * Secured.DAY
        val kept = Session(now - Secured.DAY, now - 1000)
        val text = Secured.encode(Secured.add(listOf(Session(now - 20 * Secured.DAY, now - 19 * Secured.DAY)), kept, now))
        assertEquals(listOf(kept), Secured.decode(text))
        assertEquals(emptyList<Session>(), Secured.decode("garbage,5-3,"))
    }

    @Test
    fun recentsPutTheLatestFirstWithoutRepeats() {
        assertEquals(listOf(3, 1, 2), Secured.recents(listOf(1, 3, 2), 3))
        assertEquals(listOf(9, 1, 2), Secured.recents(listOf(1, 2, 3), 9, keep = 3))
    }
}
