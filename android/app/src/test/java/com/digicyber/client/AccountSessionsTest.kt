package com.digicyber.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.digicyber.client.data.AccountSessions
import com.digicyber.client.data.SavedAccount

class AccountSessionsTest {
    @Test
    fun idsAreStableAndMatchTheDesktopAccountKey() {
        assertEquals("93fbc51a9870c49885d6d9b0", AccountSessions.idFor("https://panel.example/sub/a", "dana"))
        assertEquals(AccountSessions.idFor(" https://panel.example/sub/a ", "dana "), AccountSessions.idFor("https://panel.example/sub/a", "dana"))
    }

    @Test
    fun roundTripsSavedSessionsAndTheirCachedProfiles() {
        val accounts = listOf(
            SavedAccount(AccountSessions.idFor("https://a.example/sub", "dana"), "https://a.example/sub", "dana", "token-a", "{\"account\":{}}", 1234),
            SavedAccount(AccountSessions.idFor("https://b.example/sub", "lee"), "https://b.example/sub", "lee", "token-b"),
        )
        assertEquals(accounts, AccountSessions.decode(AccountSessions.encode(accounts)))
    }

    @Test
    fun migratesTheOldSingleAccountWithoutLosingItsTokenOrProfile() {
        val state = AccountSessions.migrate(
            serialized = null,
            activeAccountId = null,
            legacySubLink = "https://panel.example/sub/a",
            legacyUsername = "dana",
            legacyToken = "old-token",
            legacyProfile = "{\"account\":{\"username\":\"dana\"}}",
            legacyFetchedAt = 9876,
        )
        assertEquals(1, state.accounts.size)
        assertEquals(state.accounts.single().id, state.activeAccountId)
        assertEquals("old-token", state.accounts.single().token)
        assertEquals(9876, state.accounts.single().fetchedAt)
        assertTrue(state.accounts.single().profile!!.contains("dana"))
    }

    @Test
    fun preservesSavedAccountsAndUsesTheRequestedActiveOne() {
        val first = SavedAccount(AccountSessions.idFor("https://a.example/sub", "dana"), "https://a.example/sub", "dana", "a")
        val second = SavedAccount(AccountSessions.idFor("https://b.example/sub", "lee"), "https://b.example/sub", "lee", "b")
        val state = AccountSessions.migrate(AccountSessions.encode(listOf(first, second)), second.id, null, null, null, null, 0)
        assertEquals(listOf(first, second), state.accounts)
        assertEquals(second.id, state.activeAccountId)
        assertEquals("b.example", AccountSessions.summaries(state.accounts, state.activeAccountId).last().label)
        assertTrue(AccountSessions.summaries(state.accounts, state.activeAccountId).last().active)
    }

    @Test
    fun ignoresMalformedRowsAndFallsBackFromAnUnknownActiveId() {
        val state = AccountSessions.migrate("[null,{\"id\":\"wrong\",\"subLink\":\"https://a.example/sub\",\"username\":\"dana\",\"token\":\"x\"}]", "missing", null, null, null, null, 0)
        assertTrue(state.accounts.isEmpty())
        assertNull(state.activeAccountId)
    }
}
