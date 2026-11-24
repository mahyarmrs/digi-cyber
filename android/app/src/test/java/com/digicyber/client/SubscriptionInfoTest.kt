package com.digicyber.client

import com.digicyber.client.data.Api
import com.digicyber.client.data.ApiException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

// Signing in with the subscription link alone: the summary the app asks for and the name it takes.
class SubscriptionInfoTest {
    @Test
    fun asksTheSubscriptionForItsSummary() {
        assertEquals("https://sub.example.com:2096/sub/ab12?format=info", Api.infoUrl(" https://sub.example.com:2096/sub/ab12 "))
        assertEquals("https://sub.example.com/sub/ab12?name=x&format=info", Api.infoUrl("https://sub.example.com/sub/ab12?name=x#me"))
        assertThrows(ApiException::class.java) { Api.infoUrl("vless://uuid@host:443") }
    }

    @Test
    fun takesTheFirstAccountItNames() {
        assertEquals("dana", Api.accountIn("""{"emails":["", " dana ", "dana-2"],"total":0}"""))
        assertNull(Api.accountIn("""{"emails":[]}"""))
        assertNull(Api.accountIn("""{"total":1}"""))
        assertNull(Api.accountIn("dmxlc3M6Ly8="))
    }
}
