package com.digicyber.client

import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import com.digicyber.client.data.ConnState
import com.digicyber.client.data.Repo
import com.digicyber.client.data.SignIn
import com.digicyber.client.data.SignInCode
import com.digicyber.client.data.Settings
import com.digicyber.client.ui.Geo
import com.digicyber.client.ui.MainActivity
import com.digicyber.client.ui.Strings
import com.digicyber.client.vpn.DcVpnService
import com.digicyber.client.vpn.VpnState

// The app as a customer meets it, driven through its screens: the sign-in page, signing in by
// opening a digicyber:// link with the subscription link alone, every tab, the notices, the location
// list, connecting and the English and light versions. Each screen goes to /data/local/tmp/screens for CI.
@RunWith(AndroidJUnit4::class)
class UiTourTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val fa = Strings("fa")

    private fun shell(command: String): String {
        val pfd = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().use { it.readText() }
    }

    private fun shot(name: String) {
        device.waitForIdle()
        Thread.sleep(1200)
        shell("screencap -p /data/local/tmp/screens/$name.png")
    }

    private fun waitFor(ms: Long, done: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            if (done()) return true
            Thread.sleep(200)
        }
        return done()
    }

    // What is on screen, as UiAutomator sees it: every text and description, for a failure message.
    private fun onScreen(): String {
        val out = java.io.ByteArrayOutputStream()
        runCatching { device.dumpWindowHierarchy(out) }
        val xml = out.toString("UTF-8")
        return Regex("(?:text|content-desc)=\"([^\"]+)\"").findAll(xml).map { it.groupValues[1] }.distinct().joinToString(" | ")
    }

    private fun see(what: String, selector: androidx.test.uiautomator.BySelector, ms: Long = 10_000) {
        if (!device.wait(Until.hasObject(selector), ms)) throw AssertionError("no $what on screen; it shows: ${onScreen()}")
    }

    private fun tap(desc: String) {
        see("\"$desc\"", By.desc(desc), 5000)
        device.findObject(By.desc(desc)).click()
    }

    @Test
    fun aCustomerSignsInWithTheQrLinkAndConnects() {
        val panel = InstrumentationRegistry.getArguments().getString("panel")
        assumeTrue("no test panel", !panel.isNullOrEmpty())
        shell("mkdir -p /data/local/tmp/screens")
        runBlocking { Repo.logout() }
        Repo.updateSettings { Settings() }
        shell("appops set ${context.packageName} ACTIVATE_VPN allow")
        assertNull("VPN consent", VpnService.prepare(context))

        ActivityScenario.launch(MainActivity::class.java).use {
            see("the sign-in page", By.text(fa("signInTitle")), 15_000)
            shot("01-sign-in")

            // What scanning the bot's QR code or tapping its link does: the app opens with the
            // subscription link alone and finds the account's name in the subscription itself.
            val link = SignIn.build(SignInCode(panel!!, ""))
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            assertTrue("signed in by the link", waitFor(20_000) { Repo.signedIn.value })
            assertEquals("demo-user", Repo.lastUsername())
            see("the home page's notices button", By.desc(fa("notices")))
            shot("02-home")
            device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 40)
            shot("03-home-plan")
            device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 40)
            shot("04-home-tools")

            tap(fa("protection"))
            shot("05-protection")
            tap(fa("account"))
            shot("06-account")
            tap(fa("home"))
            tap(fa("notices"))
            see("the notices page", By.desc(fa("back")))
            shot("07-notices")
            device.pressBack()
            tap(fa("locationsTab"))
            see("Fastest location", By.text(fa("fastest")))
            shot("08-locations")
            // The search reads English names too; a country with several cities opens to list them.
            device.findObject(By.clazz("android.widget.EditText")).text = "united"
            see("the United States in the results", By.text(Geo.name(context, "US", "fa")))
            see("New York under it", By.text("New York"))
            shot("09-search")
            device.findObject(By.clazz("android.widget.EditText")).text = ""

            see("Fastest location", By.text(fa("fastest")))
            device.findObject(By.text(fa("fastest"))).click()
            assertTrue("connected: ${VpnState.status.value}", waitFor(60_000) { VpnState.status.value.state == ConnState.Connected })
            shot("10-connected")

            Repo.updateSettings { s -> s.copy(language = "en") }
            shot("11-connected-en")
            Repo.updateSettings { s -> s.copy(theme = "light") }
            shot("12-connected-light")
            DcVpnService.disconnect(context)
            assertTrue("disconnected: ${VpnState.status.value}", waitFor(15_000) { VpnState.status.value.state == ConnState.Disconnected })
            shot("13-disconnected-light")
            Repo.updateSettings { Settings() }
        }
    }
}
