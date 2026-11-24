package com.digicyber.client.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import com.digicyber.client.R
import com.digicyber.client.data.Repo
import com.digicyber.client.data.noticeLog
import com.digicyber.client.data.unreadNotices

@Composable
fun DcRoot(activity: MainActivity) {
    val settings by Repo.settings.collectAsState()
    val signedIn by Repo.signedIn.collectAsState()
    val dark = when (settings.theme) {
        "light" -> false
        "system" -> isSystemInDarkTheme()
        else -> true
    }
    val t = remember(settings.language) { Strings(settings.language) }
    LaunchedEffect(dark) { activity.applySystemBars(dark) }
    DcTheme(dark) {
        CompositionLocalProvider(LocalT provides t, LocalLayoutDirection provides if (t.rtl) LayoutDirection.Rtl else LayoutDirection.Ltr) {
            Surface(Modifier.fillMaxSize(), color = LocalDc.current.background) {
                if (signedIn) MainScreen(activity) else SignedOutScreen()
                if (signedIn) SwitchAccount(activity)
            }
        }
    }
}

// A digicyber:// link opened while signed in: the same subscription, nothing to do; another one, ask first.
@Composable
private fun SwitchAccount(activity: MainActivity) {
    val t = LocalT.current
    val c = LocalDc.current
    val scope = rememberCoroutineScope()
    val pending by Repo.pendingSignIn.collectAsState()
    val code = pending ?: return
    val current = Repo.lastUsername()
    if (code.subLink.trim() == Repo.lastSubLink().trim()) {
        LaunchedEffect(code) { Repo.pendingSignIn.value = null }
        return
    }
    AlertDialog(
        onDismissRequest = { Repo.pendingSignIn.value = null },
        containerColor = c.card,
        title = { Text(t("switchAccountTitle"), color = c.text) },
        text = { Text(t("switchAccountText", "user" to iso(current)), color = c.muted) },
        confirmButton = {
            TextButton(onClick = {
                activity.disconnect()
                // Signed out, the sign-in screen takes the waiting code and signs in with it.
                scope.launch { Repo.logout() }
            }) { Text(t("switch"), color = c.accent, fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = { Repo.pendingSignIn.value = null }) { Text(t("cancel"), color = c.text) } },
    )
}

// Four tabs (home, locations, protection, account); notices and the app picker open over them.
@Composable
private fun MainScreen(activity: MainActivity) {
    val profile by Repo.profile.collectAsState()
    val settings by Repo.settings.collectAsState()
    val p = profile ?: return
    var tab by rememberSaveable { mutableStateOf("home") }
    var overlay by rememberSaveable { mutableStateOf("") }
    val log = remember(p) { noticeLog(p) }
    val unread = unreadNotices(log, settings)
    LaunchedEffect(overlay, unread) {
        if (overlay == "notices" && unread > 0) {
            Repo.updateSettings { s -> s.copy(seenNoticeId = maxOf(s.seenNoticeId, log.maxOfOrNull { it.id } ?: 0), seenAnnounce = p.announce) }
        }
    }
    BackHandler(enabled = overlay.isNotEmpty() || tab != "home") {
        if (overlay.isNotEmpty()) overlay = "" else tab = "home"
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) {
                when (tab) {
                    "locations" -> LocationsScreen(p, settings, activity, focusSearch = false, asTab = true) { tab = "home" }
                    "protection" -> ProtectionPage(settings) { overlay = "apps" }
                    "account" -> AccountPage(p, settings, activity)
                    else -> HomePage(
                        p,
                        settings,
                        log,
                        unread,
                        activity,
                        onLocations = { tab = "locations" },
                        onNotices = { overlay = "notices" },
                        onApps = { overlay = "apps" },
                        onTab = { tab = it },
                    )
                }
            }
            BottomBar(tab) { tab = it }
        }
        if (overlay == "notices") {
            Box(Modifier.fillMaxSize().background(LocalDc.current.background)) {
                NoticesPage(log) { overlay = "" }
            }
        }
    }
    if (overlay == "apps") AppPicker(settings) { overlay = "" }
}

@Composable
private fun BottomBar(tab: String, onSelect: (String) -> Unit) {
    val c = LocalDc.current
    val t = LocalT.current
    val tabs = listOf(
        Triple("home", R.drawable.ic_home, t("home")),
        Triple("locations", R.drawable.ic_globe, t("locationsTab")),
        Triple("protection", R.drawable.ic_shield, t("protection")),
        Triple("account", R.drawable.ic_user, t("account")),
    )
    Column(Modifier.fillMaxWidth().background(c.panel)) {
        HorizontalDivider(color = c.line)
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.SpaceAround) {
            for ((key, icon, label) in tabs) {
                val on = key == tab
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).clickable { onSelect(key) }
                        .semantics {
                            contentDescription = label
                            role = Role.Tab
                            selected = on
                        }
                        .padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.width(56.dp).height(30.dp).clip(RoundedCornerShape(15.dp)).background(if (on) c.accentSoft else Color.Transparent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(painterResource(icon), null, tint = if (on) c.accent else c.muted, modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(label, color = if (on) c.text else c.muted, fontSize = 12.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium, maxLines = 1)
                }
            }
        }
    }
}
