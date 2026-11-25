package com.digicyber.client

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import com.digicyber.client.data.Repo

// Saved Android sessions behave like the desktop account store: adding and switching accounts keeps
// each login available, and signing out of one account does not sign out of the others.
@RunWith(AndroidJUnit4::class)
class AccountsTest {
    private val panel = InstrumentationRegistry.getArguments().getString("panel")

    private suspend fun removeAllSavedAccounts() {
        while (Repo.accounts.value.isNotEmpty()) {
            val id = Repo.activeAccountId.value ?: Repo.accounts.value.first().id
            if (Repo.activeAccountId.value != id) Repo.switchAccount(id)
            Repo.logout()
        }
    }

    @Test
    fun addsSwitchesAndSignsOutOfAccountsIndependently() = runBlocking {
        assumeTrue("no test panel", !panel.isNullOrEmpty())
        removeAllSavedAccounts()

        Repo.login(panel!!, "demo-user")
        val firstId = Repo.activeAccountId.value!!
        assertEquals("demo-user", Repo.profile.value?.account?.username)

        val secondPanel = panel!!.replace("/sub/demo", "/sub/other")
        Repo.login(secondPanel, "other-user")
        val secondId = Repo.activeAccountId.value!!
        assertNotEquals(firstId, secondId)
        assertEquals("other-user", Repo.profile.value?.account?.username)
        assertEquals(2, Repo.accounts.value.size)
        assertFalse(Repo.accounts.value.single { it.id == firstId }.active)
        assertTrue(Repo.accounts.value.single { it.id == secondId }.active)

        Repo.switchAccount(firstId)
        assertEquals(firstId, Repo.activeAccountId.value)
        assertEquals("demo-user", Repo.profile.value?.account?.username)
        assertEquals(2, Repo.accounts.value.size)

        Repo.logout()
        assertEquals(secondId, Repo.activeAccountId.value)
        assertEquals("other-user", Repo.profile.value?.account?.username)
        assertEquals(listOf(secondId), Repo.accounts.value.map { it.id })

        Repo.logout()
        assertNull(Repo.activeAccountId.value)
        assertTrue(Repo.accounts.value.isEmpty())
        assertFalse(Repo.signedIn.value)
    }
}
