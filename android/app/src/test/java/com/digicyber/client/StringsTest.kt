package com.digicyber.client

import org.junit.Assert.assertEquals
import org.junit.Test
import com.digicyber.client.ui.Strings

class StringsTest {
    // A key in one language only shows English, or the bare key, to the other.
    @Test
    fun everyWordHasBothLanguages() {
        assertEquals(emptySet<String>(), Strings.missing())
    }
}
